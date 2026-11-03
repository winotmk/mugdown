import { t } from "../i18n";
import { $mark, $remark } from "@milkdown/kit/utils";
import { editorViewCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import { toggleMark } from "@milkdown/kit/prose/commands";
import { editableInlineChildren, safeColor } from "../shared/inline-format";

const definitions = [
  { name: "underline", tag: "u" },
  { name: "color", tag: "span" },
  { name: "background", tag: "mark" },
] as const;
let closePalette: (() => void) | undefined;
export function closeInlinePalette() {
  closePalette?.();
}
export function inlineFormatting() {
  const remark = $remark(
    "winotypo-inline-format",
    () =>
      function (this: any) {
        const data = this.data();
        data.toMarkdownExtensions ??= [];
        data.toMarkdownExtensions.push({
          handlers: {
            winotypoInline(node: any, _parent: any, state: any, info: any) {
              const content = state.containerPhrasing(node, info);
              if (node.attrs.underline) return "<u>" + content + "</u>";
              if (node.attrs.color)
                return (
                  '<span style="color: ' +
                  safeColor(node.attrs.color) +
                  '">' +
                  content +
                  "</span>"
                );
              return (
                '<mark style="background-color: ' +
                safeColor(node.attrs.background) +
                '">' +
                content +
                "</mark>"
              );
            },
          },
        });
        return (tree: any) => {
          const visit = (node: any) => {
            if (["paragraph", "heading", "tableCell"].includes(node.type)) {
              const children = editableInlineChildren(node.children ?? []);
              if (children) node.children = children;
            } else node.children?.forEach(visit);
          };
          visit(tree);
        };
      },
  );
  return [
    ...remark,
    ...definitions.map(({ name, tag }) =>
      $mark("winotypo_" + name, () => ({
        attrs: {
          value: { default: name === "background" ? "#fff1b8" : "#000000" },
        },
        parseDOM:
          name === "underline"
            ? [
                { tag: "u" },
                {
                  style: "text-decoration",
                  getAttrs: (v: string) =>
                    v.includes("underline") ? {} : false,
                },
              ]
            : [
                {
                  style: name === "color" ? "color" : "background-color",
                  getAttrs: (v: string) => {
                    // Browser DOM styles normalize hex values to rgb.
                    const rgb = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(v);
                    const value =
                      safeColor(v) ??
                      (rgb
                        ? "#" +
                          rgb
                            .slice(1)
                            .map((n) => Number(n).toString(16).padStart(2, "0"))
                            .join("")
                        : null);
                    return value ? { value } : false;
                  },
                },
                ...(name === "background"
                  ? [{ tag: "mark", getAttrs: () => ({ value: "#fff1b8" }) }]
                  : []),
              ],
        toDOM: (mark) => {
          const value = safeColor(mark.attrs.value) ?? "#fff1b8";
          const luminance = [1, 3, 5]
            .map((at) => parseInt(value.slice(at, at + 2), 16))
            .reduce(
              (sum, channel, i) => sum + channel * [0.299, 0.587, 0.114][i],
              0,
            );
          return [
            tag,
            name === "underline"
              ? {}
              : {
                  style:
                    name === "color"
                      ? `color: ${value}; --winotypo-text-color: ${value}`
                      : `background-color: ${value}; color: var(--winotypo-text-color, ${luminance > 145 ? "#1f2328" : "#ffffff"})`,
                },
            0,
          ];
        },
        parseMarkdown: {
          match: (node) =>
            node.type === "winotypoInline" &&
            !!(node.attrs as Record<string, string>)?.[name],
          runner: (state, node, type) => {
            const attrs = node.attrs as Record<string, string>;
            // One HTML span can carry both foreground and background colors.
            for (const key of definitions)
              if (attrs[key.name])
                state.openMark(
                  state.schema.marks["winotypo_" + key.name],
                  key.name === "underline" ? {} : { value: attrs[key.name] },
                );
            state.next(node.children);
            for (const key of [...definitions].reverse())
              if (attrs[key.name])
                state.closeMark(state.schema.marks["winotypo_" + key.name]);
          },
        },
        toMarkdown: {
          match: (mark) => mark.type.name === "winotypo_" + name,
          runner: (state, mark) => {
            state.withMark(mark, "winotypoInline", undefined, {
              attrs: {
                [name]: name === "underline" ? "true" : mark.attrs.value,
              },
            });
          },
        },
      })),
    ),
  ];
}
export function formatActive(ctx: Ctx, name: string) {
  const { state } = ctx.get(editorViewCtx);
  const type = state.schema.marks["winotypo_" + name];
  return (
    !!type &&
    (state.selection.empty
      ? !!type.isInSet(state.storedMarks ?? state.selection.$from.marks())
      : state.doc.rangeHasMark(state.selection.from, state.selection.to, type))
  );
}
export function applyInline(ctx: Ctx, name: string, value?: string) {
  const view = ctx.get(editorViewCtx),
    { state } = view;
  const { from, to } = state.selection;
  if (name === "clear") {
    view.dispatch(state.tr.removeMark(from, to).setStoredMarks([]));
  } else {
    const type = state.schema.marks["winotypo_" + name];
    if (!type) return;
    if (value === "reset") {
      view.dispatch(
        state.selection.empty
          ? state.tr.removeStoredMark(type)
          : state.tr.removeMark(from, to, type),
      );
    } else if (value) {
      const color = safeColor(value);
      if (!color) return;
      view.dispatch(
        state.selection.empty
          ? state.tr.addStoredMark(type.create({ value: color }))
          : state.tr.addMark(from, to, type.create({ value: color })),
      );
    } else toggleMark(type)(state, view.dispatch);
  }
  view.focus();
}

// Ant Design's open-source base palettes; foreground and background have separate contrast ranges.
const colors = [
  "#cf1322",
  "#d4380d",
  "#d46b08",
  "#ad8b00",
  "#389e0d",
  "#08979c",
  "#096dd9",
  "#531dab",
  "#c41d7f",
];
const backgrounds = [
  "#fff1b8",
  "#ffccc7",
  "#ffd8bf",
  "#ffe7ba",
  "#d9f7be",
  "#b5f5ec",
  "#bae7ff",
  "#d6e4ff",
  "#efdbff",
  "#ffd6e7",
];
export function openColorPalette(ctx: Ctx, changed: () => void) {
  closeInlinePalette();
  const view = ctx.get(editorViewCtx),
    selection = view.state.selection;
  const palette = document.createElement("div");
  palette.className = "inline-color-palette";
  palette.setAttribute("role", "dialog");
  palette.setAttribute("aria-label", t("文字与背景颜色"));
  const rect = view.coordsAtPos(selection.from);
  Object.assign(palette.style, {
    left: Math.max(8, Math.min(rect.left, innerWidth - 270)) + "px",
    top: Math.min(rect.bottom + 12, innerHeight - 330) + "px",
  });
  const close = () => {
    palette.remove();
    document.removeEventListener("pointerdown", outside);
    document.removeEventListener("keydown", key);
    if (closePalette === close) closePalette = undefined;
  };
  closePalette = close;
  const outside = (e: PointerEvent) => {
    if (!palette.contains(e.target as Node)) close();
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      close();
      view.focus();
    }
  };
  const run = (name: string, color: string) => {
    // Do not apply a stale palette after an external document replacement.
    if (selection.$from.doc !== view.state.doc) {
      close();
      return;
    }
    view.dispatch(view.state.tr.setSelection(selection));
    applyInline(ctx, name, color);
    changed();
    close();
  };
  for (const [name, label, values] of [
    ["color", t("文字颜色"), colors],
    ["background", t("背景颜色"), backgrounds],
  ] as const) {
    const title = document.createElement("div");
    title.className = "palette-label";
    title.textContent = label;
    const grid = document.createElement("div");
    grid.className = "inline-color-grid";
    for (const color of values) {
      const button = document.createElement("button");
      button.type = "button";
      button.title = label + " " + color;
      button.setAttribute("aria-label", button.title);
      button.style.backgroundColor = color;
      button.onpointerdown = (e) => {
        e.preventDefault();
        run(name, color);
      };
      grid.append(button);
    }
    const custom = document.createElement("input");
    custom.type = "color";
    custom.value = name === "color" ? "#096dd9" : "#fff1b8";
    custom.setAttribute("aria-label", t("自定义") + label);
    custom.onchange = () => run(name, custom.value);
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "palette-reset";
    reset.textContent = t("重置") + label;
    reset.onclick = () => run(name, "reset");
    palette.append(title, grid, custom, reset);
  }
  (view.dom.closest(".app") ?? document.body).append(palette);
  setTimeout(() => {
    if (palette.isConnected) {
      document.addEventListener("pointerdown", outside);
      document.addEventListener("keydown", key);
    }
  }, 0);
  return close;
}
