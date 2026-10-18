#!/usr/bin/env bash
# Xitter через ngrok: запускает сервер веб-версии и даёт на него публичную https-ссылку.
# Работает в Termux на Android и в обычном Linux.
#   bash start-ngrok.sh                      — случайный адрес *.ngrok-free.app
#   NGROK_DOMAIN=имя.ngrok-free.app bash start-ngrok.sh — ваш бесплатный постоянный домен из панели ngrok
set -e
cd "$(dirname "$0")"
ROOT="$(pwd)"
PORT="${PORT:-3000}"

TERMUX=""
case "${PREFIX:-}" in *com.termux*) TERMUX=1 ;; esac

if [ -n "$TERMUX" ]; then
  # node — сервер, proot и resolv-conf — чтобы ngrok видел DNS внутри Termux
  NEED=""
  command -v node >/dev/null 2>&1 || NEED="$NEED nodejs"
  command -v termux-chroot >/dev/null 2>&1 || NEED="$NEED proot"
  command -v curl >/dev/null 2>&1 || NEED="$NEED curl"
  [ -f "$PREFIX/etc/resolv.conf" ] || NEED="$NEED resolv-conf"
  if [ -n "$NEED" ]; then pkg install -y $NEED; fi
  BIN="$PREFIX/bin"
else
  command -v node >/dev/null 2>&1 || { echo "Нужен Node.js: sudo apt install nodejs"; exit 1; }
  BIN="$HOME/.local/bin"
  mkdir -p "$BIN"
  export PATH="$BIN:$PATH"
fi

# ngrok ставим один раз
if ! command -v ngrok >/dev/null 2>&1; then
  case "$(uname -m)" in
    aarch64|arm64) ARCH=arm64 ;;
    armv7l|armv8l|arm*) ARCH=arm ;;
    x86_64|amd64) ARCH=amd64 ;;
    i?86) ARCH=386 ;;
    *) echo "Неизвестная архитектура $(uname -m)"; exit 1 ;;
  esac
  echo "Скачиваю ngrok ($ARCH)…"
  curl -fsSL "https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-$ARCH.tgz" | tar xz -C "$BIN" ngrok
  chmod +x "$BIN/ngrok"
fi

NG=(ngrok)
[ -n "$TERMUX" ] && NG=(termux-chroot ngrok)

# Токен вводится только здесь и хранится в настройках ngrok на этом устройстве
if ! grep -qs authtoken "$HOME/.config/ngrok/ngrok.yml"; then
  echo "Нужен authtoken ngrok: https://dashboard.ngrok.com/get-started/your-authtoken"
  read -rsp "Вставьте authtoken (символы не отображаются): " TOKEN; echo
  "${NG[@]}" config add-authtoken "$TOKEN" >/dev/null
  unset TOKEN
  echo "Токен сохранён."
fi

# Сервер веб-версии в фоне
[ -n "$TERMUX" ] && command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock
cd "$ROOT/server"
PORT="$PORT" node server.js > "$ROOT/server.log" 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
for _ in $(seq 1 20); do curl -fs -o /dev/null "http://127.0.0.1:$PORT/" && break; sleep 0.5; done
echo "Сервер Xitter работает на порту $PORT"

# Публичная ссылка: строка «Forwarding» в окне ngrok. Ctrl+C останавливает всё.
ARGS=(http "$PORT")
[ -n "${NGROK_DOMAIN:-}" ] && ARGS+=(--url "$NGROK_DOMAIN")
"${NG[@]}" "${ARGS[@]}"
