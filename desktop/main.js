// Xitter для Windows: окно Electron с веб-версией из папки web.
// Файлы отдаются по своему адресу app://xitter/, чтобы вход и данные сохранялись между запусками.
const { app, BrowserWindow, protocol, net, shell, session, ipcMain, nativeImage } = require('electron');
const path = require('path');
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

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

app.whenReady().then(() => {
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
