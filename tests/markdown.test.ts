import { describe, expect, it } from "vitest";
import {
  splitMarkdown,
  protectComments,
  restoreComments,
  wordCount,
} from "../src/shared/markdown";
import { fromMarkdown } from "mdast-util-from-markdown";
import { markRichExtensions } from "../src/shared/rich-syntax";
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
    const tree = fromMarkdown(raw);
    markRichExtensions(tree, raw, "test");
    expect(tree.children[1]).toMatchObject({
      type: "code",
      lang: "test",
      value: "<!-- secret comment -->",
    });
  });
  it("keeps inline HTML inside a numbered list without swallowing neighboring text", () => {
    const raw =
      "1. Press <kbd>Ctrl</kbd> + <kbd>O</kbd> to open.\n2. Next step.";
    const tree = fromMarkdown(raw);
    markRichExtensions(tree, raw);
    expect(tree.children[0]).toMatchObject({
      type: "list",
      ordered: true,
      children: [
        {
          type: "listItem",
          children: [
            {
              type: "paragraph",
              children: [
                { type: "text", value: "Press " },
                { type: "mugdownInlineHtml", value: "<kbd>Ctrl</kbd>" },
                { type: "text", value: " + " },
                { type: "mugdownInlineHtml", value: "<kbd>O</kbd>" },
                { type: "text", value: " to open." },
              ],
            },
          ],
        },
        { type: "listItem", children: [{ type: "paragraph" }] },
      ],
    });
  });
  it("preserves a details block with Markdown between blank lines", () => {
    const block =
      "<details>\r\n<summary>Show image</summary>\r\n\r\n![Example](example.png)\r\n\r\n</details>";
    const raw = block + "\r\n\r\n## The next heading\r\n";
    const tree = fromMarkdown(raw);
    markRichExtensions(tree, raw);
    expect(tree.children).toMatchObject([
      { type: "winotypoExtension", kind: "html", value: block },
      { type: "heading" },
    ]);
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
