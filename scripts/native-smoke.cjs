const { chromium } = require("playwright"),
  fs = require("node:fs/promises"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const root = path.resolve(__dirname, ".."),
  testDir = path.join(root, ".qa", "native-" + Date.now());
const cdp = process.env.MUGDOWN_CDP || "http://127.0.0.1:9226";
const invoke = (page, command, args = {}) =>
  page.evaluate(
    ([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a),
    [command, args],
  );
async function waitFor(fn, timeout = 15000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      const r = await fn();
      if (r) return r;
    } catch (e) {
      last = e;
    }
    await pause(80);
  }
  throw last || Error("Timed out");
}
(async () => {
  await fs.mkdir(testDir, { recursive: true });
  const a = path.join(testDir, "旧文档.md"),
    b = path.join(testDir, "笔记.md");
  const original =
    "---\r\n# preserved\r\ntitle: 旧标题\r\ndate: 2026-10-21\r\ntags: [one, two]\r\nimage: should-not-render.png\r\nunknown: untouched\r\n---\r\n\r\n# 正文标题\r\n\r\n选区测试文字\r\n\r\n段落转换文字\r\n\r\n<!-- comment preserved -->\r\n";
  await fs.writeFile(a, original);
  await fs.writeFile(b, "# 笔记\n\n第二篇文档。\n");
  const browser = await waitFor(() => chromium.connectOverCDP(cdp));
  const context = browser.contexts()[0];
  const page = await waitFor(() => context.pages().find((p) => !p.isClosed()));
  const checks = [],
    errors = [];
  page.on("pageerror", (e) => errors.push(e.stack));
  page.setDefaultTimeout(15000);
  let settings, clipboard;
  try {
    await page.locator(".app").waitFor();
    settings = (await invoke(page, "workspace")).settings;
    for (const d of (await invoke(page, "workspace")).documents) {
      if (d.path && d.path.includes(path.join(".qa", "native-")))
        await invoke(page, "close_document", { id: d.id });
      else
        throw Error(
          "Use a separate mugdown test process; personal documents are open",
        );
    }
    await invoke(page, "save_settings", {
      settings: {
        ...settings,
        uiTheme: "github-light",
        markdownStyle: "github",
        language: "zh-CN",
        toolbarPinned: true,
      },
    });
    await invoke(page, "open_documents", { paths: [a, b] });
    await page.getByRole("tab", { name: /旧文档/ }).click();
    await page.locator(".ProseMirror h1").waitFor();
    assert.equal(await page.locator(".tab").count(), 2);
    checks.push("原生打开多文件");
    assert.equal(await page.locator(".ProseMirror img").count(), 0);
    assert(
      !(await page
        .locator(".workspace")
        .innerText()
        .then((t) => t.includes("2026-10-21"))),
    );
    checks.push("元数据不生成封面日期标签");
    for (const name of ["MD", "可视化"]) {
      await page.getByRole("button", { name, exact: true }).click();
      await pause(120);
    }
    await page.keyboard.press("Control+s");
    await pause(150);
    assert.equal(await fs.readFile(a, "utf8"), original);
    checks.push("未编辑切换模式原文逐字节保留");
    const p = page
      .locator(".ProseMirror p")
      .filter({ hasText: "选区测试文字" });
    await p.click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    await page
      .locator(".milkdown-toolbar")
      .getByRole("button", { name: /下划线/ })
      .click();
    await page.keyboard.press("Control+s");
    await waitFor(async () =>
      (await fs.readFile(a, "utf8")).includes("<u>选区测试文字</u>"),
    );
    checks.push("原生格式保存");
    const written = await fs.readFile(a, "utf8");
    assert(written.startsWith(original.match(/^---[\s\S]*?\r\n---\r\n/)[0]));
    assert(written.includes("<!-- comment preserved -->"));
    checks.push("编辑后原头部注释保留");
    await page.getByRole("button", { name: "MD", exact: true }).click();
    await page.locator(".source-editor .cm-content").click();
    await page.keyboard.press("Control+End");
    await page.keyboard.insertText("\n跨模式撤销测试");
    await page.getByRole("button", { name: "可视化", exact: true }).click();
    await page.keyboard.press("Control+z");
    await pause(200);
    assert(
      !(await page
        .locator(".ProseMirror")
        .innerText()
        .then((t) => t.includes("跨模式撤销测试"))),
    );
    checks.push("原生跨模式撤销");
    const ws = await invoke(page, "workspace"),
      doc = ws.documents.find((d) => d.name === "旧文档.md");
    await fs.writeFile(a, "外部程序修改\n");
    await page.keyboard.press("Control+s");
    await page.getByRole("dialog", { name: "文件已被其他程序修改" }).waitFor();
    await page.getByRole("button", { name: "取消", exact: true }).click();
    assert.equal(await fs.readFile(a, "utf8"), "外部程序修改\n");
    checks.push("检测外部文件修改并阻止静默覆盖");
    await fs.writeFile(a, written);
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
      "base64",
    );
    const image = await invoke(page, "import_image", {
      id: doc.id,
      name: "pasted.png",
      data: Array.from(png),
    });
    assert(image.startsWith("旧文档/"));
    assert.equal(
      (await fs.readFile(path.join(testDir, image))).compare(png),
      0,
    );
    const imageSource = await invoke(page, "image_source", {
      id: doc.id,
      url: image,
    });
    assert(imageSource.startsWith("data:image/png;base64,"));
    checks.push("图片保存到同名文件夹并可渲染");
    await page.getByRole("button", { name: "MD", exact: true }).click();
    await page.locator(".source-editor .cm-content").click();
    await page.keyboard.press("Control+End");
    await page.keyboard.insertText("\n![](<" + image + ">)\n");
    await page.getByRole("button", { name: "可视化", exact: true }).click();
    await page.keyboard.press("Control+s");
    await pause(200);
    const copyDir = path.join(testDir, "copy");
    await fs.mkdir(copyDir);
    await invoke(page, "save_document", {
      id: doc.id,
      path: path.join(copyDir, "复制.md"),
      force: false,
    });
    assert.equal(
      (await fs.readFile(path.join(copyDir, image))).compare(png),
      0,
    );
    checks.push("另存为复制本地图片");
    clipboard = await invoke(page, "read_clipboard");
    if (clipboard.text || clipboard.html)
      await invoke(page, "write_clipboard", {
        text: "纯文本测试",
        html: "<b>HTML 测试</b>",
      });
    const clip = await invoke(page, "read_clipboard");
    if (clipboard.text || clipboard.html)
      assert(clip.html.includes("HTML 测试"));
    checks.push("系统剪贴板文本和 HTML");
    await page.locator(".source-editor").count();
    // Move unsaved text and shared history to another real OS window.
    await page.getByRole("button", { name: "MD", exact: true }).click();
    await page.locator(".source-editor .cm-content").click();
    await page.keyboard.press("Control+End");
    await page.keyboard.insertText("\n未保存的窗口移动测试");
    await page
      .locator(".menubar")
      .getByRole("button", { name: "窗口", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "移到新窗口", exact: true })
      .click();
    const newPage = await waitFor(() =>
      context.pages().find((p) => p !== page && !p.isClosed()),
    );
    await newPage.locator(".ProseMirror").waitFor();
    assert(
      await newPage
        .locator(".ProseMirror")
        .innerText()
        .then((t) => t.includes("未保存的窗口移动测试")),
    );
    assert.equal(await newPage.locator(".tabbar").count(), 0);
    assert.equal(await page.locator(".tabbar").count(), 0);
    checks.push("拆为两个原生窗口且单文档隐藏标签栏");
    await newPage.keyboard.press("Control+z");
    await pause(200);
    assert(
      !(await newPage
        .locator(".ProseMirror")
        .innerText()
        .then((t) => t.includes("未保存的窗口移动测试"))),
    );
    checks.push("跨窗口保留撤销记录");
    const origin = (await invoke(page, "workspace")).windows.find((w) =>
      w.ids.some((id) => id !== doc.id),
    ).label;
    await invoke(newPage, "move_document", {
      id: doc.id,
      target: origin,
    }).catch((e) => {
      if (!newPage.isClosed()) throw e;
    });
    await waitFor(() => newPage.isClosed());
    assert.equal(await page.locator(".tab").count(), 2);
    checks.push("窗口合并并关闭空窗口");
    await page.screenshot({ path: "docs/mugdown-windows.png" });
    assert.deepEqual(errors, []);
    await fs.writeFile(
      path.join(root, ".qa/native-checks.json"),
      JSON.stringify({ checks, errors, testDir }, null, 2),
    );
    process.stdout.write(
      JSON.stringify({ passed: checks.length, checks, errors }, null, 2) + "\n",
    );
  } catch (e) {
    await page.screenshot({ path: "docs/native-failure.png" }).catch(() => {});
    process.stderr.write(
      await page
        .locator("body")
        .innerText()
        .catch(() => ""),
    );
    throw e;
  } finally {
    if (clipboard && (clipboard.text || clipboard.html))
      await invoke(page, "write_clipboard", clipboard).catch(() => {});
    if (settings)
      await invoke(page, "save_settings", { settings }).catch(() => {});
    await browser.close();
  }
})().catch((e) => {
  process.stderr.write(e.stack + "\n");
  process.exitCode = 1;
});
