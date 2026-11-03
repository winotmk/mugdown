// The documentation uses the production renderer and synthetic documents.
// The two-window scene supplies the desktop events through a local fixture.
const { chromium } = require("playwright");
const fs = require("node:fs/promises");
const assert = require("node:assert/strict");

const url = (process.env.MUGDOWN_URL || "http://127.0.0.1:5177").replace(
  /\/$/,
  "",
);
const output = "docs/media";
const frames = ".qa/readme-frames";
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const languages = ["zh-CN", "en-US"].filter(
  (id) =>
    !process.env.MUGDOWN_README_LANG || process.env.MUGDOWN_README_LANG === id,
);
const words = {
  "zh-CN": {
    sample:
      "# 留一点空白\n\n一杯咖啡，一份 Markdown。把注意力留给正在写的这一页。\n\n## 今天的笔记\n\n> 把一个想法写下来，剩下的慢慢来。\n\n- **可视化编辑**：直接调整段落，也能切回 MD 源码。\n- **本地文件**：笔记和图片随时带走。",
    close: "关闭外观设置",
    empty: "拖入 Markdown 文档，或者",
    steps: [
      "拖出标签，拆分窗口",
      "两个文档，各有一个窗口",
      "拖回标题栏，松手合并",
      "两个标签回到同一个窗口",
    ],
  },
  "en-US": {
    sample:
      "# Room to write\n\nOpen a Markdown file and give the page your full attention.\n\n## Today's notes\n\n> Write down one idea. The rest can wait.\n\n- **Visual editing**: format the page, or switch to Markdown source.\n- **Local files**: keep your notes and images together.",
    close: "Close appearance settings",
    empty: "Drop a Markdown document here, or",
    steps: [
      "Drag the tab out to detach it",
      "Two documents, two windows",
      "Drag the title bar back and release to merge",
      "Both tabs are back in one window",
    ],
  },
};

async function installDesktop(
  page,
  { language, theme = "github-light", empty = false, stage = false },
) {
  await page.addInitScript(
    ({ sample, language, theme, empty, stage }) => {
      if (stage && window === window.top) return;
      const label =
        new URL(location.href).searchParams.get("window") || "editor-readme";
      const callbacks = new Map(),
        listeners = new Map();
      let next = 1;
      const makeDoc = (id, name, raw) => ({
        id,
        name,
        raw,
        saved: raw,
        path: name,
        revision: 0,
      });
      const zh = language === "zh-CN";
      const documents = empty
        ? []
        : stage
          ? [
              makeDoc(
                "draft",
                zh ? "草稿.md" : "Draft.md",
                zh
                  ? "# 草稿\n\n在这里写下第一个想法。"
                  : "# Draft\n\nMake room for the first idea.",
              ),
              makeDoc(
                "notes",
                zh ? "笔记.md" : "Notes.md",
                zh
                  ? "# 笔记\n\n把需要对照的资料放在另一边。"
                  : "# Notes\n\nKeep your reference beside the draft.",
              ),
            ]
          : [
              makeDoc(
                "sample",
                zh ? "写作笔记.md" : "Writing notes.md",
                sample,
              ),
            ];
      const state = {
        documents,
        windows: stage
          ? [
              { label: "primary", ids: ["draft", "notes"], active: "draft" },
              { label: "secondary", ids: ["notes"], active: "notes" },
            ]
          : [
              {
                label,
                ids: documents.map((doc) => doc.id),
                active: documents[0]?.id ?? null,
              },
            ],
        settings: {
          uiTheme: theme,
          markdownStyle: "github",
          fontSize: 17,
          contentWidth: 820,
          customCss: "",
          language,
          toolbarPinned: false,
        },
        settingsStorage: {
          path: "./settings.json",
          location: "portable",
          error: null,
        },
        presets: { directory: "./presets", items: [], error: null },
      };
      const emit = (name, payload) => {
        for (const [id, { event, handler }] of listeners)
          if (event === name)
            callbacks.get(handler)?.({
              event,
              id,
              payload: structuredClone(payload),
            });
      };
      const fixture = (window.__readmeDesktop = {
        commands: [],
        emit,
        setWindows(windows) {
          state.windows = windows;
          emit("workspace", state);
        },
      });
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
          if (stage) fixture.commands.push({ command, args });
          if (command === "plugin:event|listen") {
            const id = next++;
            listeners.set(id, args);
            return id;
          }
          if (command === "workspace") return structuredClone(state);
          if (command === "save_settings") {
            state.settings = structuredClone(args.settings);
            emit("workspace", state);
          }
          if (stage && command === "start_window_drag")
            return new Promise((resolve) => {
              fixture.resolveDrop = resolve;
            });
        },
      };
    },
    { sample: words[language].sample, language, theme, empty, stage },
  );
}
async function desktop(page, options) {
  await installDesktop(page, options);
  await page.goto(url);
  await page.locator(options.empty ? ".empty" : ".ProseMirror h1").waitFor();
  await page.evaluate(() => document.fonts.ready);
}
function sequence(page, name, height, width = 1000) {
  const timeline = [];
  let pointer = { x: 0, y: 0 };
  const folder = frames + "/" + name;
  const shot = async (duration = 75) => {
    const file = String(timeline.length).padStart(3, "0") + ".png";
    await page.screenshot({
      path: folder + "/" + file,
      clip: { x: 0, y: 0, width, height },
      caret: "hide",
    });
    timeline.push({ file, duration });
  };
  const move = async (x, y, steps = 7, track) => {
    const from = { ...pointer };
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      pointer = { x: from.x + (x - from.x) * t, y: from.y + (y - from.y) * t };
      await page.mouse.move(pointer.x, pointer.y);
      await page.evaluate(({ x, y }) => {
        document.getElementById("readme-pointer").style.transform =
          "translate(" + x + "px," + y + "px)";
      }, pointer);
      if (track) await track(pointer);
      if (steps > 1) await shot();
    }
  };
  const aim = async (locator, fraction = 0.5) => {
    const b = await locator.boundingBox();
    assert(b, "Missing control: " + locator);
    await move(b.x + b.width * fraction, b.y + b.height / 2);
    return { ...pointer };
  };
  const press = async () => {
    await page.mouse.down();
    await page.evaluate(() =>
      document.getElementById("readme-pointer").classList.add("clicking"),
    );
    await shot(80);
  };
  const release = async () => {
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
    press,
    release,
    settle,
    async click() {
      await press();
      await release();
    },
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
      fs.writeFile(folder + "/timeline.json", JSON.stringify(timeline)),
  };
}

