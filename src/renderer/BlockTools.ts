import { t } from "../i18n";
import type { Ctx } from "@milkdown/kit/ctx";
import { editorViewCtx } from "@milkdown/kit/core";
import { BlockProvider, block, blockConfig } from "@milkdown/kit/plugin/block";
import { setBlockType, wrapIn } from "@milkdown/kit/prose/commands";
import { liftListItem, wrapInList } from "@milkdown/kit/prose/schema-list";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import type { Node } from "@milkdown/kit/prose/model";
import { richEdit } from "./EditorTools";
import { insert } from "@milkdown/kit/utils";
import { prepareRichBody } from "../shared/rich-syntax";
import { bindBlockDrag } from "./BlockDrag";

function ancestor(view: EditorView, names: string[]) {
  const { $from } = view.state.selection;
  for (let depth = $from.depth; depth > 0; depth--)
    if (names.includes($from.node(depth).type.name))
      return { depth, node: $from.node(depth), pos: $from.before(depth) };
  return null;
}
export function blockCommand(view: EditorView, name: string) {
  const { state, dispatch } = view,
    { schema } = state;
  if (name === "paragraph" || /^h[1-4]$/.test(name))
    return setBlockType(
      name === "paragraph" ? schema.nodes.paragraph : schema.nodes.heading,
      name === "paragraph" ? undefined : { level: Number(name[1]) },
    )(state, dispatch);
  if (name === "quote") {
    const parent = ancestor(view, ["blockquote"]);
    if (parent) {
      const range = state.selection.$from.blockRange(
        state.selection.$to,
        (node) => node.type.name === "blockquote",
      );
      if (!range) return false;
      dispatch(state.tr.lift(range, parent.depth - 1).scrollIntoView());
      return true;
    }
    return wrapIn(schema.nodes.blockquote)(state, dispatch);
  }
  if (name === "codeblock")
    return setBlockType(schema.nodes.code_block)(state, dispatch);
  if (["list", "ordered", "task"].includes(name)) {
    const parent = ancestor(view, ["bullet_list", "ordered_list"]);
    const type =
      name === "ordered" ? schema.nodes.ordered_list : schema.nodes.bullet_list;
    const item = ancestor(view, ["list_item"]);
    if (parent && parent.node.type === type && name !== "task")
      return liftListItem(schema.nodes.list_item)(state, dispatch);
    if (parent && parent.node.type !== type)
      dispatch(
        state.tr.setNodeMarkup(
          parent.pos,
          type,
          name === "ordered" ? { order: 1 } : {},
        ),
      );
    else if (!parent && !wrapInList(type)(state, dispatch)) return false;
    if (name === "task") {
      const current = ancestor(view, ["list_item"]);
      if (current && "checked" in current.node.attrs)
        view.dispatch(
          view.state.tr.setNodeMarkup(current.pos, undefined, {
            ...current.node.attrs,
            checked:
              typeof current.node.attrs.checked === "boolean" ? null : false,
          }),
        );
    } else {
      const list = ancestor(view, ["bullet_list", "ordered_list"]);
      if (list) {
        let tr = view.state.tr;
        let index = 0;
        list.node.forEach((node, offset) => {
          tr = tr.setNodeMarkup(list.pos + 1 + offset, undefined, {
            ...node.attrs,
            listType: name === "ordered" ? "ordered" : "bullet",
            label: name === "ordered" ? String(++index) + "." : "•",
            checked: null,
          });
        });
        view.dispatch(tr);
      }
    }
    return true;
  }
  return false;
}
function blockLabel(node: Node): string {
  if (
    (node.type.name === "bullet_list" &&
      typeof node.firstChild?.attrs.checked === "boolean") ||
    (node.type.name === "list_item" && typeof node.attrs.checked === "boolean")
  )
    return "☑";
  if (node.type.name === "heading") return "H" + node.attrs.level;
  if (node.type.name === "paragraph")
    return node.content.size === 0 ? "+" : "T";
  if (node.type.name === "blockquote")
    return node.firstChild ? blockLabel(node.firstChild) : "❞";
  return (
    (
      {
        bullet_list: "•",
        ordered_list: "1.",
        list_item: "•",
        code_block: "{}",
        table: "▦",
        "image-block": "▧",
        horizontal_rule: "—",
        blog_extension: "</>",
      } as Record<string, string>
    )[node.type.name] ?? "T"
  );
}
export function configureSemanticBlockHandle(
  ctx: Ctx,
  changed: () => void,
  error: (value: string) => void,
  marker: string,
) {
  ctx.set(blockConfig.key, {
    filterNodes: (_pos, node) =>
      !["table_row", "table_cell", "table_header"].includes(node.type.name),
  });
  ctx.set(block.key, {
    view: () => {
      const dom = document.createElement("div");
      dom.className = "milkdown-block-handle semantic-block-handle";
      const type = document.createElement("button");
      type.type = "button";
      type.className = "operation-item block-type-button";
      type.textContent = "T";
      type.setAttribute("aria-label", t("段落类型与格式"));
      const drag = document.createElement("span");
      drag.className = "operation-item block-drag-handle";
      drag.textContent = "⠿";
      drag.title = t("拖动段落");
      dom.append(type, drag);
      let menu: HTMLElement | null = null;
      const provider = new BlockProvider({
        ctx,
        content: dom,
        getOffset: () => 6,
        getPlacement: () => "left",
        getPosition: ({ active }) => {
          const label = blockLabel(active.node);
          if (label === "+") {
            type.innerHTML =
              '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
          } else type.textContent = label;
          type.dataset.blockType = active.node.type.name;
          type.title =
            label === "+" ? t("添加内容") : t("段落类型与格式 · ") + label;
          const rect = active.el.getBoundingClientRect();
          const first = active.el.matches("p,h1,h2,h3,h4,h5,h6")
            ? active.el
            : (active.el.querySelector<HTMLElement>("p,h1,h2,h3,h4,h5,h6") ??
              active.el);
          const walker = document.createTreeWalker(first, NodeFilter.SHOW_TEXT);
          let text: globalThis.Node | null;
          while ((text = walker.nextNode())) {
            if (!text.textContent?.trim()) continue;
            const range = document.createRange();
            range.setStart(text, 0);
            range.setEnd(text, Math.min(text.textContent.length, 1));
            const line = range.getBoundingClientRect();
            if (line.height)
              return new DOMRect(rect.left, line.top, rect.width, line.height);
          }
          const css = getComputedStyle(first),
            height =
              parseFloat(css.lineHeight) || parseFloat(css.fontSize) * 1.5;
          return new DOMRect(
            rect.left,
            first.getBoundingClientRect().top +
              (parseFloat(css.paddingTop) || 0),
            rect.width,
            height,
          );
        },
      });
      const destroyDrag = bindBlockDrag(
        drag,
        () =>
          provider.active
            ? { from: provider.active.$pos.pos, view: ctx.get(editorViewCtx) }
            : null,
        changed,
      );
      // The provider marks its whole container draggable; prevent the browser
      // gesture even when a pointer starts between the two compact buttons.
      dom.addEventListener(
        "dragstart",
        (event) => {
          event.preventDefault();
          event.stopImmediatePropagation();
        },
        true,
      );
      const close = () => {
        menu?.remove();
        menu = null;
        document.removeEventListener("pointerdown", outside);
        document.removeEventListener("keydown", key);
      };
      const outside = (e: PointerEvent) => {
        if (
          !menu?.contains(e.target as globalThis.Node) &&
          !dom.contains(e.target as globalThis.Node)
        )
          close();
      };
      const key = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          close();
          ctx.get(editorViewCtx).focus();
        }
      };
      const render = () => {
        if (!menu) return;
        const view = ctx.get(editorViewCtx);
        menu.replaceChildren();
        const parent = view.state.selection.$from.parent;
        const title = document.createElement("div");
        title.className = "palette-label";
        title.textContent = t("段落类型");
        menu.append(title);
        const choices = [
          ["paragraph", "T", t("普通段落")],
          ["h1", "H1", t("一级标题")],
          ["h2", "H2", t("二级标题")],
          ["h3", "H3", t("三级标题")],
          ["h4", "H4", t("四级标题")],
          ["codeblock", "{}", t("代码块")],
          ["quote", "❞", t("引用")],
          ["list", "•", t("无序列表")],
          ["ordered", "1.", t("有序列表")],
          ["task", "☑", t("任务列表")],
        ];
        for (const [name, icon, label] of choices) {
          const button = document.createElement("button");
          button.type = "button";
          button.setAttribute("role", "menuitemcheckbox");
          const active =
            name === "paragraph"
              ? parent.type.name === "paragraph"
              : name.startsWith("h") && name.length === 2
                ? parent.type.name === "heading" &&
                  parent.attrs.level === Number(name[1])
                : name === "codeblock"
                  ? parent.type.name === "code_block"
                  : name === "quote"
                    ? !!ancestor(view, ["blockquote"])
                    : name === "ordered"
                      ? !!ancestor(view, ["ordered_list"])
                      : name === "task"
                        ? typeof ancestor(view, ["list_item"])?.node.attrs
                            .checked === "boolean"
                        : !!ancestor(view, ["bullet_list"]);
          button.setAttribute("aria-checked", String(active));
          button.classList.toggle("active", active);
          const badge = document.createElement("span");
          badge.className = "block-menu-icon";
          badge.textContent = icon;
          const text = document.createElement("span");
          text.textContent = label;
          const check = document.createElement("span");
          check.textContent = active ? "✓" : "";
          check.className = "block-menu-check";
          button.append(badge, text, check);
          button.onpointerdown = (e) => e.preventDefault();
          button.onclick = () => {
            changed();
            if (!blockCommand(view, name))
              error(t("当前块不支持此转换，请先移出列表或表格。"));
            view.focus();
            changed();
            render();
          };
          menu.append(button);
        }
        const help = document.createElement("small");
        help.textContent = t("引用可与标题、列表组合");
        help.className = "block-menu-help";
        menu.append(help);
        for (const [name, label] of [
          ["image", t("插入图片")],
          ["table", t("插入表格")],
          ["divider", t("插入分隔线")],
          ["excerpt", t("插入摘要分隔线")],
        ]) {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = label;
          button.setAttribute("role", "menuitem");
          button.onpointerdown = (e) => e.preventDefault();
          button.onclick = () => {
            const run = async () => {
              changed();
              const parent = view.state.selection.$from.parent;
              if (!parent.isTextblock || parent.content.size > 0)
                await richEdit(view, "paragraph-after");
              if (name === "image") {
                const node =
                  view.state.schema.nodes["image-block"]?.createAndFill();
                if (node)
                  view.dispatch(
                    view.state.tr.replaceSelectionWith(node).scrollIntoView(),
                  );
              } else
                insert(
                  name === "table"
                    ? t("| 标题 | 内容 |\n| --- | --- |\n|  |  |\n")
                    : name === "divider"
                      ? "\n---\n"
                      : prepareRichBody("\n<!--more-->\n", marker),
                )(ctx);
              view.focus();
              changed();
              close();
            };
            void run().catch((e) => error(String(e)));
          };
          menu.append(button);
        }
        for (const [name, label] of [
          ["paragraph-before", t("在前面插入段落")],
          ["paragraph-after", t("在后面插入段落")],
          ["duplicate-block", t("创建当前段落副本")],
          ["delete-block", t("删除当前段落")],
        ]) {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = label;
          button.setAttribute("role", "menuitem");
          button.onpointerdown = (e) => e.preventDefault();
          button.onclick = () => {
            changed();
            void richEdit(view, name)
              .then(changed)
              .catch((e) => error(String(e)));
            close();
          };
          menu.append(button);
        }
      };
      type.onpointerdown = (e) => {
        e.preventDefault();
        e.stopPropagation();
      };
      type.onmousedown = (e) => {
        e.preventDefault();
        e.stopPropagation();
      };
      type.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (menu) {
          close();
          return;
        }
        const active = provider.active;
        if (!active) return;
        const view = ctx.get(editorViewCtx);
        view.dispatch(
          view.state.tr.setSelection(
            TextSelection.near(
              view.state.doc.resolve(
                Math.min(active.$pos.pos + 1, view.state.doc.content.size),
              ),
            ),
          ),
        );
        menu = document.createElement("div");
        menu.className = "block-format-menu";
        menu.setAttribute("role", "menu");
        menu.setAttribute("aria-label", t("段落格式"));
        const rect = type.getBoundingClientRect();
        const top = Math.max(8, Math.min(rect.bottom + 6, innerHeight - 580));
        Object.assign(menu.style, {
          left: Math.max(8, Math.min(rect.left, innerWidth - 235)) + "px",
          top: top + "px",
          maxHeight: innerHeight - top - 8 + "px",
        });
        // Keep floating controls in the app's theme and color-scheme scope.
        (view.dom.closest(".app") ?? document.body).append(menu);
        render();
        menu.onkeydown = (e) => {
          if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
          e.preventDefault();
          const buttons = [...menu!.querySelectorAll("button")];
          const current = buttons.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          buttons[
            e.key === "Home"
              ? 0
              : e.key === "End"
                ? buttons.length - 1
                : (current + (e.key === "ArrowDown" ? 1 : buttons.length - 1)) %
                  buttons.length
          ]?.focus();
        };
        if (e.detail === 0) menu.querySelector("button")?.focus();
        document.addEventListener("pointerdown", outside);
        document.addEventListener("keydown", key);
      };
      provider.update();
      return {
        update: () => provider.update(),
        destroy: () => {
          destroyDrag();
          close();
          provider.destroy();
        },
      };
    },
  });
}
