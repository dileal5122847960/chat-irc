/*
 * Funciones propias de cada sistema. Todo lo demás de la app es común.
 * • Android/iOS: Capacitor. • Windows: Electron (puente `window.chamuflacDesktop`, desktop/preload.cjs).
 * • En el navegador (pruebas) no hacen nada.
 * • Avisos push (Firebase): token del dispositivo, canales de aviso, toques en avisos.
 * • Avisos locales: mensajes y llamadas que llegan con la app en segundo plano.
 * • Navegador del sistema: acceso con Google y descarga de actualizaciones.
 * • Pantalla de inicio nativa (splash) y estado de la app (primer plano / segundo plano).
 */
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { SplashScreen } from '@capacitor/splash-screen';
import { PushNotifications } from '@capacitor/push-notifications';
import { LocalNotifications } from '@capacitor/local-notifications';
import { playTone } from '../common.js';
import { Share } from '@capacitor/share';
import { Filesystem, Directory } from '@capacitor/filesystem';

export const isNative = Capacitor.isNativePlatform();
const desktop = typeof window !== 'undefined' ? window.chamuflacDesktop : null; // app de Windows (Electron)
export const isDesktop = !!desktop;
export const isApp = isNative || isDesktop; // app instalada (no navegador)
export const platform = isDesktop ? desktop.platform : isNative ? Capacitor.getPlatform() : 'android'; // en pruebas, como Android
// La compilación activa los avisos push solo si tiene la configuración de Firebase
export const pushEnabled = isNative && typeof __PUSH_ENABLED__ !== 'undefined' && __PUSH_ENABLED__;
export const AUTH_REDIRECT = 'com.chamuflac.app://auth';

let foreground = true;
export const isForeground = () => foreground && !document.hidden && (!isDesktop || document.hasFocus());

export async function hideSplash() {
  if (isNative) try { await SplashScreen.hide({ fadeOutDuration: 250 }); } catch { /* nada */ }
}

/** Abre una dirección en el navegador del sistema (Google, descargas). */
export async function openExternal(url) {
  if (isDesktop) return desktop.openExternal(url);
  if (isNative) return Browser.open({ url, presentationStyle: 'fullscreen' });
  window.open(url, '_blank', 'noopener');
}
export async function closeExternal() {
  if (isDesktop) return desktop.focus(); // vuelve la ventana de la app al frente
  if (isNative) try { await Browser.close(); } catch { /* nada */ }
}
/** Instala una versión nueva. Windows: la descarga y la instala sola. Android: abre la descarga del APK. */
export async function installUpdate(url) {
  if (isDesktop) return desktop.installUpdate(url);
  return openExternal(url);
}

/**
 * Eventos de la app.
 * onUrl(url): la app se abrió desde un enlace (vuelta del acceso con Google).
 * onResume(): la app vuelve al primer plano.
 */
export function initAppEvents({ onUrl, onResume, onBack }) {
  if (isDesktop) {
    desktop.onUrl((url) => onUrl?.(url)); // vuelta del acceso con Google (com.chamuflac.app://auth)
    const resume = () => { if (!document.hidden) onResume?.(); };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('focus', resume);
    return;
  }
  if (!isNative) {
    document.addEventListener('visibilitychange', () => { if (!document.hidden) onResume?.(); });
    return;
  }
  App.addListener('appUrlOpen', ({ url }) => onUrl?.(url));
  App.addListener('appStateChange', ({ isActive }) => {
    foreground = isActive;
    if (isActive) onResume?.();
  });
  App.addListener('backButton', () => { if (!onBack?.()) App.minimizeApp(); }); // como WhatsApp: atrás en la portada = a segundo plano
  App.getLaunchUrl().then((r) => r?.url && onUrl?.(r.url)).catch(() => {});
}

/** Nombre legible del dispositivo para la lista de dispositivos de la cuenta. */
export function deviceName() {
  if (isDesktop) return ('Windows · ' + (desktop.hostname || 'PC')).slice(0, 60);
  const ua = navigator.userAgent;
  const m = ua.match(/Android [\d.]+; ([^;)]+)/);
  return (m ? m[1].replace(/ Build.*/, '') : 'Android').slice(0, 60);
}

/**
 * Avisos push. onToken(token) al registrarse; onTap(data) al tocar un aviso
 * (data: { kind: 'dm'|'call'|'friend', id, from, nick, video }).
 */
export async function initPush({ onToken, onTap }) {
  if (!pushEnabled) return false;
  try {
    await PushNotifications.createChannel({ id: 'messages', name: 'Mensajes', description: 'Mensajes y solicitudes', importance: 4, visibility: 0, vibration: true });
    await PushNotifications.createChannel({ id: 'calls', name: 'Llamadas', description: 'Llamadas entrantes', importance: 5, visibility: 0, vibration: true });
    PushNotifications.addListener('registration', ({ value }) => onToken?.(value));
    PushNotifications.addListener('registrationError', (e) => console.warn('push', e));
    PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => onTap?.(notification?.data || {}));
    // Con la app abierta el aviso no se muestra: la bandeja en tiempo real ya lo recibió
    PushNotifications.addListener('pushNotificationReceived', () => {});
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') perm = await PushNotifications.requestPermissions();
    if (perm.receive !== 'granted') return false;
    await PushNotifications.register();
    return true;
  } catch (e) {
    console.warn('push', e);
    return false;
  }
}