async function windowDemo(browser, language, suffix) {
  const width = 1200,
    height = 510;
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 1,
  });
  try {
    const steps = words[language].steps;
    const stageUrl = url + "/readme-windows";
    await installDesktop(page, { language, stage: true });
    await page.route(stageUrl, (route) =>
      route.fulfill({
        contentType: "text/html; charset=utf-8",
        body:
          '<!doctype html><meta charset="utf-8"><style>' +
          'body{margin:0;background:#eaf0f7;font:16px "Segoe UI","Microsoft YaHei",sans-serif;overflow:hidden}' +
          "iframe{position:absolute;border:1px solid #aab8cb;border-radius:8px;box-shadow:0 10px 25px #19284229;background:white}" +
          "#primary{left:30px;top:36px;width:610px;height:370px}" +
          "#secondary{left:630px;top:83px;width:540px;height:360px;visibility:hidden}" +
          "#caption{position:absolute;z-index:3;inset:auto 0 0;background:#162338;color:white;padding:13px 30px;font-weight:600;letter-spacing:.015em}" +
          '</style><iframe id="primary" src="' +
          url +
          '/?window=primary"></iframe>' +
          '<iframe id="secondary" src="' +
          url +
          '/?window=secondary"></iframe><div id="caption"></div>',
      }),
    );
    await page.goto(stageUrl);
    const left = page.frameLocator("#primary");
    const right = page.frameLocator("#secondary");
    await left.locator('.tab[data-tab-id="notes"]').waitFor();
    await right.locator(".ProseMirror h1").waitFor({ state: "attached" });
    const primary = page
      .frames()
      .find(
        (frame) =>
          new URL(frame.url()).searchParams.get("window") === "primary",
      );
    const secondary = page
      .frames()
      .find(
        (frame) =>
          new URL(frame.url()).searchParams.get("window") === "secondary",
      );
    assert(primary && secondary);
    const caption = (index) =>
      page.locator("#caption").evaluate((node, text) => {
        node.textContent = text;
      }, steps[index]);
    const seq = sequence(page, "windows" + suffix, height, width);
    await seq.start();
    await caption(0);
    await seq.move(360, 150, 1);
    await seq.shot(1000);
    await seq.aim(left.locator('.tab[data-tab-id="notes"]'));
    await seq.press();
    await seq.move(855, 180, 12);
    await left.locator(".drag-hint").waitFor();
    await seq.shot(650);
    await seq.release();
    await primary.waitForFunction(() =>
      __readmeDesktop.commands.some(
        (call) =>
          call.command === "finish_tab_drag" && call.args.id === "notes",
      ),
    );
    const separate = [
      { label: "primary", ids: ["draft"], active: "draft" },
      { label: "secondary", ids: ["notes"], active: "notes" },
    ];
    await primary.evaluate(
      (windows) => __readmeDesktop.setWindows(windows),
      separate,
    );
    await secondary.evaluate(
      (windows) => __readmeDesktop.setWindows(windows),
      separate,
    );
    await page.locator("#secondary").evaluate((frame) => {
      frame.style.visibility = "visible";
    });
    await left.locator(".tabbar").waitFor({ state: "hidden" });
    await right.locator(".document-label").waitFor();
    await caption(1);
    await seq.shot(1400);
    await caption(2);
    const from = await seq.aim(right.locator(".document-caption"), 0.22);
    await seq.press();
    await secondary.waitForFunction(
      () => typeof __readmeDesktop.resolveDrop === "function",
    );
    await seq.move(460, 300, 12, (point) =>
      page.locator("#secondary").evaluate(
        (frame, { x, y }) => {
          frame.style.left = x + "px";
          frame.style.top = y + "px";
        },
        { x: 630 + point.x - from.x, y: 83 + point.y - from.y },
      ),
    );
    await primary.evaluate(() =>
      __readmeDesktop.emit("window-merge-target", 1),
    );
    await secondary.evaluate(() =>
      __readmeDesktop.emit("window-merge-preview", "primary"),
    );
    await left.locator(".window-merge-target").waitFor();
    await seq.shot(1100);
    await seq.release();
    await secondary.evaluate(() => __readmeDesktop.resolveDrop("primary"));
    await secondary.waitForFunction(() =>
      __readmeDesktop.commands.some(
        (call) =>
          call.command === "merge_windows" && call.args.target === "primary",
      ),
    );
    await primary.evaluate(() => {
      __readmeDesktop.emit("window-merge-target", null);
      __readmeDesktop.setWindows([
        { label: "primary", ids: ["draft", "notes"], active: "notes" },
      ]);
    });
    await page.locator("#secondary").evaluate((frame) => {
      frame.style.visibility = "hidden";
    });
    await left.locator('.tab[data-tab-id="notes"]').waitFor();
    assert.equal(await left.locator(".tab").count(), 2);
    await caption(3);
    await seq.shot(1500);
    await seq.finish();
  } finally {
    await page.close();
  }
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
  const should = (scene) =>
    !process.env.MUGDOWN_README_SCENE ||
    process.env.MUGDOWN_README_SCENE.split(",").includes(scene);
  try {
    for (const language of languages) {
      const suffix = language === "en-US" ? "-en" : "";
      if (should("empty")) {
        const empty = await newPage();
        await desktop(empty, { language, empty: true, theme: "github-dark" });
        assert.equal(await empty.locator(".empty h1, .ProseMirror").count(), 0);
        await empty.getByText(words[language].empty, { exact: true }).waitFor();
        await empty.screenshot({
          path: output + "/empty-" + (suffix ? "en" : "zh") + ".png",
          caret: "hide",
        });
        await empty.close();
      }
      if (should("toolbar")) {
        const page = await newPage();
        await desktop(page, { language });
        const bar = sequence(page, "toolbar" + suffix, 380);
        await bar.start();
        await bar.move(650, 210, 1);
        await bar.shot(1150);
        await bar.aim(page.locator(".toolbar-handle"));
        await bar.settle();
        assert.equal(
          await page.locator(".toolbar-shelf").getAttribute("data-open"),
          "true",
        );
        await bar.move(650, 210);
        await bar.settle(750);
        assert.equal(
          await page.locator(".toolbar-shelf").getAttribute("data-open"),
          "false",
        );
        await bar.aim(page.locator(".toolbar-handle"));
        await bar.settle(400);
        await bar.aim(page.locator(".toolbar-pin"));
        await bar.click();
        await bar.move(650, 210);
        await bar.settle();
        assert.equal(
          await page.locator(".toolbar-shelf").getAttribute("data-pinned"),
          "true",
        );
        await bar.aim(page.locator(".toolbar-pin"));
        await bar.click();
        await bar.move(650, 210);
        await bar.settle(900);
        assert.equal(
          await page.locator(".toolbar-shelf").getAttribute("data-pinned"),
          "false",
        );
        await bar.finish();
        await page.close();
      }
      if (should("themes")) {
        const page = await newPage();
        await desktop(page, { language });
        const skin = sequence(page, "themes" + suffix, 620);
        await skin.start();
        await skin.move(790, 200, 1);
        await skin.shot(1000);
        await skin.aim(page.locator(".appearance-button"));
        await skin.click();
        await page.locator(".appearance-dialog").waitFor();
        await skin.settle();
        for (const [name, id] of [
          ["GitHub Dark", "github-dark"],
          ["Nord", "nord"],
        ]) {
          await skin.aim(
            page.locator('.theme-swatches button[aria-label="' + name + '"]'),
          );
          await skin.click();
          await skin.settle(1150);
          assert.equal(
            await page.locator(".app").getAttribute("data-theme"),
            id,
          );
        }
        await skin.aim(
          page.getByRole("button", {
            name: words[language].close,
            exact: true,
          }),
        );
        await skin.click();
        await skin.move(790, 200);
        await skin.settle(1450);
        await skin.finish();
        await page.evaluate(() =>
          document.getElementById("readme-pointer").remove(),
        );
        await page.screenshot({
          path: output + "/editor-dark" + suffix + ".png",
          caret: "hide",
        });
        await page.close();
      }
      if (should("windows")) await windowDemo(browser, language, suffix);
      console.log("Captured documentation media for " + language);
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
