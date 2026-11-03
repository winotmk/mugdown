import { t } from "../i18n";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { DocumentData, Workspace } from "../shared/types";
import { DocumentHistory } from "../shared/document-history";

export const native = isTauri();
export const mac = /Mac/i.test(navigator.platform);
export const label = native ? getCurrentWindow().label : "editor-browser";
const events = new EventTarget();
const history = new DocumentHistory();
const browserState: Workspace = {
  documents: [],
  windows: [{ label, ids: [], active: null }],
  settings: {
    uiTheme: "github-light",
    markdownStyle: "github",
    fontSize: 17,
    contentWidth: 900,
    customCss: "",
    language: "zh-CN",
    toolbarPinned: false,
  },
  presets: {
    directory: "./presets",
    items: Object.entries(
      import.meta.glob<string>("../../assets/presets/*.css", {
        eager: true,
        query: "?raw",
        import: "default",
      }),
    ).map(([path, css]) => {
      const file = path.split("/").pop()!;
      return { id: `external:${file}`, name: file.replace(/\.css$/i, ""), css };
    }),
    error: null,
  },
};
try {
  Object.assign(
    browserState.settings,
    JSON.parse(localStorage.getItem("mugdown-appearance") || "{}"),
  );
} catch {}
function announce() {
  events.dispatchEvent(
    new CustomEvent("workspace", { detail: structuredClone(browserState) }),
  );
}
export async function call<T = void>(
  command: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  if (native) return invoke<T>(command, args);
  const current = browserState.windows[0];
  const doc = browserState.documents.find((d) => d.id === args.id);
  let result: unknown;
  switch (command) {
    case "workspace":
      return structuredClone(browserState) as T;
    case "ready":
      return undefined as T;
    case "create_document": {
      const d: DocumentData = {
        id: crypto.randomUUID(),
        name: t("未命名.md"),
        path: null,
        raw: "",
        saved: "",
        revision: 0,
      };
      browserState.documents.push(d);
      current.ids.push(d.id);
      current.active = d.id;
      history.open(d.id, "");
      result = d;
      break;
    }
    case "activate_document":
      current.active = args.id as string;
      break;
    case "update_document":
      if (!doc) throw Error(t("文档已关闭"));
      history.record(doc.id, doc.raw, args.raw as string, args.group as string);
      doc.raw = args.raw as string;
      doc.revision++;
      result = doc;
      break;
    case "undo_document":
      if (!doc) throw Error(t("文档已关闭"));
      doc.raw =
        (args.forward
          ? history.redo(doc.id, doc.raw)
          : history.undo(doc.id, doc.raw)) ?? doc.raw;
      result = doc;
      break;
    case "close_document":
      current.ids = current.ids.filter((id) => id !== args.id);
      current.active = current.ids.at(-1) ?? null;
      browserState.documents = browserState.documents.filter(
        (d) => d.id !== args.id,
      );
      break;
    case "reorder_documents":
      current.ids = args.ids as string[];
      break;
    case "save_settings":
      browserState.settings = args.settings as Workspace["settings"];
      localStorage.setItem("mugdown-appearance", JSON.stringify(args.settings));
      break;
    case "refresh_presets":
      break;
    case "write_clipboard":
      await navigator.clipboard.writeText(args.text as string);
      break;
    case "read_clipboard":
      result = { text: await navigator.clipboard.readText(), html: "" };
      break;
    case "image_source":
      result = args.url;
      break;
    case "open_external":
      window.open(args.url as string, "_blank", "noopener");
      break;
    case "finish_tab_drag":
      return undefined as T;
    default:
      throw Error(t("此功能需要在 mugdown 桌面版使用"));
  }
  announce();
  return structuredClone(result) as T;
}
export async function subscribe<T>(name: string, handler: (value: T) => void) {
  if (native) return listen<T>(name, (e) => handler(e.payload));
  const fn = (e: Event) => handler((e as CustomEvent).detail);
  events.addEventListener(name, fn);
  return () => events.removeEventListener(name, fn);
}
export async function openFiles() {
  if (native) {
    const paths = await open({
      multiple: true,
      filters: [
        {
          name: t("Markdown 文档"),
          extensions: ["md", "markdown", "mdown", "mkd", "txt"],
        },
      ],
    });
    if (paths)
      await call("open_documents", {
        paths: Array.isArray(paths) ? paths : [paths],
      });
  } else {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = ".md,.markdown,.mdown,.mkd,.txt";
    input.onchange = async () => {
      for (const file of Array.from(input.files ?? []))
        await openBrowserFile(file);
    };
    input.click();
  }
}
export async function openBrowserFile(file: File) {
  const d = await call<DocumentData>("create_document");
  const stored = browserState.documents.find((doc) => doc.id === d.id)!;
  stored.raw = stored.saved = await file.text();
  stored.name = file.name;
  history.reset(d.id, stored.raw);
  announce();
}
export async function savePath(name: string) {
  return native
    ? save({
        defaultPath: name,
        filters: [{ name: t("Markdown 文档"), extensions: ["md"] }],
      })
    : null;
}
export function downloadDocument(doc: DocumentData) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(
    new Blob([doc.raw], { type: "text/markdown;charset=utf-8" }),
  );
  a.download = doc.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  const stored = browserState.documents.find((d) => d.id === doc.id);
  if (stored) stored.saved = doc.raw;
  announce();
}
export async function pickImage() {
  return native
    ? open({
        filters: [
          {
            name: t("图片"),
            extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif"],
          },
        ],
      })
    : null;
}
export async function pickCss() {
  if (!native) throw Error(t("请在桌面版导入 CSS 预设"));
  const path = await open({
    filters: [{ name: t("CSS 样式表"), extensions: ["css"] }],
  });
  return path && typeof path === "string"
    ? call<string>("read_css", { path })
    : null;
}
window.mugdown = {
  importImage: (id, name, data) =>
    call<string>("import_image", { id, name, data: Array.from(data) }),
  imageSource: (id, url) => call<string>("image_source", { id, url }),
  openExternal: (url) => call("open_external", { url }),
  writeClipboard: (data) => call("write_clipboard", data),
  readClipboard: () => call("read_clipboard"),
};
