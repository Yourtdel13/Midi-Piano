#!/usr/bin/env bash
# 不依赖 Gradle 的极简 Android 构建脚本（aapt + javac + d8 + apksigner）
set -euo pipefail
cd "$(dirname "$0")"

APP=app
BUILD=build
SDK="${ANDROID_JAR:-.deps/android.jar}"
R8JAR="${R8_JAR:-.deps/r8.jar}"
KS_PASS="${KS_PASS:-android}"
KEYSTORE="${KEYSTORE:-debug.keystore}"
OUT="${OUT:-$BUILD/MidiPiano.apk}"

for f in "$SDK" "$R8JAR"; do
  [ -f "$f" ] || { echo "缺少依赖：$f；先运行 scripts/fetch-deps.sh 或设置 ANDROID_JAR / R8_JAR" >&2; exit 1; }
done

rm -rf "$BUILD"
mkdir -p "$BUILD/classes" "$BUILD/dex"

echo "==> javac"
javac --release 11 -encoding UTF-8 -classpath "$SDK" -d "$BUILD/classes" \
  $(find "$APP/src" -name '*.java' -print)

echo "==> d8"
java -cp "$R8JAR" com.android.tools.r8.D8 --release --lib "$SDK" --min-api 24 \
  --output "$BUILD/dex" $(find "$BUILD/classes" -name '*.class' -print)

echo "==> aapt"
aapt package -f \
  -M "$APP/AndroidManifest.xml" \
  -S "$APP/res" \
  -A "$APP/assets" \
  -I "$SDK" \
  -F "$BUILD/unsigned.apk"

echo "==> 加入 classes.dex"
( cd "$BUILD" && zip -q -j unsigned.apk dex/classes.dex )

echo "==> zipalign"
zipalign -f 4 "$BUILD/unsigned.apk" "$BUILD/aligned.apk"

if [ ! -f "$KEYSTORE" ]; then
  echo "==> 生成调试签名"
  keytool -genkeypair -keystore "$KEYSTORE" -storepass "$KS_PASS" -keypass "$KS_PASS" \
    -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=Android Debug,O=Android,C=US" >/dev/null
fi

echo "==> apksigner"
apksigner sign --ks "$KEYSTORE" --ks-pass pass:$KS_PASS --key-pass pass:$KS_PASS \
  --out "$OUT" "$BUILD/aligned.apk"

apksigner verify --verbose "$OUT" | head -8
echo "==> 结果"
aapt dump badging "$OUT" | head -4
ls -lh "$OUT"
