import { t } from "../i18n";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Crepe } from "./MiniCrepe";
import { callCommand, insert, replaceAll } from "@milkdown/kit/utils";
import {
  toggleStrongCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  wrapInHeadingCommand,
  wrapInBulletListCommand,
  wrapInOrderedListCommand,
  createCodeBlockCommand,
} from "@milkdown/kit/preset/commonmark";
import { editorViewCtx } from "@milkdown/kit/core";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { TextSelection } from "@milkdown/kit/prose/state";
import { toggleStrikethroughCommand } from "@milkdown/kit/preset/gfm";
import { undo, redo } from "@milkdown/kit/prose/history";
import { EditorView, basicSetup } from "codemirror";
import { Compartment, Transaction } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { oneDark } from "@codemirror/theme-one-dark";
import { undo as sourceUndo, redo as sourceRedo } from "@codemirror/commands";
import { restoreComments } from "../shared/markdown";
import { prepareRichBody } from "../shared/rich-syntax";
import { blogExtensions } from "./BlogExtensions";
import {
  inlineFormatting,
  applyInline,
  formatActive,
  openColorPalette,
  closeInlinePalette,
} from "./InlineFormatting";
import { blockCommand, configureSemanticBlockHandle } from "./BlockTools";
import {
  richEdit,
  sourceEdit,
  richSearch,
  sourceSearch,
  richContextAt,
  type SearchResult,
} from "./EditorTools";
import "./crepe.css";
import "@milkdown/crepe/theme/frame.css";

export interface EditorHandle {
  command(name: string): void;
  insert(text: string): void;
  focus(): void;
  flush(): void;
  replace(value: string): void;
  search(
    query: string,
    backwards?: boolean,
    replacement?: string,
    all?: boolean,
  ): SearchResult;
  contextAt(x: number, y: number): void;
}
interface Props {
  id: string;
  value: string;
  onChange(value: string): void;
  onError(message: string): void;
  dark: boolean;
  readOnly?: boolean;
}

