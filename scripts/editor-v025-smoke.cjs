const { chromium } = require("playwright"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 980, height: 780 } });
  const errors = [],
    checks = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(10000);
  const type = page.locator(".block-type-button"),
    grip = page.locator(".block-drag-handle");
  const hover = async (locator) => {
    await locator.hover();
    await pause(260);
    await page.locator('.semantic-block-handle[data-show="true"]').waitFor();
  };
  const order = () => page.locator(".ProseMirror > p").allTextContents();
  try {
    await page.goto(process.env.MUGDOWN_URL || "http://127.0.0.1:5173");
    const chooser = page.waitForEvent("filechooser");
    await page
      .getByRole("button", { name: "打开文档 Ctrl+O", exact: true })
      .click();
    await (
      await chooser
    ).setFiles({
      name: "排版测试.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(
        "First **bold** paragraph\n\nSecond paragraph\n\nThird paragraph\n\n# Heading\n",
      ),
    });
    await page.locator(".ProseMirror h1").waitFor();
    for (const width of [540, 980]) {
      await page.setViewportSize({ width, height: 780 });
      for (const selector of ["p", "h1"]) {
        await hover(page.locator(`.ProseMirror > ${selector}`).first());
        const alignment = await page.evaluate((selector) => {
          const block = document.querySelector(`.ProseMirror > ${selector}`),
            handle = document
              .querySelector(".semantic-block-handle")
              .getBoundingClientRect();
          const range = document.createRange();
          range.setStart(block.firstChild, 0);
          range.setEnd(block.firstChild, 1);
          const line = range.getBoundingClientRect();
          return {
            delta: Math.abs(
              handle.y + handle.height / 2 - line.y - line.height / 2,
            ),
            left: handle.x,
          };
        }, selector);
        assert(
          alignment.delta < 1.5,
          `${width}px ${selector} vertical delta ${alignment.delta}`,
        );
        assert(alignment.left >= 8);
      }
    }
    checks.push("窄/宽窗口中段落和标题的按钮与首行文字垂直对齐");

    const paragraphs = page.locator(".ProseMirror > p");
    await hover(paragraphs.first());
    let start = await grip.boundingBox(),
      end = await paragraphs.nth(2).boundingBox();
    await page.mouse.move(
      start.x + start.width / 2,
      start.y + start.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(end.x + 30, end.y + end.height - 2, { steps: 12 });
    await page.locator(".block-drop-indicator:not([hidden])").waitFor();
    assert.equal(await page.locator(".drop-overlay").count(), 0);
    await page.mouse.up();
    await page.waitForFunction(
      () =>
        document.querySelector(".ProseMirror > p").textContent ===
        "Second paragraph",
    );
    assert.deepEqual(await order(), [
      "Second paragraph",
      "Third paragraph",
      "First bold paragraph",
    ]);
    assert.equal(await paragraphs.nth(2).locator("strong").innerText(), "bold");
    checks.push("真实指针拖动移动整段并保留粗体，没有打开文件提示");
    await page.keyboard.press("Control+z");
    await page.waitForFunction(
      () =>
        document.querySelector(".ProseMirror > p").textContent ===
        "First bold paragraph",
    );
    checks.push("段落移动可以撤销");
    await hover(paragraphs.first());
    start = await grip.boundingBox();
    end = await paragraphs.nth(2).boundingBox();
    await page.mouse.move(start.x + 8, start.y + 10);
    await page.mouse.down();
    await page.mouse.move(end.x + 30, end.y + end.height - 2, { steps: 8 });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    assert.deepEqual(await order(), [
      "First bold paragraph",
      "Second paragraph",
      "Third paragraph",
    ]);
    assert.equal(await page.locator(".block-drop-indicator").count(), 0);
    checks.push("Esc 取消段落拖动且不改变内容");

    await page.locator(".ProseMirror h1").click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await hover(page.locator(".ProseMirror > p").last());
    assert.equal(
      await type.locator("svg path").getAttribute("d"),
      "M12 5v14M5 12h14",
    );
    assert.equal(await type.getAttribute("title"), "添加内容");
    assert.equal(
      await type.locator("svg").evaluate((svg) => getComputedStyle(svg).fill),
      "none",
    );
    checks.push("空行显示粗线条 SVG 加号");

    const open = () => page.locator(".appearance-button").click();
    const close = () =>
      page.getByRole("button", { name: "关闭外观设置", exact: true }).click();
    for (const theme of [
      "github-dark",
      "nord",
      "solarized-light",
      "catppuccin-mocha",
    ]) {
      await open();
      await page
        .locator(".appearance-dialog select")
        .nth(1)
        .selectOption(theme);
      await close();
      const colors = await page.evaluate(() => {
        const color = (selector) =>
          getComputedStyle(document.querySelector(selector)).backgroundColor;
        return {
          surface: color(".editor-surface"),
          article: color(".workspace > .markdown-scope"),
          textArea: color(".ProseMirror"),
          workspace: color(".workspace"),
          handle: color(".toolbar-handle"),
          shelf: color(".toolbar-shelf"),
        };
      });
      assert.equal(colors.surface, colors.article, theme);
      assert.equal(colors.textArea, colors.article, theme);
      assert.equal(colors.workspace, colors.article, theme);
      assert.equal(colors.handle, colors.article, theme);
      assert.equal(colors.shelf, "rgba(0, 0, 0, 0)");
    }
    checks.push("四种明暗皮肤下顶部留白、拉手与正文底色一致");
    await page.mouse.move(800, 650);
    await pause(240);
    await page.screenshot({ path: "docs/mugdown-v0.2.5-dark.png" });

    await open();
    const styles = page.locator(".appearance-dialog select").nth(2);
    assert.equal(await styles.locator("option").count(), 7);
    for (const name of ["Air", "Book", "Compact", "Notebook"]) {
      await styles.selectOption(`external:${name}.css`);
      assert.equal(await styles.inputValue(), `external:${name}.css`);
    }
    await styles.selectOption("external:Book.css");
    await close();
    const book = await page.evaluate(() => ({
      bg: getComputedStyle(document.querySelector(".editor-surface"))
        .backgroundColor,
      article: getComputedStyle(
        document.querySelector(".workspace > .markdown-scope"),
      ).backgroundColor,
      textArea: getComputedStyle(document.querySelector(".ProseMirror"))
        .backgroundColor,
      textColor: getComputedStyle(document.querySelector(".ProseMirror")).color,
      font: getComputedStyle(document.querySelector(".ProseMirror")).fontFamily,
      heading: getComputedStyle(document.querySelector(".ProseMirror h1"))
        .textAlign,
    }));
    assert.equal(book.bg, "rgb(250, 247, 239)");
    assert.equal(book.bg, book.article);
    assert.equal(book.bg, book.textArea);
    assert.equal(book.textColor, "rgb(64, 58, 50)");
    assert(book.font.includes("Georgia"));
    assert.equal(book.heading, "center");
    checks.push("四个外部 CSS 预设可选择，Book 的纸色、衬线字体和标题样式生效");
    await page.screenshot({ path: "docs/mugdown-v0.2.5-book.png" });
    await open();
    await page.getByRole("button", { name: "刷新预设", exact: true }).click();
    assert.equal(await styles.locator("option").count(), 7);
    await close();
    await page.keyboard.press("Control+/");
    await page.locator(".source-editor .cm-editor").waitFor();
    const source = await page.evaluate(() => ({
      surface: getComputedStyle(document.querySelector(".editor-surface"))
        .backgroundColor,
      article: getComputedStyle(
        document.querySelector(".workspace > .markdown-scope"),
      ).backgroundColor,
    }));
    assert.equal(source.surface, source.article);
    checks.push("刷新预设和 MD 源码切换可用，源码顶部底色保持一致");
    assert.deepEqual(errors, []);
    await fs.writeFile(
      ".qa/editor-v025-checks.json",
      JSON.stringify({ checks, errors }, null, 2),
    );
    process.stdout.write(
      JSON.stringify({ passed: checks.length, checks, errors }, null, 2) + "\n",
    );
  } catch (error) {
    await page.screenshot({ path: ".qa/editor-v025-failure.png" });
    throw error;
  } finally {
    await browser.close();
  }
})().catch((error) => {
  process.stderr.write(error.stack + "\n");
  process.exitCode = 1;
});
