// Мост для веб-версии: смена значка окна и панели задач (Xitter Plus).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('xitterDesktop', {
  setIcon: (pngDataURL) => ipcRenderer.send('set-icon', String(pngDataURL || '')),
});
