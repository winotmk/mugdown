const { chromium } = require("playwright"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises");
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const sample =
  "# 留一点空白\n\n一杯咖啡，一段文字。\n\n## 恰好够用\n\n写作应该是一件很简单的事。把想法写下来，再慢慢打磨。\n\n- 只关注眼前的文档\n- 粘贴图片，留在文档旁边\n- 用熟悉的 Markdown 表达\n\n> 好的工具，让你忘记工具。\n";
(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true }),
    page = await browser.newPage({ viewport: { width: 980, height: 780 } });
  const errors = [],
    checks = [];
  page.on("pageerror", (e) => {
    errors.push(e.stack);
    process.stderr.write(e.stack + "\n");
  });
  page.setDefaultTimeout(15000);
  const button = (name) => page.getByRole("button", { name, exact: true });
  const openSample = async () => {
    const chooser = page.waitForEvent("filechooser");
    await button("打开文档 Ctrl+O").click();
    await (
      await chooser
    ).setFiles({
      name: "写作.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(sample),
    });
    await page.locator(".ProseMirror h1").waitFor();
  };
  try {
    await page.goto(process.env.MUGDOWN_URL || "http://127.0.0.1:5173");
    await openSample();
    assert.equal(await page.locator(".tabbar").count(), 0);
    assert.equal(await page.locator("aside").count(), 0);
    checks.push("单文档隐藏 tab 且无侧栏");
    assert.equal(await page.locator(".mode-switch button").count(), 2);
    assert.equal(await button("预览").count(), 0);
    checks.push("仅保留可视化与 MD");
    assert.equal(
      await page
        .locator(".menubar")
        .getByRole("button", { name: "查找", exact: true })
        .count(),
      0,
    );
    await page
      .locator(".menubar")
      .getByRole("button", { name: "编辑", exact: true })
      .click();
    await page.getByRole("menuitem", { name: /^查找/ }).click();
    await page.locator(".find-input").waitFor();
    await button("关闭查找").click();
    checks.push("移除顶部查找，编辑菜单仍可查找");
    const shelf = page.locator(".toolbar-shelf"),
      handle = page.locator(".toolbar-handle");
    assert.equal(await shelf.getAttribute("data-open"), "false");
    assert.equal(
      await page.locator(".toolbar-drawer").getAttribute("aria-hidden"),
      "true",
    );
    await page.screenshot({ path: "docs/mugdown-v0.2-collapsed.png" });
    checks.push("默认折叠且保留可发现的拉手");
    const top = (await page.locator(".ProseMirror h1").boundingBox()).y;
    await handle.hover();
    await pause(220);
    assert.equal(await shelf.getAttribute("data-open"), "true");
    assert.equal((await page.locator(".ProseMirror h1").boundingBox()).y, top);
    checks.push("悬停下滑展开，正文不跳动");
    await page.mouse.move(700, 600);
    await pause(360);
    assert.equal(await shelf.getAttribute("data-open"), "false");
    checks.push("移开鼠标自动收起");
    await handle.click();
    await page.mouse.move(700, 600);
    await pause(220);
    assert.equal(await shelf.getAttribute("data-pinned"), "true");
    assert.equal(await shelf.getAttribute("data-open"), "true");
    checks.push("点击固定后保持显示");
    await handle.click();
    await pause(240);
    assert.equal(await shelf.getAttribute("data-pinned"), "false");
    assert.equal(await shelf.getAttribute("data-open"), "false");
    checks.push("再次点击立即取消固定并收起");
    await handle.click();
    await pause(200);
    await button("MD").click();
    await page.locator(".source-editor .cm-content").waitFor();
    assert.equal(
      (await page.locator(".source-editor .cm-line").allTextContents()).join(
        "\n",
      ),
      sample,
    );
    await page.locator(".source-editor .cm-content").click();
    await page.keyboard.press("Control+End");
    await page.keyboard.insertText("追加文字");
    await button("可视化").click();
    await page.locator(".ProseMirror").waitFor();
    await page.keyboard.press("Control+z");
    await pause(150);
    assert(
      !(await page.locator(".ProseMirror").innerText()).includes("追加文字"),
    );
    checks.push("模式切换和跨模式撤销保留");
    const p = page
      .locator(".ProseMirror p")
      .filter({ hasText: "一杯咖啡，一段文字。" });
    await p.click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    await page
      .locator(".milkdown-toolbar")
      .getByRole("button", { name: /粗体/ })
      .click();
    await page.locator(".ProseMirror strong").waitFor();
    checks.push("选区浮动工具栏和格式编辑保留");
    await button("外观设置").click();
    await page.getByLabel("界面语言", { exact: true }).selectOption("en-US");
    await page
      .getByRole("dialog", { name: "Appearance settings", exact: true })
      .waitFor();
    assert(
      await page
        .locator(".menubar")
        .getByRole("button", { name: "File", exact: true })
        .count(),
    );
    const themeOptions = await page
      .locator(".appearance-dialog select")
      .nth(1)
      .locator("option")
      .allTextContents();
    assert(!themeOptions.some((t) => /[\u3400-\u9fff]/.test(t)));
    checks.push("外观设置即时切换英文，包含经典皮肤名称");
    await button("Close appearance settings").click();
    assert.equal(
      await page.locator(".ProseMirror strong").innerText(),
      "一杯咖啡，一段文字。",
    );
    assert.equal(await page.locator("html").getAttribute("lang"), "en-US");
    checks.push("语言切换保持正文与格式");
    await p.hover();
    await page.locator(".block-type-button").click();
    assert(
      await page
        .locator(".block-format-menu")
        .getByText("Heading 1", { exact: true })
        .count(),
    );
    await page.keyboard.press("Escape");
    checks.push("段落菜单英文翻译");
    await p.click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    await page
      .locator(".milkdown-toolbar")
      .getByRole("button", { name: /Underline/ })
      .waitFor();
    checks.push("选区工具提示英文翻译");
    await page.keyboard.press("ArrowRight");
    await button("Appearance settings").click();
    await page.getByLabel("GitHub Dark", { exact: true }).click();
    await button("Close appearance settings").click();
    await page.mouse.move(700, 600);
    await page.screenshot({ path: "docs/mugdown-v0.2-en.png" });
    checks.push("英文界面支持主题切换");
    await page.keyboard.press("Control+n");
    await page.locator(".tab").nth(1).waitFor();
    assert(
      (await page.locator(".tab").nth(1).innerText()).includes("Untitled.md"),
    );
    await button("Close Untitled.md").click();
    await page.locator(".tabbar").waitFor({ state: "hidden" });
    checks.push("英文新文档和 tab 关闭操作");
    await page.keyboard.press("Control+w");
    await page
      .getByRole("dialog", { name: "Save changes?", exact: true })
      .waitFor();
    await button("Cancel").click();
    await page.keyboard.press("Control+w");
    await page
      .getByRole("dialog", { name: "Save changes?", exact: true })
      .waitFor();
    await button("Don't save").click();
    checks.push("未保存提醒英文翻译");
    await page.reload();
    await page.locator(".empty").waitFor();
    assert(
      await page
        .locator(".menubar")
        .getByRole("button", { name: "File", exact: true })
        .count(),
    );
    assert.equal(await shelf.getAttribute("data-pinned"), "true");
    checks.push("重启保留语言和工具栏固定设置");
    await button("Appearance settings").click();
    await page
      .getByLabel("Interface language", { exact: true })
      .selectOption("zh-CN");
    await button("关闭外观设置").click();
    await handle.click();
    checks.push("可切回简体中文");
    await openSample();
    await page.mouse.move(700, 600);
    await pause(240);
    await page.screenshot({ path: "docs/mugdown-v0.2-dark.png" });
    await handle.focus();
    assert.equal(await shelf.getAttribute("data-open"), "true");
    await page.keyboard.press("Escape");
    await pause(220);
    assert.equal(await shelf.getAttribute("data-open"), "false");
    checks.push("键盘聚焦展开，Esc 收起");
    assert.deepEqual(errors, []);
    await fs.mkdir(".qa", { recursive: true });
    await fs.writeFile(
      ".qa/ui-v0.2-checks.json",
      JSON.stringify({ checks, errors }, null, 2),
    );
    process.stdout.write(
      JSON.stringify({ passed: checks.length, checks, errors }, null, 2) + "\n",
    );
  } catch (e) {
    await page.screenshot({ path: ".qa/ui-v0.2-failure.png" });
    process.stderr.write(await page.locator("body").innerText());
    throw e;
  } finally {
    await browser.close();
  }
})().catch((e) => {
  process.stderr.write(e.stack + "\n");
  process.exitCode = 1;
});
