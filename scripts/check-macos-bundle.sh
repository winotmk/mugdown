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
if ! swift - "$mugdown_pid" <<'SWIFT'
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
then
  cat "$mugdown_fixture/startup.log"
  fail "The packaged macOS app did not reach renderer readiness; see the startup log."
fi

if ! node - "$mugdown_fixture" <<'NODE'
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = process.argv[2];
const settings = JSON.parse(fs.readFileSync(path.join(root, 'mugdown.settings.json'), 'utf8'));
assert.equal(settings.language, 'zh-CN');
assert.equal(settings.uiTheme, 'github-light');
for (const file of ['Air.css', 'Book.css', 'Compact.css', 'Notebook.css']) {
  assert(fs.readFileSync(path.join(root, 'presets', file), 'utf8').length > 0);
}
assert(!fs.existsSync(path.join(root, 'mugdown.app/Contents/MacOS/settings.json')));
console.log('Portable settings and all four presets initialized outside the .app bundle.');
NODE
then
  fail "The packaged app did not initialize settings and presets outside its .app bundle."
fi
