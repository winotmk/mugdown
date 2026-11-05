#!/bin/bash
set -euo pipefail

mugdown_bundle=${1:?Usage: bash scripts/check-macos-bundle.sh path/to/mugdown.app}
mugdown_binary="$mugdown_bundle/Contents/MacOS/mugdown"
fail() {
  printf '::error::%s\n' "$1" >&2
  exit 1
}
test "$(uname -s)" = Darwin
test -x "$mugdown_binary" || fail "Packaged macOS executable is missing: $mugdown_binary"
plutil -lint "$mugdown_bundle/Contents/Info.plist" || fail "The app's Info.plist is invalid."
# Apple's lipo consumes every argument after -verify_arch as an architecture.
lipo "$mugdown_binary" -verify_arch arm64 x86_64 || fail "The macOS executable must contain both arm64 and x86_64."
codesign --verify --deep --strict "$mugdown_bundle" || fail "The macOS app's code signature is invalid."
plutil -extract CFBundleLocalizations json -o - "$mugdown_bundle/Contents/Info.plist" | node -e 'const a=require("node:assert/strict"); const l=JSON.parse(require("node:fs").readFileSync(0,"utf8")); for(const x of ["en","zh-Hans","zh-Hant"]) a(l.includes(x));' || fail "The app must declare Chinese and English localizations."

# Run a copy so portable settings and presets cannot enter the shipped bundle.
mugdown_fixture=$(mktemp -d "${TMPDIR:-/tmp}/mugdown-smoke.XXXXXX")
mugdown_pid=
cleanup() {
  if [ -n "$mugdown_pid" ]; then
    kill "$mugdown_pid" 2>/dev/null || true
    wait "$mugdown_pid" 2>/dev/null || true
  fi
  rm -rf "$mugdown_fixture"
}
trap cleanup EXIT
cp -R "$mugdown_bundle" "$mugdown_fixture/mugdown.app"
"$mugdown_fixture/mugdown.app/Contents/MacOS/mugdown" >"$mugdown_fixture/startup.log" 2>&1 &
mugdown_pid=$!

# The window starts hidden; it becomes visible only after React calls `ready`.
# Window PID and bounds are available without granting Accessibility access.
wait_for_window() {
  swift - "$1" <<'SWIFT'
import CoreGraphics
import Foundation

let pid = Int32(CommandLine.arguments[1])!
for _ in 0..<150 {
    if kill(pid, 0) != 0 { exit(1) }
    let windows = CGWindowListCopyWindowInfo(
        [.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID
    ) as? [[String: Any]] ?? []
    if windows.contains(where: { window in
        guard let owner = window[kCGWindowOwnerPID as String] as? Int32,
              let layer = window[kCGWindowLayer as String] as? Int,
              let bounds = window[kCGWindowBounds as String] as? [String: Any],
              let width = bounds["Width"] as? Double,
              let height = bounds["Height"] as? Double else { return false }
        return owner == pid && layer == 0 && width >= 540 && height >= 360
    }) {
        print("Packaged WKWebView app reached renderer readiness and showed its window.")
        exit(0)
    }
    Thread.sleep(forTimeInterval: 0.2)
}
FileHandle.standardError.write(Data("The packaged app did not show an editor window within 30 seconds.\n".utf8))
exit(1)
SWIFT
}
if ! wait_for_window "$mugdown_pid"; then
  cat "$mugdown_fixture/startup.log"
  fail "The packaged macOS app did not reach renderer readiness; see the startup log."
fi

if ! node - "$mugdown_fixture" <<'NODE'
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = process.argv[2];
const system = path.join(os.homedir(), 'Library/Application Support/com.winotmk.mugdown');
assert(!fs.existsSync(path.join(system, 'settings.json')), 'Fresh launch generated a settings file');
assert(!fs.existsSync(path.join(system, 'presets')), 'Fresh launch expanded built-in presets');
assert(!fs.existsSync(path.join(root, 'mugdown.settings.json')), 'Fresh launch wrote beside the app');
assert(!fs.existsSync(path.join(root, 'mugdown-data')), 'Fresh launch enabled portable mode');
assert(!fs.existsSync(path.join(root, 'mugdown.app/Contents/MacOS/settings.json')));
console.log('First launch keeps defaults in memory and leaves the app directory clean.');
NODE
then
  fail "Fresh macOS launch must not generate default settings or presets."
fi

kill "$mugdown_pid" 2>/dev/null || true
wait "$mugdown_pid" 2>/dev/null || true
mugdown_pid=

node - "$mugdown_fixture" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const root = process.argv[2];
const directory = path.join(root, 'mugdown-data');
fs.mkdirSync(path.join(directory, 'presets'), { recursive: true });
const settings = JSON.stringify({
  uiTheme: 'nord', markdownStyle: 'external:Personal.css', fontSize: 20,
  contentWidth: 850, customCss: '', language: 'zh-CN', toolbarPinned: false,
  macStorageVersion: 1, portableMode: true
}, null, 2);
fs.writeFileSync(path.join(directory, 'settings.json'), settings);
fs.writeFileSync(path.join(root, 'portable-original.json'), settings);
fs.writeFileSync(path.join(directory, 'presets/Personal.css'), 'p { font-style: italic; }');
NODE

"$mugdown_fixture/mugdown.app/Contents/MacOS/mugdown" >"$mugdown_fixture/startup.log" 2>&1 &
mugdown_pid=$!
if ! wait_for_window "$mugdown_pid"; then
  cat "$mugdown_fixture/startup.log"
  fail "The packaged app did not start with its portable profile."
fi
if ! node - "$mugdown_fixture" <<'NODE'
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = process.argv[2];
const directory = path.join(root, 'mugdown-data');
assert.equal(fs.readFileSync(path.join(directory, 'settings.json'), 'utf8'),
  fs.readFileSync(path.join(root, 'portable-original.json'), 'utf8'));
assert.deepEqual(fs.readdirSync(path.join(directory, 'presets')), ['Personal.css']);
assert(!fs.existsSync(path.join(os.homedir(), 'Library/Application Support/com.winotmk.mugdown/settings.json')));
assert(!fs.existsSync(path.join(root, 'mugdown.settings.json')));
assert(!fs.existsSync(path.join(root, 'mugdown.app/Contents/MacOS/settings.json')));
console.log('Portable startup preserves personal data without expanding defaults or writing a selector beside the app.');
NODE
then
  fail "Portable startup modified default locations or failed to preserve the profile."
fi
codesign --verify --deep --strict "$mugdown_fixture/mugdown.app" || fail "Startup modified the signed app bundle."
