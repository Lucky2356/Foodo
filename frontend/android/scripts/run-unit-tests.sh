#!/usr/bin/env bash
# Runs the updater's pure-Java unit tests (UpdatePolicyTest) with plain javac/java and JUnit 4,
# without the Android SDK or Gradle. CI runs the same tests through Gradle
# (testDebugUnitTest / testReleaseUnitTest); this script is for environments without the SDK.
#
#   frontend/android/scripts/run-unit-tests.sh            # downloads JUnit to ~/.cache/foodo-junit
#   JUNIT_JARS=/path/junit.jar:/path/hamcrest.jar ...     # or use existing jars
#
# Needs JDK 17+ (the project builds with JDK 21).
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
src="$here/app/src/main/java/io/github/lucky2356/foodo/update"
tests="$here/app/src/test/java/io/github/lucky2356/foodo/update"

if [ -z "${JUNIT_JARS:-}" ]; then
  cache="${XDG_CACHE_HOME:-$HOME/.cache}/foodo-junit"
  mkdir -p "$cache"
  fetch() { # path sha256
    local file="$cache/$(basename "$1")"
    if [ ! -f "$file" ]; then
      curl -sSfL --retry 5 --retry-all-errors --max-time 120 -o "$file.tmp" "https://repo1.maven.org/maven2/$1"
      mv "$file.tmp" "$file"
    fi
    echo "$2  $file" | sha256sum -c --quiet - || { rm -f "$file"; echo "Checksum mismatch: $file" >&2; exit 1; }
    printf '%s' "$file"
  }
  junit="$(fetch junit/junit/4.13.2/junit-4.13.2.jar 8e495b634469d64fb8acfa3495a065cbacc8a0fff55ce1e31007be4c16dc57d3)"
  hamcrest="$(fetch org/hamcrest/hamcrest-core/1.3/hamcrest-core-1.3.jar 66fdef91e9739348df7a096aa384a5685f4e875584cce89386a7a47251c4d8e9)"
  JUNIT_JARS="$junit:$hamcrest"
fi

out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
# Only the classes without Android imports; compiling them here also proves they stay Android-free.
javac -Xlint:all -Werror --release 17 -d "$out" -cp "$JUNIT_JARS" \
  "$src/MiniJson.java" "$src/UpdateException.java" "$src/UpdatePolicy.java" "$src/UpdateHttp.java" \
  "$tests"/*.java
java -cp "$out:$JUNIT_JARS" org.junit.runner.JUnitCore io.github.lucky2356.foodo.update.UpdatePolicyTest
