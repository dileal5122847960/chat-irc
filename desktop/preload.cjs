// Puente mínimo entre la app (web) y Windows. La app lo detecta como window.chamuflacDesktop
// (src/app/native.js). Solo expone estas funciones: la página no tiene acceso a Node.
const { contextBridge, ipcRenderer } = require('electron');

let urlHandler = null;
const queued = [];
ipcRenderer.on('chamuflac:url', (_e, url) => (urlHandler ? urlHandler(url) : queued.push(url)));

contextBridge.exposeInMainWorld('chamuflacDesktop', {
  platform: 'windows',
  hostname: (process.argv.find((a) => a.startsWith('--chamuflac-host=')) || '').slice(17) || 'PC',
  openExternal: (url) => ipcRenderer.invoke('chamuflac:open-external', String(url)),
  focus: () => ipcRenderer.invoke('chamuflac:focus'),
  attention: () => ipcRenderer.invoke('chamuflac:attention'),
  installUpdate: (url) => ipcRenderer.invoke('chamuflac:install-update', String(url)),
  onUrl: (fn) => { urlHandler = fn; queued.splice(0).forEach(fn); },
});
