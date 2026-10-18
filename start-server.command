#!/usr/bin/env bash
# Запуск сервера Xitter на macOS / Linux
cd "$(dirname "$0")/server"
if ! command -v node >/dev/null 2>&1; then
  echo "Не найден Node.js. Установите его: https://nodejs.org (или sudo apt install nodejs)"
  exit 1
fi
if [ ! -d node_modules/ws ]; then
  if command -v npm >/dev/null 2>&1; then
    npm install
  else
    echo "Нет папки server/node_modules и не найден npm."
    echo "Установите npm: sudo apt install npm  (Fedora: sudo dnf install nodejs-npm, Arch: sudo pacman -S npm)"
    exit 1
  fi
fi
exec node server.js
