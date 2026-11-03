const { chromium } = require("playwright"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises");

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 980, height: 900 } });
  const checks = [],
    errors = [];
  const file = "./settings.json";
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(10000);
  await page.addInitScript(
    ({ file }) => {
      const callbacks = new Map(),
        listeners = new Map();
      let next = 1;
      const state = {
        documents: [],
        windows: [{ label: "editor-test", ids: [], active: null }],
        settings: {
          uiTheme: "github-dark",
          markdownStyle: "sakura",
          fontSize: 19,
          contentWidth: 820,
          customCss: "",
          language: "zh-CN",
          toolbarPinned: true,
        },
        settingsStorage: { path: file, location: "portable", error: null },
        presets: { directory: "./presets", items: [], error: null },
      };
      if (new URL(location.href).searchParams.has("settings-error")) {
        state.settingsStorage.error =
          "设置文件格式错误（请修正 JSON）: " + file + ": expected value";
      }
      const mock = (window.__mugSettings = {
        state,
        rejectSave: false,
        rejectLocation: false,
        commands: [],
        nextPresets: [],
        emit(event = "workspace", payload = state) {
          for (const listener of listeners.values())
            if (listener.event === event)
              callbacks.get(listener.handler)?.({
                event,
                id: listener.id,
                payload: structuredClone(payload),
              });
        },
      });
      window.isTauri = true;
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
        unregisterListener(event, id) {
          listeners.delete(id);
        },
      };
      window.__TAURI_INTERNALS__ = {
        metadata: {
          currentWindow: { label: "editor-test" },
          currentWebview: { label: "editor-test" },
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
          mock.commands.push({ command, args });
          if (command === "plugin:event|listen") {
            const id = next++;
            listeners.set(id, { id, event: args.event, handler: args.handler });
            return id;
          }
          if (command === "workspace") return structuredClone(state);
          if (command === "refresh_presets") {
            state.presets.items = mock.nextPresets;
            mock.emit();
          }
          if (command === "set_settings_location") {
            if (mock.rejectLocation) {
              mock.emit();
              throw "无法记录设置保存位置";
            }
            state.settingsStorage.location = args.location;
            state.settingsStorage.path =
              args.location === "system"
                ? "%APPDATA%\\com.winotmk.mugdown\\settings.json"
                : file;
            state.settingsStorage.error = null;
            mock.emit();
          }
          if (command === "save_settings") {
            if (mock.rejectSave) {
              state.settingsStorage.error =
                "无法保存设置，请选择可写的保存位置: " +
                file +
                ": permission denied";
              mock.emit();
              throw state.settingsStorage.error;
            }
            state.settings = args.settings;
            state.settingsStorage.error = null;
            mock.emit();
          }
        },
      };
    },
    { file },
  );
  try {
    const url = process.env.MUGDOWN_URL || "http://127.0.0.1:5173";
    await page.goto(url);
    await page.locator(".appearance-button").click();
    const path = page.getByRole("textbox", {
      name: "设置文件路径",
      exact: true,
    });
    await path.waitFor();
    assert.equal(await path.inputValue(), file);
    assert.equal(await path.getAttribute("readonly"), "");
    assert.equal(
      await page.getByRole("combobox").nth(1).inputValue(),
      "github-dark",
    );
    checks.push("调色板显示可复制的相对路径，保留迁移后的皮肤");
    await page.evaluate(() => {
      __mugSettings.nextPresets = [
        {
          id: "external:Custom.css",
          name: "Custom",
          css: "h1 { color: red; }",
        },
      ];
    });
    await page.getByRole("button", { name: "刷新预设", exact: true }).click();
    const markdownStyle = page.getByRole("combobox").nth(2);
    await markdownStyle.selectOption("external:Custom.css");
    assert.equal(await markdownStyle.inputValue(), "external:Custom.css");
    await markdownStyle.selectOption("sakura");
    checks.push("刷新原生目录后新增 CSS 出现在下拉列表并可选择");

    await page
      .getByRole("combobox", { name: "界面语言", exact: true })
      .selectOption("en-US");
    await page
      .getByRole("textbox", { name: "Settings file path", exact: true })
      .waitFor();
    checks.push("英文界面包含设置路径说明与标签");

    await page.evaluate(() => {
      __mugSettings.rejectSave = true;
    });
    await page.getByRole("combobox").nth(1).selectOption("github-light");
    await page.locator(".settings-storage-error").waitFor();
    assert.equal(
      await page.getByRole("combobox").nth(1).inputValue(),
      "github-dark",
    );
    assert.match(
      await page.locator(".settings-storage-error").innerText(),
      /^Cannot save settings/,
    );
    assert(
      (await page.locator(".settings-storage-error").innerText()).includes(
        file,
      ),
    );
    checks.push("保存失败保留原设置，持续显示英文错误和实际路径");

    await page.evaluate(() => {
      __mugSettings.rejectSave = false;
    });
    await page.getByRole("combobox").nth(1).selectOption("github-light");
    await page.waitForFunction(
      () =>
        document.querySelector("select") &&
        !document.querySelector(".settings-storage-error"),
    );
    assert.equal(
      await page.getByRole("combobox").nth(1).inputValue(),
      "github-light",
    );
    await page
      .getByRole("combobox", { name: "Interface language", exact: true })
      .selectOption("zh-CN");
    await path.scrollIntoViewIfNeeded();
    const dismiss = page.getByRole("button", { name: "关闭提示", exact: true });
    if (await dismiss.count()) await dismiss.click();
    const toggle = page.getByRole("switch", {
      name: "随系统目录保存",
      exact: true,
    });
    await toggle.check();
    assert.equal(
      await path.inputValue(),
      "%APPDATA%\\com.winotmk.mugdown\\settings.json",
    );
    await toggle.uncheck();
    assert.equal(await path.inputValue(), file);
    checks.push("开关可来回切换系统目录与程序旁，相对路径同步更新");
    await page.evaluate(() => {
      __mugSettings.rejectLocation = true;
    });
    await toggle.click();
    assert.equal(await toggle.isChecked(), false);
    await page.getByRole("button", { name: "关闭提示", exact: true }).click();
    checks.push("切换失败保持原位置与开关状态");
    await page.screenshot({ path: "docs/mugdown-v0.2.5-settings.png" });
    checks.push("恢复可写后成功保存并清除错误");

    await page.goto(url + "?settings-error=1");
    await page
      .getByRole("alert")
      .filter({ hasText: "设置文件格式错误" })
      .waitFor();
    await page.locator(".appearance-button").click();
    await page.locator(".settings-storage-error").waitFor();
    checks.push("启动时提示配置损坏，调色板中可持续查看");
    await page
      .getByRole("button", { name: "关闭外观设置", exact: true })
      .click();
    await page.evaluate(() =>
      __mugSettings.emit("tauri://drag-enter", {
        paths: [],
        position: { x: 20, y: 20 },
      }),
    );
    assert.equal(await page.locator(".drop-overlay").count(), 0);
    await page.evaluate(() =>
      __mugSettings.emit("tauri://drag-enter", {
        paths: ["C:/note.md"],
        position: { x: 20, y: 20 },
      }),
    );
    await page.locator(".drop-overlay").waitFor();
    await page.evaluate(() =>
      __mugSettings.emit("tauri://drag-drop", {
        paths: ["C:/note.md"],
        position: { x: 20, y: 20 },
      }),
    );
    await page.waitForFunction(() =>
      __mugSettings.commands.some(
        (item) =>
          item.command === "open_documents" &&
          item.args.paths[0] === "C:/note.md",
      ),
    );
    assert.equal(await page.locator(".drop-overlay").count(), 0);
    checks.push("无文件的原生拖动不弹提示，外部文档仍可拖入打开");

    const demo = await browser.newPage();
    await demo.goto(url);
    await demo.locator(".appearance-button").click();
    await demo
      .getByText("浏览器演示使用浏览器本地存储。", { exact: true })
      .waitFor();
    assert.equal(await demo.locator(".settings-storage input").count(), 0);
    await demo.close();
    checks.push("浏览器演示仍使用本地存储，不显示虚假的文件路径");
    assert.deepEqual(errors, []);
    await fs.writeFile(
      ".qa/settings-ui-v025-checks.json",
      JSON.stringify({ checks, errors }, null, 2),
    );
    process.stdout.write(
      JSON.stringify({ passed: checks.length, checks, errors }, null, 2) + "\n",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  process.stderr.write(error.stack + "\n");
  process.exitCode = 1;
});
