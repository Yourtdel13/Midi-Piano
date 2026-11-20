#!/usr/bin/env bash
# 下载构建所需的 android.jar 与 r8.jar 到 .deps/
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .deps

ANDROID_ZIP_URL="${ANDROID_ZIP_URL:-https://dl.google.com/android/repository/platform-34-ext12_r01.zip}"
R8_URL="${R8_URL:-https://dl.google.com/dl/android/maven2/com/android/tools/r8/8.5.35/r8-8.5.35.jar}"

if [ ! -f .deps/android.jar ]; then
  echo "==> 下载 Android platform 34"
  curl -fL "$ANDROID_ZIP_URL" -o .deps/platform.zip
  unzip -p .deps/platform.zip 'android-*/android.jar' > .deps/android.jar
  rm -f .deps/platform.zip
fi

if [ ! -f .deps/r8.jar ]; then
  echo "==> 下载 R8 8.5.35"
  curl -fL "$R8_URL" -o .deps/r8.jar
fi

ls -lh .deps/
