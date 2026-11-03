import { t } from "../i18n";
import { $node, $remark, $view } from "@milkdown/kit/utils";
import DOMPurify from "dompurify";
import MarkdownIt from "markdown-it";
import deflist from "markdown-it-deflist";

const markdown = new MarkdownIt({ html: true }).use(deflist);
export function blogExtensions(marker: string, articleId: string) {
  const remark = $remark("winotypo-extensions", () => () => (tree: any) => {
    const visit = (node: any) => {
      if (node.type === "code" && String(node.lang).startsWith(marker + "-")) {
        node.kind = node.lang.slice(marker.length + 1);
        node.type = "winotypoExtension";
      }
      node.children?.forEach(visit);
    };
    visit(tree);
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
        state.addNode("html", undefined, node.attrs.raw);
      },
    },
  }));
  const view = $view(schema, () => (initialNode, editor, getPos) => {
    let current = initialNode,
      disposed = false;
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
      label.textContent =
        current.attrs.kind === "html"
          ? "HTML"
          : current.attrs.kind === "definition"
            ? t("定义列表")
            : t("博客模板");
      const raw = String(current.attrs.raw);
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
      preview.innerHTML = DOMPurify.sanitize(html, {
        FORBID_TAGS: [
          "script",
          "style",
          "iframe",
          "object",
          "embed",
          "form",
          "input",
          "button",
        ],
        FORBID_ATTR: ["style", "autoplay"],
      });
      preview.querySelectorAll("video,audio").forEach((media) => {
        media.setAttribute("preload", "none");
        media.setAttribute("controls", "");
      });
      preview.querySelectorAll("img").forEach((image) => {
        const url = image.getAttribute("src") ?? "";
        void window.mugdown
          .imageSource(articleId, url)
          .then((src) => {
            if (!disposed && image.isConnected) image.src = src;
          })
          .catch(() => {});
      });
    };
    preview.addEventListener("click", (event) => {
      const link = (event.target as Element).closest("a");
      if (link) {
        event.preventDefault();
        void window.mugdown.openExternal(link.href).catch(() => {});
      }
    });
    edit.onclick = () => {
      textarea.value = current.attrs.raw;
      source.hidden = false;
      preview.hidden = true;
      edit.hidden = true;
      textarea.focus();
    };
    const close = () => {
      source.hidden = true;
      preview.hidden = false;
      edit.hidden = false;
    };
    cancel.onclick = close;
    apply.onclick = () => {
      const pos = getPos();
      if (typeof pos === "number")
        editor.dispatch(
          editor.state.tr.setNodeMarkup(pos, undefined, {
            ...current.attrs,
            raw: textarea.value,
          }),
        );
      close();
    };
    render();
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
      destroy() {
        disposed = true;
      },
    };
  });
  return [...remark, schema, view];
}
