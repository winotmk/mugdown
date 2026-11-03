import { t } from "../i18n";
import { $node, $remark, $view } from "@milkdown/kit/utils";
import DOMPurify from "dompurify";
import MarkdownIt from "markdown-it";
import deflist from "markdown-it-deflist";
import { markRichExtensions } from "../shared/rich-syntax";

const markdown = new MarkdownIt({ html: true }).use(deflist);
const previewOptions = {
  FORBID_TAGS: [
    "script",
    "style",
    "iframe",
    "object",
    "embed",
    "form",
    "input",
    "button",
    "base",
    "link",
    "meta",
  ],
  FORBID_ATTR: ["style", "autoplay", "srcset"],
};

function showPreview(target: HTMLElement, html: string, documentId: string) {
  target.innerHTML = DOMPurify.sanitize(html, previewOptions);
  for (const media of target.querySelectorAll("video,audio")) {
    media.setAttribute("preload", "none");
    media.setAttribute("controls", "");
  }
  for (const image of target.querySelectorAll("img[src]")) {
    const url = image.getAttribute("src")!;
    void window.mugdown
      .imageSource(documentId, url)
      .then((src) => {
        if (target.contains(image)) image.setAttribute("src", src);
      })
      .catch(() => {});
  }
}

export function blogExtensions(marker: string, articleId: string) {
  const remark = $remark(
    "winotypo-extensions",
    () => () => (tree: any, file: unknown) => {
      markRichExtensions(tree, String(file), marker);
    },
  );
  const inline = $node("mugdown_inline_html", () => ({
    group: "inline",
    inline: true,
    atom: true,
    attrs: { raw: { default: "" } },
    toDOM: (node) => [
      "span",
      { "data-mugdown-inline-html": node.attrs.raw },
      node.attrs.raw,
    ],
    parseDOM: [
      {
        tag: "span[data-mugdown-inline-html]",
        getAttrs: (dom: HTMLElement) => ({
          raw: dom.getAttribute("data-mugdown-inline-html") ?? "",
        }),
      },
    ],
    parseMarkdown: {
      match: (node) => node.type === "mugdownInlineHtml",
      runner: (state, node, type) => {
        state.addNode(type, { raw: node.value ?? "" });
      },
    },
    toMarkdown: {
      match: (node) => node.type.name === "mugdown_inline_html",
      runner: (state, node) => {
        if (node.attrs.raw) state.addNode("html", undefined, node.attrs.raw);
      },
    },
  }));
  const inlineView = $view(inline, () => (initial) => {
    const dom = document.createElement("span");
    dom.className = "inline-html-fragment";
    dom.title = "HTML";
    dom.contentEditable = "false";
    let raw: string | undefined;
    const render = (value: string) => {
      if (value === raw) return;
      raw = value;
      showPreview(dom, markdown.renderInline(raw), articleId);
    };
    render(initial.attrs.raw);
    return {
      dom,
      update(node) {
        if (node.type !== initial.type) return false;
        render(node.attrs.raw);
        return true;
      },
      stopEvent: (event) =>
        event.target instanceof Element && !!event.target.closest("a"),
      ignoreMutation: () => true,
    };
  });
  const schema = $node("blog_extension", () => ({
    group: "block",
    atom: true,
    isolating: true,
    attrs: { raw: { default: "" }, kind: { default: "html" } },
    toDOM: (node) => [
      "section",
      { "data-blog-extension": node.attrs.kind, "data-raw": node.attrs.raw },
      node.attrs.raw,
    ],
    parseDOM: [
      {
        tag: "section[data-blog-extension]",
        getAttrs: (dom: HTMLElement) => ({
          raw: dom.dataset.raw ?? "",
          kind: dom.dataset.blogExtension ?? "html",
        }),
      },
    ],
    parseMarkdown: {
      match: (node) => node.type === "winotypoExtension",
      runner: (state, node, type) => {
        state.addNode(type, { raw: node.value, kind: node.kind });
      },
    },
    toMarkdown: {
      match: (node) => node.type.name === "blog_extension",
      runner: (state, node) => {
        // Milkdown drops an empty value; mdast's HTML boundary check requires
        // a string. An emptied fragment has no output.
        if (node.attrs.raw) state.addNode("html", undefined, node.attrs.raw);
      },
    },
  }));
  const view = $view(schema, () => (initialNode, editor, getPos) => {
    let current = initialNode,
      renderedRaw: string | undefined,
      renderedKind: string | undefined;
    const dom = document.createElement("section");
    dom.className = "blog-extension";
    dom.contentEditable = "false";
    const tools = document.createElement("div"),
      label = document.createElement("span"),
      edit = document.createElement("button");
    tools.className = "extension-tools";
    edit.textContent = t("编辑片段");
    edit.type = "button";
    edit.setAttribute("aria-label", t("编辑扩展片段"));
    tools.append(label, edit);
    const preview = document.createElement("div");
    preview.className = "extension-preview";
    const source = document.createElement("div"),
      textarea = document.createElement("textarea");
    source.className = "extension-source";
    source.hidden = true;
    textarea.setAttribute("aria-label", t("扩展片段内容"));
    textarea.placeholder = t("输入 HTML 源码…");
    textarea.spellcheck = false;
    const actions = document.createElement("div"),
      apply = document.createElement("button"),
      cancel = document.createElement("button");
    apply.textContent = t("应用");
    apply.type = cancel.type = "button";
    apply.className = "secondary";
    cancel.textContent = t("取消");
    cancel.className = "text-button";
    actions.append(apply, cancel);
    source.append(textarea, actions);
    dom.append(tools, preview, source);
    const render = () => {
      const raw = String(current.attrs.raw ?? "");
      const kind = current.attrs.kind;
      if (raw === renderedRaw && kind === renderedKind) return;
      renderedRaw = raw;
      renderedKind = kind;
      dom.dataset.kind = kind;
      label.textContent =
        current.attrs.kind === "html"
          ? "HTML"
          : current.attrs.kind === "definition"
            ? t("定义列表")
            : t("博客模板");
      let html = markdown.render(raw);
      if (current.attrs.kind === "template") {
        const figure =
          /\{\{[<%]\s*figure\b[\s\S]*?\bsrc\s*=\s*["']([^"']+)["']/.exec(raw);
        const asset = /\{%\s*asset_img\s+([^\s%]+)/.exec(raw);
        if (figure || asset) {
          const image = document.createElement("img");
          image.src = (figure?.[1] ?? asset![1])!;
          image.alt = t("模板图片");
          html = image.outerHTML;
        }
      }
      showPreview(preview, html, articleId);
    };
    const open = () => {
      textarea.value = current.attrs.raw;
      source.hidden = false;
      preview.hidden = true;
      edit.hidden = true;
      textarea.focus();
    };
    edit.onclick = open;
    const close = () => {
      source.hidden = true;
      preview.hidden = false;
      edit.hidden = false;
    };
    const remove = () => {
      const pos = getPos();
      if (typeof pos === "number")
        editor.dispatch(editor.state.tr.delete(pos, pos + current.nodeSize));
      editor.focus();
    };
    cancel.onclick = () => {
      if (!current.attrs.raw) remove();
      else close();
    };
    apply.onclick = () => {
      if (!textarea.value.trim()) {
        remove();
        return;
      }
      const pos = getPos();
      if (typeof pos === "number")
        editor.dispatch(
          editor.state.tr.setNodeMarkup(pos, undefined, {
            ...current.attrs,
            raw: textarea.value,
          }),
        );
      close();
      editor.focus();
    };
    render();
    if (!initialNode.attrs.raw)
      requestAnimationFrame(() => {
        if (dom.isConnected && !current.attrs.raw) open();
      });
    return {
      dom,
      update(node) {
        if (node.type !== current.type) return false;
        current = node;
        render();
        return true;
      },
      stopEvent: (event) =>
        !!(event.target as Element).closest(
          "textarea,button,a,summary,video,audio",
        ),
      ignoreMutation: () => true,
    };
  });
  return [...remark, schema, view, inline, inlineView];
}
