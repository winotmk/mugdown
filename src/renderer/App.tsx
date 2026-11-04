import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  Bold,
  Italic,
  Underline,
  Highlighter,
  Palette,
  Eraser,
  Link,
  List,
  ListOrdered,
  Quote,
  Code2,
  Table2,
  Image,
  Minus,
  Square,
  X,
  Plus,
  FileText,
  Search,
  ChevronDown,
  ArrowUp,
  ArrowDown,
  ExternalLink,
  Check,
  Ellipsis,
  Maximize2,
  Pin,
  PinOff,
  GripHorizontal,
} from "lucide-react";
import { RichEditor, SourceEditor, type EditorHandle } from "./EditorLoader";
import {
  call,
  subscribe,
  label,
  native,
  mac,
  openFiles,
  openBrowserFile,
  savePath,
  downloadDocument,
  pickImage,
  pickCss,
} from "./bridge";
import { UI_THEMES, resolveUiTheme, MARKDOWN_STYLES } from "../shared/themes";
import { splitMarkdown, wordCount } from "../shared/markdown";
import type { DocumentData, Workspace, Mode } from "../shared/types";
import cup from "../../src-tauri/icons/64x64.png";
import cup16 from "../../assets/icons-small/16x16.png";
import cup20 from "../../assets/icons-small/20x20.png";
import cup24 from "../../assets/icons-small/24x24.png";
import cup32 from "../../assets/icons-small/32x32.png";
import cup48 from "../../assets/icons-small/48x48.png";
import cup64 from "../../assets/icons-small/64x64.png";
import {
  t,
  languages,
  setLanguage,
  getLanguage,
  translateError,
  documentName,
} from "../i18n";

type Choice = {
  title: string;
  description: string;
  buttons: { label: string; value: string; primary?: boolean }[];
  resolve: (value: string) => void;
};
type MenuItem = [string, string, string?];
function windowDragRegion(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    target.hasAttribute("data-tauri-drag-region") &&
    target.getAttribute("data-tauri-drag-region") !== "false"
  );
}
function scopedCss(css: string) {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    const surface =
      ".editor-surface.markdown-scope[data-markdown-style][data-markdown-mode]";
    const scope = `${surface} .ProseMirror`;
    const walk = (rules: CSSRuleList): string =>
      Array.from(rules)
        .map((rule) => {
          if (rule instanceof CSSStyleRule) {
            const selectors = rule.selectorText
              .split(",")
              .map((s) => {
                const clean = s
                  .trim()
                  .replace(/^(?:html\s+)?body\b|^:root\b|^html\b/g, "")
                  .trim();
                return clean ? `${scope} ${clean}` : scope;
              })
              .join(",");
            const root = rule.selectorText
              .split(",")
              .some((s) => /^(?:(?:html\s+)?body|:root|html)$/.test(s.trim()));
            const variables = root
              ? Array.from(rule.style)
                  .filter((key) => key.startsWith("--md-"))
                  .map((key) => `${key}:${rule.style.getPropertyValue(key)};`)
                  .join("")
              : "";
            const colors = root
              ? `${rule.style.backgroundColor ? `--md-bg:${rule.style.backgroundColor};` : ""}${rule.style.color ? `--md-fg:${rule.style.color};` : ""}`
              : "";
            return `${selectors}{${rule.style.cssText}}${variables || colors ? `${surface}{${variables}${colors}}` : ""}`;
          }
          if (rule instanceof CSSMediaRule)
            return `@media ${rule.conditionText}{${walk(rule.cssRules)}}`;
          if (rule instanceof CSSSupportsRule)
            return `@supports ${rule.conditionText}{${walk(rule.cssRules)}}`;
          return "";
        })
        .join("\n");
    return walk(sheet.cssRules);
  } catch {
    return "";
  }
}

