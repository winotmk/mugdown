const { chromium } = require("playwright"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises");
(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true }),
    page = await browser.newPage({ viewport: { width: 980, height: 780 } }),
    errors = [],
    checks = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.setDefaultTimeout(10000);
  await page.addInitScript(() => {
    const callbacks = new Map(),
      listeners = new Map();
    let next = 1;
    const state = {
      documents: [
        {
          id: "draft",
          path: null,
          name: "未命名.md",
          raw: "# Draft\n\nOriginal paragraph\n",
          saved: "# Draft\n\nOriginal paragraph\n",
          revision: 0,
        },
      ],
      windows: [{ label: "editor-test", ids: ["draft"], active: "draft" }],
      settings: {
        uiTheme: "github-light",
        markdownStyle: "github",
        fontSize: 17,
        contentWidth: 900,
        customCss: "",
        language: "zh-CN",
        toolbarPinned: false,
      },
    };
    const mock = (window.__mugMock = {
      commands: [],
      state,
      resolveDrop: null,
      emit(event, payload) {
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
        mock.commands.push({ command, args: structuredClone(args) });
        if (command === "plugin:event|listen") {
          const id = next++;
          listeners.set(id, { id, event: args.event, handler: args.handler });
          return id;
        }
        if (command === "workspace") return structuredClone(state);
        if (command === "start_window_drag")
          return await new Promise((resolve) => {
            mock.resolveDrop = resolve;
          });
        if (command === "update_document") {
          await new Promise((r) => setTimeout(r, 80));
          state.documents[0].raw = args.raw;
          state.documents[0].revision++;
          mock.commands.push({ command: "update-done" });
          mock.emit("document-changed", state.documents[0]);
        }
        if (command === "merge_windows")
          mock.mergedRaw = state.documents[0].raw;
      },
    };
  });
  try {
    await page.goto(process.env.MUGDOWN_URL || "http://127.0.0.1:5173");
    await page.locator(".ProseMirror p").waitFor();
    assert.equal(await page.locator(".tabbar").count(), 0);
    await page
      .locator(".document-caption")
      .click({ position: { x: 10, y: 14 } });
    await page.locator(".drag-hint").waitFor();
    assert.equal(
      await page.evaluate(
        () =>
          __mugMock.commands.filter((c) => c.command === "start_window_drag")
            .length,
      ),
      1,
    );
    checks.push("单文档无 tab 时标题栏空白启动整窗拖动");
    await page.evaluate(() => {
      __mugMock.emit("window-merge-preview", "target");
      __mugMock.emit("window-merge-target", 1);
    });
    await page
      .getByText("松开，合并 1 个文档到此窗口", { exact: true })
      .waitFor();
    await page
      .getByText("松开，将此窗口合并到另一窗口 · Esc 取消", { exact: true })
      .waitFor();
    const overlay = await page.locator(".window-merge-target").boundingBox();
    assert.deepEqual(overlay, { x: 0, y: 0, width: 980, height: 780 });
    await page.screenshot({ path: "docs/mugdown-v0.2.3-merge-hint.png" });
    checks.push("来源提示与整窗接收高亮覆盖完整目标窗口");
    await page.evaluate(() => {
      __mugMock.emit("window-merge-target", null);
      __mugMock.resolveDrop(null);
    });
    await page.locator(".drag-hint").waitFor({ state: "hidden" });
    assert.equal(
      await page.evaluate(
        () =>
          __mugMock.commands.filter((c) => c.command === "merge_windows")
            .length,
      ),
      0,
    );
    checks.push("拖到桌面仅移动窗口");
    await page.locator(".ProseMirror p").click();
    await page.keyboard.press("Control+End");
    await page.keyboard.insertText(" unsaved");
    await page
      .locator(".document-caption")
      .click({ position: { x: 10, y: 14 } });
    await page.locator(".drag-hint").waitFor();
    await page.evaluate(() => __mugMock.resolveDrop("target"));
    await page.waitForFunction(() =>
      __mugMock.commands.some((c) => c.command === "merge_windows"),
    );
    const result = await page.evaluate(() => ({
      raw: __mugMock.mergedRaw,
      commands: __mugMock.commands,
    }));
    assert(result.raw.includes("unsaved"));
    assert(
      result.commands.findLastIndex((c) => c.command === "update-done") <
        result.commands.findIndex((c) => c.command === "merge_windows"),
    );
    checks.push("松手后先完成正文提交，再合并窗口");
    const before = await page.evaluate(
      () =>
        __mugMock.commands.filter((c) => c.command === "start_window_drag")
          .length,
    );
    await page.locator(".document-label").click();
    assert.equal(
      await page.evaluate(
        () =>
          __mugMock.commands.filter((c) => c.command === "start_window_drag")
            .length,
      ),
      before,
    );
    checks.push("文件名的文档拖动入口保留，不误触整窗移动");
    await page.evaluate(() => __mugMock.emit("menu-command", "find"));
    await page.locator(".find-input").waitFor();
    await page.locator(".find-input").pressSequentially("needle");
    await page.evaluate(() => __mugMock.emit("menu-command", "undo"));
    await page.waitForFunction(
      () => document.querySelector(".find-input").value === "",
    );
    checks.push("原生菜单撤销优先作用于聚焦的输入框");
    await page.getByRole("button", { name: "关闭查找", exact: true }).click();
    await page.evaluate(() => __mugMock.emit("menu-command", "appearance"));
    await page.getByRole("dialog", { name: "外观设置", exact: true }).waitFor();
    await page
      .getByRole("button", { name: "关闭外观设置", exact: true })
      .click();
    checks.push("原生菜单事件调用当前窗口的查找与外观设置");
    await page.evaluate(() => __mugMock.emit("menu-command", "close-window"));
    await page.getByRole("button", { name: "不保存", exact: true }).waitFor();
    await page.getByRole("button", { name: "取消", exact: true }).click();
    assert.equal(
      await page.evaluate(() =>
        __mugMock.commands.some((c) => c.command === "plugin:window|destroy"),
      ),
      false,
    );
    assert((await page.locator(".ProseMirror").innerText()).includes("unsaved"));
    checks.push("原生菜单关闭窗口保留未保存提醒，取消后保留草稿");
    assert.deepEqual(errors, []);
    await fs.writeFile(
      ".qa/window-drag-ui-checks.json",
      JSON.stringify({ checks, errors }, null, 2),
    );
    process.stdout.write(
      JSON.stringify({ passed: checks.length, checks, errors }, null, 2) + "\n",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  process.stderr.write(e.stack + "\n");
  process.exitCode = 1;
});