export const RichEditor = forwardRef<EditorHandle, Props>(function RichEditor(
  { id, value, onChange, onError, readOnly = false },
  ref,
) {
  const root = useRef<HTMLDivElement>(null),
    editor = useRef<Crepe | null>(null),
    synchronize = useRef<((value: string) => void) | null>(null),
    emitLatest = useRef<(() => void) | null>(null),
    latestValue = useRef(value);
  const nestedSource = useRef<EditorView | null>(null);
  latestValue.current = value;
  const change = useRef(onChange),
    error = useRef(onError);
  change.current = onChange;
  error.current = onError;
  useImperativeHandle(
    ref,
    () => ({
      flush: () => emitLatest.current?.(),
      replace: (text) => synchronize.current?.(text),
      insert: (text) =>
        editor.current?.editor.action(insert(prepareRichBody(text))),
      focus: () =>
        editor.current?.editor.action((ctx) => ctx.get(editorViewCtx).focus()),
      search: (query, backwards, replacement, all) => {
        emitLatest.current?.();
        const result = editor.current?.editor.action((ctx) =>
          richSearch(
            ctx.get(editorViewCtx),
            query,
            backwards,
            replacement,
            all,
          ),
        ) ?? { count: 0, index: 0 };
        emitLatest.current?.();
        return result;
      },
      contextAt: (x, y) => {
        const element = document
          .elementFromPoint(x, y)
          ?.closest<HTMLElement>(".cm-editor");
        nestedSource.current =
          element && root.current?.contains(element)
            ? EditorView.findFromDOM(element)
            : null;
        const nested = nestedSource.current;
        if (nested) {
          const at = nested.posAtCoords({ x, y }),
            { from, to } = nested.state.selection.main;
          if (at != null && (at < from || at > to || from === to))
            nested.dispatch({ selection: { anchor: at } });
        } else
          editor.current?.editor.action((ctx) =>
            richContextAt(ctx.get(editorViewCtx), x, y),
          );
      },
      command: (name) => {
        const e = editor.current;
        if (!e) return;
        emitLatest.current?.();
        const nested = nestedSource.current;
        if (
          nested?.dom.isConnected &&
          [
            "cut",
            "copy",
            "paste",
            "copy-plain",
            "copy-html",
            "paste-plain",
            "select-all",
          ].includes(name)
        ) {
          void sourceEdit(nested, name, true)
            .then(() => emitLatest.current?.())
            .catch((err) => error.current(String(err)));
          return;
        }
        if (
          [
            "cut",
            "copy",
            "paste",
            "copy-plain",
            "copy-html",
            "paste-plain",
            "select-all",
            "paragraph-before",
            "paragraph-after",
            "duplicate-block",
            "delete-block",
          ].includes(name)
        ) {
          void e.editor
            .action((ctx) => richEdit(ctx.get(editorViewCtx), name))
            .then(() => emitLatest.current?.())
            .catch((err) => error.current(String(err)));
          return;
        }
        const commands: Record<string, () => void> = {
          bold: () => e.editor.action(callCommand(toggleStrongCommand.key)),
          italic: () => e.editor.action(callCommand(toggleEmphasisCommand.key)),
          code: () => e.editor.action(callCommand(toggleInlineCodeCommand.key)),
          strike: () =>
            e.editor.action(callCommand(toggleStrikethroughCommand.key)),
          heading: () =>
            e.editor.action(callCommand(wrapInHeadingCommand.key, 2)),
          list: () => e.editor.action(callCommand(wrapInBulletListCommand.key)),
          ordered: () =>
            e.editor.action(callCommand(wrapInOrderedListCommand.key)),
          quote: () =>
            e.editor.action((ctx) =>
              blockCommand(ctx.get(editorViewCtx), "quote"),
            ),
          underline: () =>
            e.editor.action((ctx) => applyInline(ctx, "underline")),
          highlight: () =>
            e.editor.action((ctx) => applyInline(ctx, "background")),
          clear: () => e.editor.action((ctx) => applyInline(ctx, "clear")),
          color: () =>
            e.editor.action((ctx) =>
              openColorPalette(ctx, () => emitLatest.current?.()),
            ),
          codeblock: () =>
            e.editor.action(callCommand(createCodeBlockCommand.key)),
          table: () =>
            e.editor.action(
              insert(t("\n| 标题 | 内容 |\n| --- | --- |\n|  |  |\n")),
            ),
          link: () => e.editor.action(insert(t("[链接文字](https://)"))),
          undo: () =>
            e.editor.action((ctx) => {
              const view = ctx.get(editorViewCtx);
              undo(view.state, view.dispatch);
            }),
          redo: () =>
            e.editor.action((ctx) => {
              const view = ctx.get(editorViewCtx);
              redo(view.state, view.dispatch);
            }),
        };
        commands[name]?.();
        emitLatest.current?.();
      },
    }),
    [],
  );
  useEffect(() => {
    if (!root.current) return;
    let disposed = false,
      ready = false,
      last = "",
      appliedValue = value;
    let lastDocument: ProseNode | null = null;
    const marker = "mugdown-comment-" + crypto.randomUUID().slice(0, 8);
    const labelComments = () => {
      root.current
        ?.querySelectorAll(".milkdown-code-block")
        .forEach((block) => {
          const label =
            block.querySelector(".language-button")?.textContent?.trim() ?? "";
          block.classList.toggle("preserved-comment", label.startsWith(marker));
          const text =
            block.querySelector(".cm-content")?.textContent ??
            block.querySelector("pre")?.textContent ??
            "";
        });
    };
    const observer = new MutationObserver(labelComments);
    observer.observe(root.current, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    const upload = async (file: File) =>
      window.mugdown.importImage(
        id,
        file.name,
        new Uint8Array(await file.arrayBuffer()),
      );
    const crepe = new Crepe({
      root: root.current,
      defaultValue: prepareRichBody(value),
      features: {
        [Crepe.Feature.AI]: false,
        [Crepe.Feature.TopBar]: false,
        [Crepe.Feature.Latex]: false,
      },
      featureConfigs: {
        [Crepe.Feature.Placeholder]: {
          text: t("继续写，或者输入 / 添加内容…"),
          mode: "block",
        },
        [Crepe.Feature.ImageBlock]: {
          onUpload: upload,
          inlineOnUpload: upload,
          blockOnUpload: upload,
          proxyDomURL: (url) =>
            window.mugdown.imageSource(id, url).catch(() => url),
          blockUploadPlaceholderText: t("粘贴图片链接，或上传本地图片"),
          inlineUploadPlaceholderText: t("图片链接"),
          blockCaptionPlaceholderText: t("图片说明"),
        },
        [Crepe.Feature.Toolbar]: {
          boldLabel: t("粗体"),
          italicLabel: t("斜体"),
          linkLabel: t("链接"),
          codeLabel: t("行内代码"),
          strikethroughLabel: t("删除线"),
          buildToolbar: (builder) => {
            const svg = (path: string) =>
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
              path +
              "</svg>";
            const group = builder.getGroup("formatting");
            for (const item of [
              {
                name: "underline",
                label: t("下划线 · Ctrl+U"),
                icon: svg('<path d="M6 3v7a6 6 0 0 0 12 0V3M4 21h16"/>'),
              },
              {
                name: "background",
                label: t("高亮 · Ctrl+Shift+H"),
                icon: svg(
                  '<path d="m9 12 6-9 6 4-6 9zM9 12l-4 5 5 1 5-2M3 22h18"/>',
                ),
              },
              {
                name: "color",
                label: t("文字与背景颜色"),
                icon: svg('<path d="m4 17 7-14 7 14M7 12h8M3 21h18"/>'),
              },
              {
                name: "clear",
                label: t("清除样式 · Ctrl+Shift+R"),
                icon: svg(
                  '<path d="m14 3 7 7-10 10H5l-3-3zM8 11l7 7M13 21h8"/>',
                ),
              },
            ])
              group.addItem(item.name, {
                label: item.label,
                icon: item.icon,
                active: (ctx) =>
                  item.name !== "clear" && formatActive(ctx, item.name),
                onRun: (ctx) => {
                  emitLatest.current?.();
                  if (item.name === "color")
                    openColorPalette(ctx, () => emitLatest.current?.());
                  else applyInline(ctx, item.name);
                  emitLatest.current?.();
                },
              });
          },
        },
        [Crepe.Feature.BlockEdit]: {
          textGroup: {
            label: t("文本"),
            text: { label: t("段落") },
            h1: { label: t("一级标题") },
            h2: { label: t("二级标题") },
            h3: { label: t("三级标题") },
            h4: { label: t("四级标题") },
            h5: null,
            h6: null,
            quote: { label: t("引用") },
            divider: { label: t("分隔线") },
          },
          listGroup: {
            label: t("列表"),
            bulletList: { label: t("无序列表") },
            orderedList: { label: t("有序列表") },
            taskList: { label: t("任务列表") },
          },
          advancedGroup: {
            label: t("内容"),
            image: { label: t("图片") },
            codeBlock: { label: t("代码块") },
            table: { label: t("表格") },
            math: null,
          },
        },
      },
    });
    crepe.setReadonly(readOnly);
    crepe.editor
      .use(blogExtensions(marker, id))
      .use(inlineFormatting())
      .config((ctx) =>
        configureSemanticBlockHandle(
          ctx,
          () => emitLatest.current?.(),
          (message) => error.current(message),
        ),
      );
    const shortcuts = (event: KeyboardEvent) => {
      if (
        event.isComposing ||
        !(event.ctrlKey || event.metaKey) ||
        (event.target as HTMLElement)?.closest("input,textarea")
      )
        return;
      const key = event.key.toLowerCase();
      const name =
        !event.shiftKey && key === "u"
          ? "underline"
          : event.shiftKey && key === "h"
            ? "background"
            : event.shiftKey && key === "r"
              ? "clear"
              : null;
      if (!name || !editor.current) return;
      event.preventDefault();
      event.stopPropagation();
      emitLatest.current?.();
      editor.current.editor.action((ctx) => applyInline(ctx, name));
      emitLatest.current?.();
    };
    root.current.addEventListener("keydown", shortcuts, true);
    const notify = () => {
      if (!ready) return;
      const doc = crepe.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        // Drain pending input mutations before taking a synchronous document snapshot.
        const observer = (
          view as unknown as {
            domObserver?: { flush(): void; forceFlush?(): void };
          }
        ).domObserver;
        observer?.forceFlush?.();
        observer?.flush();
        return view.state.doc;
      });
      if (lastDocument?.eq(doc)) return;
      lastDocument = doc;
      const markdown = crepe.getMarkdown();
      if (markdown === last) return;
      last = markdown;
      appliedValue = restoreComments(markdown, marker);
      change.current(appliedValue);
    };
    crepe.on((listener) => listener.markdownUpdated(notify));
    const creating = crepe
      .create()
      .then(() => {
        if (disposed) return;
        editor.current = crepe;
        last = crepe.getMarkdown();
        lastDocument = crepe.editor.action(
          (ctx) => ctx.get(editorViewCtx).state.doc,
        );
        emitLatest.current = notify;
        labelComments();
        ready = true;
        synchronize.current = (next) => {
          if (next === appliedValue) return;
          ready = false;
          const previousHead = crepe.editor.action(
            (ctx) => ctx.get(editorViewCtx).state.selection.head,
          );
          crepe.editor.action(replaceAll(prepareRichBody(next)));
          crepe.editor.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            view.dispatch(
              view.state.tr.setSelection(
                TextSelection.near(
                  view.state.doc.resolve(
                    Math.min(previousHead, view.state.doc.content.size),
                  ),
                ),
              ),
            );
          });
          last = crepe.getMarkdown();
          lastDocument = crepe.editor.action(
            (ctx) => ctx.get(editorViewCtx).state.doc,
          );
          appliedValue = next;
          ready = true;
        };
        synchronize.current(latestValue.current);
      })
      .catch((err) => {
        if (!disposed) error.current(String(err));
      });
    return () => {
      disposed = true;
      ready = false;
      observer.disconnect();
      root.current?.removeEventListener("keydown", shortcuts, true);
      closeInlinePalette();
      editor.current = null;
      synchronize.current = null;
      emitLatest.current = null;
      void creating.then(() => crepe.destroy()).catch(() => {});
    };
  }, [id]);
  useEffect(() => {
    synchronize.current?.(value);
  }, [value]);
  useEffect(() => {
    editor.current?.setReadonly(readOnly);
  }, [readOnly]);
  return (
    <div
      className="rich-editor"
      ref={root}
      onFocusCapture={(event) => {
        const dom = (event.target as HTMLElement).closest<HTMLElement>(
          ".cm-editor",
        );
        nestedSource.current = dom ? EditorView.findFromDOM(dom) : null;
      }}
    />
  );
});

