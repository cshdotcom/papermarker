#!/bin/bash
# PaperMarker Android 桥接应用构建脚本（无 Gradle）
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
export JAVA_HOME=/home/z/android-tools/jdk-21.0.13+9
export PATH=$JAVA_HOME/bin:$PATH
TOOLS=/home/z/android-tools
BT=$TOOLS/android-14
AJAR=$TOOLS/android-34/android.jar
OUT=$DIR/build
rm -rf "$OUT"
mkdir -p "$OUT/classes" "$OUT/gen"

echo "[1/6] 生成最小资源"
mkdir -p "$OUT/res/values"
cat > "$OUT/res/values/strings.xml" << 'EOF'
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">PaperMarker 桥接</string>
</resources>
EOF
cat > "$OUT/res/values/styles.xml" << 'EOF'
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="AppTheme" parent="@android:style/Theme.DeviceDefault.Light.NoActionBar"></style>
</resources>
EOF

echo "[2/6] aapt2 link 生成 R.java + base.apk"
"$BT/aapt2" link -o "$OUT/base.apk" -I "$AJAR" \
  --manifest "$DIR/AndroidManifest.xml" \
  --java "$OUT/gen" \
  --min-sdk-version 26 --target-sdk-version 34 \
  --version-code 1 --version-name "1.0" \
  "$OUT/res/values/strings.xml" "$OUT/res/values/styles.xml"

echo "[3/6] javac 编译"
find "$DIR/src" "$OUT/gen" -name "*.java" > "$OUT/sources.txt"
javac -source 8 -target 8 -nowarn -encoding UTF-8 \
  -bootclasspath "$AJAR" -classpath "$AJAR" \
  -d "$OUT/classes" @"$OUT/sources.txt" 2> "$OUT/javac_warn.txt" || { cat "$OUT/javac_warn.txt"; exit 1; }

echo "[4/6] d8 打包 dex"
"$BT/d8" --lib "$AJAR" --output "$OUT/dex.zip" \
  $(find "$OUT/classes" -name "*.class")

echo "[5/6] 合并 APK"
cp "$OUT/base.apk" "$OUT/unsigned.apk"
cd "$OUT" && zip -j unsigned.apk classes.dex && cd "$DIR"

echo "[6/6] zipalign + 签名"
"$BT/zipalign" -f 4 "$OUT/unsigned.apk" "$DIR/PaperMarker-Bridge.apk"
"$BT/apksigner" sign --ks "$DIR/../android-app/papermarker.keystore" \
  --ks-pass pass:papermarker --ks-key-alias papermarker \
  --key-pass pass:papermarker \
  "$DIR/PaperMarker-Bridge.apk"

echo ""
echo "✓ 构建完成：$DIR/PaperMarker-Bridge.apk"
ls -lh "$DIR/PaperMarker-Bridge.apk"