/** Avisos locales (mensajes y llamadas con la app en segundo plano). */
let localReady = null;
export function initLocal({ onTap }) {
  if (isDesktop) { desktopTap = onTap; localReady = Promise.resolve(Notification.permission !== 'denied'); return; }
  if (!isNative) return;
  localReady = (async () => {
    try {
      await LocalNotifications.createChannel({ id: 'messages', name: 'Mensajes', importance: 4, visibility: 0, vibration: true });
      await LocalNotifications.createChannel({ id: 'calls', name: 'Llamadas', importance: 5, visibility: 0, vibration: true });
      LocalNotifications.addListener('localNotificationActionPerformed', ({ notification }) => onTap?.(notification?.extra || {}));
      let perm = await LocalNotifications.checkPermissions();
      if (perm.display !== 'granted') perm = await LocalNotifications.requestPermissions();
      return perm.display === 'granted';
    } catch { return false; }
  })();
}
let notifSeq = 1;
const notifByPeer = new Map();
let desktopTap = null;
const desktopNotifs = new Map(); // persona → aviso de Windows abierto
export async function notify({ title, body, peer, call = false, extra = {} }) {
  if (isDesktop) {
    // Aviso de Windows; al hacer clic, la app vuelve al frente y abre la conversación
    try {
      desktopNotifs.get(peer)?.close();
      // Aviso silencioso: suena el tono que eligió la persona (las llamadas ya suenan con su tono)
      const n = new Notification(title, { body, tag: 'from-' + peer, requireInteraction: call, silent: true });
      if (!call) playTone('msg');
      n.onclick = () => { desktop.focus(); desktopTap?.({ from: peer, ...extra }); n.close(); };
      desktopNotifs.set(peer, n);
      desktop.attention(); // parpadea en la barra de tareas
    } catch { /* nada */ }
    return;
  }
  if (!isNative || !(await localReady)) return;
  const id = notifByPeer.get(peer) || ((notifSeq = (notifSeq % 100000) + 1));
  notifByPeer.set(peer, id); // un aviso por persona: el nuevo reemplaza al anterior
  try {
    await LocalNotifications.schedule({ notifications: [{ id, title, body, channelId: call ? 'calls' : 'messages', extra: { from: peer, ...extra }, autoCancel: true }] });
  } catch { /* nada */ }
}
export async function clearNotifications(peer) {
  if (isDesktop) { if (peer) { desktopNotifs.get(peer)?.close(); desktopNotifs.delete(peer); } else { desktopNotifs.forEach((n) => n.close()); desktopNotifs.clear(); } return; }
  if (!isNative) return;
  const id = notifByPeer.get(peer);
  try {
    if (id) await LocalNotifications.cancel({ notifications: [{ id }] });
    if (!peer && pushEnabled) await PushNotifications.removeAllDeliveredNotifications();
  } catch { /* nada */ }
}

/* ---------------- Compartir y guardar archivos del chat ---------------- */
const toBase64 = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });
const safeName = (n) => String(n || 'archivo').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120);
/** ¿Se puede compartir a otras apps (correo, mensajería…)? */
export function canShareFiles() {
  if (isNative) return true;
  try { return !!navigator.canShare && navigator.canShare({ files: [new File(['x'], 'x.txt', { type: 'text/plain' })] }); } catch { return false; }
}
/** Abre el menú del sistema para enviar el archivo por correo, otra app de mensajería, Drive… */
export async function shareFile(file) {
  if (isNative) {
    const w = await Filesystem.writeFile({ path: 'compartir/' + safeName(file.name), data: await toBase64(file), directory: Directory.Cache, recursive: true });
    return Share.share({ title: file.name, files: [w.uri], dialogTitle: file.name });
  }
  if (canShareFiles() && navigator.canShare({ files: [file] })) return navigator.share({ files: [file], title: file.name });
  return saveFile(file);
}
/** Guarda el archivo. Android: carpeta Documentos/ChamuFlac. Windows y navegador: descarga (elige dónde). */
export async function saveFile(file) {
  if (isNative) {
    try {
      await Filesystem.writeFile({ path: 'ChamuFlac/' + Date.now() + '-' + safeName(file.name), data: await toBase64(file), directory: Directory.Documents, recursive: true });
      return 'Documentos/ChamuFlac';
    } catch { return shareFile(file); } // sin permiso de almacenamiento: se ofrece compartir (p. ej. «Guardar en Drive/Archivos»)
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  return null;
}
