// Capture the production renderer with a synthetic document and an in-memory
// desktop bridge. No user documents, settings, or native services are loaded.
const { chromium } = require("playwright");
const fs = require("node:fs/promises");
const assert = require("node:assert/strict");

const url = process.env.MUGDOWN_URL || "http://127.0.0.1:5177";
const output = "docs/media";
const frames = ".qa/readme-frames";
const sample = [
  "# 留一点空白",
  "",
  "一杯咖啡，一份 Markdown。打开文档，把注意力留给正在写的这一页。",
  "",
  "## 今天的笔记",
  "",
  "> 把一个想法写下来，剩下的慢慢来。",
  "",
  "- **可视化编辑**：直接调整段落，也能随时切回 MD 源码。",
  "- **本地文件**：笔记和图片由自己整理，随时带走。",
  "",
  "## 下次再写",
  "",
  "试试把鼠标移到上方的小拉手，工具栏会滑下来。",
].join("\n");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function desktop(page) {
  await page.addInitScript(
    ({ sample }) => {
      const label = "editor-readme";
      const callbacks = new Map(),
        listeners = new Map();
      let next = 1;
      const state = {
        documents: [
          {
            id: "sample",
            path: "Demo.md",
            name: "写作笔记.md",
            raw: sample,
            saved: sample,
            revision: 0,
          },
        ],
        windows: [{ label, ids: ["sample"], active: "sample" }],
        settings: {
          uiTheme: "github-light",
          markdownStyle: "github",
          fontSize: 17,
          contentWidth: 820,
          customCss: "",
          language: "zh-CN",
          toolbarPinned: false,
        },
        settingsStorage: {
          path: "./settings.json",
          location: "portable",
          error: null,
        },
        presets: { directory: "./presets", items: [], error: null },
      };
      window.isTauri = true;
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
        unregisterListener: (_event, id) => listeners.delete(id),
      };
      window.__TAURI_INTERNALS__ = {
        metadata: { currentWindow: { label }, currentWebview: { label } },
        transformCallback(fn) {
          const id = next++;
          callbacks.set(id, fn);
          return id;
        },
        unregisterCallback(id) {
          callbacks.delete(id);
        },
        async invoke(command, args = {}) {
          if (command === "plugin:event|listen") {
            const id = next++;
            listeners.set(id, args);
            return id;
          }
          if (command === "workspace") return structuredClone(state);
          if (command === "save_settings") {
            state.settings = structuredClone(args.settings);
            for (const [id, { event, handler }] of listeners)
              if (event === "workspace")
                callbacks.get(handler)?.({
                  event,
                  id,
                  payload: structuredClone(state),
                });
          }
        },
      };
    },
    { sample },
  );
  await page.goto(url);
  await page.locator(".ProseMirror h1").waitFor();
  await page.evaluate(() => document.fonts.ready);
}

