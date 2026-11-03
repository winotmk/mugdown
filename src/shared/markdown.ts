import { fromMarkdown } from "mdast-util-from-markdown";

// Keep existing front matter byte-for-byte. It is an extension, never a document model.
export function splitMarkdown(raw: string) {
  const match =
    /^(\uFEFF?(?:---|\+\+\+)[ \t]*\r?\n)([\s\S]*?)(^\s*(?:---|\+\+\+)[ \t]*(?:\r?\n|$))/m.exec(
      raw,
    );
  if (
    !match ||
    match.index !== 0 ||
    match[1].trim().replace("\uFEFF", "") !== match[3].trim()
  )
    return { header: "", body: raw };
  // Avoid treating an ordinary thematic break followed by prose as metadata.
  if (!/^\s*(?:[\w"'-]+\s*[:=]|#)/m.test(match[2]))
    return { header: "", body: raw };
  return { header: match[0], body: raw.slice(match[0].length) };
}
export function protectComments(body: string, marker = "mugdown-comment") {
  const replacements: { start: number; end: number; text: string }[] = [];
  const walk = (node: any) => {
    if (
      node.type === "html" &&
      node.position &&
      /^<!--[\s\S]*-->$/.test(String(node.value).trim())
    ) {
      const start = node.position.start.offset,
        end = node.position.end.offset;
      replacements.push({
        start,
        end,
        text: "```" + marker + "\n" + body.slice(start, end) + "\n```",
      });
    }
    node.children?.forEach(walk);
  };
  walk(fromMarkdown(body));
  for (const r of replacements.sort((a, b) => b.start - a.start))
    body = body.slice(0, r.start) + r.text + body.slice(r.end);
  return body;
}
export function restoreComments(body: string, marker = "mugdown-comment") {
  return body.replace(
    new RegExp(
      "```" +
        marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
        "\\r?\\n(<!--[\\s\\S]*?-->)\\r?\\n```",
      "g",
    ),
    "$1",
  );
}
export function imageFolder(path: string) {
  return path.replace(/\.(?:md|markdown|mdown|mkd|txt)$/i, "");
}
export function wordCount(raw: string) {
  const body = splitMarkdown(raw)
    .body.replace(/```[\s\S]*?```/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  const han = body.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  return (
    han +
    (body
      .replace(/[\u3400-\u9fff]/g, " ")
      .match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length ?? 0)
  );
}
