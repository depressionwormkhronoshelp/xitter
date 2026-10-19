// Xitter для Windows и Linux: окно Electron с веб-версией из папки web.
// Файлы отдаются по своему адресу app://xitter/, чтобы вход и данные сохранялись между запусками.
const { app, BrowserWindow, protocol, net, shell, session, ipcMain, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');

const WEB = app.isPackaged ? path.join(process.resourcesPath, 'web') : path.join(__dirname, '..', 'web');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

if (!app.requestSingleInstanceLock()) app.quit();

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
  win.loadURL('app://xitter/index.html');
}

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

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

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
