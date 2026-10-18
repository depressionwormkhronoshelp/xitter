#!/usr/bin/env bash
# Сборка Xitter.apk без Android Studio/Gradle: aapt2 + javac + dx + zipalign + apksigner.
# Нужны: JDK, aapt2, dalvik-exchange (dx), zipalign, apksigner и android.jar (API 34).
#   Ubuntu/Debian: sudo apt install aapt zipalign apksigner dalvik-exchange openjdk-17-jdk
#   android.jar:   https://raw.githubusercontent.com/Sable/android-platforms/master/android-34/android.jar
set -euo pipefail
cd "$(dirname "$0")"
ANDROID_JAR="${ANDROID_JAR:-./android-34.jar}"
[ -f "$ANDROID_JAR" ] || curl -fsSL -o "$ANDROID_JAR" https://raw.githubusercontent.com/Sable/android-platforms/master/android-34/android.jar
OUT=build
rm -rf "$OUT" && mkdir -p "$OUT"/{compiled,gen,classes,apk}

# 1. веб-интерфейс внутрь приложения
rm -rf assets && mkdir -p assets/www
cp -r ../web/. assets/www/
rm -rf assets/www/sw.js assets/www/download

# 2. ресурсы
aapt2 compile --dir res -o "$OUT/compiled/res.zip"
aapt2 link -o "$OUT/unsigned.apk" -I "$ANDROID_JAR" \
  --manifest AndroidManifest.xml -A assets --java "$OUT/gen" \
  --min-sdk-version 24 --target-sdk-version 34 --version-code 1 --version-name 1.0 \
  "$OUT/compiled/res.zip"

# 3. Java → dex
javac -source 8 -target 8 -bootclasspath "$ANDROID_JAR" -Xlint:-options -Xlint:-deprecation \
  -d "$OUT/classes" $(find src "$OUT/gen" -name '*.java')
dalvik-exchange --dex --min-sdk-version=24 --output="$OUT/apk/classes.dex" "$OUT/classes"
(cd "$OUT/apk" && zip -q -j ../unsigned.apk classes.dex)

# 4. выравнивание и подпись
zipalign -f -p 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"
# Ключ подписи: из секретов CI (ANDROID_KEYSTORE_BASE64 + ANDROID_KEYSTORE_PASSWORD),
# иначе локальный xitter.keystore (создаётся при первой сборке, в git не попадает).
export KS_PASS="${ANDROID_KEYSTORE_PASSWORD:-xitter-local}"
if [ -n "${ANDROID_KEYSTORE_BASE64:-}" ]; then
  echo "$ANDROID_KEYSTORE_BASE64" | base64 -d > "$OUT/release.keystore"
  KS="$OUT/release.keystore"
else
  KS=xitter.keystore
  if [ ! -f "$KS" ]; then
    keytool -genkeypair -keystore "$KS" -alias xitter -keyalg RSA -keysize 2048 -validity 10000 \
      -storepass "$KS_PASS" -keypass "$KS_PASS" -dname "CN=Xitter, O=Xitter, C=RU" >/dev/null 2>&1
  fi
fi
mkdir -p ../dist
apksigner sign --ks "$KS" --ks-pass env:KS_PASS --key-pass env:KS_PASS \
  --min-sdk-version 24 --out ../dist/Xitter.apk "$OUT/aligned.apk"
apksigner verify --print-certs ../dist/Xitter.apk | head -1
echo "Готово: dist/Xitter.apk"
