#!/usr/bin/env bash
# Agent Chess — build a signed, sideloadable APK without Gradle.
#
# Two toolchain shapes are supported:
#   * aapt2  (official SDK build-tools, x86_64 desktop / GitHub Actions)
#   * aapt   (v1, packaged for arm64 by Debian/Ubuntu — builds on the phone)
#
# Everything else (javac, d8, apksigner) is JVM code, so it runs anywhere.
#
# Environment:
#   ANDROID_SDK        SDK root holding android-15/ and android-35/  (default /tmp/opencode/sdk)
#   AGENT_CHESS_KEY    PKCS#8 private key  (default ../horizon-build/key.pk8)
#   AGENT_CHESS_CERT   DER certificate     (default ../horizon-build/cert.der)
#   VERSION_NAME       versionName override (default from the manifest)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SDK="${ANDROID_SDK:-/tmp/opencode/sdk}"
BT="$SDK/android-15"
PLATFORM="$SDK/android-35/android.jar"
KEY="${AGENT_CHESS_KEY:-$ROOT/../horizon-build/key.pk8}"
CERT="${AGENT_CHESS_CERT:-$ROOT/../horizon-build/cert.der}"
BUILD="$ROOT/android/build"
OUT="$ROOT/dist/agent-chess.apk"

fail() { echo "error: $*" >&2; exit 1; }

[ -f "$PLATFORM" ] || fail "missing platform jar: $PLATFORM"
[ -f "$KEY" ] || fail "missing signing key: $KEY"
[ -f "$CERT" ] || fail "missing signing certificate: $CERT"

# The official build-tools binaries are x86_64 only, so "exists and is
# executable" is not enough on an arm64 host — probe it for real.
# Debian/Ubuntu also ship a native arm64 aapt2 at
# /usr/lib/android-sdk/build-tools/debian/aapt2.
AAPT2=""
for candidate in "$BT/aapt2" /usr/lib/android-sdk/build-tools/debian/aapt2; do
  if [ -x "$candidate" ] && "$candidate" version >/dev/null 2>&1; then
    AAPT2="$candidate"
    break
  fi
done

ZIPALIGN="zipalign"
for candidate in "$BT/zipalign" /usr/lib/android-sdk/build-tools/debian/zipalign; do
  if [ -x "$candidate" ]; then ZIPALIGN="$candidate"; break; fi
done

if [ -n "$AAPT2" ]; then
  TOOLCHAIN=aapt2
elif command -v aapt >/dev/null 2>&1; then
  TOOLCHAIN=aapt
else
  fail "no resource compiler found (need aapt2 or aapt on PATH)"
fi

echo "==> bundle"
node "$ROOT/scripts/build.mjs"

echo "==> clean"
rm -rf "$BUILD"
mkdir -p "$BUILD/classes" "$BUILD/dex" "$BUILD/gen" "$ROOT/dist"

if [ "$TOOLCHAIN" = aapt2 ]; then
  echo "==> aapt2 compile"
  "$AAPT2" compile --dir "$ROOT/android/res" -o "$BUILD/res.zip"

  echo "==> aapt2 link"
  "$AAPT2" link \
    -o "$BUILD/base.apk" \
    -I "$PLATFORM" \
    --manifest "$ROOT/android/AndroidManifest.xml" \
    -R "$BUILD/res.zip" \
    -A "$ROOT/android/assets" \
    --java "$BUILD/gen" \
    --auto-add-overlay
else
  echo "==> aapt package (v1, native arm64)"
  aapt package -f -m \
    -M "$ROOT/android/AndroidManifest.xml" \
    -S "$ROOT/android/res" \
    -A "$ROOT/android/assets" \
    -I "$PLATFORM" \
    -J "$BUILD/gen" \
    -F "$BUILD/base.apk"
fi

echo "==> javac"
find "$ROOT/android/src" "$BUILD/gen" -name '*.java' > "$BUILD/sources.txt"
javac -source 17 -target 17 -encoding UTF-8 \
  -classpath "$PLATFORM" \
  -d "$BUILD/classes" \
  @"$BUILD/sources.txt" 2>&1 | grep -v "bootstrap class path" || true
[ -n "$(find "$BUILD/classes" -name '*.class' -print -quit)" ] || fail "javac produced no classes"

echo "==> d8"
find "$BUILD/classes" -name '*.class' > "$BUILD/classes.txt"
"$BT/d8" --lib "$PLATFORM" --min-api 24 --output "$BUILD/dex" @"$BUILD/classes.txt"

echo "==> package dex"
cd "$BUILD"
zip -q -j base.apk dex/classes.dex

echo "==> zipalign"
"$ZIPALIGN" -f -p 4 base.apk aligned.apk

echo "==> sign"
"$BT/apksigner" sign \
  --key "$KEY" \
  --cert "$CERT" \
  --min-sdk-version 24 \
  --out "$OUT" \
  aligned.apk

echo "==> verify"
"$BT/apksigner" verify --verbose "$OUT"

echo
ls -lh "$OUT"
echo "APK ready: $OUT"
