#!/usr/bin/env bash
# rust-anything-lab — build the GullyScore Rust Android APK (arm64-v8a).
#
# Everything is built from the lab's own toolchain + SDK:
#   1. cargo build --release --target aarch64-linux-android  (NDK linker)
#   2. aapt2 compile/link the manifest + launcher icon (copied read-only from
#      the RN app's own assets) into a base APK
#   3. add libgullyscore_app.so, zipalign, sign with a local debug key
#
# Output: GullyScore-rust-<version>.apk at the lab root.
set -euo pipefail
cd "$(dirname "$0")/.."
. ./env.sh

SDK="$PWD/android-sdk"
BT="$SDK/build-tools/34.0.0"
PLATFORM="$SDK/platforms/android-34/android.jar"
NDK_TARGET="aarch64-linux-android"
OUT="GullyScore-rust-0.2.0.apk"

export ANDROID_HOME="$SDK"
# cargo discovers .cargo/config.toml from the CWD, not the manifest dir —
# pin the NDK linker explicitly so the build works from anywhere
export CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="$SDK/ndk/29.0.14206865/toolchains/llvm/prebuilt/linux-x86_64/bin/aarch64-linux-android24-clang"

echo "== 1/5 cargo release build ($NDK_TARGET) =="
cargo build --release --manifest-path rust/Cargo.toml --target "$NDK_TARGET" -p gullyscore_app
SO="rust/target/$NDK_TARGET/release/libgullyscore_app.so"
test -f "$SO"
ls -la "$SO"

echo "== 2/5 resources + manifest (aapt2) =="
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
# launcher icons: read from the RN app's own res (never modified)
for d in mipmap-mdpi mipmap-hdpi mipmap-xhdpi mipmap-xxhdpi mipmap-xxxhdpi; do
  mkdir -p "$STAGE/res/$d"
  src="../GullyScoreRN/android/app/src/main/res/$d/ic_launcher.webp"
  if [ -f "$src" ]; then cp "$src" "$STAGE/res/$d/ic_launcher.webp"; fi
done
"$BT/aapt2" compile --dir "$STAGE/res" -o "$STAGE/res.zip"
"$BT/aapt2" link \
  -o "$STAGE/base.apk" \
  -I "$PLATFORM" \
  --manifest android/AndroidManifest.xml \
  --version-code 1 --version-name 0.2.0 \
  "$STAGE/res.zip"

echo "== 3/5 add the native library =="
mkdir -p "$STAGE/lib/arm64-v8a"
cp "$SO" "$STAGE/lib/arm64-v8a/libgullyscore_app.so"
(cd "$STAGE" && zip -q -r base.apk lib)

echo "== 4/5 zipalign + sign =="
if [ ! -f android/debug.keystore ]; then
  keytool -genkeypair -keystore android/debug.keystore -alias androiddebugkey \
    -storepass android -keypass android -dname "CN=GullyScore Rust Debug,O=Debug,C=US" \
    -keyalg RSA -keysize 2048 -validity 10000 >/dev/null 2>&1
fi
"$BT/zipalign" -f 4 "$STAGE/base.apk" "$STAGE/aligned.apk"
"$BT/apksigner" sign --ks android/debug.keystore --ks-pass pass:android \
  --key-pass pass:android --out "$OUT" "$STAGE/aligned.apk"

echo "== 5/5 verify =="
"$BT/aapt" dump badging "$OUT" | head -6
unzip -l "$OUT" | grep -E "lib/|\.arsc|Manifest" || true
"$BT/apksigner" verify "$OUT" && echo "APK_SIGNATURE_OK"
echo "BUILT: $OUT ($(du -h "$OUT" | cut -f1))"
