/*
 * ChamuFlac — service worker de los avisos push del navegador.
 * Recibe los avisos de Firebase Cloud Messaging (sin cargar Firebase aquí) y los muestra.
 * El aviso nunca lleva el texto del mensaje: solo quién escribe (los mensajes van cifrados).
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let p = {};
  try { p = e.data ? e.data.json() : {}; } catch { /* aviso vacío */ }
  const n = p.notification || {};
  const d = p.data || {};
  e.waitUntil((async () => {
    // Con ChamuFlac a la vista no hace falta: el mensaje ya aparece en pantalla
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (d.kind !== 'call' && list.some((c) => c.visibilityState === 'visible' && c.focused)) return;
    await self.registration.showNotification(n.title || 'ChamuFlac', {
      body: n.body || '',
      icon: '/favicon.svg',
      tag: d.kind === 'group' ? 'group-' + d.id : 'from-' + (d.from || ''),
      renotify: true,
      requireInteraction: d.kind === 'call',
      data: d,
    });
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const d = e.notification.data || {};
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const c = list.find((x) => new URL(x.url).origin === self.location.origin);
    if (c) { await c.focus(); c.postMessage({ type: 'chamuflac-push', data: d }); return; }
    await self.clients.openWindow('/#aviso=' + encodeURIComponent(JSON.stringify(d)));
  })());
});
