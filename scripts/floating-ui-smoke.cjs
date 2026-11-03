const { chromium } = require("playwright"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  // A dark system with a light app exposed the detached portal's wrong colors.
  const page = await browser.newPage({
    viewport: { width: 980, height: 620 },
    colorScheme: "dark",
  });
  const errors = [],
    checks = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(10000);
  const read = (locator) =>
    locator.evaluate((element) => {
      const css = getComputedStyle(element);
      return {
        background: css.backgroundColor,
        color: css.color,
        shadow: css.boxShadow,
        radius: css.borderRadius,
        scheme: css.colorScheme,
        scrollbar: css.scrollbarColor,
        width: css.scrollbarWidth,
        inApp: !!element.closest(".app"),
        scrolls: element.scrollHeight > element.clientHeight,
      };
    });
  const selectText = async () => {
    await page.locator(".ProseMirror > p").first().click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    await page.locator('.milkdown-toolbar[data-show="true"]').waitFor();
  };
  try {
    await page.goto(process.env.MUGDOWN_URL || "http://127.0.0.1:5173");
    const chooser = page.waitForEvent("filechooser");
    await page
      .getByRole("button", { name: "打开文档 Ctrl+O", exact: true })
      .click();
    await (
      await chooser
    ).setFiles({
      name: "菜单检查.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(
        "这是一段用于检查浮动菜单的正文。\n\n第二段文字保持清晰可读。\n",
      ),
    });
    await page.locator(".ProseMirror > p").first().waitFor();
    for (const [theme, style] of [
      ["github-light", "github"],
      ["github-dark", "github"],
      ["nord", "sakura"],
      ["github-dark", "external:Book.css"],
    ]) {
      await page.locator(".appearance-button").click();
      await page
        .locator(".appearance-dialog select")
        .nth(1)
        .selectOption(theme);
      await page
        .locator(".appearance-dialog select")
        .nth(2)
        .selectOption(style);
      await page
        .getByRole("button", { name: "关闭外观设置", exact: true })
        .click();
      await selectText();
      const toolbar = await read(page.locator(".milkdown-toolbar"));
      await page.locator(".ProseMirror > p").first().hover();
      await pause(260);
      await page.locator(".block-type-button").click();
      const menu = page.getByRole("menu", { name: "段落格式", exact: true });
      await menu.waitFor();
      const floating = await read(menu);
      assert.equal(floating.inApp, true);
      assert.notEqual(floating.background, "rgba(0, 0, 0, 0)");
      for (const property of [
        "background",
        "color",
        "shadow",
        "radius",
        "scheme",
      ])
        assert.equal(
          floating[property],
          toolbar[property],
          `${theme}/${style}: ${property}`,
        );
      assert(floating.scrolls);
      assert.equal(floating.width, "thin");
      assert(
        floating.scrollbar.endsWith(floating.background),
        `${theme}: scrollbar track ${floating.scrollbar}`,
      );
      if (style === "github")
        await page.screenshot({
          path: `docs/mugdown-v0.2.6-menu-${theme}.png`,
        });
      await menu.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await page
        .getByRole("menuitem", { name: "删除当前段落", exact: true })
        .waitFor({ state: "visible" });
      await page.keyboard.press("Escape");
      await menu.waitFor({ state: "hidden" });
      checks.push(
        `${theme}/${style}：菜单底色、文字、阴影、圆角与选区工具栏一致，滚动条跟随皮肤`,
      );

      await selectText();
      await page
        .locator('.milkdown-toolbar [data-toolbar-item="color"]')
        .click();
      const palette = await read(
        page.getByRole("dialog", { name: "文字与背景颜色", exact: true }),
      );
      assert(palette.inApp);
      for (const property of ["background", "color", "shadow", "scheme"])
        assert.equal(
          palette[property],
          toolbar[property],
          `${theme}: palette ${property}`,
        );
      await page.keyboard.press("Escape");
    }
    checks.push("颜色面板同步继承皮肤，不再出现透明背景或系统颜色错配");
    await page.locator(".ProseMirror > p").first().hover();
    await pause(260);
    await page.locator(".block-type-button").click();
    await page.getByRole("menuitemcheckbox", { name: /二级标题/ }).click();
    await page.locator(".ProseMirror > h2").waitFor();
    assert(
      (await page.locator(".ProseMirror").innerText()).includes(
        "第二段文字保持清晰可读。",
      ),
    );
    checks.push("菜单滚动、Esc 关闭和段落转换仍可使用");
    assert.deepEqual(errors, []);
    await fs.writeFile(
      ".qa/floating-ui-v026-checks.json",
      JSON.stringify({ checks, errors }, null, 2),
    );
    process.stdout.write(
      JSON.stringify({ passed: checks.length, checks, errors }, null, 2) + "\n",
    );
  } catch (error) {
    await page.screenshot({ path: ".qa/floating-ui-v026-failure.png" });
    throw error;
  } finally {
    await browser.close();
  }
})().catch((error) => {
  process.stderr.write(error.stack + "\n");
  process.exitCode = 1;
});
