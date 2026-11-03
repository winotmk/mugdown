// Only these inline HTML tags become editable marks. Other HTML stays in its preserved fragment.
export interface InlineNode {
  type: string;
  value?: string;
  children?: InlineNode[];
  attrs?: Record<string, string>;
}
export function safeColor(value: string) {
  return /^#[\da-f]{6}$/i.test(value) ? value.toLowerCase() : null;
}
export function inlineBreak(value: string) {
  return /^<br\s*\/?\s*>$/i.test(value.trim());
}
export function inlineTag(value: string) {
  const close = /^<\/(u|mark|span)\s*>$/i.exec(value);
  if (close) return { tag: close[1].toLowerCase(), close: true, attrs: {} };
  const simple = /^<(u|mark)\s*>$/i.exec(value);
  if (simple) return { tag: simple[1].toLowerCase(), close: false, attrs: {} };
  const styled = /^<(mark|span)\s+style=(?:"([^"]*)"|'([^']*)')\s*>$/i.exec(
    value,
  );
  if (!styled) return null;
  const attrs: Record<string, string> = {};
  for (const declaration of (styled[2] ?? styled[3])
    .split(";")
    .filter((s) => s.trim())) {
    const match = /^\s*(color|background-color)\s*:\s*(#[\da-f]{6})\s*$/i.exec(
      declaration,
    );
    if (!match) return null;
    attrs[match[1].toLowerCase() === "color" ? "color" : "background"] =
      safeColor(match[2])!;
  }
  if (!Object.keys(attrs).length) return null;
  return { tag: styled[1].toLowerCase(), close: false, attrs };
}
export function editableInlineChildren(
  children: InlineNode[],
): InlineNode[] | null {
  const root: InlineNode[] = [];
  const stack: { tag: string; children: InlineNode[] }[] = [
    { tag: "", children: root },
  ];
  for (const original of children) {
    if (original.type === "html") {
      if (inlineBreak(original.value ?? "")) {
        stack.at(-1)!.children.push(original);
        continue;
      }
      const tag = inlineTag(original.value ?? "");
      if (!tag) return null;
      if (tag.close) {
        if (stack.length === 1 || stack.at(-1)!.tag !== tag.tag) return null;
        stack.pop();
      } else {
        const node: InlineNode = {
          type: "winotypoInline",
          attrs: {
            ...tag.attrs,
            ...(tag.tag === "u" ? { underline: "true" } : {}),
            ...(tag.tag === "mark" && !tag.attrs.background
              ? { background: "#fff1b8" }
              : {}),
          },
          children: [],
        };
        stack.at(-1)!.children.push(node);
        stack.push({ tag: tag.tag, children: node.children! });
      }
    } else {
      const nested = original.children
        ? editableInlineChildren(original.children)
        : undefined;
      if (nested === null) return null;
      stack
        .at(-1)!
        .children.push(nested ? { ...original, children: nested } : original);
    }
  }
  return stack.length === 1 ? root : null;
}
