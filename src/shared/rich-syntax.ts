import { fromMarkdown } from "mdast-util-from-markdown";
import { protectComments } from "./markdown";
import {
  editableInlineChildren,
  inlineTag,
  inlineBreak,
} from "./inline-format";

export type ExtensionKind = "html" | "template" | "definition";
interface Node {
  type: string;
  value?: string;
  children?: Node[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}
export function spaceStandaloneImages(body: string) {
  const boundaries = new Set<number>();
  for (const paragraph of (fromMarkdown(body) as Node).children ?? []) {
    if (paragraph.type !== "paragraph") continue;
    for (const image of paragraph.children ?? []) {
      if (image.type !== "image" && image.type !== "imageReference") continue;
      const start = image.position?.start.offset,
        end = image.position?.end.offset;
      if (start === undefined || end === undefined) continue;
      const lineStart = body.lastIndexOf("\n", start - 1) + 1;
      const nextNewline = body.indexOf("\n", end),
        lineEnd = nextNewline < 0 ? body.length : nextNewline;
      if (
        body.slice(lineStart, start).trim() ||
        body.slice(end, lineEnd).trim()
      )
        continue;
      if (
        lineStart &&
        body.slice(body.lastIndexOf("\n", lineStart - 2) + 1, lineStart).trim()
      )
        boundaries.add(lineStart);
      const nextLineEnd = body.indexOf("\n", lineEnd + 1);
      if (
        lineEnd < body.length &&
        body
          .slice(lineEnd + 1, nextLineEnd < 0 ? body.length : nextLineEnd)
          .trim()
      )
        boundaries.add(lineEnd + 1);
    }
  }
  for (const offset of [...boundaries].sort((a, b) => b - a))
    body = body.slice(0, offset) + "\n" + body.slice(offset);
  return body;
}
// Keep each embedded fragment intact while the rest of the document remains rich text.
export function prepareRichBody(body: string, marker: string) {
  body = spaceStandaloneImages(body);
  const replacements: { start: number; end: number; kind: ExtensionKind }[] =
    [];
  function visit(node: Node) {
    const start = node.position?.start.offset,
      end = node.position?.end.offset;
    if (node.type === "code" || node.type === "inlineCode") return;
    if (start !== undefined && end !== undefined) {
      const raw = body.slice(start, end);
      const contains = (type: string): boolean =>
        node.children?.some(
          (child) =>
            child.type === type || child.children?.some((n) => n.type === type),
        ) ?? false;
      const template = (n: Node): boolean =>
        (n.type === "text" && /\{%|\{\{[<%]/.test(n.value ?? "")) ||
        (n.type !== "inlineCode" && !!n.children?.some(template));
      const kind: ExtensionKind | null =
        node.type === "html" &&
        !raw.trim().startsWith("<!--") &&
        !inlineTag(raw) &&
        !inlineBreak(raw)
          ? "html"
          : node.type === "paragraph" &&
              contains("html") &&
              !editableInlineChildren(node.children ?? []) &&
              !/^<!--[\s\S]*-->$/.test(raw.trim())
            ? "html"
            : node.type === "paragraph" && /^:[ \t]+\S/m.test(raw)
              ? "definition"
              : node.type === "paragraph" && template(node)
                ? "template"
                : null;
      if (kind) {
        replacements.push({ start, end, kind });
        return;
      }
    }
    const children = node.children ?? [];
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const opening =
        child.type === "html" &&
        /^\s*<(details|div|table|section|figure|video|audio)\b/i.exec(
          child.value ?? "",
        );
      if (opening && child.position?.start.offset !== undefined) {
        const tags = new RegExp("<(\\/?)" + opening[1] + "\\b[^>]*>", "gi");
        let depth = 0,
          found = false;
        for (let j = i; j < children.length; j++) {
          const sibling = children[j];
          if (sibling.type === "html")
            for (const tag of (sibling.value ?? "").matchAll(tags))
              depth += tag[1] ? -1 : 1;
          if (depth === 0 && sibling.position?.end.offset !== undefined) {
            if (j > i) {
              replacements.push({
                start: child.position.start.offset,
                end: sibling.position.end.offset,
                kind: "html",
              });
              i = j;
              found = true;
            }
            break;
          }
        }
        if (found) continue;
      }
      visit(child);
    }
  }
  visit(fromMarkdown(body) as Node);
  for (const item of replacements.sort((a, b) => b.start - a.start)) {
    const raw = body.slice(item.start, item.end);
    const length = Math.max(
      3,
      ...[...raw.matchAll(/`+/g)].map((m) => m[0].length + 1),
    );
    const fence = "`".repeat(length);
    body =
      body.slice(0, item.start) +
      fence +
      marker +
      "-" +
      item.kind +
      "\n" +
      raw +
      "\n" +
      fence +
      body.slice(item.end);
  }
  return protectComments(body, marker);
}
