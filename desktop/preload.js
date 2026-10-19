// Мост для веб-версии: смена значка окна и панели задач (Xitter Plus) и вход через Google.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('xitterDesktop', {
  setIcon: (pngDataURL) => ipcRenderer.send('set-icon', String(pngDataURL || '')),
  // вход через Google в системном браузере; возвращает id_token Google
  googleSignIn: () => ipcRenderer.invoke('google-sign-in'),
});
