# Xitter

Соцсеть и мессенджер в чёрно-белом стиле с анимациями как в iPhone. Лента с фото, лайками и комментариями, подписки, активность, личные чаты и группы с фото, голосовыми и эмодзи, «печатает…», «в сети», отметки о прочтении, светлая и тёмная тема, аудио- и видеозвонки.

Все данные и сообщения хранятся в **Firebase** (проект `xittererere`), поэтому Xitter работает через интернет откуда угодно, держать компьютер включённым не нужно.

## Скачать

Каждый push в `main` собирает всё заново через GitHub Actions. Готовые файлы лежат в **Releases → latest**:

| Файл | Что это |
|---|---|
| `Xitter.exe` | Windows, запускается без установки |
| `Xitter-Setup.exe` | Установщик для Windows (ярлык в меню «Пуск») |
| `Xitter.apk` | Android |
| `Xitter-unsigned.ipa` | iPhone, без подписи (см. ниже) |
| `Xitter-web.zip` | веб-версия, можно выложить на любой хостинг |
| `Xitter-server.zip` | сервер для своего компьютера, раздаёт веб-версию |

Веб-версия также публикуется на GitHub Pages, если Pages включены (Settings → Pages → Source: **GitHub Actions**).

## Один раз настроить Firebase

1. Откройте [консоль Firebase](https://console.firebase.google.com/project/xittererere/firestore) → **Firestore Database** → **Create database** (любой регион, режим production).
2. Вкладка **Rules** → вставьте содержимое файла [`firestore.rules`](firestore.rules) → **Publish**.
3. Вход по паролю (Authentication → Sign-in method → Email/Password) уже включён. Чтобы работали кнопки «Продолжить с Google» и «Продолжить с Apple», включите там же провайдеры **Google** и **Apple**. В приложениях для Android и iPhone эти кнопки скрыты, там вход по email.

Пока база не создана, вход работает, но пользователи не видят друг друга: профили, посты и сообщения просто некуда сохранить.

Чтобы GitHub Actions сам обновлял правила и публиковал сайт на `https://xittererere.web.app`:
Firebase → ⚙ Project settings → Service accounts → **Generate new private key**, затем в GitHub: Settings → Secrets and variables → Actions → **New repository secret** с именем `FIREBASE_SERVICE_ACCOUNT` и содержимым скачанного JSON.

## Plus, LUNE и админка

- **Владелец** — тот, кто входит через Google с адресом `cladecarvsna@gmail.com` (адрес записан в `firestore.rules` и `web/backend.js`). Он сразу становится админом и может назначать других админов.
- **Админ-панель** (Настройки → Админ-панель): число пользователей и админов, список юзеров, бан, ограничение (нельзя писать), галочка, выдача и списание LUNE, выдача и снятие Plus.
- **LUNE** — внутренняя валюта, её выдаёт админ. За 100 LUNE можно купить дополнительный юзернейм.
- **Xitter Plus**: баннер с эффектом, эмодзи у ника, обводка аватарки, шрифт ника, видео или GIF на аватарке, своя тема, смена иконки приложения, файлы до 50 МБ (без Plus до 20 МБ).
- Для всех: три темы (белая, чёрная, оранжевая), музыка в профиле, стикеры, файлы в чатах.

Баланс, Plus, баны и галочки защищены правилами Firestore: пользователь не может выдать их себе сам. **После обновления правил их нужно опубликовать**: Firebase Console → Firestore → Rules → вставить `firestore.rules` → Publish (или задать секрет `FIREBASE_SERVICE_ACCOUNT`, и CI будет публиковать сам).

Файлы хранятся в Firestore частями по ~1 МБ. На бесплатном тарифе Firebase это 1 ГБ на всё и 20 000 записей в день: файл в 50 МБ занимает около 70 записей.

## Android

Установите `Xitter.apk`, разрешив установку из неизвестных источников. Введите email и пароль от 6 символов: если аккаунта нет, он создастся, затем выберите имя и @username.

Чтобы обновления APK ставились поверх старой версии, все сборки должны подписываться одним ключом. Создайте его один раз:

```
keytool -genkeypair -keystore xitter.keystore -alias xitter -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 xitter.keystore
```

и добавьте в GitHub (Settings → Secrets and variables → Actions) секреты `ANDROID_KEYSTORE_BASE64` (вывод второй команды) и `ANDROID_KEYSTORE_PASSWORD` (пароль). Без них каждая сборка подписывается временным ключом.

## iPhone

Apple не даёт поставить приложение без подписи. Варианты:

- **Сайт как приложение:** откройте веб-версию в Safari → «Поделиться» → «На экран „Домой“».
- **IPA:** скачайте `Xitter-unsigned.ipa` и установите через [Sideloadly](https://sideloadly.io) или [AltStore](https://altstore.io) со своим Apple ID. С бесплатным Apple ID приложение нужно переподписывать раз в 7 дней.
- **Через Xcode на Mac:** `bash ios-build.sh open`, выберите свою команду в Signing & Capabilities и нажмите Run.

## Свой сервер

Нужен Node.js 22+. Распакуйте `Xitter-server.zip` и запустите `start-server.sh` (Linux/macOS) или `start-server.bat` (Windows). Веб-версия откроется на `http://localhost:3000`, а для звонков с других устройств в сети на `https://АДРЕС:3443`. Браузеры дают доступ к микрофону только по https; сертификат самоподписанный, поэтому нажмите «Дополнительно» → «Перейти».

## Через ngrok (в том числе с телефона в Termux)

`start-ngrok.sh` запускает сервер веб-версии и открывает к нему доступ из интернета по https-ссылке ngrok. По https в браузере работают микрофон и камера, поэтому звонки идут с любого устройства.

В Termux на Android:

```
pkg install -y unzip curl
curl -LO https://github.com/depressionwormkhronoshelp/xitter/releases/download/latest/Xitter-server.zip
unzip -o Xitter-server.zip -d xitter && cd xitter/Xitter-server
bash start-ngrok.sh
```

Скрипт сам поставит Node.js и ngrok и при первом запуске попросит authtoken со страницы https://dashboard.ngrok.com/get-started/your-authtoken. Токен хранится только в настройках ngrok на телефоне. Ссылка на сайт появится в строке **Forwarding**. Чтобы адрес не менялся при каждом запуске, возьмите бесплатный домен в панели ngrok (Domains) и запускайте так: `NGROK_DOMAIN=имя.ngrok-free.app bash start-ngrok.sh`.

На Linux тот же скрипт работает без изменений. Пока Termux открыт, сайт доступен; остановить его можно через Ctrl+C.

## Разработка

```
web/            интерфейс (HTML, CSS, JS без сборки)
web/backend.js  работа с Firebase: вход, Firestore, сигналинг звонков
web/vendor/     собранный Firebase JS SDK
server/         сервер веб-версии
android/        оболочка Android и скрипт сборки без Gradle
ios/            проект Capacitor для Xcode
firestore.rules правила безопасности базы
```

Звонки идут через WebRTC напрямую между устройствами, Firestore передаёт только служебные данные соединения. Если через мобильный интернет звонок не соединяется, нужен TURN-сервер: его можно указать в настройках браузера через `localStorage['xitter.turn']`.

Проверка на эмуляторах Firebase: `npx firebase-tools emulators:start --only auth,firestore`, затем в консоли браузера `localStorage['xitter.emu'] = '127.0.0.1'` и перезагрузить страницу.
