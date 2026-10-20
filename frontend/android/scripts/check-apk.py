"""Checks the merged manifest of a built APK (CI, .github/workflows/android.yml).

Usage: python3 check-apk.py <apk> <expected-version-name>
Reads the manifest with `apkanalyzer manifest print` (Android SDK command-line tools) and fails if
  - the package, versionName or versionCode (X*10000 + Y*100 + Z) differ;
  - any permission other than INTERNET, REQUEST_INSTALL_PACKAGES and AndroidX's signature-level
    <package>.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION is requested;
  - any component other than the launcher activity is exported;
  - backup, cleartext traffic or debuggable are not as expected for a release build.
"""

import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET

ANDROID = "{http://schemas.android.com/apk/res/android}"
PACKAGE = "io.github.lucky2356.foodo"


def main() -> int:
    apk, version = sys.argv[1], sys.argv[2]
    tool = shutil.which("apkanalyzer")
    if not tool:
        print("apkanalyzer not found on PATH", file=sys.stderr)
        return 2
    xml = subprocess.run([tool, "manifest", "print", apk], check=True, capture_output=True, text=True).stdout
    if "xmlns:android" not in xml:
        xml = xml.replace("<manifest", '<manifest xmlns:android="http://schemas.android.com/apk/res/android"', 1)
    root = ET.fromstring(xml)
    errors: list[str] = []

    major, minor, patch = (int(p) for p in version.split("."))
    expected_code = str(major * 10000 + minor * 100 + patch)
    if root.get("package") != PACKAGE:
        errors.append(f"package {root.get('package')}")
    if root.get(f"{ANDROID}versionName") != version:
        errors.append(f"versionName {root.get(f'{ANDROID}versionName')} != {version}")
    if root.get(f"{ANDROID}versionCode") != expected_code:
        errors.append(f"versionCode {root.get(f'{ANDROID}versionCode')} != {expected_code}")

    allowed = {
        "android.permission.INTERNET",
        "android.permission.REQUEST_INSTALL_PACKAGES",
        f"{PACKAGE}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION",
    }
    for tag in ("uses-permission", "uses-permission-sdk-23"):
        for p in root.iter(tag):
            name = p.get(f"{ANDROID}name")
            if name not in allowed:
                errors.append(f"unexpected permission {name}")

    app = root.find("application")
    if app is None:
        errors.append("no <application>")
    else:
        if app.get(f"{ANDROID}allowBackup") != "false":
            errors.append("allowBackup is not false")
        if app.get(f"{ANDROID}usesCleartextTraffic") != "false":
            errors.append("usesCleartextTraffic is not false")
        if app.get(f"{ANDROID}debuggable") == "true" and "--release" in sys.argv:
            errors.append("release build is debuggable")
        for kind in ("activity", "activity-alias", "service", "receiver", "provider"):
            for c in app.iter(kind):
                name = c.get(f"{ANDROID}name")
                exported = c.get(f"{ANDROID}exported")
                # Components with an intent filter and no explicit value are exported on old targets.
                implicit = exported is None and c.find("intent-filter") is not None
                if (exported == "true" or implicit) and name not in (f"{PACKAGE}.MainActivity", ".MainActivity"):
                    errors.append(f"exported {kind} {name}")

    if errors:
        for e in errors:
            print(f"::error::{e}")
        return 1
    print(f"Manifest OK: {PACKAGE} {version} ({expected_code}), permissions and exported components as expected")
    return 0


if __name__ == "__main__":
    sys.exit(main())