export const SourceEditor = forwardRef<EditorHandle, Props>(
  function SourceEditor({ id, value, onChange, onError, dark }, ref) {
    const root = useRef<HTMLDivElement>(null),
      view = useRef<EditorView | null>(null),
      colorTheme = useRef(new Compartment()),
      change = useRef(onChange),
      programmatic = useRef(false);
    change.current = onChange;
    const replaceValue = (text: string) => {
      const editor = view.current;
      if (!editor || editor.state.doc.toString() === text) return;
      programmatic.current = true;
      try {
        editor.dispatch({
          changes: { from: 0, to: editor.state.doc.length, insert: text },
          selection: {
            anchor: Math.min(editor.state.selection.main.head, text.length),
          },
          annotations: Transaction.addToHistory.of(false),
        });
      } finally {
        programmatic.current = false;
      }
    };
    useImperativeHandle(
      ref,
      () => ({
        flush: () => {},
        replace: replaceValue,
        search: (query, backwards, replacement, all) =>
          view.current
            ? sourceSearch(view.current, query, backwards, replacement, all)
            : { count: 0, index: 0 },
        contextAt: (x, y) => {
          const v = view.current,
            at = v?.posAtCoords({ x, y });
          if (!v || at == null) return;
          const { from, to } = v.state.selection.main;
          if (at < from || at > to || from === to)
            v.dispatch({ selection: { anchor: at } });
        },
        command: (name) => {
          const editor = view.current;
          if (!editor) return;
          if (name === "undo") sourceUndo(editor);
          else if (name === "redo") sourceRedo(editor);
          else
            void sourceEdit(editor, name).catch((err) => onError(String(err)));
        },
        focus: () => view.current?.focus(),
        insert: (text) => {
          const v = view.current;
          if (v) v.dispatch(v.state.replaceSelection(text));
        },
      }),
      [],
    );
    useEffect(() => {
      if (!root.current) return;
      const editor = new EditorView({
        parent: root.current,
        doc: value,
        extensions: [
          basicSetup,
          markdown(),
          EditorView.lineWrapping,
          colorTheme.current.of(dark ? oneDark : []),
          EditorView.theme({
            "&": {
              fontSize: "14px",
              backgroundColor: "transparent",
              color: "var(--text)",
            },
            ".cm-scroller": {
              fontFamily: "Consolas, SFMono-Regular, monospace",
            },
            ".cm-content": { padding: "22px 0" },
            ".cm-gutters": {
              backgroundColor: "transparent",
              border: "none",
              color: "var(--muted)",
            },
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !programmatic.current)
              change.current(update.state.doc.toString());
          }),
        ],
      });
      view.current = editor;
      return () => {
        editor.destroy();
        view.current = null;
      };
    }, [id]);
    useEffect(() => {
      view.current?.dispatch({
        effects: colorTheme.current.reconfigure(dark ? oneDark : []),
      });
    }, [dark]);
    useEffect(() => {
      replaceValue(value);
    }, [value]);
    return <div className="source-editor" ref={root} />;
  },
);
