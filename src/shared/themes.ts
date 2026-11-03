import data from "./generated/ui-themes.json";

export const UI_THEME_IDS = [
  "github-light",
  "github-dark",
  "catppuccin-latte",
  "catppuccin-mocha",
  "nord",
  "dracula",
  "solarized-light",
  "solarized-dark",
  "radix-light",
  "radix-dark",
  "winotypo-light",
  "winotypo-dark",
] as const;
export type BuiltinThemeId = (typeof UI_THEME_IDS)[number];
export type UiThemeId = BuiltinThemeId | "system" | `custom:${string}`;
export const COLOR_LABELS = {
  paper: "编辑区域背景",
  chrome: "顶部栏背景",
  side: "侧栏背景",
  panel: "面板背景",
  text: "主要文字",
  muted: "次要文字和图标",
  line: "边框",
  hover: "悬停背景",
  selection: "选中背景",
  "selection-text": "选中文字",
  success: "成功状态",
  button: "主要按钮背景",
  "button-text": "主要按钮文字",
  red: "错误状态",
  accent: "强调色和链接",
  tabs: "标签页栏背景",
  "active-tab": "激活标签背景",
} as const;
export type ThemeColors = Record<keyof typeof COLOR_LABELS, string>;
export interface CustomTheme {
  id: `custom:${string}`;
  name: string;
  base: BuiltinThemeId;
  colors: Partial<ThemeColors>;
  documentColors: boolean;
}
export type MarkdownStyle = "github" | "sakura" | "modest";
export const UI_THEMES = data;
export const MARKDOWN_STYLES = [
  {
    id: "github",
    name: "GitHub",
    description: "GitHub Markdown CSS · 明暗自动适配",
    source: "https://github.com/sindresorhus/github-markdown-css",
  },
  {
    id: "sakura",
    name: "Sakura",
    description: "Sakura.css · 宽松阅读排版，明暗适配",
    source: "https://github.com/oxalorg/sakura",
  },
  {
    id: "modest",
    name: "Modest",
    description: "Markdown.css · 浅色纸张、居中标题",
    source: "https://github.com/markdowncss/modest",
  },
] as const;
export const THEME_SOURCES: Record<string, string> = {
  githubUi: "https://github.com/primer/github-vscode-theme",
  catppuccin: "https://github.com/catppuccin/palette",
  nord: "https://github.com/nordtheme/visual-studio-code",
  dracula: "https://github.com/dracula/visual-studio-code",
  solarized: "https://github.com/altercation/solarized",
  radix: "https://github.com/radix-ui/colors",
};
export function normalizeCustomThemes(value: unknown): CustomTheme[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  return value.slice(0, 50).flatMap((item) => {
    if (
      !item ||
      typeof item !== "object" ||
      !/^custom:[\w-]{1,80}$/.test(item.id) ||
      ids.has(item.id)
    )
      return [];
    ids.add(item.id);
    const colors = Object.fromEntries(
      Object.entries(item.colors ?? {}).filter(
        ([key, color]) =>
          key in COLOR_LABELS &&
          typeof color === "string" &&
          /^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(color),
      ),
    );
    return [
      {
        id: item.id,
        name:
          typeof item.name === "string" && item.name.trim()
            ? item.name.trim().slice(0, 60)
            : "我的配色",
        base: UI_THEME_IDS.includes(item.base) ? item.base : "github-dark",
        colors,
        documentColors: item.documentColors === true,
      },
    ];
  });
}
export function resolveUiTheme(
  id: string,
  systemDark: boolean,
  customThemes: CustomTheme[] = [],
) {
  const resolved =
    id === "system" ? (systemDark ? "github-dark" : "github-light") : id;
  const custom = customThemes.find((theme) => theme.id === resolved);
  const base =
    UI_THEMES.find((theme) => theme.id === (custom?.base ?? resolved)) ??
    UI_THEMES[1];
  return {
    ...base,
    id: custom?.id ?? base.id,
    name: custom?.name ?? base.name,
    base: base.id as BuiltinThemeId,
    documentColors: custom?.documentColors ?? base.documentColors ?? false,
    colors: { ...base.colors, ...custom?.colors } as ThemeColors,
    custom: !!custom,
  };
}
export function normalizeAppearance(settings: {
  uiTheme?: unknown;
  markdownStyle?: unknown;
  theme?: unknown;
  customThemes?: unknown;
}) {
  const customThemes = normalizeCustomThemes(settings.customThemes);
  const uiTheme: UiThemeId =
    settings.uiTheme === "system" ||
    UI_THEME_IDS.includes(settings.uiTheme as never) ||
    customThemes.some((item) => item.id === settings.uiTheme)
      ? (settings.uiTheme as UiThemeId)
      : settings.theme === "light"
        ? "github-light"
        : settings.theme === "system"
          ? "system"
          : "github-dark";
  const markdownStyle: MarkdownStyle = MARKDOWN_STYLES.some(
    (style) => style.id === settings.markdownStyle,
  )
    ? (settings.markdownStyle as MarkdownStyle)
    : "github";
  return { uiTheme, markdownStyle, customThemes };
}
export function markdownMode(
  style: MarkdownStyle,
  dark: boolean,
): "light" | "dark" {
  return style === "modest" || !dark ? "light" : "dark";
}
