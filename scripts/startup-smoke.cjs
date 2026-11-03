const { spawn } = require("node:child_process"),
  { chromium } = require("playwright"),
  fs = require("node:fs/promises"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const pause = (ms) => new Promise((r) => setTimeout(r, ms)),
  invoke = (p, c, a = {}) =>
    p.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [c, a]);
(async () => {
  const exe = path.resolve(
      process.env.MUGDOWN_EXE || "src-tauri/target/release/mugdown.exe",
    ),
    port = process.env.MUGDOWN_PORT || "9227";
  await fs.mkdir(".qa", { recursive: true });
  const start = performance.now();
  const proc = spawn(exe, [], {
    cwd: path.dirname(exe),
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
      WEBVIEW2_USER_DATA_FOLDER: path.resolve(".qa/production-webview"),
    },
    windowsHide: true,
    stdio: "ignore",
  });
  await fs.writeFile(".qa/native-pid.txt", String(proc.pid));
  proc.unref();
  let browser;
  for (let i = 0; i < 150; i++) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      break;
    } catch {
      await pause(100);
    }
  }
  if (!browser) throw Error("Production app did not start");
  const page = browser.contexts()[0].pages()[0];
  await page.locator(".empty").waitFor();
  await page.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  const readyMs = Math.round(performance.now() - start),
    url = page.url();
  assert(
    !url.includes("127.0.0.1:5173"),
    "Production build must embed the frontend",
  );
  const screen = await page.evaluate(() => ({ x: screenX, y: screenY }));
  assert(
    screen.x > -30000 && screen.y > -30000,
    "App must restore its native window",
  );
  const file = path.resolve(".qa/performance.md"),
    text = "# 写作性能\n\n一杯咖啡，一段文字。记录想法，慢慢打磨。\n\n".repeat(
      120,
    );
  await fs.writeFile(file, text);
  const open = performance.now();
  await invoke(page, "open_documents", { paths: [file] });
  await page.locator(".ProseMirror h1").first().waitFor();
  await page.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  const openMs = Math.round(performance.now() - open);
  await page.screenshot({ path: "docs/mugdown-production.png" });
  const result = {
    executable: exe,
    url,
    readyMs,
    firstOpenMs: openMs,
    documentBytes: Buffer.byteLength(text),
    executableBytes: (await fs.stat(exe)).size,
    developmentServerRequired: false,
  };
  await fs.writeFile(".qa/performance.json", JSON.stringify(result, null, 2));
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  for (const d of (await invoke(page, "workspace")).documents)
    await invoke(page, "close_document", { id: d.id });
  await browser.close();
})().catch((e) => {
  process.stderr.write(e.stack + "\n");
  process.exitCode = 1;
});
