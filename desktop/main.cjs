/*
 * ChamuFlac para Windows (Electron)
 * ──────────────────────────────────
 * Envuelve la misma app que Android (src/app/, compilada en web/). Lo propio de Windows:
 * • Se sirve como https://localhost (igual que la app de Android): así la reconocen las
 *   funciones de Supabase (turn, push) sin cambiarlas.
 * • Al cerrar la ventana sigue en la bandeja del sistema (junto al reloj) recibiendo mensajes
 *   y llamadas, como las apps de mensajería. Arranca con Windows (minimizada).
 * • Avisos nativos de Windows (los crea la app con la API Notification).
 * • Vuelta del acceso con Google: enlace com.chamuflac.app://auth (protocolo registrado).
 * • Actualización: la app consulta app_versions; si hay versión nueva, descarga el instalador
 *   y lo ejecuta en silencio; al terminar, ChamuFlac se abre de nuevo.
 */
const { app, BrowserWindow, Tray, Menu, shell, ipcMain, protocol, net, session, nativeImage, desktopCapturer } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const WEB_DIR = path.join(__dirname, 'web');
const ORIGIN = 'https://localhost';
const SCHEME = 'com.chamuflac.app';
const ICON = path.join(__dirname, 'icon.png');
const ALLOWED_DOWNLOAD = /^https:\/\/github\.com\/dileal5122847960\/chat-irc\/releases\/download\/windows-v[\d.]+\/[\w.-]+\.exe$/;

let win = null;
let tray = null;
let quitting = false;
let pendingUrl = null;
const startHidden = process.argv.includes('--hidden');

// Una sola instancia: si se abre otra (o llega un enlace com.chamuflac.app://), se avisa a la primera
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (_e, argv) => {
    const url = argv.find((a) => a.startsWith(SCHEME + '://'));
    if (url) sendUrl(url);
    show();
  });
}
if (process.defaultApp) app.setAsDefaultProtocolClient(SCHEME, process.execPath, [path.resolve(process.argv[1])]);
else app.setAsDefaultProtocolClient(SCHEME);
app.setAppUserModelId('com.chamuflac.app'); // necesario para los avisos de Windows

function sendUrl(url) {
  if (win && !win.webContents.isLoading()) win.webContents.send('chamuflac:url', url);
  else pendingUrl = url;
}

function show() {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow() {
  win = new BrowserWindow({
    width: 440, height: 800, minWidth: 360, minHeight: 560,
    title: 'ChamuFlac', icon: ICON, backgroundColor: '#111318', show: false, autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      backgroundThrottling: false, // en la bandeja sigue recibiendo mensajes y llamadas
      additionalArguments: ['--chamuflac-host=' + os.hostname().slice(0, 40)],
    },
  });
  win.removeMenu();
  win.loadURL(ORIGIN + '/index.html');
  win.once('ready-to-show', () => { if (!startHidden) win.show(); });
  win.webContents.on('did-finish-load', () => { if (pendingUrl) { win.webContents.send('chamuflac:url', pendingUrl); pendingUrl = null; } });
  // Los enlaces externos se abren en el navegador
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(ORIGIN)) { e.preventDefault(); shell.openExternal(url); } });
  // Cerrar la ventana = seguir en segundo plano (como las apps de mensajería)
  let warned = false;
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
    if (!warned && tray) { warned = true; tray.displayBalloon?.({ iconType: 'info', title: 'ChamuFlac', content: 'Sigue funcionando en segundo plano. Para salir, usa el icono junto al reloj.' }); }
  });
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  tray.setToolTip('ChamuFlac');
  const openAtLogin = () => app.getLoginItemSettings().openAtLogin;
  const rebuild = () => tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir ChamuFlac', click: show },
    { label: 'Iniciar con Windows', type: 'checkbox', checked: openAtLogin(), click: (i) => { app.setLoginItemSettings({ openAtLogin: i.checked, args: ['--hidden'] }); rebuild(); } },
    { type: 'separator' },
    { label: 'Salir', click: () => { quitting = true; app.quit(); } },
  ]));
  rebuild();
  tray.on('click', show);
}

/** Descarga el instalador nuevo y lo ejecuta en silencio; al terminar vuelve a abrir ChamuFlac. */
async function installUpdate(url) {
  if (!ALLOWED_DOWNLOAD.test(url)) throw new Error('Dirección de actualización no válida');
  const res = await net.fetch(url);
  if (!res.ok) throw new Error('Descarga fallida: ' + res.status);
  const file = path.join(os.tmpdir(), 'ChamuFlac-Setup-' + Date.now() + '.exe');
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  spawn(file, ['/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
  quitting = true;
  setTimeout(() => app.quit(), 500);
}

app.whenReady().then(() => {
  // https://localhost → archivos de la app (el resto de https pasa sin tocar)
  protocol.handle('https', (req) => {
    const u = new URL(req.url);
    if (u.host !== 'localhost') return net.fetch(req, { bypassCustomProtocolHandlers: true });
    const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.normalize(path.join(WEB_DIR, rel));
    if (!file.startsWith(WEB_DIR)) return new Response('', { status: 403 });
    return net.fetch(pathToFileURL(fs.existsSync(file) ? file : path.join(WEB_DIR, 'index.html')).toString());
  });
  // Permisos: cámara/micrófono (llamadas, notas de voz), avisos y portapapeles para la app
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb, details) => {
    const ours = (details.requestingUrl || wc.getURL()).startsWith(ORIGIN);
    cb(ours && ['media', 'notifications', 'clipboard-sanitized-write', 'clipboard-read', 'fullscreen'].includes(perm));
  });
  session.defaultSession.setPermissionCheckHandler((wc, perm, origin) => origin?.startsWith(ORIGIN) && ['media', 'notifications', 'clipboard-sanitized-write'].includes(perm));

  // Compartir pantalla en llamadas: se comparte la pantalla principal
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => callback(sources[0] ? { video: sources[0] } : {})).catch(() => callback({}));
  });
  ipcMain.handle('chamuflac:open-external', (_e, url) => { if (/^https:\/\//.test(url)) return shell.openExternal(url); });
  ipcMain.handle('chamuflac:focus', () => show());
  ipcMain.handle('chamuflac:attention', () => { if (win && !win.isFocused()) win.flashFrame(true); });
  ipcMain.handle('chamuflac:install-update', (_e, url) => installUpdate(url));

  // La primera vez, ChamuFlac se inicia con Windows (se puede quitar desde el icono de la bandeja)
  const flag = path.join(app.getPath('userData'), '.login-item');
  if (!fs.existsSync(flag)) { app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] }); fs.writeFileSync(flag, '1'); }

  createTray();
  createWindow();
  const url = process.argv.find((a) => a.startsWith(SCHEME + '://'));
  if (url) pendingUrl = url;
});
app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => { /* sigue en la bandeja */ });
