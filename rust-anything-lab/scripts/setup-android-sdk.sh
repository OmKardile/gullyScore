#!/usr/bin/env bash
# rust-anything-lab — fetch the Android SDK + NDK INSIDE the lab (gitignored:
# android-sdk/). Everything self-contained; nothing installed system-wide.
# Requires: curl, unzip, java (for sdkmanager).
set -euo pipefail
cd "$(dirname "$0")/.."
SDK="$PWD/android-sdk"
mkdir -p "$SDK/cmdline-tools"

if [ ! -x "$SDK/cmdline-tools/latest/bin/sdkmanager" ]; then
  echo "fetching cmdline-tools..."
  curl -sL --retry 3 -o /tmp/clt.zip https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
  unzip -q -o /tmp/clt.zip -d "$SDK/cmdline-tools"
  rm -rf "$SDK/cmdline-tools/latest"
  mv "$SDK/cmdline-tools/cmdline-tools" "$SDK/cmdline-tools/latest"
  rm -f /tmp/clt.zip
fi

export ANDROID_HOME="$SDK"
yes | "$SDK/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$SDK" --licenses > /tmp/sdk-licenses.log 2>&1 || true

echo "installing platform-tools, android-34, build-tools 34.0.0, ndk 29..."
yes | "$SDK/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$SDK" \
  "platform-tools" "platforms;android-34" "build-tools;34.0.0" "ndk;29.0.14206865" > /tmp/sdk-install.log 2>&1

echo "ANDROID_SDK_READY"
ls "$SDK"
ls "$SDK/ndk" 2>/dev/null || true
