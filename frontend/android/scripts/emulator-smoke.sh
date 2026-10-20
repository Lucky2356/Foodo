#!/usr/bin/env bash
# Emulator smoke test (CI, .github/workflows/android.yml): installs an APK, launches Foodo,
# waits for the web UI, takes a screenshot and fails on a crash of the app.
#
#   emulator-smoke.sh <apk> <debug|release> <out-dir> <expected-version>
#
# debug:   additionally inspects the WebView through DevTools (webview-check.mjs);
# release: the minified build (signed with the debug key in CI) is checked through the
#          accessibility tree (uiautomator), since WebView debugging is off in release builds.
set -euo pipefail

apk="$1"; mode="$2"; out="$3"; version="$4"
pkg=io.github.lucky2356.foodo
here="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$out"

adb wait-for-device
# Boot animation may still be running when the runner starts the script.
for _ in $(seq 1 60); do
  [ "$(adb shell getprop sys.boot_completed | tr -d '\r')" = "1" ] && break
  sleep 2
done
adb uninstall "$pkg" >/dev/null 2>&1 || true
adb install -r "$apk"
adb logcat -c
adb shell am start -W -n "$pkg/.MainActivity"

found=""
for _ in $(seq 1 45); do
  sleep 2
  if adb shell uiautomator dump /sdcard/foodo-ui.xml >/dev/null 2>&1; then
    adb shell cat /sdcard/foodo-ui.xml > "$out/ui-$mode.xml" 2>/dev/null || true
    # Bottom navigation of the web app (App.tsx): rendered by the WebView, seen through accessibility.
    if grep -q 'Покупки' "$out/ui-$mode.xml" && grep -q 'Меню' "$out/ui-$mode.xml"; then
      found=yes
      break
    fi
  fi
  if ! adb shell pidof "$pkg" >/dev/null 2>&1; then
    echo "::error::$pkg is not running"
    break
  fi
done
sleep 3
adb exec-out screencap -p > "$out/screenshot-$mode.png"

if [ "$mode" = debug ]; then
  pid="$(adb shell pidof "$pkg" | tr -d '\r')"
  socket="webview_devtools_remote_$pid"
  adb forward tcp:9222 "localabstract:$socket"
  node "$here/webview-check.mjs" 9222 "$version" | tee "$out/webview-check.txt"
  adb forward --remove tcp:9222 || true
fi

adb logcat -d > "$out/logcat-$mode.txt" || true
if grep -q "FATAL EXCEPTION" "$out/logcat-$mode.txt" && grep -A3 "FATAL EXCEPTION" "$out/logcat-$mode.txt" | grep -q "$pkg"; then
  echo "::error::Foodo crashed ($mode), see logcat-$mode.txt"
  grep -A20 "FATAL EXCEPTION" "$out/logcat-$mode.txt" || true
  exit 1
fi
if ! adb shell pidof "$pkg" >/dev/null 2>&1; then
  echo "::error::Foodo is not running after start ($mode)"
  exit 1
fi
if [ -z "$found" ] && [ "$mode" = debug ]; then
  # The DevTools check above already proved the UI rendered.
  echo "::warning::Main screen text not found in the accessibility tree (debug); DevTools check passed"
elif [ -z "$found" ]; then
  echo "::error::Foodo main screen text not found in the UI tree ($mode); see ui-$mode.xml and screenshot-$mode.png"
  exit 1
fi
echo "Smoke test passed ($mode)"
