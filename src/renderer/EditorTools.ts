import type { EditorView } from "@milkdown/kit/prose/view";
import { DOMParser, DOMSerializer } from "@milkdown/kit/prose/model";
import { AllSelection, TextSelection } from "@milkdown/kit/prose/state";
import DOMPurify from "dompurify";
import type { EditorView as SourceView } from "@codemirror/view";
import MarkdownIt from "markdown-it";

export interface SearchResult {
  count: number;
  index: number;
}

export function richContextAt(view: EditorView, x: number, y: number) {
  const at = view.posAtCoords({ left: x, top: y });
  if (!at) return;
  const { from, to } = view.state.selection;
  if (at.pos < from || at.pos > to || from === to)
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.near(view.state.doc.resolve(at.pos)),
      ),
    );
}
export async function richEdit(view: EditorView, name: string) {
  const { state } = view,
    { from, to } = state.selection;
  if (name === "select-all") {
    view.dispatch(state.tr.setSelection(new AllSelection(state.doc)));
    view.focus();
    return;
  }
  if (["copy", "copy-plain", "copy-html", "cut"].includes(name)) {
    if (state.selection.empty) return;
    const text = state.doc.textBetween(from, to, "\n", (node) =>
      node.type.name.includes("image") ? String(node.attrs.alt ?? "") : "",
    );
    const container = document.createElement("div");
    container.append(
      DOMSerializer.fromSchema(state.schema).serializeFragment(
        state.selection.content().content,
      ),
    );
    const html = DOMPurify.sanitize(container.innerHTML);
    await window.mugdown.writeClipboard(
      name === "copy-html"
        ? { text: html }
        : { text, ...(name !== "copy-plain" ? { html } : {}) },
    );
    if (name === "cut" && !view.isDestroyed && view.state.doc.eq(state.doc))
      view.dispatch(
        view.state.tr
          .setSelection(state.selection)
          .deleteSelection()
          .scrollIntoView(),
      );
  } else if (name === "paste" || name === "paste-plain") {
    const data = await window.mugdown.readClipboard();
    if (view.isDestroyed || !view.state.doc.eq(state.doc)) return;
    let tr = view.state.tr.setSelection(state.selection);
    if (name === "paste" && data.html) {
      const dom = document.createElement("div");
      dom.innerHTML = DOMPurify.sanitize(data.html);
      tr = tr.replaceSelection(
        DOMParser.fromSchema(state.schema).parseSlice(dom, {
          preserveWhitespace: true,
        }),
      );
    } else {
      const lines = data.text.replace(/\r\n?/g, "\n").split("\n");
      if (lines.length === 1) tr = tr.insertText(data.text);
      else {
        const dom = document.createElement("div");
        for (const line of lines) {
          const p = document.createElement("p");
          p.textContent = line;
          dom.append(p);
        }
        tr = tr.replaceSelection(
          DOMParser.fromSchema(state.schema).parseSlice(dom),
        );
      }
    }
    view.dispatch(tr.scrollIntoView());
  } else if (
    [
      "paragraph-before",
      "paragraph-after",
      "duplicate-block",
      "delete-block",
    ].includes(name)
  ) {
    const { $from } = state.selection;
    // Work on the current text block, retaining surrounding quotes/lists whenever their schema permits.
    const depth = $from.depth || 1;
    const start = $from.depth ? $from.before(depth) : from;
    const node = state.doc.nodeAt(start);
    if (!node) return;
    const end = start + node.nodeSize;
    let tr = state.tr;
    if (name === "delete-block") tr = tr.delete(start, end);
    else {
      const pos = name === "paragraph-before" ? start : end;
      const inserted =
        name === "duplicate-block"
          ? node
          : state.schema.nodes.paragraph.create();
      tr = tr
        .insert(pos, inserted)
        .setSelection(
          TextSelection.near(
            tr.doc.resolve(Math.min(pos + 1, tr.doc.content.size)),
          ),
        );
    }
    view.dispatch(tr.scrollIntoView());
  }
  if (!view.isDestroyed) view.focus();
}
function matches(text: string, query: string, offset: number) {
  const result: { from: number; to: number }[] = [];
  if (!query) return result;
  for (
    let at = text.indexOf(query);
    at >= 0;
    at = text.indexOf(query, at + query.length)
  )
    result.push({ from: offset + at, to: offset + at + query.length });
  return result;
}
export function richSearch(
  view: EditorView,
  query: string,
  backwards = false,
  replacement?: string,
  all = false,
): SearchResult {
  const { state } = view;
  const found: { from: number; to: number }[] = [];
  state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    found.push(
      ...matches(
        node.textBetween(0, node.content.size, "", "\ufffc"),
        query,
        pos + 1,
      ),
    );
    return false;
  });
  if (!found.length) return { count: 0, index: 0 };
  let index = backwards
    ? found.map((m) => m.to <= state.selection.from).lastIndexOf(true)
    : found.findIndex((m) => m.from >= state.selection.to);
  if (index < 0) index = backwards ? found.length - 1 : 0;
  if (replacement !== undefined) {
    const selected = found.findIndex(
      (m) => m.from === state.selection.from && m.to === state.selection.to,
    );
    if (all) {
      let tr = state.tr;
      for (const match of [...found].reverse())
        tr = tr.insertText(replacement, match.from, match.to);
      view.dispatch(tr.scrollIntoView());
      view.focus();
      return { count: found.length, index: 0 };
    }
    if (selected >= 0) {
      view.dispatch(
        state.tr
          .insertText(replacement, found[selected].from, found[selected].to)
          .scrollIntoView(),
      );
      return richSearch(view, query, backwards);
    }
  }
  const match = found[index];
  view.dispatch(
    state.tr
      .setSelection(TextSelection.create(state.doc, match.from, match.to))
      .scrollIntoView(),
  );
  view.focus();
  return { count: found.length, index: index + 1 };
}
const markdown = new MarkdownIt({ html: true });
export async function sourceEdit(view: SourceView, name: string, code = false) {
  view.focus();
  const { state } = view,
    { from, to } = state.selection.main;
  if (name === "select-all")
    view.dispatch({ selection: { anchor: 0, head: state.doc.length } });
  else if (["copy", "copy-plain", "copy-html", "cut"].includes(name)) {
    if (from === to) return;
    const text = state.sliceDoc(from, to),
      html = DOMPurify.sanitize(
        code
          ? "<pre><code>" +
              text
                .replaceAll("&", "&amp;")
                .replaceAll("<", "&lt;")
                .replaceAll(">", "&gt;") +
              "</code></pre>"
          : markdown.render(text),
      );
    await window.mugdown.writeClipboard({
      text: name === "copy-html" ? html : text,
    });
    if (
      name === "cut" &&
      view.dom.isConnected &&
      view.state.doc.eq(state.doc)
    ) {
      view.focus();
      view.dispatch({
        changes: { from, to, insert: "" },
        selection: { anchor: from },
      });
    }
  } else if (name === "paste" || name === "paste-plain") {
    const data = await window.mugdown.readClipboard();
    if (view.dom.isConnected && view.state.doc.eq(state.doc)) {
      view.focus();
      view.dispatch({
        changes: { from, to, insert: data.text },
        selection: { anchor: from + data.text.length },
      });
    }
  } else {
    const line = state.doc.lineAt(from),
      last = state.doc.lineAt(to);
    if (name === "delete-block")
      view.dispatch({
        changes: {
          from: line.from,
          to: Math.min(state.doc.length, last.to + 1),
          insert: "",
        },
        selection: { anchor: line.from },
      });
    else if (name === "duplicate-block")
      view.dispatch({
        changes: {
          from: last.to,
          insert: "\n" + state.sliceDoc(line.from, last.to),
        },
        selection: { anchor: last.to + 1 },
      });
    else if (name === "paragraph-before")
      view.dispatch({
        changes: { from: line.from, insert: "\n" },
        selection: { anchor: line.from },
      });
    else if (name === "paragraph-after")
      view.dispatch({
        changes: { from: last.to, insert: "\n" },
        selection: { anchor: last.to + 1 },
      });
  }
  if (view.dom.isConnected) view.focus();
}
export function sourceSearch(
  view: SourceView,
  query: string,
  backwards = false,
  replacement?: string,
  all = false,
): SearchResult {
  const { state } = view,
    found = matches(state.doc.toString(), query, 0);
  if (!found.length) return { count: 0, index: 0 };
  let index = backwards
    ? found.map((m) => m.to <= state.selection.main.from).lastIndexOf(true)
    : found.findIndex((m) => m.from >= state.selection.main.to);
  if (index < 0) index = backwards ? found.length - 1 : 0;
  if (replacement !== undefined) {
    if (all) {
      view.dispatch({
        changes: found.map((m) => ({ ...m, insert: replacement })),
      });
      view.focus();
      return { count: found.length, index: 0 };
    }
    const selected = found.find(
      (m) =>
        m.from === state.selection.main.from &&
        m.to === state.selection.main.to,
    );
    if (selected) {
      view.dispatch({
        changes: { ...selected, insert: replacement },
        selection: { anchor: selected.from + replacement.length },
      });
      return sourceSearch(view, query, backwards);
    }
  }
  view.dispatch({
    selection: { anchor: found[index].from, head: found[index].to },
    scrollIntoView: true,
  });
  view.focus();
  return { count: found.length, index: index + 1 };
}
