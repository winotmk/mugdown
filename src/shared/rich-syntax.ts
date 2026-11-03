import { fromMarkdown } from "mdast-util-from-markdown";
import { editableInlineChildren, type InlineNode } from "./inline-format";

export type ExtensionKind = "html" | "template" | "definition";
interface Node extends InlineNode {
  children?: Node[];
  position?: {
    start: { offset?: number; column?: number };
    end: { offset?: number };
  };
  kind?: ExtensionKind;
  lang?: string | null;
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
export const prepareRichBody = spaceStandaloneImages;

const phrasing = new Set([
  "paragraph",
  "heading",
  "tableCell",
  "emphasis",
  "strong",
  "delete",
  "link",
  "linkReference",
]);
const voidTags = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);
const pairedBlocks =
  /^(?:article|aside|blockquote|details|div|figure|footer|header|main|nav|section|table|video|audio)$/i;
const hasHtml = (node: Node): boolean =>
  node.type === "html" || !!node.children?.some(hasHtml);
const hasTemplate = (node: Node): boolean =>
  (node.type === "text" && /\{%|\{\{[<%]/.test(node.value ?? "")) ||
  !!node.children?.some(hasTemplate);

// Run on Milkdown's Markdown tree, after Markdown has parsed list and quote
// nesting. Inserting temporary fences into the source can break that nesting.
export function markRichExtensions(
  tree: Node,
  source: string,
  commentMarker?: string,
) {
  function rawBetween(first: Node, last: Node = first, indent = 0) {
    const start = first.position?.start.offset;
    const end = last.position?.end.offset;
    if (start === undefined || end === undefined) return first.value ?? "";
    const raw = source.slice(start, end);
    if (!indent) return raw;
    // Strip only the parent list/quote prefix on continuation lines. The
    // Markdown serializer will put it back when it serializes that container.
    return raw.replace(/(\r?\n)([^\r\n]*)/g, (_, eol: string, line: string) => {
      const prefix = line.slice(0, indent).match(/^[ \t>]*/)?.[0] ?? "";
      return eol + line.slice(prefix.length);
    });
  }
  function tagEnd(nodes: Node[], start: number, name: string) {
    const tags = new RegExp(
      "<(\\/?)" + name + "(?=[\\s/>])(?:\"[^\"]*\"|'[^']*'|[^\"'<>])*>",
      "gi",
    );
    let depth = 0;
    for (let j = start; j < nodes.length; j++) {
      if (nodes[j].type !== "html") continue;
      for (const tag of (nodes[j].value ?? "").matchAll(tags)) {
        if (tag[1]) depth--;
        else if (!tag[0].endsWith("/>")) depth++;
      }
      if (depth === 0) return j;
    }
    return -1;
  }
  const extension = (raw: string, kind: ExtensionKind): Node => ({
    type: "winotypoExtension",
    value: raw,
    kind,
  });
  function visit(node: Node, indent = 0) {
    // Milkdown's default HTML plugin wraps each flow HTML node in a paragraph
    // with the very same source span. Recover those flow nodes for our preview.
    const children = phrasing.has(node.type)
      ? node.children
      : node.children?.map((child) => {
          const leaf = child.children?.[0];
          return child.type === "paragraph" &&
            child.children?.length === 1 &&
            leaf?.type === "html" &&
            child.position?.start.offset !== undefined &&
            child.position.start.offset === leaf.position?.start.offset &&
            child.position.end.offset === leaf.position?.end.offset
            ? leaf
            : child;
        });
    if (!children?.length) return;
    if (phrasing.has(node.type)) {
      if (!hasHtml(node) || editableInlineChildren(children)) return;
      const inline = (first: Node, last: Node = first): Node => ({
        type: "mugdownInlineHtml",
        value: rawBetween(first, last, indent),
      });
      const result: Node[] = [];
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (child.type !== "html") {
          visit(child, indent);
          result.push(child);
          continue;
        }
        const text = child.value ?? "";
        const opening = /^<([a-z][\w:-]*)(?=[\s/>])/i.exec(text);
        if (
          !opening ||
          voidTags.has(opening[1].toLowerCase()) ||
          text.endsWith("/>")
        ) {
          result.push(inline(child));
          continue;
        }
        const end = tagEnd(children, i, opening[1]);
        if (end < 0) {
          // Malformed or crossing tags: keep the original phrasing intact.
          node.children = [inline(children[0], children[children.length - 1])];
          return;
        }
        const group = children.slice(i, end + 1);
        if (editableInlineChildren(group)) result.push(...group);
        else result.push(inline(child, children[end]));
        i = end;
      }
      node.children = result;
      return;
    }
    const result: Node[] = [];
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const nested = node.type === "listItem" || node.type === "blockquote";
      const column = nested
        ? Math.max(0, (child.position?.start.column ?? 1) - 1)
        : indent;
      if (child.type === "html") {
        const opening = /^\s*<([a-z][\w:-]*)(?=[\s/>])/i.exec(
          child.value ?? "",
        );
        const end =
          opening && pairedBlocks.test(opening[1])
            ? tagEnd(children, i, opening[1])
            : i;
        const last = Math.max(i, end);
        const raw = rawBetween(child, children[last], column);
        result.push(
          node.type === "root" &&
            commentMarker &&
            /^<!--[\s\S]*-->$/.test(raw.trim())
            ? { type: "code", value: raw, lang: commentMarker }
            : extension(raw, "html"),
        );
        i = last;
      } else if (
        child.type === "paragraph" &&
        !hasHtml(child) &&
        !(node.type === "listItem" && i === 0)
      ) {
        const raw = rawBetween(child, child, column);
        const kind = /^:[ \t]+\S/m.test(raw)
          ? "definition"
          : hasTemplate(child)
            ? "template"
            : null;
        if (kind) result.push(extension(raw, kind));
        else result.push(child);
      } else {
        visit(child, column);
        result.push(
          child.type === "paragraph" &&
            child.children?.length === 1 &&
            child.children[0].type === "mugdownInlineHtml" &&
            !(node.type === "listItem" && i === 0)
            ? extension(rawBetween(child, child, column), "html")
            : child,
        );
      }
    }
    node.children = result;
  }
  visit(tree);
}
