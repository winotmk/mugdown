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
    assert.equal((await handle.innerText()).trim(), "");
    assert.equal(await handle.locator("svg").count(), 2);
    await page.screenshot({ path: "docs/mugdown-v0.2.1-collapsed.png" });
    checks.push("默认折叠，拉手只有图标");
    const top = (await page.locator(".ProseMirror h1").boundingBox()).y;
    await handle.hover();
    await pause(220);
    assert.equal(await shelf.getAttribute("data-open"), "true");
    assert.equal((await page.locator(".ProseMirror h1").boundingBox()).y, top);
    assert.equal(await handle.locator(".lucide-pin").count(), 1);
    checks.push("悬停下滑且拉手显示图钉与上箭头，正文不跳动");
    await page.screenshot({ path: "docs/mugdown-v0.2.1-hover.png" });
    await page.mouse.move(700, 600);
    await pause(360);
    assert.equal(await shelf.getAttribute("data-open"), "false");
    checks.push("移开鼠标自动收起");
    await handle.click();
    await page.mouse.move(700, 600);
    await pause(220);
    assert.equal(await shelf.getAttribute("data-pinned"), "true");
    assert.equal(await shelf.getAttribute("data-open"), "true");
    await handle.waitFor({ state: "hidden" });
    assert.equal(await handle.getAttribute("tabindex"), "-1");
    assert.equal(Math.round((await shelf.boundingBox()).height), 43);
    await page.screenshot({ path: "docs/mugdown-v0.2.1-pinned.png" });
    checks.push("点击拉手固定，拉手上收消失且不占位");
    await button("取消固定工具栏").click();
    await pause(240);
    assert.equal(await shelf.getAttribute("data-pinned"), "false");
    assert.equal(await shelf.getAttribute("data-open"), "false");
    await handle.waitFor({ state: "visible" });
    checks.push("末端图钉解锁收起并恢复拉手");
    await handle.hover();
    await pause(220);
    await button("MD").click();
    await page.locator(".source-editor .cm-content").waitFor();
    assert.equal(await shelf.getAttribute("data-pinned"), "false");
    await button("可视化").click();
    await page.locator(".ProseMirror").waitFor();
    checks.push("点击工具按钮不会自动固定");
    const blank = await page.locator(".format-tools").evaluate((el) => {
      const r = el.getBoundingClientRect(),
        last = el.lastElementChild.getBoundingClientRect();
      return { x: (last.right + r.right) / 2, y: r.y + r.height / 2 };
    });
    await page.mouse.click(blank.x, blank.y);
    await pause(200);
    assert.equal(await shelf.getAttribute("data-pinned"), "true");
    await handle.waitFor({ state: "hidden" });
    await page.mouse.click(blank.x, blank.y);
    assert.equal(await shelf.getAttribute("data-pinned"), "true");
    checks.push("点击工具栏空白固定，再点空白保持固定");
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
    await page.screenshot({ path: "docs/mugdown-v0.2.1-en.png" });
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
    await button("取消固定工具栏").click();
    checks.push("可切回简体中文");
    await openSample();
    await page.mouse.move(700, 600);
    await pause(240);
    await page.screenshot({ path: "docs/mugdown-v0.2.1-dark.png" });
    await handle.focus();
    assert.equal(await shelf.getAttribute("data-open"), "true");
    await page.keyboard.press("Escape");
    await pause(220);
    assert.equal(await shelf.getAttribute("data-open"), "false");
    checks.push("键盘聚焦展开，Esc 收起");
    await button("外观设置").click();
    await page.getByLabel("GitHub Light", { exact: true }).click();
    await button("关闭外观设置").click();
    for (const width of [540, 600, 640, 760, 980, 1920]) {
      await page.setViewportSize({ width, height: 780 });
      for (const selector of ["h1", "h2", "p", "ul", "blockquote"]) {
        const block = page.locator(".ProseMirror > " + selector).first();
        await block.hover();
        await page
          .locator('.semantic-block-handle[data-show="true"]')
          .waitFor();
        await pause(240);
        const rect = await page.locator(".semantic-block-handle").boundingBox(),
          paragraph = await (
            selector === "ul"
              ? block.locator("li").first()
              : selector === "blockquote"
                ? block.locator("p").first()
                : block
          ).boundingBox();
        assert(
          rect.x >= 8,
          `${width}px ${selector}: handle clipped at ${rect.x}`,
        );
        assert(rect.width <= 40.5, `${width}px ${selector}: oversized handle`);
        assert(
          rect.x + rect.width <= paragraph.x - 5,
          `${width}px ${selector}: handle overlaps text`,
        );
        assert(
          paragraph.x >= 59.5,
          `${width}px ${selector}: insufficient gutter`,
        );
      }
      checks.push(`${width}px 窗口中标题、段落、列表、引用的块按钮均不溢出`);
      if (width === 540) {
        await page.locator(".ProseMirror > p").first().hover();
        await pause(240);
        await page.screenshot({ path: "docs/mugdown-v0.2.1-narrow.png" });
      }
    }
    await page.setViewportSize({ width: 980, height: 780 });
    for (const [scale, size] of [
      [1, 24],
      [1.25, 32],
      [2, 48],
    ]) {
      const ctx = await browser.newContext({
        viewport: { width: 980, height: 780 },
        deviceScaleFactor: scale,
      });
      const scaled = await ctx.newPage();
      await scaled.goto(process.env.MUGDOWN_URL || "http://127.0.0.1:5173");
      await scaled.locator(".brand img").waitFor();
      await scaled.waitForFunction(
        () => document.querySelector(".brand img")?.complete,
      );
      const width = await scaled
        .locator(".brand img")
        .evaluate((img) => img.naturalWidth);
      assert.equal(width, 24); // srcset width descriptors retain the 24 CSS-pixel natural size.
      assert(
        (await scaled.locator(".brand img").getAttribute("srcset")).includes(
          `${size}w`,
        ),
      );
      const selectedSize = await scaled
        .locator(".brand img")
        .evaluate(async (img) => {
          const bytes = await (await fetch(img.currentSrc)).arrayBuffer();
          return new DataView(bytes).getUint32(16);
        });
      assert([16, 20, 24, 32, 48, 64].includes(selectedSize));
      assert(
        selectedSize >= Math.ceil(24 * scale),
        `DPR ${scale}: icon would be enlarged from ${selectedSize}px`,
      );
      if (scale === 1)
        await scaled
          .locator(".titlebar")
          .screenshot({ path: "docs/mugdown-v0.2.1-titlebar.png" });
      checks.push(`${scale * 100}% 缩放图标像素充足，无放大插值`);
      await ctx.close();
    }
    assert.deepEqual(errors, []);
    await fs.mkdir(".qa", { recursive: true });
    await fs.writeFile(
      ".qa/ui-v0.2.1-checks.json",
      JSON.stringify({ checks, errors }, null, 2),
    );
    process.stdout.write(
      JSON.stringify({ passed: checks.length, checks, errors }, null, 2) + "\n",
    );
  } catch (e) {
    await page.screenshot({ path: ".qa/ui-v0.2.1-failure.png" });
    process.stderr.write(await page.locator("body").innerText());
    throw e;
  } finally {
    await browser.close();
  }
})().catch((e) => {
  process.stderr.write(e.stack + "\n");
  process.exitCode = 1;
});
