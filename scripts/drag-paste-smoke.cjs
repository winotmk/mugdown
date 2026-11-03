const { chromium } = require("playwright"),
  fs = require("node:fs/promises"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { execFileSync } = require("node:child_process");
const pause = (ms) => new Promise((r) => setTimeout(r, ms)),
  invoke = (p, c, a = {}) =>
    p.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [c, a]);
const cursor = (action = "get", x = 0, y = 0) =>
  JSON.parse(
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        path.join(__dirname, "cursor-test.ps1"),
        action,
        String(Math.round(x)),
        String(Math.round(y)),
      ],
      { encoding: "utf8", windowsHide: true },
    ),
  );
async function waitFor(fn) {
  for (let i = 0; i < 100; i++) {
    const r = await fn();
    if (r) return r;
    await pause(100);
  }
  throw Error("Timed out");
}
(async () => {
  const b = await chromium.connectOverCDP(
      process.env.MUGDOWN_CDP || "http://127.0.0.1:9226",
    ),
    ctx = b.contexts()[0],
    p = ctx.pages()[0];
  cursor("restore", Number(await fs.readFile(".qa/native-pid.txt", "utf8")));
  for (const q of ctx.pages()) {
    const lab = await q.evaluate(
        () => window.__TAURI_INTERNALS__.metadata.currentWindow.label,
      ),
      s = await invoke(q, "workspace");
    for (const id of s.windows.find((w) => w.label === lab)?.ids ?? []) {
      const d = s.documents.find((d) => d.id === id);
      if (d.path?.includes(path.sep + ".qa" + path.sep) || (!d.path && !d.raw))
        await invoke(q, "close_document", { id });
      else throw Error("Use an isolated test process");
    }
    if (q !== p)
      await invoke(q, "plugin:window|destroy", { label: lab }).catch(() => {});
  }
  await pause(150);
  const originalCursor = cursor(),
    checks = [],
    errors = [];
  p.on("pageerror", (e) => errors.push(e.stack));
  const dir = path.resolve(".qa/drag-paste-" + Date.now());
  await fs.mkdir(dir, { recursive: true });
  try {
    for (const d of (await invoke(p, "workspace")).documents) {
      if (d.path?.includes(path.sep + ".qa" + path.sep))
        await invoke(p, "close_document", { id: d.id });
      else throw Error("Use an isolated test process");
    }
    const files = ["drag.md", "other.md"];
    for (const f of files)
      await fs.writeFile(path.join(dir, f), "# " + f + "\n\n拖拽测试\n");
    await invoke(p, "open_documents", {
      paths: files.map((f) => path.join(dir, f)),
    });
    await p.getByRole("tab", { name: /drag.md/ }).click();
    await p.locator(".ProseMirror").waitFor();
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
      "base64",
    );
    await p.locator(".ProseMirror").click();
    await p.keyboard.press("Control+End");
    await p.locator(".ProseMirror").evaluate((el, bytes) => {
      const dt = new DataTransfer();
      dt.items.add(
        new File([new Uint8Array(bytes)], "clipboard.png", {
          type: "image/png",
        }),
      );
      el.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: dt,
        }),
      );
    }, Array.from(png));
    await waitFor(async () => {
      try {
        return (await fs.readdir(path.join(dir, "drag"))).length > 0;
      } catch {
        return false;
      }
    });
    await p.keyboard.press("Control+s");
    await pause(250);
    assert(
      (await fs.readFile(path.join(dir, "drag.md"), "utf8")).includes(
        "drag/image-",
      ),
    );
    await waitFor(() =>
      p
        .locator(".ProseMirror img")
        .evaluateAll((imgs) =>
          imgs.some((i) => i.complete && i.naturalWidth > 0),
        ),
    );
    checks.push("粘贴图片事件写入同名文件夹、相对链接并显示图片");
    const tab = p.getByRole("tab", { name: /drag.md/ }),
      box = await tab.boundingBox();
    const lab = await p.evaluate(
      () => window.__TAURI_INTERNALS__.metadata.currentWindow.label,
    );
    const pos = await invoke(p, "plugin:window|outer_position", { label: lab });
    const size = await invoke(p, "plugin:window|outer_size", { label: lab });
    await p.mouse.move(box.x + 40, box.y + 18);
    await p.mouse.down();
    await p.mouse.move(size.width + 70, 100, { steps: 5 });
    cursor("set", pos.x + size.width + 70, pos.y + 100);
    await p.mouse.up();
    const second = await waitFor(() =>
      ctx.pages().find((q) => q !== p && !q.isClosed()),
    );
    await second.locator(".ProseMirror").waitFor();
    assert.equal(await p.locator(".tabbar").count(), 0);
    assert.equal(await second.locator(".tabbar").count(), 0);
    checks.push("实际 tab 拖动事件拆分原生窗口");
    const doc = (await invoke(second, "workspace")).documents.find(
      (d) => d.name === "drag.md",
    );
    const sbox = await second.locator(".document-label").boundingBox(),
      screen = await second.evaluate(() => ({ x: screenX, y: screenY }));
    const x = pos.x + 160,
      y = pos.y + 60;
    await second.mouse.move(sbox.x + sbox.width / 2, sbox.y + sbox.height / 2);
    await second.mouse.down();
    await second.mouse.move(-100, -100, { steps: 5 });
    await second.locator(".drag-hint").waitFor();
    cursor("set", x, y);
    await second.mouse.up();
    await pause(400);
    const state = await invoke(p, "workspace");
    const owner = state.windows.find((w) => w.ids.includes(doc.id));
    const first = state.windows.find((w) => w.ids.length === 2);
    assert(owner && first && owner.label === first.label);
    assert.equal(await p.locator(".tab").count(), 2);
    checks.push("实际 tab 拖动事件合并到另一窗口顶部");
    for (const w of state.windows.filter((w) => w.label !== owner.label)) {
      for (const id of w.ids) await invoke(second, "close_document", { id });
      await second
        .evaluate(() =>
          window.__TAURI_INTERNALS__.invoke("plugin:window|destroy", {
            label: window.__TAURI_INTERNALS__.metadata.currentWindow.label,
          }),
        )
        .catch(() => {});
    }
    assert.deepEqual(errors, []);
    await fs.writeFile(
      ".qa/drag-paste-checks.json",
      JSON.stringify({ checks, errors }, null, 2),
    );
    process.stdout.write(
      JSON.stringify({ passed: checks.length, checks, errors }, null, 2) + "\n",
    );
  } finally {
    cursor("set", originalCursor.x, originalCursor.y);
    await b.close();
  }
})().catch((e) => {
  process.stderr.write(e.stack + "\n");
  process.exitCode = 1;
});
