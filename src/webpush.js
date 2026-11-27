/*
 * Avisos push en el navegador (web): Firebase Cloud Messaging con el service worker /sw.js.
 * Se activan desde el menú de usuario (el navegador pide permiso). El token se guarda en el
 * dispositivo de la cuenta (register_device), igual que en la app de Android.
 * Las apps (Android y Windows) tienen sus propios avisos: aquí no se usa.
 */
import { FIREBASE_WEB, VAPID_KEY } from './config.js';

export const webPushSupported = () =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && !window.chamuflacDesktop && window.isSecureContext;
export const webPushState = () => (!webPushSupported() ? 'unsupported' : Notification.permission); // granted / denied / default

let messaging = null;
async function fcm() {
  if (messaging) return messaging;
  const [{ initializeApp }, m] = await Promise.all([import('firebase/app'), import('firebase/messaging')]);
  messaging = { m, inst: m.getMessaging(initializeApp(FIREBASE_WEB)) };
  return messaging;
}
/** Token de avisos de este navegador (null si no hay permiso). ask: pedir permiso si aún no se dio. */
export async function webPushToken({ ask = false } = {}) {
  if (!webPushSupported() || Notification.permission === 'denied') return null;
  if (Notification.permission !== 'granted') {
    if (!ask || (await Notification.requestPermission()) !== 'granted') return null;
  }
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    const { m, inst } = await fcm();
    return (await m.getToken(inst, { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg })) || null;
  } catch (e) {
    console.warn('Avisos web:', e);
    return null;
  }
}
/** Deja de recibir avisos en este navegador. */
export async function webPushOff() {
  try { const { m, inst } = await fcm(); await m.deleteToken(inst); } catch { /* nada */ }
}
/** Al tocar un aviso: fn(data) con { kind, from, id, nick }. */
export function onWebPushTap(fn) {
  navigator.serviceWorker?.addEventListener('message', (e) => { if (e.data?.type === 'chamuflac-push') fn(e.data.data || {}); });
  const m = location.hash.match(/^#aviso=(.+)$/);
  if (m) {
    history.replaceState(null, '', location.pathname);
    try { fn(JSON.parse(decodeURIComponent(m[1]))); } catch { /* nada */ }
  }
}
