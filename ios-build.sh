#!/usr/bin/env bash
# Сборка Xitter для iOS. Запускать на Mac с установленным Xcode.
#   bash ios-build.sh          — собрать неподписанный dist/Xitter-unsigned.ipa
#   bash ios-build.sh open     — открыть проект в Xcode (запуск на iPhone, Archive → .ipa)
set -euo pipefail
cd "$(dirname "$0")"
npm install
npx cap sync ios

if [ "${1:-}" = "open" ]; then
  npx cap open ios
  exit 0
fi

xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release \
  -sdk iphoneos -destination 'generic/platform=iOS' -derivedDataPath build/ios \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" build

rm -rf build/Payload && mkdir -p build/Payload dist
cp -R build/ios/Build/Products/Release-iphoneos/App.app build/Payload/
(cd build && rm -f ../dist/Xitter-unsigned.ipa && zip -qry ../dist/Xitter-unsigned.ipa Payload)
echo "Готово: dist/Xitter-unsigned.ipa"
echo "Установить на iPhone: Sideloadly или AltStore (подпишут вашим Apple ID)."
