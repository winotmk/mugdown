const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");

(async () => {
  const browser = await chromium.launch({
    ...(process.env.MUGDOWN_BROWSER_EXECUTABLE
      ? { executablePath: process.env.MUGDOWN_BROWSER_EXECUTABLE }
      : { channel: "msedge" }),
    headless: true,
  });
  const checks = [],
    errors = [];
  try {
    const page = await browser.newPage({
      viewport: { width: 980, height: 900 },
    });
    page.setDefaultTimeout(15000);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "platform", { get: () => "MacIntel" });
      const callbacks = new Map(),
        listeners = new Map();
      let next = 1;
      const system =
        "~/Library/Application Support/com.winotmk.mugdown/settings.json";
      const portable = "./mugdown-data/settings.json";
      const state = {
        documents: [
          {
            id: "draft",
            path: null,
            name: "未命名.md",
            raw: "# Mac notebook\n\nOriginal paragraph\n",
            saved: "# Mac notebook\n\nOriginal paragraph\n",
            revision: 0,
          },
        ],
        windows: [{ label: "editor-mac", ids: ["draft"], active: "draft" }],
        settings: {
          uiTheme: "github-light",
          markdownStyle: "github",
          fontSize: 17,
          contentWidth: 900,
          customCss: "",
          language: "zh-CN",
          toolbarPinned: false,
        },
        settingsStorage: { path: system, location: "system", error: null },
        presets: {
          directory:
            "~/Library/Application Support/com.winotmk.mugdown/presets",
          items: [
            {
              id: "external:Book.css",
              name: "Book",
              css: "p {font-family:serif}",
            },
          ],
          error: null,
        },
      };
      const mock = (window.__mugMac = {
        state,
        commands: [],
        rejectLocation: false,
        emit(event = "workspace", payload = state) {
          for (const listener of listeners.values()) {
            if (listener.event === event)
              callbacks.get(listener.handler)?.({
                event,
                id: listener.id,
                payload: structuredClone(payload),
              });
          }
        },
      });
      window.isTauri = true;
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
        unregisterListener(_event, id) {
          listeners.delete(id);
        },
      };
      window.__TAURI_INTERNALS__ = {
        metadata: {
          currentWindow: { label: "editor-mac" },
          currentWebview: { label: "editor-mac" },
        },
        transformCallback(fn) {
          const id = next++;
          callbacks.set(id, fn);
          return id;
        },
        unregisterCallback(id) {
          callbacks.delete(id);
        },
        async invoke(command, args = {}) {
          mock.commands.push({ command, args: structuredClone(args) });
          if (command === "plugin:event|listen") {
            const id = next++;
            listeners.set(id, { id, event: args.event, handler: args.handler });
            return id;
          }
          if (command === "workspace") return structuredClone(state);
          if (command === "save_settings") {
            state.settings = args.settings;
            state.settingsStorage.error = null;
            mock.emit();
          }
          if (command === "set_settings_location") {
            if (mock.rejectLocation) {
              state.settingsStorage.error =
                "无法启用便携模式，请确认 app 旁的数据目录可写: read-only volume";
              mock.emit();
              throw state.settingsStorage.error;
            }
            state.settingsStorage.location = args.location;
            state.settingsStorage.path =
              args.location === "portable" ? portable : system;
            state.settingsStorage.error = null;
            state.presets.directory =
              args.location === "portable"
                ? "./mugdown-data/presets"
                : "~/Library/Application Support/com.winotmk.mugdown/presets";
            mock.emit();
          }
          if (command === "update_document") {
            state.documents[0].raw = args.raw;
            state.documents[0].revision++;
            mock.emit("document-changed", state.documents[0]);
          }
          if (command === "read_clipboard")
            return {
              text: "Plain clipboard text",
              html: "<b>Rich clipboard text</b>",
            };
          if (command === "refresh_presets") mock.emit();
        },
      };
    });

    await page.goto(process.env.MUGDOWN_URL || "http://127.0.0.1:5173");
    await page.locator(".ProseMirror p").waitFor();
    assert.equal(await page.locator(".app.is-native-mac").count(), 1);
    assert.equal(await page.locator(".menubar").count(), 0);
    assert.equal(await page.locator(".window-controls").count(), 0);
    assert((await page.locator(".brand").boundingBox()).x >= 80);
    checks.push("Mac 标题栏隐藏重复主菜单，为原生窗口按钮保留空间");

    await page.locator(".toolbar-handle").hover();
    await page
      .getByRole("button", { name: "更多编辑操作", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "复制为 HTML", exact: true })
      .waitFor();
    await page
      .getByRole("menuitem", { name: "创建段落副本", exact: true })
      .waitFor();
    await page.keyboard.press("Escape");
    checks.push("隐藏主菜单后，格式工具栏仍可打开高级编辑操作");

    await page.locator(".ProseMirror p").click();
    await page.evaluate(() => __mugMac.emit("menu-command", "paste-plain"));
    await page.waitForFunction(() =>
      document
        .querySelector(".ProseMirror")
        .innerText.includes("Plain clipboard text"),
    );
    assert.equal(await page.locator(".ProseMirror strong").count(), 0);
    checks.push("系统菜单的纯文本粘贴命令进入真实编辑器且不带 HTML 格式");

    await page.evaluate(() => __mugMac.emit("menu-command", "appearance"));
    const dialog = page.getByRole("dialog", { name: "外观设置", exact: true });
    await dialog.waitFor();
    const toggle = page.getByRole("switch", { name: "便携模式", exact: true });
    const path = page.getByRole("textbox", {
      name: "设置文件路径",
      exact: true,
    });
    assert.equal(await toggle.isChecked(), false);
    assert((await path.inputValue()).includes("Library/Application Support"));
    assert.equal(
      await page
        .getByRole("switch", { name: "随系统目录保存", exact: true })
        .count(),
      0,
    );
    await page
      .getByRole("button", { name: "打开配置文件夹", exact: true })
      .click();
    await page.waitForFunction(() =>
      __mugMac.commands.some((c) => c.command === "open_settings_folder"),
    );
    checks.push("Mac 设置默认使用用户目录，并提供打开配置文件夹入口");

    await toggle.check();
    await page.waitForFunction(
      () => __mugMac.state.settingsStorage.location === "portable",
    );
    assert.equal(await path.inputValue(), "./mugdown-data/settings.json");
    assert(
      await dialog.getByText("./mugdown-data/presets", { exact: true }).count(),
    );
    await toggle.uncheck();
    await page.waitForFunction(
      () => __mugMac.state.settingsStorage.location === "system",
    );
    assert((await path.inputValue()).includes("Library/Application Support"));
    checks.push("便携开关双向切换，配置和预设目录同步更新");

    await page.evaluate(() => {
      __mugMac.rejectLocation = true;
    });
    await toggle.click();
    await dialog.locator(".settings-storage-error").waitFor();
    assert.equal(await toggle.isChecked(), false);
    assert((await path.inputValue()).includes("Library/Application Support"));
    checks.push("启用便携模式失败后保留原位置，并显示可写目录提示");

    await page.getByLabel("界面语言", { exact: true }).selectOption("en-US");
    await page
      .getByRole("dialog", { name: "Appearance settings", exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("switch", { name: "Portable mode", exact: true })
        .isChecked(),
      false,
    );
    await page
      .getByRole("button", { name: "Open settings folder", exact: true })
      .waitFor();
    await page
      .getByRole("switch", { name: "Portable mode", exact: true })
      .click();
    await page.locator(".settings-storage-error").waitFor();
    assert(
      (await page.locator(".settings-storage-error").innerText()).startsWith(
        "Cannot enable portable mode",
      ),
    );
    checks.push("Mac 存储设置和错误提示支持英文");
    assert.deepEqual(errors, []);
    await fs.mkdir(".qa", { recursive: true });
    await fs.writeFile(
      ".qa/mac-ui-checks.json",
      JSON.stringify({ checks, errors }, null, 2),
    );
    console.log(
      JSON.stringify({ passed: checks.length, checks, errors }, null, 2),
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