export default function App() {
  const editItems: MenuItem[] = [
    ["undo", t("撤销"), "Z"],
    ["redo", t("重做"), "Shift+Z"],
    ["-", ""],
    ["cut", t("剪切"), "X"],
    ["copy", t("复制"), "C"],
    ["paste", t("粘贴"), "V"],
    ["paste-plain", t("粘贴为纯文本"), "Shift+V"],
    ["copy-plain", t("复制为纯文本")],
    ["copy-html", t("复制为 HTML")],
    ["select-all", t("全选"), "A"],
    ["-", ""],
    ["duplicate-block", t("创建段落副本")],
    ["paragraph-before", t("在前面插入段落")],
    ["paragraph-after", t("在后面插入段落")],
    ["delete-block", t("删除当前段落")],
    ["-", ""],
    ["find", t("查找"), "F"],
    ["replace", t("替换"), mac ? "Alt+F" : "H"],
  ];
  const tools = [
    ["heading", t("标题"), null, "H₂"],
    ["bold", t("粗体"), Bold],
    ["italic", t("斜体"), Italic],
    ["underline", t("下划线"), Underline],
    ["highlight", t("高亮"), Highlighter],
    ["color", t("文字与背景色"), Palette],
    ["clear", t("清除样式"), Eraser],
    ["-", "", null],
    ["link", t("链接"), Link],
    ["list", t("无序列表"), List],
    ["ordered", t("有序列表"), ListOrdered],
    ["quote", t("引用"), Quote],
    ["codeblock", t("代码块"), Code2],
    ["table", t("表格"), Table2],
    ["image", t("插入图片"), Image],
  ] as const;

  const [state, setState] = useState<Workspace | null>(null);
  const stateRef = useRef<Workspace | null>(null);
  const [modes, setModes] = useState<Record<string, Mode>>({});
  const [menu, setMenu] = useState<string | null>(null);
  const [appearance, setAppearance] = useState(false);
  const [toolbarHover, setToolbarHover] = useState(false);
  const [toolbarSuppressed, setToolbarSuppressed] = useState(false);
  const toolbarTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [notice, setNotice] = useState("");
  const [windowDragging, setWindowDragging] = useState(false);
  const [windowMergePreview, setWindowMergePreview] = useState<string | null>(
    null,
  );
  const [windowMergeCount, setWindowMergeCount] = useState<number | null>(null);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [find, setFind] = useState(false),
    [replace, setReplace] = useState(false);
  const [query, setQuery] = useState(""),
    [replacement, setReplacement] = useState("");
  const [found, setFound] = useState({ count: 0, index: 0 });
  const [context, setContext] = useState<{ x: number; y: number } | null>(null);
  const [drop, setDrop] = useState(false),
    [dragId, setDragId] = useState<string | null>(null);
  const [systemDark, setSystemDark] = useState(
    matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const editor = useRef<EditorHandle>(null);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const pending = useRef(new Map<string, number>());
  const writeError = useRef<string | null>(null);
  const closing = useRef(false);
  const ignoreTabClick = useRef(false);
  const commandRef = useRef<(name: string) => Promise<void>>(async () => {});
  const currentWindow = state?.windows.find((w) => w.label === label);
  const active = state?.documents.find((d) => d.id === currentWindow?.active);
  const mode = active
    ? (modes[active.id] ?? (active.raw.length > 512_000 ? "source" : "visual"))
    : "visual";
  const [count, setCount] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => setCount(wordCount(active?.raw ?? "")), 180);
    return () => clearTimeout(timer);
  }, [active?.raw]);
  const theme = resolveUiTheme(
    state?.settings.uiTheme ?? "github-light",
    systemDark,
  );
  const dark = theme.dark;
  const toolbarPinned = state?.settings.toolbarPinned ?? false;
  const toolbarOpen = !toolbarSuppressed && (toolbarPinned || toolbarHover);
  const setToolbarPinned = (pinned: boolean) => {
    if (!stateRef.current) return;
    if (stateRef.current.settings.toolbarPinned === pinned) return;
    if (toolbarTimer.current) clearTimeout(toolbarTimer.current);
    setToolbarHover(false);
    setToolbarSuppressed(!pinned);
    editor.current?.focus();
    const previous = stateRef.current;
    updateState({
      ...previous,
      settings: { ...previous.settings, toolbarPinned: pinned },
    });
    void call("save_settings", {
      settings: { ...previous.settings, toolbarPinned: pinned },
    }).catch((e) => {
      if (stateRef.current)
        updateState({
          ...stateRef.current,
          settings: {
            ...stateRef.current.settings,
            toolbarPinned: previous.settings.toolbarPinned,
          },
        });
      fail(e);
    });
  };
  const updateState = (next: Workspace) => {
    stateRef.current = next;
    setState(next);
  };
  const fail = (e: unknown) => setNotice(translateError(e));
  const flush = async () => {
    editor.current?.flush();
    await chain.current;
    if (writeError.current) throw Error(writeError.current);
  };
  const ask = (
    title: string,
    description: string,
    buttons: Choice["buttons"],
  ) =>
    new Promise<string>((resolve) =>
      setChoice({ title, description, buttons, resolve }),
    );
  const docNow = () => {
    const s = stateRef.current,
      w = s?.windows.find((w) => w.label === label);
    return s?.documents.find((d) => d.id === w?.active);
  };
  const change = (value: string) => {
    const doc = docNow(),
      s = stateRef.current;
    if (!doc || !s || value === doc.raw) return;
    const id = doc.id;
    updateState({
      ...s,
      documents: s.documents.map((d) =>
        d.id === id ? { ...d, raw: value } : d,
      ),
    });
    pending.current.set(id, (pending.current.get(id) ?? 0) + 1);
    chain.current = chain.current
      .then(() => call("update_document", { id, raw: value, group: mode }))
      .then(() => {
        writeError.current = null;
      })
      .catch((e) => {
        writeError.current = String(e);
        fail(e);
      })
      .finally(() => {
        const n = (pending.current.get(id) ?? 1) - 1;
        if (n) pending.current.set(id, n);
        else pending.current.delete(id);
      });
  };
  const reconcile = (next: Workspace) => {
    setLanguage(next.settings.language);
    next.settings.language ??= "zh-CN";
    next.settings.toolbarPinned ??= false;
    const local = stateRef.current;
    if (local)
      next.documents = next.documents.map((d) =>
        pending.current.has(d.id)
          ? {
              ...d,
              raw: local.documents.find((l) => l.id === d.id)?.raw ?? d.raw,
            }
          : d,
      );
    updateState(next);
  };
  const saveDoc = async (id: string, as = false): Promise<boolean> => {
    await flush();
    let doc = stateRef.current?.documents.find((d) => d.id === id);
    if (!doc) return false;
    if (!native) {
      downloadDocument(doc);
      return true;
    }
    const path =
      as || !doc.path ? await savePath(doc.path ?? documentName(doc)) : null;
    if ((as || !doc.path) && !path) return false;
    try {
      await call("save_document", { id, path, force: false });
      return true;
    } catch (e) {
      if (String(e).includes("EXTERNAL_CHANGE:")) {
        const answer = await ask(
          t("文件已被其他程序修改"),
          t("覆盖会替换磁盘上的版本。可以另存为，保留两个版本。"),
          [
            { label: t("取消"), value: "cancel" },
            { label: t("另存为…"), value: "as", primary: true },
            { label: t("覆盖磁盘版本"), value: "force" },
          ],
        );
        if (answer === "as") return saveDoc(id, true);
        if (answer === "force") {
          await call("save_document", { id, path, force: true });
          return true;
        }
        return false;
      }
      fail(e);
      return false;
    }
  };
  const closeDoc = async (id: string) => {
    await flush();
    const doc = stateRef.current?.documents.find((d) => d.id === id);
    if (!doc) return true;
    if (doc.raw !== doc.saved) {
      const answer = await ask(
        t("保存修改？"),
        t("“{0}” 有尚未保存的内容。", { "0": documentName(doc) }),
        [
          { label: t("取消"), value: "cancel" },
          { label: t("不保存"), value: "discard" },
          { label: t("保存"), value: "save", primary: true },
        ],
      );
      if (answer === "cancel") return false;
      if (answer === "save" && !(await saveDoc(id))) return false;
    }
    await call("close_document", { id });
    return true;
  };
  const closeWindow = async () => {
    if (closing.current) return;
    closing.current = true;
    try {
      await flush();
      const ids =
        stateRef.current?.windows.find((w) => w.label === label)?.ids.slice() ??
        [];
      for (const id of ids) if (!(await closeDoc(id))) return;
      if (native) await getCurrentWindow().destroy();
    } catch (e) {
      fail(e);
    } finally {
      closing.current = false;
    }
  };
  const setMode = async (next: Mode) => {
    await flush();
    const doc = docNow();
    if (doc) setModes((prev) => ({ ...prev, [doc.id]: next }));
  };
  const runSearch = (backwards = false, replacement?: string, all = false) => {
    setFound(
      editor.current?.search(query, backwards, replacement, all) ?? {
        count: 0,
        index: 0,
      },
    );
  };
  const upload = async (file: File) => {
    let doc = docNow();
    if (!doc) {
      await call("create_document");
      doc = docNow();
    }
    if (!doc) return;
    if (!doc.path && native && !(await saveDoc(doc.id))) return;
    const url = await window.mugdown.importImage(
      doc.id,
      file.name || "pasted.png",
      new Uint8Array(await file.arrayBuffer()),
    );
    editor.current?.insert(
      `\n![${file.name.replace(/\.[^.]+$/, "").replace(/[\[\]]/g, "") || t("图片")}](<${url}>)\n`,
    );
    editor.current?.flush();
  };
  commandRef.current = async (name) => {
    setMenu(null);
    setContext(null);
    try {
      const doc = docNow();
      if (name === "new") {
        await flush();
        await call("create_document");
        return;
      }
      if (name === "open") {
        await flush();
        await openFiles();
        return;
      }
      if (name === "close-window") {
        await closeWindow();
        return;
      }
      if (name === "appearance") {
        setAppearance(true);
        return;
      }
      if (name === "find" || name === "replace") {
        setFind(true);
        setReplace(name === "replace");
        setTimeout(
          () =>
            document.querySelector<HTMLInputElement>(".find-input")?.focus(),
          30,
        );
        return;
      }
      if (!doc) return;
      if (name === "save" || name === "save-as") {
        await saveDoc(doc.id, name === "save-as");
        return;
      }
      if (name === "close") {
        await closeDoc(doc.id);
        return;
      }
      if (name === "detach") {
        await flush();
        await call("move_document", { id: doc.id, target: null });
        return;
      }
      if (name.startsWith("merge:")) {
        await flush();
        await call("move_document", { id: doc.id, target: name.slice(6) });
        return;
      }
      if (name === "toggle-mode") {
        await setMode(mode === "source" ? "visual" : "source");
        return;
      }
      if (name === "undo" || name === "redo") {
        await flush();
        const next = await call<DocumentData>("undo_document", {
          id: doc.id,
          forward: name === "redo",
        });
        const s = stateRef.current!;
        updateState({
          ...s,
          documents: s.documents.map((d) => (d.id === next.id ? next : d)),
        });
        editor.current?.replace(
          mode === "source" ? next.raw : splitMarkdown(next.raw).body,
        );
        return;
      }
      if (name === "image") {
        if (!doc.path && native && !(await saveDoc(doc.id))) return;
        const path = await pickImage();
        if (typeof path === "string") {
          const url = await call<string>("import_image_file", {
            id: doc.id,
            path,
          });
          editor.current?.insert(`\n![](<${url}>)\n`);
          editor.current?.flush();
        }
        return;
      }
      editor.current?.command(name);
    } catch (e) {
      fail(e);
    }
  };
  const run = (name: string) => {
    void commandRef.current(name);
  };

  useEffect(() => {
    let disposed = false;
    const unsubs: (() => void)[] = [];
    const setup = async () => {
      unsubs.push(await subscribe<Workspace>("workspace", reconcile));
      unsubs.push(
        await subscribe<string>("menu-command", (command) => {
          if (
            (command === "undo" || command === "redo") &&
            document.activeElement?.closest(
              "input,textarea,select,.extension-source",
            )
          ) {
            document.execCommand(command);
            return;
          }
          void commandRef.current(command);
        }),
      );
      unsubs.push(
        await subscribe<string | null>(
          "window-merge-preview",
          setWindowMergePreview,
        ),
      );
      unsubs.push(
        await subscribe<number | null>(
          "window-merge-target",
          setWindowMergeCount,
        ),
      );
      unsubs.push(
        await subscribe<DocumentData>("document-changed", (doc) => {
          const s = stateRef.current;
          if (s && !pending.current.has(doc.id))
            updateState({
              ...s,
              documents: s.documents.map((d) => (d.id === doc.id ? doc : d)),
            });
        }),
      );
      unsubs.push(
        await subscribe("request-close", () => {
          void commandRef.current("close-window");
        }),
      );
      const initial = await call<Workspace>("workspace");
      if (disposed) return;
      reconcile(initial);
      if (initial.settingsStorage?.error) fail(initial.settingsStorage.error);
      if (native) {
        unsubs.push(
          await getCurrentWindow().onCloseRequested((e) => {
            e.preventDefault();
            void commandRef.current("close-window");
          }),
        );
        unsubs.push(
          await getCurrentWebviewWindow().onDragDropEvent((e) => {
            if (document.documentElement.dataset.blockDragging === "true") {
              setDrop(false);
              return;
            }
            if (e.payload.type === "enter") setDrop(e.payload.paths.length > 0);
            if (e.payload.type === "leave") setDrop(false);
            if (e.payload.type === "drop") {
              setDrop(false);
              if (!e.payload.paths.length) return;
              void call("open_documents", { paths: e.payload.paths }).catch(
                fail,
              );
            }
          }),
        );
        await call("ready");
      }
    };
    void setup().catch(fail);
    const keys = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.key === "Escape") {
        setMenu(null);
        setContext(null);
        setAppearance(false);
        setFind(false);
        setDragId(null);
        return;
      }
      if (e.isComposing) return;
      const modifier = e.ctrlKey || e.metaKey,
        key = e.key.toLowerCase();
      const input = !!target.closest("input,textarea,select,.extension-source");
      const action =
        modifier && key === "s"
          ? e.shiftKey
            ? "save-as"
            : "save"
          : modifier && key === "o"
            ? "open"
            : modifier && key === "n"
              ? "new"
              : modifier && key === "w"
                ? "close"
                : !input && modifier && key === "z"
                  ? e.shiftKey
                    ? "redo"
                    : "undo"
                  : !input && modifier && key === "y"
                    ? "redo"
                    : modifier && !e.altKey && key === "f"
                      ? "find"
                      : modifier &&
                          (mac ? e.altKey && key === "f" : key === "h")
                        ? "replace"
                        : modifier && key === "/"
                          ? "toggle-mode"
                          : modifier && key === ","
                            ? "appearance"
                            : null;
      if (action) {
        e.preventDefault();
        e.stopPropagation();
        void commandRef.current(action);
      }
    };
    window.addEventListener("keydown", keys, true);
    const mq = matchMedia("(prefers-color-scheme: dark)"),
      listener = () => setSystemDark(mq.matches);
    mq.addEventListener("change", listener);
    const before = (e: BeforeUnloadEvent) => {
      if (
        !native &&
        stateRef.current?.documents.some((d) => d.raw !== d.saved)
      ) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => {
      disposed = true;
      if (toolbarTimer.current) clearTimeout(toolbarTimer.current);
      unsubs.forEach((fn) => fn());
      window.removeEventListener("keydown", keys, true);
      mq.removeEventListener("change", listener);
      window.removeEventListener("beforeunload", before);
    };
  }, []);
  useEffect(() => {
    if (native)
      void getCurrentWindow().setTitle(
        `${active?.raw !== active?.saved ? "● " : ""}${active ? documentName(active) + " — " : ""}mugdown`,
      );
  }, [active?.name, active?.raw === active?.saved, state?.settings.language]);
  useEffect(() => {
    if (notice) {
      const t = setTimeout(() => setNotice(""), 6500);
      return () => clearTimeout(t);
    }
  }, [notice]);
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (
        !(e.target as HTMLElement).closest(
          ".menu-anchor,.dropdown,.context-menu",
        )
      ) {
        setMenu(null);
        setContext(null);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  const tabDrag = (event: ReactPointerEvent<HTMLDivElement>, id: string) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button"))
      return;
    const el = event.currentTarget,
      startX = event.clientX,
      startY = event.clientY;
    let dragging = false,
      cancelled = false;
    el.setPointerCapture(event.pointerId);
    const cancel = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelled = true;
    };
    const move = (e: PointerEvent) => {
      if (
        !cancelled &&
        Math.hypot(e.clientX - startX, e.clientY - startY) > 7
      ) {
        dragging = true;
        setDragId(id);
      }
    };
    const finish = async (e: PointerEvent) => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", finish);
      el.removeEventListener("pointercancel", abort);
      window.removeEventListener("keydown", cancel, true);
      if (el.hasPointerCapture(event.pointerId))
        el.releasePointerCapture(event.pointerId);
      setDragId(null);
      if (cancelled || !dragging) return;
      ignoreTabClick.current = true;
      setTimeout(() => {
        ignoreTabClick.current = false;
      }, 250);
      try {
        await flush();
        const target = document
          .elementFromPoint(e.clientX, e.clientY)
          ?.closest<HTMLElement>("[data-tab-id]")?.dataset.tabId;
        const ids = stateRef.current?.windows
          .find((w) => w.label === label)
          ?.ids.slice();
        if (target && ids && target !== id) {
          ids.splice(ids.indexOf(id), 1);
          ids.splice(ids.indexOf(target), 0, id);
          await call("reorder_documents", { ids });
        } else await call("finish_tab_drag", { id });
      } catch (e) {
        fail(e);
      }
    };
    const abort = () => {
      cancelled = true;
      void finish(new PointerEvent("pointerup"));
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", finish);
    el.addEventListener("pointercancel", abort);
    window.addEventListener("keydown", cancel, true);
  };
  const menuItems =
    menu === t("文件")
      ? [
          ["new", t("新建文档"), "N"],
          ["open", t("打开…"), "O"],
          ["-", ""],
          ["save", t("保存"), "S"],
          ["save-as", t("另存为…"), "Shift+S"],
          ["close", t("关闭文档"), "W"],
        ]
      : menu === t("编辑")
        ? editItems
        : menu === t("窗口")
          ? [
              ["detach", t("移到新窗口")],
              ...(state?.windows
                .filter((w) => w.label !== label)
                .map((w, i) => [
                  "merge:" + w.label,
                  t("合并到窗口 {0}", { "0": i + 1 }),
                ]) ?? []),
              ["-", ""],
              ["appearance", t("外观设置…"), ","],
            ]
          : [];
  const renderMenu = (items: MenuItem[], contextMenu = false) =>
    items.map(([key, title, shortcut], i) =>
      key === "-" ? (
        <hr key={i} />
      ) : (
        <button
          role="menuitem"
          key={key}
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => run(key)}
          disabled={
            !active &&
            !["new", "open", "appearance", "find", "replace"].includes(key)
          }
        >
          <span>{title}</span>
          {shortcut && (
            <kbd>
              {mac ? "⌘" : "Ctrl+"}
              {mac
                ? shortcut.replace("Shift+", "⇧").replace("Alt+", "⌥")
                : shortcut}
            </kbd>
          )}
        </button>
      ),
    );
  const style = {
    ...Object.fromEntries(
      Object.entries(theme.colors).map(([key, value]) => ["--" + key, value]),
    ),
    "--editor-font": `${state?.settings.fontSize ?? 17}px`,
    "--content-width": `${state?.settings.contentWidth ?? 900}px`,
    "--comment-label": JSON.stringify(t("HTML 注释")),
    colorScheme: dark ? "dark" : "light",
  } as CSSProperties;
  return (
    <div
      className={`app ${mac ? "is-mac" : ""}`}
      data-theme={theme.id}
      data-dark={dark}
      style={style}
    >
      <header
        className="titlebar"
        data-tauri-drag-region
        onMouseDown={(e) => {
          if (!native || e.button !== 0 || !windowDragRegion(e.target)) return;
          e.preventDefault();
          e.stopPropagation();
          if (e.detail !== 1) return;
          editor.current?.flush();
          setWindowDragging(true);
          void call<string | null>("start_window_drag")
            .then(async (target) => {
              if (target) {
                await flush();
                await call("merge_windows", { target });
              }
            })
            .catch(fail)
            .finally(() => {
              setWindowDragging(false);
              setWindowMergePreview(null);
            });
        }}
        onDoubleClick={(e) => {
          if (windowDragRegion(e.target) && native)
            void getCurrentWindow().toggleMaximize();
        }}
      >
        <div className="brand" data-tauri-drag-region>
          <img
            src={cup24}
            srcSet={`${cup16} 16w, ${cup20} 20w, ${cup24} 24w, ${cup32} 32w, ${cup48} 48w, ${cup64} 64w`}
            sizes="24px"
            width={24}
            height={24}
            alt=""
          />
          <span data-tauri-drag-region>mugdown</span>
        </div>
        <nav className="menubar" aria-label={t("主菜单")}>
          {[t("文件"), t("编辑"), t("窗口")].map((title) => (
            <div className="menu-anchor" key={title}>
              <button
                className={menu === title ? "active" : ""}
                onClick={() => setMenu(menu === title ? null : title)}
              >
                {title}
              </button>
              {menu === title && (
                <div className="dropdown" role="menu">
                  {renderMenu(menuItems as MenuItem[])}
                </div>
              )}
            </div>
          ))}
        </nav>
        <div
          className="document-caption"
          data-tauri-drag-region
          title={active?.path ?? ""}
        >
          <div
            className="document-label"
            data-tauri-drag-region={
              currentWindow?.ids.length === 1 ? "false" : undefined
            }
            data-tab-id={
              currentWindow?.ids.length === 1 ? active?.id : undefined
            }
            onPointerDown={(e) => {
              if (active && currentWindow?.ids.length === 1)
                tabDrag(e, active.id);
            }}
            title={
              currentWindow?.ids.length === 1
                ? t("拖动文件名到另一窗口内可合并")
                : (active?.path ?? "")
            }
          >
            {active?.raw !== active?.saved && <span className="dirty-dot" />}
            {active ? documentName(active) : ""}
          </div>
        </div>
        <button
          className="icon-button appearance-button"
          title={t("外观设置")}
          aria-label={t("外观设置")}
          onClick={() => setAppearance(true)}
        >
          <Palette size={16} />
        </button>
        {!mac && native && (
          <div className="window-controls">
            <button
              aria-label={t("最小化")}
              onClick={() => void getCurrentWindow().minimize()}
            >
              <Minus size={14} />
            </button>
            <button
              aria-label={t("最大化")}
              onClick={() => void getCurrentWindow().toggleMaximize()}
            >
              <Square size={11} />
            </button>
            <button
              className="window-close"
              aria-label={t("关闭窗口")}
              onClick={() => run("close-window")}
            >
              <X size={16} />
            </button>
          </div>
        )}
      </header>
      {currentWindow && currentWindow.ids.length > 1 && (
        <div className="tabbar" role="tablist">
          {currentWindow.ids.map((id) => {
            const d = state!.documents.find((d) => d.id === id)!;
            return (
              <div
                key={id}
                role="tab"
                tabIndex={0}
                aria-selected={id === active?.id}
                className={`tab ${id === active?.id ? "selected" : ""} ${dragId === id ? "dragging" : ""}`}
                data-tab-id={id}
                onPointerDown={(e) => tabDrag(e, id)}
                onClick={() => {
                  if (!ignoreTabClick.current)
                    void flush()
                      .then(() => call("activate_document", { id }))
                      .catch(fail);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter")
                    void flush().then(() => call("activate_document", { id }));
                }}
                title={t("{0}\n拖出窗口可拆分，拖到其他窗口内可合并", {
                  "0": d.path ?? d.name,
                })}
              >
                <FileText size={13} />
                <span>{documentName(d)}</span>
                {d.raw !== d.saved && <span className="dirty-dot" />}
                <button
                  aria-label={t("关闭 {0}", { "0": documentName(d) })}
                  onClick={(e) => {
                    e.stopPropagation();
                    void closeDoc(id);
                  }}
                >
                  <X size={13} />
                </button>
              </div>
            );
          })}
          <button
            className="new-tab"
            title={t("新建文档")}
            aria-label={t("新建文档")}
            onClick={() => run("new")}
          >
            <Plus size={16} />
          </button>
        </div>
      )}
      <div
        className="editor-surface markdown-scope"
        data-markdown-style={
          MARKDOWN_STYLES.some(
            (preset) => preset.id === state?.settings.markdownStyle,
          )
            ? state?.settings.markdownStyle
            : "github"
        }
        data-markdown-mode={
          state?.settings.markdownStyle === "modest" || !dark ? "light" : "dark"
        }
        data-editor-mode={mode}
      >
        <section
          className="toolbar-shelf"
          data-open={toolbarOpen}
          data-pinned={toolbarPinned}
          onPointerEnter={() => {
            if (toolbarTimer.current) clearTimeout(toolbarTimer.current);
            if (!toolbarSuppressed) setToolbarHover(true);
          }}
          onPointerLeave={() => {
            setToolbarSuppressed(false);
            toolbarTimer.current = setTimeout(
              () => setToolbarHover(false),
              140,
            );
          }}
          onFocusCapture={() => {
            if (!toolbarSuppressed) setToolbarHover(true);
          }}
          onBlurCapture={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget))
              setToolbarHover(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape" && !toolbarPinned) {
              setToolbarHover(false);
              editor.current?.focus();
            }
          }}
        >
          <div
            className="toolbar-drawer"
            id="editor-toolbar"
            inert={!toolbarOpen}
            aria-hidden={!toolbarOpen}
          >
            <div
              className="toolbar"
              aria-label={t("编辑工具栏")}
              onPointerDown={(e) => {
                if (
                  !(e.target as HTMLElement).closest(
                    'button,input,select,textarea,a,[role="button"]',
                  )
                )
                  e.preventDefault();
              }}
              onClick={(e) => {
                if (
                  !(e.target as HTMLElement).closest(
                    'button,input,select,textarea,a,[role="button"]',
                  )
                )
                  setToolbarPinned(true);
              }}
            >
              <div className="format-tools">
                {tools.map(([key, title, Icon, text]) =>
                  key === "-" ? (
                    <span className="separator" key={key} />
                  ) : (
                    <button
                      key={key}
                      aria-label={title}
                      title={title}
                      disabled={!active || mode !== "visual"}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => run(key)}
                    >
                      {Icon ? <Icon size={16} /> : <span>{text}</span>}
                    </button>
                  ),
                )}
                <button
                  aria-label={t("更多编辑操作")}
                  title={t("更多编辑操作")}
                  onClick={() => setMenu(menu === t("编辑") ? null : t("编辑"))}
                >
                  <Ellipsis size={17} />
                </button>
              </div>
              <div className="mode-switch" aria-label={t("编辑模式")}>
                {(
                  [
                    ["visual", t("可视化")],
                    ["source", "MD"],
                  ] as const
                ).map(([key, title]) => (
                  <button
                    key={key}
                    disabled={!active}
                    aria-pressed={mode === key}
                    className={mode === key ? "active" : ""}
                    onClick={() => void setMode(key)}
                  >
                    {title}
                  </button>
                ))}
              </div>
              <button
                className="toolbar-pin"
                aria-label={
                  toolbarPinned ? t("取消固定工具栏") : t("固定工具栏")
                }
                aria-pressed={toolbarPinned}
                title={toolbarPinned ? t("取消固定工具栏") : t("固定工具栏")}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setToolbarPinned(!toolbarPinned)}
              >
                {toolbarPinned ? <PinOff size={14} /> : <Pin size={14} />}
              </button>
            </div>
          </div>
          <button
            className="toolbar-handle"
            aria-label={t("展开并固定工具栏")}
            aria-hidden={toolbarPinned}
            inert={toolbarPinned}
            tabIndex={toolbarPinned ? -1 : 0}
            aria-expanded={toolbarOpen}
            aria-pressed={toolbarPinned}
            aria-controls="editor-toolbar"
            title={t("悬停展开，点击固定工具栏")}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setToolbarPinned(true)}
          >
            {toolbarOpen ? <Pin size={12} /> : <GripHorizontal size={12} />}
            <ChevronDown size={11} />
          </button>
        </section>
        {find && (
          <div className="findbar">
            <Search size={15} />
            <input
              className="find-input"
              placeholder={t("查找文字")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") runSearch(e.shiftKey);
              }}
            />
            <span className="find-status">
              {found.count ? `${found.index}/${found.count}` : t("0 项")}
            </span>
            <button
              title={t("上一个")}
              aria-label={t("上一个")}
              onClick={() => runSearch(true)}
            >
              <ArrowUp size={15} />
            </button>
            <button
              title={t("下一个")}
              aria-label={t("下一个")}
              onClick={() => runSearch()}
            >
              <ArrowDown size={15} />
            </button>
            <button title={t("展开替换")} onClick={() => setReplace(!replace)}>
              <ChevronDown size={15} />
            </button>
            {replace && (
              <>
                <input
                  placeholder={t("替换为")}
                  value={replacement}
                  onChange={(e) => setReplacement(e.target.value)}
                />
                <button onClick={() => runSearch(false, replacement)}>
                  {t("替换")}{" "}
                </button>
                <button onClick={() => runSearch(false, replacement, true)}>
                  {t("全部替换")}{" "}
                </button>
              </>
            )}
            <button aria-label={t("关闭查找")} onClick={() => setFind(false)}>
              <X size={15} />
            </button>
          </div>
        )}
        <main
          className={`workspace ${drop ? "file-over" : ""}`}
          onDragOver={(e) => {
            if (!native && e.dataTransfer.types.includes("Files")) {
              e.preventDefault();
              setDrop(true);
            }
          }}
          onDragLeave={() => setDrop(false)}
          onDrop={(e) => {
            if (native || !e.dataTransfer.types.includes("Files")) return;
            e.preventDefault();
            setDrop(false);
            void (async () => {
              for (const file of Array.from(e.dataTransfer.files))
                await openBrowserFile(file);
            })().catch(fail);
          }}
          onPasteCapture={(e) => {
            const files = Array.from(e.clipboardData.files).filter((f) =>
              f.type.startsWith("image/"),
            );
            if (!files.length) return;
            e.preventDefault();
            e.stopPropagation();
            void (async () => {
              for (const file of files) await upload(file);
            })().catch(fail);
          }}
          onClick={(e) => {
            const link = (e.target as HTMLElement).closest<HTMLAnchorElement>(
              ".markdown-scope a",
            );
            if (link) {
              e.preventDefault();
              const href = link.getAttribute("href") ?? "";
              if (href.startsWith("#")) {
                let id = href.slice(1);
                try {
                  id = decodeURIComponent(id);
                } catch {}
                const headings = e.currentTarget.querySelectorAll(
                  ".ProseMirror :is([id], h1, h2, h3, h4, h5, h6)",
                );
                const target = Array.from(headings).find(
                  (node) =>
                    node.id === id ||
                    (/^H[1-6]$/.test(node.tagName) &&
                      node.textContent
                        ?.toLowerCase()
                        .trim()
                        .replace(/[^\p{L}\p{N}\s_-]/gu, "")
                        .replace(/\s+/g, "-") === id),
                );
                target?.scrollIntoView({ block: "start" });
                return;
              }
              void window.mugdown.openExternal(href).catch(fail);
            }
          }}
          onContextMenu={(e) => {
            if (!active) return;
            e.preventDefault();
            editor.current?.contextAt(e.clientX, e.clientY);
            setContext({
              x: Math.min(e.clientX, innerWidth - 290),
              y: Math.min(e.clientY, innerHeight - 440),
            });
          }}
        >
          {active ? (
            <div className="markdown-scope" data-editor-mode={mode}>
              {mode === "source" ? (
                <SourceEditor
                  key={`${active.id}:source:${getLanguage()}`}
                  ref={editor}
                  id={active.id}
                  value={active.raw}
                  onChange={change}
                  onError={fail}
                  dark={dark}
                />
              ) : (
                <RichEditor
                  key={`${active.id}:rich:${getLanguage()}`}
                  ref={editor}
                  id={active.id}
                  value={splitMarkdown(active.raw).body}
                  onChange={(body) => {
                    const doc = docNow();
                    if (doc) change(splitMarkdown(doc.raw).header + body);
                  }}
                  onError={fail}
                  dark={dark}
                />
              )}
            </div>
          ) : (
            <div className="empty">
              <img src={cup} alt="" />
              <p>{t("拖入 Markdown 文档，或者")} </p>
              <div>
                <button className="primary" onClick={() => run("open")}>
                  {t("打开文档")} <kbd>{mac ? "⌘O" : "Ctrl+O"}</kbd>
                </button>
                <button onClick={() => run("new")}>
                  {t("新建")} <kbd>{mac ? "⌘N" : "Ctrl+N"}</kbd>
                </button>
              </div>
            </div>
          )}
          {drop && (
            <div className="drop-overlay">
              <FileText size={30} />
              <span>{t("松开，打开文档")} </span>
            </div>
          )}
        </main>
      </div>
      <footer className="statusbar">
        <span title={active?.path ?? ""}>
          {!native
            ? t("浏览器演示")
            : active
              ? active.raw === active.saved
                ? t("已保存到本地")
                : t("未保存")
              : t("就绪")}
        </span>
        <span className="status-spacer" />
        {active && (
          <>
            <span>
              {count} {t("字")}{" "}
            </span>
            <span>Markdown</span>
            <span>UTF-8</span>
            {splitMarkdown(active.raw).header && (
              <button
                title={t("文档含原有头部信息；在 MD 模式查看与编辑")}
                onClick={() => void setMode("source")}
              >
                {t("头部已保留")}{" "}
              </button>
            )}
          </>
        )}
      </footer>
      {context && (
        <div
          className="context-menu dropdown"
          role="menu"
          style={{ left: context.x, top: Math.max(8, context.y) }}
        >
          {renderMenu(
            editItems.filter(
              ([key]) =>
                ![
                  "copy-plain",
                  "copy-html",
                  "paragraph-before",
                  "paragraph-after",
                  "replace",
                ].includes(key),
            ),
            true,
          )}
        </div>
      )}
      {notice && (
        <div className="toast" role="alert">
          <span>{notice}</span>
          <button aria-label={t("关闭提示")} onClick={() => setNotice("")}>
            <X size={15} />
          </button>
        </div>
      )}
      {appearance && state && (
        <div className="modal-backdrop" onClick={() => setAppearance(false)}>
          <section
            className="appearance-dialog"
            role="dialog"
            aria-label={t("外观设置")}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="dialog-title">
              <h2>{t("外观")} </h2>
              <button
                aria-label={t("关闭外观设置")}
                onClick={() => setAppearance(false)}
              >
                <X size={18} />
              </button>
            </div>
            <p className="muted">{t("选一个舒服的写作环境。")} </p>
            <label>
              {t("界面语言")}{" "}
              <select
                aria-label={t("界面语言")}
                value={state.settings.language}
                onChange={(e) => {
                  const language = e.target.value;
                  setMenu(null);
                  void flush()
                    .then(() =>
                      call("save_settings", {
                        settings: { ...stateRef.current!.settings, language },
                      }),
                    )
                    .catch(fail);
                }}
              >
                {languages.map((language) => (
                  <option key={language.id} value={language.id}>
                    {language.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("界面皮肤")}{" "}
              <select
                value={state.settings.uiTheme}
                onChange={(e) =>
                  void call("save_settings", {
                    settings: { ...state.settings, uiTheme: e.target.value },
                  }).catch(fail)
                }
              >
                <option value="system">{t("跟随系统")} </option>
                {UI_THEMES.map((themeItem) => (
                  <option value={themeItem.id} key={themeItem.id}>
                    {t(themeItem.name)}
                  </option>
                ))}
              </select>
            </label>
            <div className="theme-swatches">
              {UI_THEMES.filter(
                (themeItem) => !themeItem.id.startsWith("winotypo"),
              ).map((themeItem) => (
                <button
                  key={themeItem.id}
                  aria-label={themeItem.name}
                  className={theme.id === themeItem.id ? "selected" : ""}
                  onClick={() =>
                    void call("save_settings", {
                      settings: { ...state.settings, uiTheme: themeItem.id },
                    }).catch(fail)
                  }
                  style={{
                    background: themeItem.colors.chrome,
                    color: themeItem.colors.text,
                    borderColor: themeItem.colors.line,
                  }}
                >
                  <i style={{ background: themeItem.colors.accent }} />
                  Aa{theme.id === themeItem.id && <Check size={12} />}
                </button>
              ))}
            </div>
            <label>
              {t("Markdown 排版")}{" "}
              <select
                value={state.settings.markdownStyle}
                onChange={(e) =>
                  void call("save_settings", {
                    settings: {
                      ...state.settings,
                      markdownStyle: e.target.value,
                    },
                  }).catch(fail)
                }
              >
                {MARKDOWN_STYLES.map((themeItem) => (
                  <option key={themeItem.id} value={themeItem.id}>
                    {themeItem.name}
                  </option>
                ))}
                {state.presets?.items.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="preset-settings">
              <p className="muted">
                {t("添加 CSS 到预设目录后，点击刷新即可使用。")}
              </p>
              <div>
                <code>{state.presets?.directory ?? "./presets"}</code>
                {native && (
                  <button
                    className="secondary"
                    onClick={() => void call("open_presets_folder").catch(fail)}
                  >
                    {t("打开目录")}
                  </button>
                )}
                <button
                  className="secondary"
                  onClick={() => void call("refresh_presets").catch(fail)}
                >
                  {t("刷新预设")}
                </button>
              </div>
              {state.presets?.error && (
                <p className="settings-storage-error">
                  {translateError(state.presets.error)}
                </p>
              )}
            </div>
            <label>
              {t("正文字号")} <span>{state.settings.fontSize}px</span>
              <input
                aria-label={t("正文字号")}
                type="range"
                min="12"
                max="28"
                value={state.settings.fontSize}
                onChange={(e) =>
                  void call("save_settings", {
                    settings: { ...state.settings, fontSize: +e.target.value },
                  }).catch(fail)
                }
              />
            </label>
            <label>
              {t("正文宽度")} <span>{state.settings.contentWidth}px</span>
              <input
                aria-label={t("正文宽度")}
                type="range"
                min="500"
                max="1400"
                step="50"
                value={state.settings.contentWidth}
                onChange={(e) =>
                  void call("save_settings", {
                    settings: {
                      ...state.settings,
                      contentWidth: +e.target.value,
                    },
                  }).catch(fail)
                }
              />
            </label>
            <div className="css-setting">
              <div>
                <strong>{t("自定义 CSS")} </strong>
                <p className="muted">{t("只作用于正文，不修改文档。")} </p>
              </div>
              <button
                className="secondary"
                onClick={() =>
                  void pickCss()
                    .then((css) => {
                      if (css !== null)
                        return call("save_settings", {
                          settings: { ...state.settings, customCss: css },
                        });
                    })
                    .catch(fail)
                }
              >
                {t("导入 CSS…")}{" "}
              </button>
              {state.settings.customCss && (
                <button
                  onClick={() =>
                    void call("save_settings", {
                      settings: { ...state.settings, customCss: "" },
                    }).catch(fail)
                  }
                >
                  {t("移除")}{" "}
                </button>
              )}
            </div>
            <div className="appearance-sample">
              <h3>{t("恰好够用。")} </h3>
              <p>
                {t("一段文字，一个好想法。")} <a>{t("继续写下去。")} </a>
              </p>
              <code># mugdown</code>
            </div>
            <div className="settings-storage">
              <strong>{t("设置文件")}</strong>
              {state.settingsStorage ? (
                <>
                  <p className="muted">
                    {state.settingsStorage.location === "system"
                      ? t("设置随当前系统用户保存。")
                      : t("设置保存在程序旁，移动程序文件夹即可携带设置。")}
                  </p>
                  <label className="storage-toggle">
                    <span>{t("随系统目录保存")}</span>
                    <input
                      type="checkbox"
                      role="switch"
                      aria-label={t("随系统目录保存")}
                      checked={state.settingsStorage.location === "system"}
                      onChange={(e) =>
                        void call("set_settings_location", {
                          location: e.target.checked ? "system" : "portable",
                        }).catch(fail)
                      }
                    />
                  </label>
                  <input
                    aria-label={t("设置文件路径")}
                    readOnly
                    value={state.settingsStorage.path}
                  />
                  {state.settingsStorage.error && (
                    <p className="settings-storage-error" role="status">
                      {translateError(state.settingsStorage.error)}
                    </p>
                  )}
                </>
              ) : (
                <p className="muted">{t("浏览器演示使用浏览器本地存储。")}</p>
              )}
            </div>
            <p className="dialog-footnote">
              mugdown 0.2.8 ·{" "}
              {native ? (mac ? "macOS" : "Windows") : t("浏览器预览")}{" "}
              {t("· 本地 Markdown 编辑器")}{" "}
            </p>
          </section>
        </div>
      )}
      {choice && (
        <div className="modal-backdrop">
          <section
            className="choice-dialog"
            role="dialog"
            aria-label={choice.title}
          >
            <h2>{choice.title}</h2>
            <p>{choice.description}</p>
            <div className="dialog-actions">
              {choice.buttons.map((b) => (
                <button
                  key={b.value}
                  className={b.primary ? "primary" : "secondary"}
                  onClick={() => {
                    choice.resolve(b.value);
                    setChoice(null);
                  }}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
      {state?.presets?.items.find(
        (preset) => preset.id === state.settings.markdownStyle,
      ) && (
        <style>
          {scopedCss(
            state.presets.items.find(
              (preset) => preset.id === state.settings.markdownStyle,
            )!.css,
          )}
        </style>
      )}
      {state?.settings.customCss && (
        <style>{scopedCss(state.settings.customCss)}</style>
      )}
      {windowMergeCount !== null && (
        <div className="window-merge-target" role="status">
          <span>
            {t("松开，合并 {0} 个文档到此窗口", { 0: windowMergeCount })}
          </span>
        </div>
      )}
      {windowDragging && (
        <div className="drag-hint" role="status">
          {windowMergePreview
            ? t("松开，将此窗口合并到另一窗口 · Esc 取消")
            : t("拖到另一窗口内合并 · 拖到桌面移动 · Esc 取消")}
        </div>
      )}
      {dragId && (
        <div className="drag-hint">
          {t("拖出窗口拆分 · 拖到另一窗口内合并 · Esc 取消")}{" "}
        </div>
      )}
    </div>
  );
}
