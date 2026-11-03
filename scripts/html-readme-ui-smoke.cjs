const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({
    viewport: { width: 1040, height: 780 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(10000);
  const article = page.locator(".ProseMirror");
  const blocks = article.locator('.blog-extension[data-kind="html"]');
  const readme = await fs.readFile("README.md", "utf8");
  const originalHero = readme.match(/<div align="center">[\s\S]*?<\/div>/)[0];
  const originalDetails = readme.match(/<details>[\s\S]*?<\/details>/)[0];
  const source =
    '<section onclick="window.htmlRan = true">\n<h3>HTML example</h3>\n<p><em>Rendered text</em></p>\n<script>window.htmlRan = true</script>\n</section>';
  const open = async (file) => {
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: /打开文档/ }).click();
    await (await chooser).setFiles(file);
  };
  const save = async () => {
    const download = page.waitForEvent("download");
    await page.keyboard.press("Control+s");
    return fs.readFile(await (await download).path(), "utf8");
  };
  const checkNoErrors = async () => {
    assert.equal(await page.locator(".toast").count(), 0);
    assert.deepEqual(errors, []);
  };
  const insertBlock = async (fromPlus = false) => {
    await article.locator("p").last().hover();
    const button = page.locator('.semantic-block-handle[data-show="true"] .block-type-button');
    if (fromPlus) await page.locator('.semantic-block-handle[data-show="true"] .block-type-button[title="添加内容"]').waitFor();
    await button.click();
    await page
      .getByRole("menuitem", { name: "插入 HTML 块", exact: true })
      .click();
    const input = page.locator(".extension-source textarea:visible");
    await input.waitFor();
    return input;
  };
  try {
    await page.route(
      /\/(src-tauri\/icons\/128x128\.png|docs\/media\/(?:empty-(?:zh|en)|editor-dark(?:-en)?)\.png|docs\/media\/(?:toolbar|themes|windows)(?:-en)?\.gif)$/,
      (route) =>
        route.fulfill({
          path: path.resolve(new URL(route.request().url()).pathname.slice(1)),
        }),
    );
    await page.goto(process.env.MUGDOWN_URL || "http://127.0.0.1:5173");
    await open("README.md");
    await article
      .getByRole("heading", { name: "mugdown", exact: true })
      .waitFor();
    assert.equal(await blocks.count(), 2);
    assert.equal(
      await blocks.first().locator(".extension-tools > span").textContent(),
      "HTML",
    );
    await page.waitForFunction(
      () => document.querySelector(".extension-preview img")?.naturalWidth > 0,
    );
    assert.equal(await article.locator("ol li kbd").count(), 6);
    await blocks.nth(1).locator("summary").click();
    await blocks
      .nth(1)
      .locator("details[open] img")
      .waitFor({ state: "visible" });
    await checkNoErrors();
    await article
      .getByRole("heading", { name: "仓库目录", exact: true })
      .click();
    await page.keyboard.press("End");
    await page.keyboard.insertText("（检查）");
    await page.keyboard.press("Control+/");
    await page.locator(".source-editor .cm-editor").waitFor();
    const savedReadme = await save();
    assert(savedReadme.includes(originalHero));
    assert(savedReadme.includes(originalDetails));
    assert(savedReadme.includes("<kbd>Ctrl</kbd> + <kbd>O</kbd>"));
    assert(savedReadme.includes("## 仓库目录（检查）"));
    await page.keyboard.press("Control+/");
    await article
      .getByRole("heading", { name: "mugdown", exact: true })
      .waitFor();
    await checkNoErrors();
    console.log(
      "README renders; editing and round-tripping preserve original HTML and inline keys.",
    );

    await page.reload();
    await open({
      name: "example.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("Before\n\nAfter\n"),
    });
    await article.getByText("After", { exact: true }).waitFor();
    await article.getByText("After", { exact: true }).click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    const input = await insertBlock(true);
    await input.fill(source);
    await page.getByRole("button", { name: "应用", exact: true }).click();
    await blocks
      .getByRole("heading", { name: "HTML example", exact: true })
      .waitFor();
    assert.equal(await blocks.locator("p em").innerText(), "Rendered text");
    assert.equal(await blocks.locator("script,[onclick]").count(), 0);
    assert.equal(await page.evaluate(() => window.htmlRan), undefined);
    await blocks
      .getByRole("button", { name: "编辑扩展片段", exact: true })
      .click();
    assert.equal(
      await page.locator(".extension-source textarea:visible").inputValue(),
      source,
    );
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await insertBlock();
    await page.getByRole("button", { name: "取消", exact: true }).click();
    assert.equal(await blocks.count(), 1);
    assert((await save()).includes(source));
    await checkNoErrors();
    await fs.mkdir(".qa", { recursive: true });
    await page.screenshot({ path: ".qa/html-block-v027.png", caret: "hide" });
    console.log(
      "HTML insertion, sanitized preview, re-edit, cancel and original source save passed.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
