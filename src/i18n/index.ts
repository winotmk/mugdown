export interface LanguagePack {
  name: string;
  messages: Record<string, string>;
}
const files = import.meta.glob<LanguagePack>("./locales/*.json", {
  eager: true,
  import: "default",
});
const packs = Object.fromEntries(
  Object.entries(files).map(([file, pack]) => [
    file
      .split("/")
      .pop()!
      .replace(/\.json$/, ""),
    pack,
  ]),
);
export const languages = Object.entries(packs).map(([id, pack]) => ({
  id,
  name: pack.name,
}));
let current = "zh-CN";
export function setLanguage(language?: string) {
  current = language && packs[language] ? language : "zh-CN";
  if (typeof document !== "undefined") document.documentElement.lang = current;
}
export function getLanguage() {
  return current;
}
// Source phrases are stable message IDs, like gettext. New packs only change values.
export function t(
  message: string,
  params: Record<string, string | number> = {},
) {
  const translated =
    packs[current]?.messages[message] ??
    packs["zh-CN"]?.messages[message] ??
    message;
  return translated.replace(/\{(\w+)\}/g, (token, key) =>
    params[key] === undefined ? token : String(params[key]),
  );
}
export function translateError(error: unknown): string {
  const message = String(error).replace(/^Error:\s*/, "");
  if (message.includes("\n"))
    return message.split("\n").map(translateError).join("\n");
  if (packs[current]?.messages[message])
    return packs[current].messages[message];
  for (const [source, target] of Object.entries(
    packs[current]?.messages ?? {},
  )) {
    if (source.length > 4 && message.startsWith(source + ":"))
      return target + message.slice(source.length);
  }
  return message;
}
export function documentName(doc: { name: string; path: string | null }) {
  return !doc.path && ["未命名.md", "Untitled.md"].includes(doc.name)
    ? t("未命名.md")
    : doc.name;
}
