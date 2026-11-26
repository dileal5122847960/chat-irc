/*
 * Actualizaciones automáticas de la web
 * ──────────────────────────────────────
 * • /version.json lo genera cada compilación: si su "build" no coincide con el de esta
 *   pestaña, hay un despliegue nuevo → se ofrece actualizar.
 * • check_app_version('web', versión) en la base de datos dice si la actualización es
 *   OBLIGATORIA (versión por debajo de min_version) → se recarga sola (esperando a que
 *   termine una llamada si la hay).
 * Las apps de móvil y Windows usarán la misma función con su plataforma.
 */
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
const BUILD_ID = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev';
const CHECK_EVERY = 10 * 60 * 1000;

export function startVersionCheck({ supabase, t, isBusy }) {
  let shown = null; // 'available' | 'required'
  let lastCheck = 0;

  async function check() {
    if (Date.now() - lastCheck < 30 * 1000) return;
    lastCheck = Date.now();
    let required = false, latest = null, notes = '';
    try {
      const { data } = await supabase.rpc('check_app_version', { p_platform: 'web', p_version: APP_VERSION });
      const r = Array.isArray(data) ? data[0] : data;
      if (r) { required = r.status === 'required'; latest = r.latest_version; notes = r.notes || ''; }
    } catch { /* sin conexión */ }
    let newBuild = false;
    try {
      const res = await fetch('/version.json?ts=' + Date.now(), { cache: 'no-store' });
      if (res.ok) { const v = await res.json(); newBuild = !!v.build && v.build !== BUILD_ID && BUILD_ID !== 'dev'; latest ||= v.version; }
    } catch { /* sin conexión o en desarrollo */ }
    if (required) return show('required', latest, notes);
    if (newBuild) return show('available', latest, notes);
  }

  function reloadFresh() {
    const url = new URL(location.href);
    url.searchParams.set('v', Date.now().toString(36));
    location.replace(url.toString());
  }

  function show(kind, latest, notes) {
    if (shown === 'required' || shown === kind) return;
    shown = kind;
    document.getElementById('update-bar')?.remove();
    const bar = document.createElement('div');
    bar.id = 'update-bar';
    bar.className = 'update-bar ' + kind;
    const ver = latest ? ` <b class="ugc">v${latest}</b>` : '';
    if (kind === 'required') {
      bar.innerHTML = `<span>⬆️ ${t('Actualización obligatoria')}${ver}. ${t('La app se actualizará en unos segundos…')}</span>`;
      document.body.appendChild(bar);
      const go = () => (isBusy() ? setTimeout(go, 15000) : setTimeout(reloadFresh, 4000));
      go();
    } else {
      bar.innerHTML = `<span>✨ ${t('Nueva versión disponible')}${ver}${notes ? ` · <span class="ugc">${notes.replace(/[<>&]/g, '')}</span>` : ''}</span>
        <button class="btn small primary" data-update>${t('Actualizar')}</button><button class="icon-btn sm" data-dismiss title="${t('Más tarde')}">✕</button>`;
      document.body.appendChild(bar);
      bar.querySelector('[data-update]').onclick = () => (isBusy() ? alert(t('Termina la llamada antes de actualizar.')) : reloadFresh());
      bar.querySelector('[data-dismiss]').onclick = () => bar.remove();
    }
  }

  check();
  setInterval(check, CHECK_EVERY);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  // Limpia el parámetro ?v= que se añade al recargar
  if (new URL(location.href).searchParams.has('v')) {
    const url = new URL(location.href); url.searchParams.delete('v'); history.replaceState(null, '', url.toString());
  }
}

/** Registra este navegador como dispositivo de la cuenta y guarda la versión que usa. */
export async function registerDevice(supabase, userId) {
  const key = 'deviceId:' + userId;
  let id = null;
  try { id = Number(localStorage.getItem(key)) || null; } catch { /* nada */ }
  const ua = navigator.userAgent;
  const name = (/Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Navegador')
    + ' · ' + (/Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '');
  if (id) {
    const { data } = await supabase.from('devices').update({ last_seen: new Date().toISOString(), app_version: APP_VERSION, name }).eq('id', id).select('id');
    if (data?.length) return id;
  }
  const { data, error } = await supabase.from('devices').insert({ user_id: userId, platform: 'web', name, app_version: APP_VERSION }).select('id').single();
  if (error) return null;
  try { localStorage.setItem(key, String(data.id)); } catch { /* nada */ }
  return data.id;
}
