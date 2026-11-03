import { afterEach, describe, it, expect } from "vitest";
import zh from "../src/i18n/locales/zh-CN.json";
import en from "../src/i18n/locales/en-US.json";
import {
  t,
  setLanguage,
  getLanguage,
  languages,
  documentName,
  translateError,
} from "../src/i18n";
afterEach(() => setLanguage("zh-CN"));
describe("language packs", () => {
  it("discovers packs and checks complete matching message IDs", () => {
    expect(languages.map((l) => l.id)).toEqual(
      expect.arrayContaining(["en-US", "zh-CN"]),
    );
    const packs = import.meta.glob<{
      name: string;
      messages: Record<string, string>;
    }>("../src/i18n/locales/*.json", { eager: true, import: "default" });
    for (const [file, pack] of Object.entries(packs)) {
      expect(pack.name.trim(), file).not.toBe("");
      expect(Object.keys(pack.messages).sort(), file).toEqual(
        Object.keys(zh.messages).sort(),
      );
      for (const [source, target] of Object.entries(pack.messages)) {
        expect(
          (target.match(/\{\w+\}/g) ?? []).sort(),
          file + ": " + source,
        ).toEqual((source.match(/\{\w+\}/g) ?? []).sort());
      }
    }
    for (const [source, target] of Object.entries(en.messages)) {
      expect(/[\u3400-\u9fff]/.test(target), source).toBe(false);
    }
  });
  it("switches language and interpolates without translating user text", () => {
    setLanguage("en-US");
    expect(t("合并到窗口 {0}", { 0: 2 })).toBe("Merge into window 2");
    expect(t("关闭 {0}", { 0: "我的文章.md" })).toBe("Close 我的文章.md");
  });
  it("preserves filenames but localizes an unsaved default title", () => {
    setLanguage("en-US");
    expect(documentName({ path: null, name: "未命名.md" })).toBe("Untitled.md");
    expect(documentName({ path: "C:/未命名.md", name: "未命名.md" })).toBe(
      "未命名.md",
    );
  });
  it("localizes native errors and preserves diagnostic suffixes", () => {
    setLanguage("en-US");
    expect(translateError("Error: 文档已关闭")).toBe("The document is closed");
    expect(translateError("无效文件名: test")).toBe("Invalid filename: test");
    expect(
      translateError(
        "无法读取旧版设置: E:/设置/settings.json: denied\n旧版设置文件格式错误: expected value",
      ),
    ).toBe(
      "Cannot read the previous settings: E:/设置/settings.json: denied\nInvalid previous settings file: expected value",
    );
  });
  it("falls back safely for unknown languages or new messages", () => {
    setLanguage("missing");
    expect(getLanguage()).toBe("zh-CN");
    expect(t("新消息")).toBe("新消息");
  });
});