function sequence(page, name, height) {
  const timeline = [];
  let pointer = { x: 0, y: 0 };
  const folder = `${frames}/${name}`;
  const shot = async (duration = 75) => {
    const file = `${String(timeline.length).padStart(3, "0")}.png`;
    await page.screenshot({
      path: `${folder}/${file}`,
      clip: { x: 0, y: 0, width: 1000, height },
      caret: "hide",
    });
    timeline.push({ file, duration });
  };
  const move = async (x, y, steps = 7) => {
    const from = { ...pointer };
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      pointer = { x: from.x + (x - from.x) * t, y: from.y + (y - from.y) * t };
      await page.mouse.move(pointer.x, pointer.y);
      await page.evaluate(({ x, y }) => {
        document.getElementById("readme-pointer").style.transform =
          `translate(${x}px,${y}px)`;
      }, pointer);
      if (steps > 1) await shot();
    }
  };
  const aim = async (selector) => {
    const b = await page.locator(selector).boundingBox();
    assert(b, `Missing control: ${selector}`);
    await move(b.x + b.width / 2, b.y + b.height / 2);
  };
  const click = async () => {
    await page.mouse.down();
    await page.evaluate(() =>
      document.getElementById("readme-pointer").classList.add("clicking"),
    );
    await shot(80);
    await page.mouse.up();
    await page.evaluate(() =>
      document.getElementById("readme-pointer").classList.remove("clicking"),
    );
  };
  const settle = async (hold = 1050) => {
    for (let i = 0; i < 4; i++) await shot(65);
    await pause(160);
    await shot(hold);
  };
  return {
    shot,
    move,
    aim,
    click,
    settle,
    async start() {
      await fs.mkdir(folder, { recursive: true });
      await page.evaluate(() => {
        const cursor = document.createElement("div");
        cursor.id = "readme-pointer";
        cursor.innerHTML =
          '<svg viewBox="0 0 20 26" width="19" height="24"><path d="M2 2v18l5-5 4 8 3-2-4-7h7Z" fill="#fff" stroke="#162033" stroke-width="1.5" stroke-linejoin="round"/></svg>';
        document.body.append(cursor);
        const css = document.createElement("style");
        css.textContent =
          "#readme-pointer{position:fixed;inset:0 auto auto 0;z-index:1000;pointer-events:none;filter:drop-shadow(0 1px 2px #0005)}#readme-pointer.clicking::before{content:'';position:absolute;left:-9px;top:-9px;width:22px;height:22px;border:2px solid #2f81f7;border-radius:50%;background:#2f81f737}";
        document.head.append(css);
      });
    },
    finish: () =>
      fs.writeFile(`${folder}/timeline.json`, JSON.stringify(timeline)),
  };
}

(async () => {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const newPage = () =>
    browser.newPage({
      viewport: { width: 1000, height: 690 },
      deviceScaleFactor: 1,
      colorScheme: "light",
    });
  try {
    const toolbarPage = await newPage();
    await desktop(toolbarPage);
    await toolbarPage.screenshot({
      path: `${output}/editor-light.png`,
      caret: "hide",
    });
    const bar = sequence(toolbarPage, "toolbar", 380);
    await bar.start();
    await bar.move(650, 210, 1);
    await bar.shot(1150);
    await bar.aim(".toolbar-handle");
    await bar.settle();
    assert.equal(
      await toolbarPage.locator(".toolbar-shelf").getAttribute("data-open"),
      "true",
    );
    await bar.move(650, 210);
    await bar.settle(750);
    assert.equal(
      await toolbarPage.locator(".toolbar-shelf").getAttribute("data-open"),
      "false",
    );
    await bar.aim(".toolbar-handle");
    await bar.settle(400);
    await bar.aim(".toolbar-pin");
    await bar.click();
    await bar.move(650, 210);
    await bar.settle();
    assert.equal(
      await toolbarPage.locator(".toolbar-shelf").getAttribute("data-pinned"),
      "true",
    );
    await bar.aim(".toolbar-pin");
    await bar.click();
    await bar.move(650, 210);
    await bar.settle(900);
    assert.equal(
      await toolbarPage.locator(".toolbar-shelf").getAttribute("data-pinned"),
      "false",
    );
    await bar.finish();
    await toolbarPage.close();

    const skinPage = await newPage();
    await desktop(skinPage);
    const skin = sequence(skinPage, "themes", 620);
    await skin.start();
    await skin.move(790, 200, 1);
    await skin.shot(1000);
    await skin.aim(".appearance-button");
    await skin.click();
    await skinPage.locator(".appearance-dialog").waitFor();
    await skin.settle();
    await skin.aim('.theme-swatches button[aria-label="GitHub Dark"]');
    await skin.click();
    await skin.settle(1150);
    assert.equal(
      await skinPage.locator(".app").getAttribute("data-theme"),
      "github-dark",
    );
    await skin.aim('.theme-swatches button[aria-label="Nord"]');
    await skin.click();
    await skin.settle(1150);
    assert.equal(
      await skinPage.locator(".app").getAttribute("data-theme"),
      "nord",
    );
    await skin.aim('.appearance-dialog button[aria-label="关闭外观设置"]');
    await skin.click();
    await skin.move(790, 200);
    await skin.settle(1450);
    await skin.finish();
    await skinPage.evaluate(() =>
      document.getElementById("readme-pointer").remove(),
    );
    await skinPage.screenshot({
      path: `${output}/editor-dark.png`,
      caret: "hide",
    });
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
