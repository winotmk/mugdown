import { describe, expect, it } from "vitest";
import {
  splitMarkdown,
  protectComments,
  restoreComments,
  wordCount,
} from "../src/shared/markdown";
import { prepareRichBody } from "../src/shared/rich-syntax";
import { DocumentHistory } from "../src/shared/document-history";

describe("document fidelity", () => {
  it("keeps YAML, unknown fields, comments, BOM and CRLF verbatim", () => {
    const header =
      "\uFEFF---\r\n# old blog metadata\r\ntitle: 旧文档\r\nunknown: [a, b]\r\n---\r\n";
    const raw = header + "\r\n# 正文\r\n";
    expect(splitMarkdown(raw)).toEqual({ header, body: "\r\n# 正文\r\n" });
  });
  it("recognizes TOML but leaves ordinary horizontal rules as content", () => {
    expect(
      splitMarkdown('+++\ndate = "2026-10-21"\n+++\n正文').header,
    ).toContain("date =");
    expect(splitMarkdown("---\n这是正文\n---\n下一段").header).toBe("");
    expect(splitMarkdown("---\ntitle: incomplete").header).toBe("");
  });
  it("preserves standalone HTML comments through rich editor parsing", () => {
    const raw = "正文\n\n<!-- secret comment -->\n\n末尾";
    expect(restoreComments(protectComments(raw, "test"), "test")).toBe(raw);
    expect(prepareRichBody(raw, "test")).toContain("<!-- secret comment -->");
  });
  it("counts Chinese characters and English words without metadata", () => {
    expect(wordCount("---\ntitle: not counted\n---\n你好 world again")).toBe(4);
  });
  it("keeps undo history across editor replacements", () => {
    const h = new DocumentHistory();
    h.open("d", "hello");
    h.record("d", "hello", "hello world", "visual");
    h.boundary("d");
    h.record("d", "hello world", "hello world!", "source");
    expect(h.undo("d", "hello world!")).toBe("hello world");
    expect(h.undo("d", "hello world")).toBe("hello");
    expect(h.redo("d", "hello")).toBe("hello world");
  });
});
