const { chromium } = require("playwright");
const assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  path = require("node:path");
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const sample =
  '# 留一点空白\n\n一杯咖啡，一段文字。\n\n## 恰好够用\n\n写作应该是一件很简单的事。把想法写下来，再慢慢打磨。\n\n- 只关注眼前的文档\n- 粘贴图片，留在文档旁边\n- 用熟悉的 Markdown 表达\n\n> 好的工具，让你忘记工具。\n\n```js\nconst mugdown = "just write"\n```\n';
(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 980, height: 780 } });
  const errors = [],
    checks = [];
  page.on("pageerror", (e) => {
    errors.push(e.stack);
    process.stderr.write(e.stack + "\n");
  });
  page.setDefaultTimeout(15000);
  try {
    await page.goto(process.env.MUGDOWN_URL || "http://127.0.0.1:5173");
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "打开文档 Ctrl+O" }).click();
    await (
      await chooser
    ).setFiles({
      name: "写作.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(sample),
    });
    await page.locator(".ProseMirror h1").waitFor();
    assert.equal(await page.locator(".tabbar").count(), 0);
    checks.push("单文档隐藏标签栏");
    assert.equal(await page.locator("aside").count(), 0);
    checks.push("无侧栏");
    await page.screenshot({ path: "docs/mugdown-light.png" });
    await page.getByRole("button", { name: "预览", exact: true }).click();
    await pause(100);
    assert.equal(
      await page.locator(".ProseMirror").getAttribute("contenteditable"),
      "false",
    );
    checks.push("只读预览");
    await page.getByRole("button", { name: "MD", exact: true }).click();
    await page.locator(".source-editor .cm-content").waitFor();
    assert.equal(
      (await page.locator(".source-editor .cm-line").allTextContents()).join(
        "\n",
      ),
      sample,
    );
    await page.locator(".source-editor .cm-content").click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("追加文字");
    await pause(150);
    await page.getByRole("button", { name: "可视化", exact: true }).click();
    await page.locator(".ProseMirror").waitFor();
    await page.keyboard.press("Control+z");
    await pause(200);
    assert(
      !(await page
        .locator(".ProseMirror")
        .innerText()
        .then((t) => t.includes("追加文字"))),
    );
    checks.push("切换模式后可撤销");
    const text = page
      .locator(".ProseMirror p")
      .filter({ hasText: "一杯咖啡，一段文字。" });
    await text.click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    await pause(200);
    assert(await page.locator(".milkdown-toolbar").isVisible());
    checks.push("选中文字浮动工具栏");
    await page
      .locator(".milkdown-toolbar")
      .getByRole("button", { name: "粗体", exact: false })
      .click();
    await pause(150);
    assert(
      await page
        .locator(".ProseMirror strong")
        .innerText()
        .then((t) => t.includes("一杯咖啡")),
    );
    checks.push("选区加粗");
    await page.getByRole("button", { name: "外观设置", exact: true }).click();
    await page.getByLabel("GitHub Dark", { exact: true }).click();
    await page.getByRole("button", { name: "关闭外观设置" }).click();
    await page.screenshot({ path: "docs/mugdown-dark.png" });
    assert.equal(await page.locator(".app").getAttribute("data-dark"), "true");
    checks.push("深色皮肤");
    await page.getByRole("button", { name: "外观设置", exact: true }).click();
    await page.getByLabel("GitHub Light", { exact: true }).click();
    const select = page.locator(".appearance-dialog select").nth(1);
    await select.selectOption("sakura");
    await page.getByRole("button", { name: "关闭外观设置" }).click();
    assert.equal(
      await page.locator(".markdown-scope").getAttribute("data-markdown-style"),
      "sakura",
    );
    checks.push("CSS 排版预设");
    await page.keyboard.press("Control+n");
    await pause(200);
    assert.equal(await page.locator(".tab").count(), 2);
    checks.push("多文档显示标签栏");
    await page
      .getByRole("button", { name: "关闭 未命名.md", exact: true })
      .click();
    await pause(200);
    assert.equal(await page.locator(".tabbar").count(), 0);
    checks.push("关闭后恢复单文档布局");
    await page.keyboard.press("Control+w");
    await page.getByRole("dialog", { name: "保存修改？" }).waitFor();
    await page.getByRole("button", { name: "取消", exact: true }).click();
    assert(await page.locator(".ProseMirror").count());
    checks.push("未保存关闭提醒");
    assert.deepEqual(errors, []);
    await fs.mkdir(".qa", { recursive: true });
    await fs.writeFile(
      ".qa/ui-checks.json",
      JSON.stringify({ checks, errors }, null, 2),
    );
    process.stdout.write(
      JSON.stringify({ passed: checks.length, checks, errors }, null, 2) + "\n",
    );
  } catch (e) {
    process.stderr.write(await page.locator("body").innerText());
    await page.screenshot({ path: "docs/ui-failure.png" });
    throw e;
  } finally {
    await browser.close();
  }
})().catch((e) => {
  process.stderr.write(e.stack + "\n");
  process.exitCode = 1;
});
