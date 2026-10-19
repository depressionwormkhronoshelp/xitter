// Xitter для Windows и Linux: окно Electron с веб-версией из папки web.
// Файлы отдаются по своему адресу app://xitter/, чтобы вход и данные сохранялись между запусками.
const { app, BrowserWindow, protocol, net, shell, session, ipcMain, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

const WEB = app.isPackaged ? path.join(process.resourcesPath, 'web') : path.join(__dirname, '..', 'web');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

if (!app.requestSingleInstanceLock()) app.quit();

// если видеодрайвер падал, со следующего запуска рисуем без видеокарты (Linux с проблемными драйверами)
const NO_GPU = path.join(app.getPath('userData'), 'no-gpu');
if (fs.existsSync(NO_GPU)) app.disableHardwareAcceleration();
app.on('child-process-gone', (_e, d) => {
  if (d.type === 'GPU' && d.reason !== 'clean-exit') try { fs.writeFileSync(NO_GPU, d.reason); } catch (e) { /* не страшно */ }
});

let win;
function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 380, minHeight: 600,
    title: 'Xitter', backgroundColor: '#ffffff', autoHideMenuBar: true,
    icon: path.join(WEB, 'icons', 'icon-512.png'),
    webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.js') },
  });
  win.webContents.setUserAgent(win.webContents.getUserAgent() + ' XitterApp');
  // внешние ссылки — в обычном браузере
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // упала страница — перезагружаем, а не оставляем пустое окно
  win.webContents.on('render-process-gone', (_e, d) => { if (d.reason !== 'clean-exit' && !win.isDestroyed()) win.reload(); });
  win.on('closed', () => { win = null; });
  win.loadURL('app://xitter/index.html');
}

// Вход через Google: Google не пускает входить во встроенном окне, поэтому страница входа открывается
// в обычном браузере, а токен возвращается сюда через одноразовый адрес 127.0.0.1 (как у десктопных OAuth-приложений)
const LOGIN_PAGE = 'https://x.lozhka.fun/desktop-login.html';
let pendingLogin = null;
ipcMain.handle('google-sign-in', (e) => {
  if (!win || e.sender !== win.webContents) throw new Error('Нет окна');
  if (pendingLogin) pendingLogin.cancel();
  return new Promise((resolve, reject) => {
    const state = crypto.randomBytes(16).toString('hex');
    const page = (text) => `<!doctype html><meta charset="utf-8"><title>Xitter</title><body style="font:18px system-ui;display:grid;place-items:center;height:90vh">${text}</body>`;
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1');
      if (u.pathname === '/ok') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(page('Готово, вернитесь в Xitter. Эту вкладку можно закрыть.')); return; }
      if (u.pathname !== '/done' || u.searchParams.get('state') !== state || !u.searchParams.get('id_token')) { res.writeHead(404); res.end(); return; }
      // перенаправление убирает токен из адреса и истории браузера
      res.writeHead(303, { Location: '/ok' }); res.end();
      finish(null, u.searchParams.get('id_token'));
    });
    const timer = setTimeout(() => finish(new Error('Время на вход вышло, попробуйте ещё раз')), 5 * 60e3);
    function finish(err, token) {
      if (!pendingLogin) return;
      pendingLogin = null;
      clearTimeout(timer);
      setTimeout(() => server.close(), 2000);
      if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
      err ? reject(err) : resolve(token);
    }
    pendingLogin = { cancel: () => finish(new Error('Вход отменён')) };
    server.listen(0, '127.0.0.1', () => {
      shell.openExternal(`${LOGIN_PAGE}?port=${server.address().port}&state=${state}`);
    });
    server.on('error', (err) => finish(err));
  });
});

// значок, выбранный в настройках Xitter Plus
ipcMain.on('set-icon', (e, url) => {
  if (!win || e.sender !== win.webContents || !/^data:image\/png;base64,/.test(url)) return;
  const img = nativeImage.createFromDataURL(url);
  if (!img.isEmpty()) win.setIcon(img);
});

// Linux AppImage: при каждом запуске кладём ярлык в меню приложений (~/.local/share/applications).
// Путь в ярлыке обновляется, если файл AppImage переместили
function linuxMenuEntry() {
  const image = process.env.APPIMAGE;
  if (process.platform !== 'linux' || !image) return;
  try {
    const share = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
    const iconDir = path.join(share, 'icons', 'hicolor', '512x512', 'apps');
    const appsDir = path.join(share, 'applications');
    fs.mkdirSync(iconDir, { recursive: true });
    fs.mkdirSync(appsDir, { recursive: true });
    fs.copyFileSync(path.join(WEB, 'icons', 'icon-512.png'), path.join(iconDir, 'xitter.png'));
    // если Xitter запустили с --no-sandbox, ярлык тоже запускает с ним
    const flags = process.argv.includes('--no-sandbox') ? ' --no-sandbox' : '';
    const entry = [
      '[Desktop Entry]', 'Type=Application', 'Name=Xitter', 'Comment=Мессенджер и лента',
      `Exec="${image.replace(/["`$\\]/g, (c) => (c === '\\' ? '\\\\\\\\' : '\\\\' + c)).replace(/%/g, '%%')}"${flags} %U`, 'Icon=xitter', 'Terminal=false',
      'Categories=Network;InstantMessaging;', 'StartupWMClass=Xitter', '',
    ].join('\n');
    const file = path.join(appsDir, 'xitter.desktop');
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== entry) fs.writeFileSync(file, entry);
  } catch (e) { /* без ярлыка приложение всё равно работает */ }
}

// повторный запуск показывает уже открытое окно, а если его нет — открывает новое
app.on('second-instance', () => {
  if (!win) { createWindow(); return; }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});

app.whenReady().then(() => {
  linuxMenuEntry();
  protocol.handle('app', (req) => {
    const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.normalize(path.join(WEB, rel));
    if (!file.startsWith(WEB)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  // камера, микрофон и уведомления для звонков
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(['media', 'notifications', 'clipboard-sanitized-write'].includes(perm)));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
