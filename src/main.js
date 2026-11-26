import './style.css';
import { supabase, configured, configError, SUPABASE_URL, SUPABASE_KEY } from './supabase.js';
import { createDM, loadIceServers } from './dm.js';
import { t, LANGS, getLang, setLang, initialLang, startI18n, retranslate, translatedFrom } from './i18n.js';
import { translate } from './translate.js';
import { APP_NAME, logoSvg, flag } from './brand.js';
import { createGroupCall } from './groupcall.js';
import { APP_VERSION, startVersionCheck, registerDevice } from './version.js';

setLang(initialLang());
startI18n();

/*
 * Arquitectura
 * ─────────────
 * • Mensajes: Supabase Realtime "Broadcast" (navegador → navegador). No se guardan.
 * • Usuarios conectados: Realtime "Presence" (por canal y en el lobby global "irc-lobby").
 * • Base de datos (mínima): cuentas registradas (profiles), canales (channels: uno por
 *   usuario registrado) y administradores permanentes (channel_admins).
 *   La lista de canales se lee al entrar y solo se recarga cuando alguien crea o borra uno.
 * • Los invitados no escriben nunca en la base de datos; pueden ser admins temporales.
 */

const root = document.getElementById('root');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const NICK_RE = /^[A-Za-z[\]\\`_^{|}][A-Za-z0-9[\]\\`_^{|}-]{1,19}$/;
const CHAN_RE = /^#[A-Za-z0-9_-]{1,30}$/;
const MAX_MSG = 1000;

const state = {
  clientId: crypto.randomUUID(), // identifica esta pestaña en Presence
  account: null, // { id, nick, email } si hay sesión iniciada
  pendingUser: null, // sesión iniciada sin nick todavía (p. ej. primera vez con Google)
  nick: null,
  registered: false,
  windows: new Map(), // clave -> ventana ('status' o '#canal' en minúsculas)
  channels: new Map(), // canales guardados en la BD (clave: nombre en minúsculas)
  active: 'status',
  lobby: null,
  lobbyReady: null,
};

/* ---------- Iconos ---------- */
const I = {
  hash: '<path d="M5 9h14M5 15h14M10 3 8 21M16 3l-2 18"/>',
  home: '<path d="M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14a5 5 0 0 1 6 5"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  send: '<path d="M4 12 20 4l-6 16-2.5-6.5z"/>',
  logout: '<path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
  dots: '<circle cx="12" cy="5" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="12" cy="19" r="1.3"/>',
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.5 2.5M15.2 15.2l2.5 2.5M6.3 17.7l2.5-2.5M15.2 8.8l2.5-2.5"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
  crown: '<path d="M3 8l4 4 5-7 5 7 4-4-2 11H5z"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>',
  'shield-off': '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6zM4 4l16 16"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/>',
  at: '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>',
  door: '<path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  eraser: '<path d="m7 21-4-4L14 6l6 6-9 9zM9 21h12M10 10l6 6"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z"/>',
  'phone-off': '<path d="M3 14.5c5-5 13-5 18 0l-2 2.5-3.5-1.5v-2.5a10 10 0 0 0-7 0v2.5L5 17z"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3z"/>',
  'video-off': '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3zM2 3l20 18"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  'mic-off': '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M3 3l18 18"/>',
  clip: '<path d="M20 11.5 12.5 19a5 5 0 0 1-7-7l8-8a3.3 3.3 0 0 1 4.7 4.7l-8 8a1.7 1.7 0 0 1-2.4-2.4l7.3-7.3"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  message: '<path d="M4 5h16v11H8l-4 4z"/><path d="M8 9h8M8 12h5"/>',
  smile: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0"/><circle cx="9" cy="10" r=".8"/><circle cx="15" cy="10" r=".8"/>',
  play: '<path d="M7 4v16l13-8z" fill="currentColor"/>',
  pause: '<path d="M7 4h3v16H7zM14 4h3v16h-3z" fill="currentColor"/>',
  check2: '<path d="m2.5 12.5 4 4 10-10M11.5 16.5l1 0L22 6.5"/>',
  'eye-off': '<path d="M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c6 0 10 6 10 6a17 17 0 0 1-3.3 3.9M6.3 7.6A17 17 0 0 0 2 12s4 6 10 6a10 10 0 0 0 4.2-.9M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  unlock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.7-1.5"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  shrink: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  pdf: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 13h6M9 17h4"/>',
  translate: '<path d="M4 5h9M8.5 3v2M6 5c0 4 3 7 6 8M11 5c0 3-3 7-7 9"/><path d="m13 20 4-9 4 9M14.5 17h5"/>',
};
const icon = (n, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[n]}</svg>`;
const verified = '<span class="verified" title="Usuario registrado">' + icon('check') + '</span>';

/* ---------- Tema ---------- */
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('theme', t); } catch { /* sin almacenamiento */ }
}
applyTheme((() => { try { return localStorage.getItem('theme'); } catch { return null; } })() || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
const store = {
  get: (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* nada */ } },
};

/* ===================================================================== */
/* Arranque                                                              */
/* ===================================================================== */
if (!configured) renderNotice('Configuración pendiente', 'Faltan las variables <code>VITE_SUPABASE_URL</code> y <code>VITE_SUPABASE_ANON_KEY</code>.');
else if (configError) renderNotice('Error de configuración', esc(configError));
else boot().catch((e) => renderNotice('Error', esc(e.message || String(e))));

function renderNotice(title, html) {
  root.innerHTML = `<div class="auth"><div class="auth-card"><div class="brand">${logoSvg(44, 'nt')}<h1>${esc(title)}</h1></div><p class="muted">${html}</p></div></div>`;
}

async function boot() {
  startVersionCheck({ supabase, t, isBusy: () => !!document.querySelector('.call-overlay') });
  connectLobby();
  const { data: { session } } = await supabase.auth.getSession();
  if (session && session.user.is_anonymous) await supabase.auth.signOut(); // restos del sistema anterior
  else if (session) await loadAccount(session.user);
  if (location.hash.includes('access_token') || location.search.includes('code=')) history.replaceState(null, '', location.pathname);
  renderHome();
}
/** Carga el perfil de la cuenta. Si aún no tiene nick, queda pendiente de elegirlo. */
async function loadAccount(user) {
  const { data } = await supabase.rpc('my_account');
  const profile = Array.isArray(data) ? data[0] : data;
  if (profile?.nick) {
    state.account = { id: user.id, user, nick: profile.nick, email: user.email, number: profile.user_number, firstName: profile.first_name || '', lastName: profile.last_name || '' };
    state.pendingUser = null;
    return true;
  }
  state.account = null;
  state.pendingUser = user;
  return false;
}

/* ---------- Lobby global (presencia) ---------- */
function connectLobby() {
  const lobby = supabase.channel('irc-lobby', { config: { broadcast: { self: false }, presence: { key: state.clientId } } });
  lobby.on('broadcast', { event: 'channels' }, () => {
    if (state.nick) loadChannels().then(() => { renderBrowser(); renderChanList(); });
  });
  state.lobby = lobby;
  state.lobbyReady = new Promise((resolve) => {
    lobby
      .on('presence', { event: 'sync' }, () => {
        resolve();
        if (state.nick) renderBrowser();
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setTimeout(resolve, 1500); // sin nadie conectado puede no llegar "sync"
        if (state.nick && status === 'SUBSCRIBED') trackLobby();
      });
  });
}
function lobbyEntries() {
  const out = [];
  for (const [key, metas] of Object.entries(state.lobby?.presenceState() || {})) {
    if (key === state.clientId || !metas[0]) continue;
    out.push(metas[0]);
  }
  return out;
}
function trackLobby() {
  if (!state.nick) return;
  const chans = [...state.windows.values()].filter((w) => w.key !== 'status' && w.kind !== 'dm').map((w) => w.name);
  state.lobby.track({ nick: state.nick, reg: state.registered, uid: state.account?.id || null, chans });
}
function activeChannels() {
  const counts = new Map();
  for (const e of lobbyEntries()) for (const c of e.chans || []) {
    const k = c.toLowerCase();
    counts.set(k, { name: counts.get(k)?.name || c, n: (counts.get(k)?.n || 0) + 1 });
  }
  for (const w of state.windows.values()) if (w.key !== 'status' && w.kind !== 'dm') {
    counts.set(w.key, { name: w.name, n: (counts.get(w.key)?.n || 0) + 1 });
  }
  return [...counts.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
}

/** Comprueba si un nick se puede usar ahora mismo. Devuelve '' si está libre o un mensaje de error. */
async function nickProblem(nick, { forAccount = null } = {}) {
  if (!NICK_RE.test(nick)) return 'Ese nick no es válido: 2–20 caracteres, letras, números y _ - [ ] { } ^ |, sin empezar por número.';
  await state.lobbyReady;
  const lower = nick.toLowerCase();
  const online = lobbyEntries().find((e) => e.nick?.toLowerCase() === lower);
  if (online && !(forAccount && online.uid === forAccount)) return `El nick ${nick} está en uso ahora mismo. Prueba otro.`;
  if (!forAccount) {
    const { data, error } = await supabase.rpc('nick_available', { p_nick: nick });
    if (error) return 'No se pudo comprobar el nick: ' + error.message;
    if (data === false) return `El nick ${nick} pertenece a un usuario registrado. Si es tuyo, inicia sesión.`;
  }
  return '';
}

/* ===================================================================== */
/* Pantalla principal                                                    */
/* ===================================================================== */
// Vistas: 'guest' (por defecto), 'login', 'register'.
// Con sesión iniciada: bienvenida (si tiene nick) o elección de nick (p. ej. primera vez con Google).
let homeView = 'guest';
const GOOGLE_SVG = '<svg class="ico" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2A11.9 11.9 0 0 1 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3a12 12 0 0 1-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z"/></svg>';
/** Canal indicado en la dirección (chat-irc.vercel.app/#canal), si lo hay. */
function linkedChannel() {
  const h = decodeURIComponent(location.hash.slice(1)).replace(/^#/, '');
  return h && CHAN_RE.test('#' + h) ? '#' + h : null;
}
const nickField = (v) => `<label for="nick">Nick</label>
  <div class="field"><span>@</span><input id="nick" name="nick" value="${esc(v)}" maxlength="20" autocomplete="nickname" autocapitalize="none" spellcheck="false" placeholder="tu_nick" required></div>`;
/** Nombre y apellido sugeridos a partir de la cuenta de Google (si los trae). */
function suggestNames(user) {
  const m = user?.user_metadata || {};
  const full = (m.full_name || m.name || '').trim().split(/\s+/);
  return { first: m.given_name || (full.length > 1 ? full.slice(0, -1).join(' ') : full[0] || ''), last: m.family_name || (full.length > 1 ? full.at(-1) : '') };
}
const nameFields = (first = '', last = '') => `<div class="name-row">
  <div><label for="first_name">Nombre</label><div class="field"><input id="first_name" name="first_name" value="${esc(first)}" maxlength="60" autocomplete="given-name" required></div></div>
  <div><label for="last_name">Apellido</label><div class="field"><input id="last_name" name="last_name" value="${esc(last)}" maxlength="60" autocomplete="family-name" required></div></div>
</div>`;
const fmtNumber = (n) => String(n || '').replace(/(\d{4})(\d{4})/, '$1 $2');
const googleBtn = `<button type="button" class="btn google block" id="google-btn">${GOOGLE_SVG} Continuar con Google</button>`;

/** Propone un nick válido a partir del nombre o el correo de la cuenta. */
function suggestNick(user) {
  const m = user?.user_metadata || {};
  const base = (m.nick || m.preferred_username || m.name || m.full_name || (user?.email || '').split('@')[0] || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '_').replace(/[^A-Za-z0-9_\-[\]{}^|]/g, '');
  const nick = base.replace(/^[^A-Za-z_[\]{}^|]+/, '').slice(0, 20);
  return nick.length >= 2 ? nick : '';
}

function renderHome(message = '', kind = 'error') {
  state.nick = null;
  const msg = `<p class="${message ? kind : 'error'}" role="alert">${message}</p>`;
  let body;
  if (state.account && (!state.account.firstName || !state.account.lastName)) {
    // Cuenta sin nombre y apellido (creada antes de que fueran obligatorios)
    const sug = suggestNames(state.account.user);
    body = `<div class="welcome-back">${avatar(state.account.nick)}<div><b>Hola, ${esc(state.account.nick)} ${verified}</b><small class="muted">${esc(state.account.email || '')}</small></div></div>
      <p class="lead">Completa tu nombre y apellido para continuar. Solo los verán tus amigos.</p>
      <form id="home-form" data-mode="names">${nameFields(sug.first, sug.last)}${msg}<button class="btn primary block" type="submit">Guardar y entrar</button></form>
      <button class="btn ghost block" id="logout-btn">${icon('logout')} Cerrar sesión</button>`;
  } else if (state.account) {
    body = `<div class="welcome-back">${avatar(state.account.nick)}<div><b>Hola, ${esc(state.account.nick)} ${verified}</b><small class="muted">${esc(state.account.email || '')}${state.account.number ? ` · Nº <span class="ugc">${fmtNumber(state.account.number)}</span>` : ''}</small></div></div>
      <form id="home-form">${msg}<button class="btn primary block" type="submit">Entrar al chat</button></form>
      <button class="btn ghost block" id="logout-btn">${icon('logout')} Cerrar sesión</button>`;
  } else if (state.pendingUser) {
    body = `<div class="welcome-back"><span class="avatar">${icon('check')}</span><div><b>Sesión iniciada</b><small class="muted">${esc(state.pendingUser.email || '')}</small></div></div>
      <p class="lead">Elige el nick que quieres reservar. Será solo tuyo.</p>
      <form id="home-form">${nickField(suggestNick(state.pendingUser))}${nameFields(suggestNames(state.pendingUser).first, suggestNames(state.pendingUser).last)}${msg}<button class="btn primary block" type="submit">Reservar nick y entrar</button></form>
      <button class="btn ghost block" id="logout-btn">${icon('logout')} Usar otra cuenta</button>`;
  } else if (homeView === 'guest') {
    body = `<form id="home-form">${nickField(store.get('lastNick'))}${msg}<button class="btn primary block" type="submit">Entrar al chat</button></form>
      <div class="divider"><span>o reserva tu nick</span></div>
      ${googleBtn}
      <p class="alt-links"><button type="button" class="link" data-view="login">Iniciar sesión con correo</button> · <button type="button" class="link" data-view="register">Crear cuenta</button></p>`;
  } else {
    const isLogin = homeView === 'login';
    const email = `<label for="email">Correo</label><div class="field"><input id="email" name="email" type="email" autocomplete="email" placeholder="tu@correo.com" required></div>`;
    const pass = `<label for="password">Contraseña</label><div class="field"><input id="password" name="password" type="password" minlength="8" autocomplete="${isLogin ? 'current-password' : 'new-password'}" placeholder="Mínimo 8 caracteres" required></div>`;
    body = `<button type="button" class="link back" data-view="guest">← Volver</button>
      <h2 class="view-title">${isLogin ? 'Iniciar sesión' : 'Crear cuenta'}</h2>
      ${googleBtn}
      <div class="divider"><span>o con tu correo</span></div>
      <form id="home-form">${isLogin ? email + pass : nickField('') + nameFields() + email + pass + '<p class="hint">Tu nick quedará reservado: nadie más podrá usarlo. Tu nombre y apellido solo los verán tus amigos.</p>'}${msg}
        <button class="btn primary block" type="submit">${isLogin ? 'Iniciar sesión' : 'Crear cuenta'}</button></form>
      <p class="alt-links">${isLogin ? '¿No tienes cuenta? <button type="button" class="link" data-view="register">Crear cuenta</button>' : '¿Ya tienes cuenta? <button type="button" class="link" data-view="login">Iniciar sesión</button>'}</p>`;
  }
  const lg = getLang();
  const langPick = `<div class="lang-dd">
      <button type="button" class="lang-btn" id="lang-btn" aria-haspopup="listbox" title="Idioma">${flag(lg)}<span class="ugc">${esc(LANGS[lg])}</span><svg class="caret" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6"/></svg></button>
      <div class="lang-list hidden" id="lang-list" role="listbox">${Object.entries(LANGS).map(([k, v]) => `<button type="button" role="option" data-lang="${k}" class="${k === lg ? 'sel' : ''}">${flag(k)}<span class="ugc">${esc(v)}</span></button>`).join('')}</div>
    </div>`;
  const BENEFITS = [
    ['hash', 'Canales temáticos', 'Únete a salas abiertas o crea la tuya y modérala con tus propios administradores.'],
    ['lock', 'Privados cifrados', 'Mensajes, fotos, vídeos, documentos y notas de voz de persona a persona, cifrados de extremo a extremo.'],
    ['video', 'Llamadas y videollamadas', 'Habla cara a cara desde el navegador, en el ordenador o en el móvil.'],
    ['translate', 'Traducción automática', 'Escribe en tu idioma: cada persona lee los mensajes en el suyo.'],
    ['eye-off', 'Sin historial', 'Nada se guarda en servidores. Si quieres conservar una charla, expórtala a PDF.'],
    ['zap', 'Gratis y sin instalar', 'Funciona en cualquier navegador moderno, sin descargas ni registros obligatorios.'],
  ];
  root.innerHTML = `<div class="landing">
    <header class="banner">
      <div class="banner-inner">
        <a class="banner-brand" href="/" aria-label="${APP_NAME}">${logoSvg(46, 'bn')}<span class="ugc">${APP_NAME}</span></a>
        <span class="banner-tag">Canales, nicks y conversación en tiempo real</span>
        ${langPick}
      </div>
    </header>
    <main class="landing-main">
      <section class="pitch">
        <h1>Chatea en tiempo real, sin instalar nada</h1>
        <p class="pitch-lead"><span class="ugc">${APP_NAME}</span> <span>combina el espíritu de los clásicos canales de chat con todo lo que esperas de una app de mensajería moderna. Entra con un nick y empieza a hablar.</span></p>
        <ul class="benefits">${BENEFITS.map(([ic, h, d]) => `<li><span class="b-ico">${icon(ic)}</span><div><b>${h}</b><p>${d}</p></div></li>`).join('')}</ul>
      </section>
      <aside class="auth-card">
        ${body}
        <p class="muted small center lang-note">${icon('translate')} ${esc(t('Los mensajes de otros idiomas se traducirán al'))} <b class="ugc">${esc(LANGS[lg])}</b>.</p>
        <p class="muted small center note">Las conversaciones no se guardan: solo ves lo que se dice mientras estás conectado.</p>
      </aside>
    </main>
    <footer class="landing-foot"><span class="ugc">© ${new Date().getFullYear()} ${APP_NAME} · v${APP_VERSION}</span> · <a href="/privacidad.html">Privacidad</a> · <a href="/terminos.html">Condiciones</a></footer>
  </div>`;

  root.querySelectorAll('[data-view]').forEach((b) => (b.onclick = () => { homeView = b.dataset.view; renderHome(); }));
  const list = document.getElementById('lang-list');
  document.getElementById('lang-btn').onclick = (e) => { e.stopPropagation(); list.classList.toggle('hidden'); };
  document.addEventListener('click', function closeLang(e) {
    if (!document.getElementById('lang-list')) return document.removeEventListener('click', closeLang);
    if (!e.target.closest('.lang-dd')) list.classList.add('hidden');
  });
  list.onclick = (e) => {
    const b = e.target.closest('[data-lang]');
    if (!b) return;
    const nick = document.getElementById('nick')?.value;
    setLang(b.dataset.lang);
    renderHome();
    if (nick !== undefined && document.getElementById('nick')) document.getElementById('nick').value = nick;
  };
  document.getElementById('google-btn')?.addEventListener('click', signInWithGoogle);
  const logout = document.getElementById('logout-btn');
  if (logout) logout.onclick = async () => { await supabase.auth.signOut(); state.account = null; state.pendingUser = null; homeView = 'guest'; renderHome('Sesión cerrada.', 'ok'); };
  const form = document.getElementById('home-form');
  const first = [...form.querySelectorAll('input')].find((i) => !i.value) || form.querySelector('input');
  if (matchMedia('(pointer:fine)').matches) first?.focus();
  form.onsubmit = (e) => { e.preventDefault(); submitHome(form); };
}
function setHomeError(form, text, kind = 'error') {
  const p = form.querySelector('[role=alert]');
  p.className = kind; p.innerHTML = text;
}

async function signInWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + '/' + location.hash } });
  if (error) {
    const form = document.getElementById('home-form');
    setHomeError(form, /not enabled|unsupported provider/i.test(error.message) ? 'El acceso con Google todavía no está activado.' : esc(error.message));
  }
}

async function submitHome(form) {
  const btn = form.querySelector('button[type=submit]');
  const label = btn.textContent;
  const done = () => { btn.disabled = false; btn.textContent = label; };
  btn.disabled = true; btn.textContent = 'Comprobando…';
  setHomeError(form, '');
  const fail = (html) => { done(); setHomeError(form, html); };
  const channel = linkedChannel();

  try {
    const names = form.first_name ? { first: form.first_name.value.trim(), last: form.last_name.value.trim() } : null;
    if (names && (!names.first || !names.last)) return fail(esc(t('Escribe tu nombre y apellido.')));
    // Cuenta sin nombre: guardarlo
    if (state.account && form.dataset.mode === 'names') {
      const { error } = await supabase.rpc('set_my_name', { p_first: names.first, p_last: names.last });
      if (error) return fail(esc(error.message));
      state.account.firstName = names.first; state.account.lastName = names.last;
    }
    // Con sesión y nick: entrar
    if (state.account) {
      const problem = await nickProblem(state.account.nick, { forAccount: state.account.id });
      if (problem) return fail(esc(problem));
      return enterChat(state.account.nick, true, channel);
    }
    // Con sesión pero sin nick (primera vez con Google): reservarlo
    if (state.pendingUser) {
      const nick = form.nick.value.trim();
      const problem = await nickProblem(nick);
      if (problem) return fail(esc(problem));
      const { data, error } = await supabase.rpc('claim_nick', { p_nick: nick });
      if (error) return fail(error.code === '23505' ? `El nick ${esc(nick)} acaba de ser reservado por otra persona.` : error.code === '23514' ? 'Ese nick no es válido.' : esc(error.message));
      await supabase.rpc('set_my_name', { p_first: names.first, p_last: names.last });
      const user = state.pendingUser;
      await loadAccount(user);
      state.account ||= { id: user.id, nick: data || nick, email: user.email };
      return enterChat(state.account.nick, true, channel);
    }
    // Invitado
    if (homeView === 'guest') {
      const nick = form.nick.value.trim();
      const problem = await nickProblem(nick);
      if (problem) return fail(esc(problem));
      store.set('lastNick', nick);
      return enterChat(nick, false, channel);
    }
    // Iniciar sesión con correo
    if (homeView === 'login') {
      const { data, error } = await supabase.auth.signInWithPassword({ email: form.email.value.trim(), password: form.password.value });
      if (error) return fail(error.message === 'Invalid login credentials' ? 'Correo o contraseña incorrectos.' : error.message === 'Email not confirmed' ? 'Aún no confirmaste tu correo. Revisa tu bandeja de entrada.' : esc(error.message));
      await loadAccount(data.user);
      return renderHome();
    }
    // Crear cuenta con correo
    if (homeView === 'register') {
      const nick = form.nick.value.trim();
      const problem = await nickProblem(nick);
      if (problem) return fail(esc(problem));
      const { data, error } = await supabase.auth.signUp({
        email: form.email.value.trim(), password: form.password.value,
        options: { data: { nick, first_name: names.first, last_name: names.last }, emailRedirectTo: location.origin + '/' },
      });
      if (error) return fail(/already registered|already exists/i.test(error.message) ? 'Ese correo ya tiene una cuenta. Inicia sesión.' : esc(error.message));
      store.set('lastNick', nick);
      if (data.session) {
        await loadAccount(data.user);
        return renderHome(state.account ? `¡Cuenta creada! Tu nick <b>${esc(state.account.nick)}</b> está reservado.` : 'Cuenta creada, pero ese nick ya se ocupó. Elige otro.', state.account ? 'ok' : 'error');
      }
      homeView = 'login';
      return renderHome(`Te enviamos un correo a <b>${esc(form.email.value.trim())}</b>. Confírmalo y luego inicia sesión.`, 'ok');
    }
  } catch (e) {
    fail(esc(e.message || String(e)));
  }
}

/* ===================================================================== */
/* Chat                                                                  */
/* ===================================================================== */

/* ---------- Diálogos y menús (sin prompt/alert del navegador) ---------- */
function closeOverlays() {
  document.querySelectorAll('.menu-pop, .dialog-wrap').forEach((e) => e.remove());
}
/**
 * Abre un menú contextual junto a un elemento.
 * items: [{ label, icon, danger, disabled, hint, onClick }] o '-' para separador.
 */
function openMenu(anchor, items, { title } = {}) {
  closeOverlays();
  const m = document.createElement('div');
  m.className = 'menu-pop';
  m.setAttribute('role', 'menu');
  m.innerHTML = (title ? `<div class="menu-title">${title}</div>` : '') + items.map((it, i) => it === '-'
    ? '<hr>'
    : `<button role="menuitem" data-i="${i}" class="${it.danger ? 'danger' : ''}" ${it.disabled ? 'disabled' : ''}>${it.icon ? icon(it.icon) : ''}<span>${it.html || esc(it.label)}${it.hint ? `<small>${esc(it.hint)}</small>` : ''}</span></button>`).join('');
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  const mw = m.offsetWidth, mh = m.offsetHeight;
  let left = Math.min(r.left, innerWidth - mw - 8);
  let top = r.bottom + 6;
  if (top + mh > innerHeight - 8) top = Math.max(8, r.top - mh - 6);
  m.style.left = Math.max(8, left) + 'px';
  m.style.top = top + 'px';
  m.onclick = (e) => {
    const b = e.target.closest('[data-i]');
    if (!b || b.disabled) return;
    m.remove();
    items[b.dataset.i].onClick?.();
  };
  setTimeout(() => document.addEventListener('pointerdown', function away(e) {
    if (!m.contains(e.target)) { m.remove(); document.removeEventListener('pointerdown', away); }
  }), 0);
  m.querySelector('button:not([disabled])')?.focus();
}
/**
 * Abre un cuadro de diálogo. fields: [{ name, label, value, prefix, max, placeholder, multiline }]
 * Devuelve una promesa con los valores, o null si se cancela. `validate` puede devolver un error (texto).
 */
function openDialog({ title, text = '', fields = [], confirm = 'Aceptar', danger = false, validate }) {
  closeOverlays();
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'dialog-wrap';
    wrap.innerHTML = `<form class="dialog" role="dialog" aria-modal="true">
      <h3>${esc(title)}</h3>${text ? `<p class="muted">${text}</p>` : ''}
      ${fields.map((f) => `<label>${esc(f.label)}</label><div class="field">${f.prefix ? `<span>${esc(f.prefix)}</span>` : ''}${f.multiline
        ? `<textarea name="${f.name}" maxlength="${f.max || 300}" rows="3" placeholder="${esc(f.placeholder || '')}">${esc(f.value || '')}</textarea>`
        : `<input name="${f.name}" type="${f.type || 'text'}" value="${esc(f.value || '')}" maxlength="${f.max || 100}" placeholder="${esc(f.placeholder || '')}" autocomplete="${f.type === 'password' ? 'new-password' : 'off'}" autocapitalize="none" spellcheck="false">`}</div>${f.hint ? `<p class="hint">${esc(f.hint)}</p>` : ''}`).join('')}
      <p class="error" role="alert"></p>
      <div class="dialog-actions"><button type="button" class="btn" data-cancel>Cancelar</button><button type="submit" class="btn ${danger ? 'danger' : 'primary'}">${esc(confirm)}</button></div>
    </form>`;
    document.body.appendChild(wrap);
    const form = wrap.querySelector('form');
    const close = (v) => { wrap.remove(); resolve(v); };
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(null); });
    wrap.querySelector('[data-cancel]').onclick = () => close(null);
    form.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(null); });
    form.onsubmit = async (e) => {
      e.preventDefault();
      const values = Object.fromEntries(fields.map((f) => [f.name, form.elements[f.name].value.trim()]));
      const btn = form.querySelector('[type=submit]');
      btn.disabled = true;
      const err = validate ? await validate(values) : '';
      btn.disabled = false;
      if (err) { form.querySelector('[role=alert]').textContent = err; return; }
      close(values);
    };
    (form.querySelector('input,textarea') || form.querySelector('[type=submit]')).focus();
  });
}
let toastTimer;
function toast(text) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.querySelector('.menu-pop')?.remove(); });

/* ---------- Canales guardados en la base de datos ---------- */
/** Lee la lista de canales (una consulta). Se repite solo cuando alguien crea o borra un canal. */
async function loadChannels() {
  const { data, error } = await supabase.from('channels').select('id, name, topic, owner_id, is_private, channel_admins(user_id)').order('name');
  if (error) { toast('No se pudo cargar la lista de canales: ' + error.message); return; }
  const map = new Map();
  for (const c of data) map.set(c.name.toLowerCase(), { id: c.id, name: c.name, topic: c.topic, owner_id: c.owner_id, is_private: c.is_private, admins: new Set(c.channel_admins.map((a) => a.user_id)) });
  // Conserva el objeto de los canales abiertos para no perder el estado en pantalla
  for (const [k, w] of state.windows) {
    if (k === 'status' || w.kind === 'dm') continue;
    const fresh = map.get(k);
    if (fresh) { Object.assign(w.ch, { topic: fresh.topic, owner_id: fresh.owner_id, is_private: fresh.is_private, admins: fresh.admins }); map.set(k, w.ch); }
  }
  state.channels = map;
}
const announceChannelsChanged = () => state.lobby.send({ type: 'broadcast', event: 'channels', payload: {} });
const myOwnChannel = () => state.account && [...state.channels.values()].find((c) => c.owner_id === state.account.id);
function onlineCount(name) { return activeChannels().find((c) => c.name.toLowerCase() === name.toLowerCase())?.n || 0; }

/* ---------- Administradores ---------- */
const isPermAdmin = (ch, uid) => !!uid && (ch.owner_id === uid || ch.admins.has(uid));
const isOwner = (ch, uid) => !!uid && ch.owner_id === uid;
const personIsAdmin = (w, p) => isPermAdmin(w.ch, p.uid) || !!p.tmp;
const iAmPermAdmin = (w) => isPermAdmin(w.ch, state.account?.id);
const iAmAdmin = (w) => iAmPermAdmin(w) || w.myTmp;
const iAmOwner = (w) => isOwner(w.ch, state.account?.id);
/** ¿El cliente cid es administrador según lo que vemos? (para validar órdenes recibidas) */
function cidIsAdmin(w, cid) { const p = w.people.get(cid); return !!p && personIsAdmin(w, p); }

/* ===================================================================== */
function enterChat(nick, registered, channel) {
  state.nick = nick;
  state.registered = registered;
  loadIceServers(SUPABASE_URL, SUPABASE_KEY); // credenciales TURN para privados y videollamadas
  if (registered && state.account?.id) registerDevice(supabase, state.account.id); // versión que usa este dispositivo
  renderClient();
  activate('status');
  loadChannels().then(() => {
    renderBrowser(); renderChanList();
    if (channel) joinChannel(channel);
  });
}

function renderClient() {
  root.innerHTML = `<div class="app" id="app">
    <aside class="sidebar">
      <header class="side-head">${logoSvg(32, 'sd')}<b class="ugc">${APP_NAME}</b>
        <button class="icon-btn mobile-only" id="close-side" title="Cerrar">${icon('x')}</button></header>
      <div class="side-section">
        <nav id="nav-browse"></nav>
        <div class="side-label spaced">Tus canales</div>
        <nav id="chan-list"></nav>
        <div class="side-label spaced" id="dm-label">Privados</div>
        <nav id="dm-list"></nav>
      </div>
      <footer class="me">
        <button class="me-btn" id="me-btn" title="Opciones de usuario">
          <span id="me-avatar"></span>
          <span class="me-info"><b id="me-nick"></b><small><i class="dot on"></i> ${state.registered ? 'Registrado' : 'Invitado'}</small></span>
        </button>
        <button class="icon-btn" id="theme-btn" title="Cambiar tema"></button>
        <button class="icon-btn" id="quit-btn" title="Salir del chat">${icon('logout')}</button>
      </footer>
    </aside>
    <div class="scrim" id="scrim"></div>
    <div class="dm-requests" id="dm-requests" aria-live="polite"></div>
    <main class="chat">
      <header class="chat-head">
        <button class="icon-btn mobile-only" id="open-side" title="Canales">${icon('menu')}</button>
        <div class="chat-title"><h2 id="win-name"></h2><p id="topic"></p></div>
        <button class="icon-btn hidden" id="call-audio" title="Llamada de voz">${icon('phone')}</button>
        <button class="icon-btn hidden" id="call-video" title="Videollamada">${icon('video')}</button>
        <button class="icon-btn" id="toggle-members" title="Usuarios">${icon('users')}<span id="member-count"></span></button>
        <button class="icon-btn" id="chan-menu" title="Opciones del canal">${icon('dots')}</button>
      </header>
      <div class="call-banner hidden" id="call-banner"></div>
      <div class="chat-body">
        <div class="log" id="log"></div>
        <aside class="members" id="members"></aside>
      </div>
      <form class="composer" id="input-form">
        <div class="picker hidden" id="picker"></div>
        <div class="input-wrap">
          <button type="button" class="icon-btn action-toggle" id="action-btn" title="Escribir como acción (* tu_nick hace algo)">${icon('sparkle')}</button>
          <button type="button" class="icon-btn dm-only" id="emoji-btn" title="Emojis y stickers">${icon('smile')}</button>
          <button type="button" class="icon-btn dm-only" id="attach-btn" title="Enviar foto, vídeo o documento">${icon('clip')}</button>
          <input id="input" autocomplete="off" spellcheck="true" maxlength="${MAX_MSG}" placeholder="Escribe un mensaje…">
          <button type="button" class="icon-btn dm-only" id="mic-btn" title="Grabar nota de voz">${icon('mic')}</button>
          <button class="send" type="submit" title="Enviar">${icon('send')}</button>
        </div>
        <div class="rec-bar">
          <button type="button" class="icon-btn" id="rec-cancel" title="Descartar">${icon('trash')}</button>
          <span class="rec-dot"></span><span id="rec-time">0:00</span><canvas id="rec-wave"></canvas>
          <button type="button" class="send" id="rec-send" title="Enviar nota de voz">${icon('send')}</button>
        </div>
        <input type="file" id="file-input" multiple hidden>
      </form>
    </main>
  </div>`;
  state.windows.clear();
  state.windows.set('status', { key: 'status', name: 'Explorar canales', lines: [], unread: 0, mention: false, last: null });
  updateMe();
  updateThemeBtn();
  bindComposer();

  const app = document.getElementById('app');
  const closeSide = () => app.classList.remove('side-open');
  document.getElementById('nav-browse').onclick = () => { activate('status'); closeSide(); };
  document.getElementById('chan-list').onclick = (e) => {
    const b = e.target.closest('[data-win]');
    if (!b) return;
    if (e.target.closest('[data-part]')) return partChannel(b.dataset.win);
    activate(b.dataset.win); closeSide();
  };
  document.getElementById('open-side').onclick = () => app.classList.add('side-open');
  document.getElementById('close-side').onclick = closeSide;
  document.getElementById('scrim').onclick = () => { closeSide(); app.classList.remove('members-open'); };
  document.getElementById('toggle-members').onclick = () => {
    if (matchMedia('(max-width: 900px)').matches) app.classList.toggle('members-open');
    else app.classList.toggle('members-hidden');
  };
  document.getElementById('quit-btn').onclick = quitChat;
  document.getElementById('theme-btn').onclick = toggleTheme;
  document.getElementById('me-btn').onclick = (e) => userMenu(e.currentTarget);
  document.getElementById('chan-menu').onclick = (e) => channelMenu(e.currentTarget);
  document.getElementById('members').onclick = (e) => {
    const li = e.target.closest('[data-cid]');
    if (li && e.detail < 2) memberMenu(li, li.dataset.cid);
  };
  document.getElementById('members').ondblclick = (e) => {
    const li = e.target.closest('[data-cid]');
    if (!li) return;
    closeOverlays();
    openPrivate(li.dataset.cid);
  };
  document.getElementById('dm-list').onclick = (e) => {
    const b = e.target.closest('[data-win]');
    if (!b) return;
    const w = state.windows.get(b.dataset.win);
    if (e.target.closest('[data-part]')) return w && dm.closeWindow(w);
    activate(b.dataset.win); closeSide();
  };
  document.getElementById('call-audio').onclick = () => dm.startCall(state.windows.get(state.active), false);
  document.getElementById('call-video').onclick = () => {
    const w = state.windows.get(state.active);
    if (w?.kind === 'dm') dm.startCall(w, true); else if (w && w.key !== 'status') gc.join(w);
  };
  document.getElementById('attach-btn').onclick = () => document.getElementById('file-input').click();
  document.getElementById('file-input').onchange = (e) => {
    const w = state.windows.get(state.active);
    if (w?.kind === 'dm') [...e.target.files].forEach((f) => dm.sendFile(w, f));
    e.target.value = '';
  };
  document.getElementById('mic-btn').onclick = () => dm.startVoice(state.windows.get(state.active));
  document.getElementById('rec-cancel').onclick = () => dm.stopVoice(false);
  document.getElementById('rec-send').onclick = () => dm.stopVoice(true);
  // Pegar o arrastrar archivos en un privado
  document.getElementById('input').addEventListener('paste', (e) => {
    const w = state.windows.get(state.active);
    const files = [...(e.clipboardData?.files || [])];
    if (w?.kind === 'dm' && files.length) { e.preventDefault(); files.forEach((f) => dm.sendFile(w, f)); }
  });
  const chatEl = document.querySelector('.chat');
  chatEl.addEventListener('dragover', (e) => { if (state.windows.get(state.active)?.kind === 'dm') { e.preventDefault(); chatEl.classList.add('dragging'); } });
  chatEl.addEventListener('dragleave', (e) => { if (!chatEl.contains(e.relatedTarget)) chatEl.classList.remove('dragging'); });
  chatEl.addEventListener('drop', (e) => {
    const w = state.windows.get(state.active);
    chatEl.classList.remove('dragging');
    if (w?.kind !== 'dm') return;
    e.preventDefault();
    [...e.dataTransfer.files].forEach((f) => dm.sendFile(w, f));
  });
  sys('status', `Conectado como <b>${esc(state.nick)}</b>${state.registered ? ' (registrado)' : ' (invitado)'}. Las conversaciones no se guardan. Haz doble clic en un nick para hablar en privado.`, 'info');
  dm.init();
  renderChanList();
  trackLobby();
}

function bindComposer() {
  const input = document.getElementById('input');
  const actionBtn = document.getElementById('action-btn');
  let actionMode = false;
  const setAction = (on) => {
    actionMode = on;
    actionBtn.classList.toggle('on', on);
    const w = state.windows.get(state.active);
    input.placeholder = on ? `Describe una acción: * ${state.nick} …` : w?.kind === 'dm' ? `Mensaje privado para ${w.peer.nick}` : w && w.key !== 'status' ? `Mensaje en ${w.name}` : 'Elige un canal para hablar';
  };
  actionBtn.onclick = () => { setAction(!actionMode); input.focus(); };
  document.getElementById('input-form').onsubmit = (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    input.dispatchEvent(new Event('input'));
    document.getElementById('picker')?.classList.add('hidden');
    sendMessage(text, actionMode ? 'action' : 'msg');
    if (actionMode) setAction(false);
  };
  const hist = []; let hi = -1;
  const wrap = input.closest('.input-wrap');
  input.addEventListener('input', () => wrap.classList.toggle('has-text', input.value.trim().length > 0));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && input.value.trim()) { hist.unshift(input.value); hi = -1; }
    if (e.key === 'ArrowUp' && hist.length) { hi = Math.min(hi + 1, hist.length - 1); input.value = hist[hi]; e.preventDefault(); }
    if (e.key === 'ArrowDown' && hi >= 0) { hi -= 1; input.value = hi < 0 ? '' : hist[hi]; e.preventDefault(); }
    if (e.key === 'Tab') { e.preventDefault(); completeNick(input); }
    if (e.key === 'Escape' && actionMode) setAction(false);
  });
  state.setActionMode = setAction;
}

function updateMe() {
  document.getElementById('me-nick').innerHTML = esc(state.nick) + (state.registered ? ' ' + verified : '');
  document.getElementById('me-avatar').innerHTML = avatar(state.nick);
  updateTitle();
}
function toggleTheme() { applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); updateThemeBtn(); }
function updateThemeBtn() {
  const b = document.getElementById('theme-btn');
  if (b) b.innerHTML = icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon');
}
function updateTitle() {
  const w = state.windows.get(state.active);
  const unread = [...state.windows.values()].reduce((n, x) => n + (x.unread || 0), 0);
  document.title = (unread ? `(${unread}) ` : '') + (w && w.key !== 'status' ? w.name + ' · ' : '') + APP_NAME;
}

/* ---------- Avatares y colores ---------- */
function hue(nick) { let h = 0; for (const c of nick.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; }
const nickStyle = (nick) => `--h:${hue(nick)}`;
/** Avatares en la gama de rojos de ChamuFlac (rojos, rubíes, corales, vinos). */
function avatar(nick) {
  const h = hue(nick);
  return `<span class="avatar" style="--h:${(340 + (h % 50)) % 360};--l:${42 + (h % 4) * 6}%">${esc(nick.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '?')}</span>`;
}

/* ---------- Mensajes ---------- */
const time = (d) => new Date(d).toLocaleTimeString(getLang(), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function linkify(s) {
  return '<span class="ugc">' + linkifyRaw(s) + '</span>';
}
function linkifyRaw(s) {
  return esc(s)
    .replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\*([^*\n]+)\*/g, '<b>$1</b>')
    .replace(/(^|\s)_([^_\n]+)_(?=\s|$)/g, '$1<i>$2</i>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>');
}
function mentionsMe(m) {
  if (m.from === state.clientId) return false;
  return new RegExp(`(^|[^\\w])${state.nick.replace(/[^\w]/g, '\\$&')}([^\\w]|$)`, 'i').test(m.body);
}
const CROWN_SVG = '<svg viewBox="0 0 24 16" aria-hidden="true"><path d="M2 14 1 3l6 4.5L12 1l5 6.5L23 3l-1 11z" stroke-linejoin="round"/><circle cx="1" cy="3" r="1.6"/><circle cx="12" cy="1.4" r="1.6"/><circle cx="23" cy="3" r="1.6"/></svg>';
/** Rol de una persona en el canal: 'owner' (creador), 'admin' (permanente), 'tmp' (temporal) o ''. */
function roleOf(w, p) {
  if (!p || !w?.ch) return '';
  if (isOwner(w.ch, p.uid)) return 'owner';
  if (isPermAdmin(w.ch, p.uid)) return 'admin';
  return p.tmp ? 'tmp' : '';
}
const ROLE_TITLE = { owner: 'Creador del canal', admin: 'Administrador', tmp: 'Administrador temporal' };
/** Coronita sobre el avatar para identificar a los administradores. */
function crown(role) { return role ? `<i class="crown ${role}" title="${ROLE_TITLE[role]}">${CROWN_SVG}</i>` : ''; }
/** Avatar con coronita si es administrador. */
function avatarWithRole(nick, role, extra = '') { return `<span class="av-wrap ${role ? 'crowned' : ''}">${crown(role)}${avatar(nick)}${extra}</span>`; }
/** Versión pequeña en línea (para acciones y menús). */
function roleBadge(w, p) { const r = roleOf(w, p); return r ? `<span class="role-inline ${r}" title="${ROLE_TITLE[r]}">${CROWN_SVG}</span>` : ''; }
/* ---------- Traducción de mensajes ---------- */
const needsTranslation = (m) => !!m.lang && m.lang !== getLang() && m.from !== state.clientId && LANGS[m.lang] && typeof m.body === 'string' && m.body.trim().length > 0;
function trInner(st, orig, src, translated) {
  if (st === 'pending') return `${linkify(orig)} <small class="tr-note">${esc(t('Traduciendo…'))}</small>`;
  if (st === 'done') return `<span class="tr-text">${linkify(translated)}</span><span class="tr-orig hidden">${linkify(orig)}</span> <button type="button" class="tr-toggle" data-src="${esc(src)}">${icon('translate')}${esc(translatedFrom(src))} · ${esc(t('Ver original'))}</button>`;
  return linkify(orig);
}
const trWrap = (id, inner) => `<span class="tr-wrap" data-tr="${id}"><!--a-->${inner}<!--z--></span>`;
/** Sustituye el cuerpo de un mensaje ya pintado (en pantalla y en la copia de la ventana). */
function replaceTr(key, id, inner) {
  const w = state.windows.get(key);
  if (!w) return;
  const startTag = `data-tr="${id}"><!--a-->`;
  w.lines = w.lines.map((l) => {
    const i = l.indexOf(startTag);
    if (i < 0) return l;
    const j = l.indexOf('<!--z-->', i);
    return l.slice(0, i + startTag.length) + inner + l.slice(j);
  });
  const el = document.querySelector(`#log [data-tr="${CSS.escape(id)}"]`);
  if (el) el.innerHTML = `<!--a-->${inner}<!--z-->`;
}
async function translateMessage(key, m) {
  const r = await translate(m.body, m.lang, getLang());
  replaceTr(key, m.trId, r ? trInner('done', m.body, m.lang, r.text) : trInner('fail', m.body));
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('.tr-toggle');
  if (!b) return;
  const wrap = b.closest('.tr-wrap');
  const showOrig = !wrap.querySelector('.tr-orig').classList.contains('hidden');
  wrap.querySelector('.tr-orig').classList.toggle('hidden', showOrig);
  wrap.querySelector('.tr-text').classList.toggle('hidden', !showOrig);
  b.innerHTML = `${icon('translate')}${esc(translatedFrom(b.dataset.src))} · ${esc(t(showOrig ? 'Ver original' : 'Ver traducción'))}`;
});

function formatMessage(w, m) {
  const mention = mentionsMe(m);
  const tr = needsTranslation(m);
  if (tr) m.trId = 'tr' + Math.random().toString(36).slice(2, 10);
  const bodyHtml = tr ? trWrap(m.trId, trInner('pending', m.body)) : linkify(m.body);
  const p = w.people.get(m.from);
  const role = roleOf(w, p);
  const nickHtml = `<b class="nick" style="${nickStyle(m.nick)}">${esc(m.nick)}</b>${m.reg ? verified : ''}`;
  if (m.kind === 'action') {
    w.last = null;
    return `<div class="msg action ${mention ? 'mention' : ''}"><span class="gutter"><time>${time(m.ts)}</time></span><div class="msg-body"><span class="star">*</span> ${nickHtml}${roleBadge(w, p)} ${bodyHtml}</div></div>`;
  }
  const grouped = w.last && w.last.from === m.from && w.last.nick === m.nick && m.ts - w.last.ts < 5 * 60 * 1000;
  w.last = { from: m.from, nick: m.nick, ts: m.ts };
  if (grouped) return `<div class="msg cont ${mention ? 'mention' : ''}"><span class="gutter"><time>${time(m.ts)}</time></span><div class="msg-body">${bodyHtml}</div></div>`;
  return `<div class="msg first ${mention ? 'mention' : ''}"><span class="gutter">${avatarWithRole(m.nick, role)}</span><div class="msg-body"><div class="msg-head">${nickHtml}<time>${time(m.ts)}</time></div>${bodyHtml}</div></div>`;
}
function addHtml(key, html, { count = false, mention = false } = {}) {
  const w = state.windows.get(key);
  if (!w) return;
  w.lines.push(html);
  if (w.lines.length > 500) w.lines.shift();
  if (state.active === key) {
    const log = document.getElementById('log');
    log.querySelector('.empty')?.remove();
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    log.insertAdjacentHTML('beforeend', html);
    if (key !== 'status' && log.children.length > 500) log.firstElementChild.remove();
    if (atBottom) log.scrollTop = log.scrollHeight;
  }
  if (count && (state.active !== key || document.hidden)) {
    w.unread = (w.unread || 0) + 1; if (mention) w.mention = true;
    renderChanList(); updateTitle();
  }
}
function addMessage(key, m) {
  const w = state.windows.get(key);
  if (!w) return;
  addHtml(key, formatMessage(w, m), { count: m.from !== state.clientId, mention: mentionsMe(m) });
  if (m.trId) translateMessage(key, m);
}
function sys(key, html, kind = 'info') {
  const w = state.windows.get(key);
  if (!w) return;
  w.last = null;
  addHtml(key, `<div class="sys ${kind}"><span class="gutter"><time>${time(Date.now())}</time></span><div class="msg-body">${html}</div></div>`);
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  const w = state.windows.get(state.active);
  if (w && w.unread) { w.unread = 0; w.mention = false; renderChanList(); updateTitle(); }
});

/* ---------- Barra lateral ---------- */
function renderChanList() {
  const nav = document.getElementById('nav-browse');
  if (!nav) return;
  nav.innerHTML = `<button class="chan ${state.active === 'status' ? 'active' : ''}">${icon('compass')}<span class="chan-name ui">Explorar canales</span></button>`;
  const joined = [...state.windows.values()].filter((w) => w.key !== 'status' && w.kind !== 'dm');
  const dms = [...state.windows.values()].filter((w) => w.kind === 'dm');
  document.getElementById('dm-label').classList.toggle('hidden', !dms.length);
  document.getElementById('dm-list').innerHTML = dms.map((w) => {
    const badge = w.unread ? `<span class="badge mention">${w.unread > 99 ? '99+' : w.unread}</span>` : '';
    return `<button data-win="${esc(w.key)}" class="chan dm ${w.key === state.active ? 'active' : ''} ${w.unread ? 'unread' : ''}" title="${esc(dm.statusText(w))}">
      <span class="dm-dot ${w.status}"></span>${avatar(w.peer.nick)}<span class="chan-name">${esc(w.peer.nick)}</span>${w.call ? `<span class="role admin">${icon('phone')}</span>` : ''}${badge}
      <span class="part" data-part title="Cerrar conversación">${icon('x')}</span></button>`;
  }).join('');
  document.getElementById('chan-list').innerHTML = joined.map((w) => {
    const badge = w.unread ? `<span class="badge ${w.mention ? 'mention' : ''}">${w.unread > 99 ? '99+' : w.unread}</span>` : '';
    return `<button data-win="${esc(w.key)}" class="chan ${w.key === state.active ? 'active' : ''} ${w.unread ? 'unread' : ''}">
      ${icon(w.ch?.is_private ? 'lock' : 'hash')}<span class="chan-name">${esc(w.name.slice(1))}</span>${iAmOwner(w) ? `<span class="role owner" title="Tu canal">${icon('crown')}</span>` : ''}${badge}
      <span class="part" data-part title="Salir del canal">${icon('x')}</span></button>`;
  }).join('') || '<p class="side-empty">Aún no estás en ningún canal.</p>';
}

/* ---------- Explorar canales ---------- */
let browserFilter = '';
function browserHtml() {
  const own = myOwnChannel();
  const q = browserFilter.toLowerCase();
  const list = [...state.channels.values()]
    .map((c) => ({ ...c, n: onlineCount(c.name) }))
    .filter((c) => !q || c.name.toLowerCase().includes(q) || c.topic.toLowerCase().includes(q))
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  let createBox;
  if (!state.registered) createBox = `<div class="create-box muted">${icon('lock')}<span>Para crear tu propio canal, <button class="link" data-act="login">inicia sesión o regístrate</button>.</span></div>`;
  else if (own) createBox = `<div class="create-box">${icon('crown')}<span>Tu canal es <button class="link" data-join="${esc(own.name)}">${esc(own.name)}</button>. Cada usuario puede crear un canal.</span></div>`;
  else createBox = `<button class="btn primary" data-act="create">${icon('plus')} Crear mi canal</button>`;
  const items = list.map((c) => `<button class="room" data-join="${esc(c.name)}">
      <span class="room-ico ${c.is_private ? 'locked' : ''}" title="${c.is_private ? 'Canal privado' : ''}">${icon(c.is_private ? 'lock' : 'hash')}</span>
      <span class="room-info"><b>${esc(c.name.slice(1))}${state.account && c.owner_id === state.account.id ? ` <span class="role owner" title="Tu canal">${icon('crown')}</span>` : ''}</b><small>${c.topic ? esc(c.topic) : '<i>Sin tema</i>'}</small></span>
      <span class="room-count ${c.n ? 'live' : ''}" title="Personas conectadas">${icon('users')}${c.n}</span></button>`).join('');
  return `<div class="browser" id="browser">
    <div class="browser-head"><div><h3>Canales</h3><p class="muted">Elige un canal para entrar.</p></div>${createBox}</div>
    <div class="field search">${icon('search')}<input id="room-filter" placeholder="Buscar canales" value="${esc(browserFilter)}" autocomplete="off"></div>
    <div class="rooms">${items || '<div class="rooms-empty">No hay canales que coincidan.</div>'}</div>
  </div>`;
}
function renderBrowser() {
  if (state.active !== 'status') return;
  const el = document.getElementById('browser');
  if (!el) return;
  const focused = document.activeElement?.id === 'room-filter';
  const pos = document.getElementById('room-filter')?.selectionStart;
  el.outerHTML = browserHtml();
  if (focused) { const i = document.getElementById('room-filter'); i.focus(); i.setSelectionRange(pos, pos); }
}
function renderActiveChannels() { renderBrowser(); }
document.addEventListener('input', (e) => {
  if (e.target.id === 'room-filter') { browserFilter = e.target.value; renderBrowser(); }
});
document.addEventListener('click', (e) => {
  const j = e.target.closest('#log [data-join]');
  if (j) { e.preventDefault(); joinChannel(j.dataset.join); return; }
  const a = e.target.closest('#log [data-act]');
  if (!a) return;
  if (a.dataset.act === 'create') createChannelDialog();
  if (a.dataset.act === 'login') { homeView = 'login'; quitChat(); }
});

async function createChannelDialog() {
  const v = await openDialog({
    title: 'Crear mi canal',
    text: 'Serás su creador y administrador. Cada usuario puede crear un canal.',
    fields: [
      { name: 'name', label: 'Nombre', prefix: '#', max: 30, placeholder: 'mi-canal' },
      { name: 'topic', label: 'Tema (opcional)', max: 300, placeholder: '¿De qué se habla aquí?', multiline: true },
      { name: 'password', label: 'Contraseña (opcional)', type: 'password', max: 72, placeholder: 'Déjala vacía para un canal abierto', hint: 'Con contraseña, el canal es privado: solo entra quien la conozca.' },
    ],
    confirm: 'Crear canal',
    validate: async ({ name, password }) => {
      const n = '#' + name.replace(/^#/, '');
      if (password && (password.length < 4 || password.length > 72)) return 'La contraseña debe tener entre 4 y 72 caracteres.';
      if (!CHAN_RE.test(n)) return 'El nombre solo puede tener letras, números, - o _ (máx. 30).';
      if (state.channels.has(n.toLowerCase())) return 'Ya existe un canal con ese nombre.';
      return '';
    },
  });
  if (!v) return;
  const name = '#' + v.name.replace(/^#/, '');
  const { data: created, error } = await supabase.from('channels').insert({ name, topic: v.topic.slice(0, 300), owner_id: state.account.id }).select('id').single();
  if (!error && v.password) {
    const r = await supabase.rpc('set_channel_password', { p_channel: created.id, p_password: v.password });
    if (r.error) toast(t('No se pudo poner la contraseña:') + ' ' + r.error.message);
  }
  if (error) {
    if (error.code === '23505' && /owner/.test(error.message + error.details)) return toast('Ya tienes un canal creado.');
    if (error.code === '23505') return toast('Ya existe un canal con ese nombre.');
    return toast('No se pudo crear el canal: ' + error.message);
  }
  await loadChannels();
  announceChannelsChanged();
  renderBrowser();
  joinChannel(name);
}

/* ---------- Ventanas ---------- */
function activate(key) {
  const w = state.windows.get(key);
  if (!w) return;
  closeOverlays();
  state.active = key;
  w.unread = 0; w.mention = false;
  const log = document.getElementById('log');
  const isDm = w.kind === 'dm';
  document.getElementById('app').classList.toggle('in-dm', isDm);
  document.getElementById('call-audio').classList.toggle('hidden', !isDm);
  document.getElementById('call-video').classList.toggle('hidden', key === 'status');
  document.getElementById('call-video').title = isDm ? 'Videollamada' : 'Videollamada grupal';
  gc.renderBanner(w);
  if (key === 'status') {
    log.innerHTML = browserHtml() + w.lines.join('');
    log.scrollTop = 0;
  } else if (isDm) {
    log.innerHTML = w.lines.join('');
    log.scrollTop = log.scrollHeight;
  } else {
    log.innerHTML = w.lines.join('') || '<div class="empty">Aún no hay mensajes. ¡Rompe el hielo!</div>';
    log.scrollTop = log.scrollHeight;
  }
  document.getElementById('win-name').innerHTML = key === 'status' ? esc(w.name) : `${icon(w.ch?.is_private ? 'lock' : 'hash', 'title-hash')}<span class="ugc">${esc(w.name.slice(1))}</span>`;
  document.getElementById('chan-menu').classList.toggle('hidden', key === 'status');
  state.setActionMode?.(false);
  document.getElementById('input-form').classList.toggle('hidden', key === 'status');
  const input = document.getElementById('input');
  input.disabled = false;
  if (!isDm) history.replaceState(null, '', key === 'status' ? location.pathname : '#' + w.name.slice(1));
  if (isDm) dm.onActivate(w); else renderTopic();
  renderMembers(); renderChanList(); updateTitle();
  if (key !== 'status' && matchMedia('(pointer:fine)').matches) document.getElementById('input').focus();
}
function renderTopic() {
  const w = state.windows.get(state.active);
  document.getElementById('topic').innerHTML = w.key === 'status' ? 'Elige un canal o crea el tuyo' : (w.ch.topic ? linkify(w.ch.topic) : '<span class="muted">Sin tema</span>');
}
function sortedPeople(w) {
  const rank = (p) => (isOwner(w.ch, p.uid) ? 0 : personIsAdmin(w, p) ? 1 : 2);
  return [...w.people.values()].sort((a, b) => rank(a) - rank(b) || a.nick.localeCompare(b.nick, 'es', { sensitivity: 'base' }));
}
function renderMembers() {
  const w = state.windows.get(state.active);
  const el = document.getElementById('members');
  const btn = document.getElementById('toggle-members');
  const isStatus = w.key === 'status' || w.kind === 'dm';
  el.classList.toggle('hidden', isStatus);
  btn.classList.toggle('hidden', isStatus);
  if (isStatus) return;
  const people = sortedPeople(w);
  const admins = people.filter((p) => personIsAdmin(w, p));
  const rest = people.filter((p) => !personIsAdmin(w, p));
  const row = (p) => `<button class="member" data-cid="${esc(p.cid)}" title="Opciones para ${esc(p.nick)}">${avatarWithRole(p.nick, roleOf(w, p), '<i class="dot on"></i>')}<span class="member-nick" style="${nickStyle(p.nick)}">${esc(p.nick)}</span>${p.reg ? verified : ''}${p.call ? `<span class="in-call" title="En la videollamada">${icon('video')}</span>` : ''}${p.me ? '<small>tú</small>' : ''}</button>`;
  document.getElementById('member-count').textContent = people.length;
  el.innerHTML = (admins.length ? `<div class="side-label">Administradores — ${admins.length}</div>${admins.map(row).join('')}` : '') +
    `<div class="side-label ${admins.length ? 'spaced' : ''}">En línea — ${rest.length}</div>${rest.map(row).join('')}`;
}
function completeNick(input) {
  const w = state.windows.get(state.active);
  const m = input.value.match(/(\S+)$/);
  if (!m || !w.people) return;
  const found = [...w.people.values()].map((p) => p.nick).find((n) => n.toLowerCase().startsWith(m[1].toLowerCase()));
  if (found) input.value = input.value.slice(0, -m[1].length) + found + (m.index === 0 ? ': ' : ' ');
}

/* ===================================================================== */
/* Canal en tiempo real (Broadcast + Presence)                           */
/* ===================================================================== */
function myPresence(w) {
  return { nick: state.nick, reg: state.registered, uid: state.account?.id || null, tmp: !!w.myTmp, call: !!w.inCall };
}
async function joinChannel(name) {
  const key = name.toLowerCase();
  if (state.windows.has(key)) return activate(key);
  if (!state.channels.has(key)) await loadChannels();
  const ch = state.channels.get(key);
  if (!ch) { toast(`El canal ${name} no existe.`); return activate('status'); }

  // Canal privado: el servidor comprueba la contraseña y entrega el secreto del canal
  let secret = null;
  if (ch.is_private) {
    secret = await privateAccess(ch);
    if (!secret) return; // contraseña cancelada: se queda donde estaba
    if (state.windows.has(key)) return activate(key);
  }

  const w = { key, name: ch.name, ch, lines: [], people: new Map(), unread: 0, mention: false, last: null, rt: null, ready: false, myTmp: false, secret };
  state.windows.set(key, w);
  activate(key);
  sys(key, `Has entrado en <b>${esc(ch.name)}</b>${ch.topic ? ` — ${linkify(ch.topic)}` : ''}`, 'join');
  if (iAmOwner(w)) sys(key, 'Eres el creador de este canal. Toca a un usuario de la lista para nombrarlo administrador.', 'info');

  if (ch.is_private) sys(key, `${icon('lock')} ${esc(t('Canal privado: solo entra quien conoce la contraseña.'))}`, 'info');
  const rt = supabase.channel('irc:' + (secret ? 'p:' + secret : key), { config: { broadcast: { self: false }, presence: { key: state.clientId } } });
  const on = (event, fn) => rt.on('broadcast', { event }, ({ payload }) => payload && fn(payload));
  on('msg', (m) => {
    if (typeof m.body !== 'string' || typeof m.nick !== 'string') return;
    m.body = m.body.slice(0, MAX_MSG);
    m.ts = Math.min(Number(m.ts) || Date.now(), Date.now());
    if (!LANGS[m.lang]) delete m.lang;
    addMessage(key, m);
  });
  on('topic', (t) => applyTopic(w, t));
  on('admin', (a) => applyAdmin(w, a));
  on('kick', (k) => applyKick(w, k));
  on('deleted', (d) => applyDeleted(w, d));
  on('rekey', (r) => applyRekey(w, r));
  on('gc', (g) => gc.onSignal(w, g));
  rt.on('presence', { event: 'sync' }, () => {
    const people = new Map();
    for (const [cid, metas] of Object.entries(rt.presenceState())) {
      const p = metas[0];
      if (!p?.nick) continue;
      people.set(cid, { cid, nick: p.nick, reg: !!p.reg, uid: p.uid || null, tmp: !!p.tmp, call: !!p.call, me: cid === state.clientId });
    }
    w.people = people;
    if (state.active === key) renderMembers();
    gc.syncPeers(w);
  })
    .on('presence', { event: 'join' }, ({ key: cid, newPresences }) => {
      // Una actualización de estado (nick, cargo) llega como salida + entrada: no se anuncia
      if (cid === state.clientId || !w.ready || !newPresences[0]?.nick || w.people.has(cid)) return;
      sys(key, `<b>${esc(newPresences[0].nick)}</b> ha entrado`, 'join');
    })
    .on('presence', { event: 'leave' }, ({ key: cid, leftPresences }) => {
      if (cid === state.clientId || !leftPresences[0]?.nick) return;
      setTimeout(() => { if (!rt.presenceState()[cid]) sys(key, `<b>${esc(leftPresences[0].nick)}</b> ha salido`, 'part'); }, 600);
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await rt.track(myPresence(w));
        setTimeout(() => (w.ready = true), 1500);
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') sys(key, 'Problema de conexión; reintentando…', 'err');
    });
  w.rt = rt;
  trackLobby();
}
/** Envía un evento al canal y lo aplica también localmente (broadcast no se devuelve a uno mismo). */
function emit(w, event, payload, apply) {
  const full = { ...payload, byCid: state.clientId, by: state.nick };
  w.rt.send({ type: 'broadcast', event, payload: full });
  apply?.(w, full, true);
}

async function partChannel(key, notice = '') {
  const w = state.windows.get(key);
  if (!w || key === 'status') return;
  gc.onLeaveChannel(w);
  if (w.rt) await supabase.removeChannel(w.rt);
  state.windows.delete(key);
  trackLobby();
  if (notice) sys('status', notice, 'err');
  if (state.active === key) activate('status'); else renderChanList();
}

let lastSend = 0;
function sendMessage(body, kind = 'msg') {
  const w = state.windows.get(state.active);
  if (!w || w.key === 'status') return;
  if (w.kind === 'dm') return dm.sendText(w, body.slice(0, 4000), kind);
  if (Date.now() - lastSend < 250) return toast('Más despacio: espera un momento entre mensajes.');
  lastSend = Date.now();
  const m = { id: crypto.randomUUID().slice(0, 12), from: state.clientId, nick: state.nick, reg: state.registered, kind, body: body.slice(0, MAX_MSG), ts: Date.now(), lang: getLang() };
  addMessage(w.key, m);
  w.rt.send({ type: 'broadcast', event: 'msg', payload: m }).then((r) => {
    if (r !== 'ok') sys(w.key, 'No se pudo enviar el último mensaje (conexión inestable).', 'err');
  });
}

/* ---------- Tema del canal ---------- */
function applyTopic(w, t, local = false) {
  if (typeof t.topic !== 'string') return;
  if (!local && !cidIsAdmin(w, t.byCid)) return;
  w.ch.topic = t.topic.slice(0, 300);
  sys(w.key, `<b>${esc(t.by)}</b> cambió el tema: ${w.ch.topic ? linkify(w.ch.topic) : '<i>(sin tema)</i>'}`, 'topic');
  if (state.active === w.key) renderTopic();
}
async function editTopic(w) {
  const v = await openDialog({ title: `Tema de ${w.name}`, fields: [{ name: 'topic', label: 'Tema', value: w.ch.topic, max: 300, multiline: true, placeholder: '¿De qué se habla aquí?' }], confirm: 'Guardar' });
  if (!v) return;
  const { data, error } = await supabase.from('channels').update({ topic: v.topic.slice(0, 300) }).eq('id', w.ch.id).select('topic');
  if (error || !data?.length) return toast('No tienes permiso para cambiar el tema.');
  emit(w, 'topic', { topic: data[0].topic }, applyTopic);
}

/* ---------- Administradores ---------- */
function applyAdmin(w, a, local = false) {
  if (!local && !cidIsAdmin(w, a.byCid) && !(a.action === 'revoke' && a.byCid === a.cid)) return;
  const target = w.people.get(a.cid);
  const name = target?.nick || a.nick || 'alguien';
  if (a.perm && a.uid) {
    if (a.action === 'grant') w.ch.admins.add(a.uid); else w.ch.admins.delete(a.uid);
  }
  if (a.cid === state.clientId && !a.perm) {
    w.myTmp = a.action === 'grant';
    w.rt.track(myPresence(w));
  }
  if (target && !a.perm) target.tmp = a.action === 'grant';
  const self = a.byCid === a.cid;
  const kind = a.perm ? '' : ' temporal';
  sys(w.key, a.action === 'grant'
    ? `<b>${esc(a.by)}</b> nombró administrador${kind} a <b>${esc(name)}</b>`
    : self ? `<b>${esc(name)}</b> dejó de ser administrador` : `<b>${esc(a.by)}</b> quitó el cargo de administrador a <b>${esc(name)}</b>`, 'topic');
  if (a.cid === state.clientId && a.action === 'grant') toast(`Ahora eres administrador${kind} de ${w.name}`);
  if (state.active === w.key) renderMembers();
  renderChanList();
}
async function grantAdmin(w, p) {
  const perm = !!p.uid && iAmPermAdmin(w);
  if (perm) {
    const { error } = await supabase.from('channel_admins').insert({ channel_id: w.ch.id, user_id: p.uid, granted_by: state.account.id });
    if (error && error.code !== '23505') return toast('No se pudo nombrar administrador: ' + error.message);
  }
  emit(w, 'admin', { action: 'grant', cid: p.cid, uid: p.uid, nick: p.nick, perm }, applyAdmin);
}
async function revokeAdmin(w, p) {
  const perm = isPermAdmin(w.ch, p.uid) && !isOwner(w.ch, p.uid);
  if (perm) {
    const { data, error } = await supabase.from('channel_admins').delete().eq('channel_id', w.ch.id).eq('user_id', p.uid).select();
    if (error || !data?.length) return toast('Solo el creador del canal puede quitar administradores permanentes.');
  }
  emit(w, 'admin', { action: 'revoke', cid: p.cid, uid: p.uid, nick: p.nick, perm }, applyAdmin);
}
async function adminsDialog(w) {
  const ids = [w.ch.owner_id, ...w.ch.admins].filter(Boolean);
  let nicks = new Map();
  if (ids.length) {
    const { data } = await supabase.from('profiles').select('id, nick').in('id', ids);
    nicks = new Map((data || []).map((r) => [r.id, r.nick]));
  }
  const online = new Set([...w.people.values()].map((p) => p.uid).filter(Boolean));
  const temps = [...w.people.values()].filter((p) => p.tmp && !isPermAdmin(w.ch, p.uid));
  const row = (nick, label, on) => `<li>${avatar(nick)}<span><b>${esc(nick)}</b><small>${label}${on ? ' · en línea' : ''}</small></span></li>`;
  const html = `<ul class="admin-list">
    ${w.ch.owner_id ? row(nicks.get(w.ch.owner_id) || '?', 'Creador', online.has(w.ch.owner_id)) : '<li class="muted">Canal del sistema (sin creador)</li>'}
    ${[...w.ch.admins].filter((id) => id !== w.ch.owner_id).map((id) => row(nicks.get(id) || '?', 'Administrador', online.has(id))).join('')}
    ${temps.map((p) => row(p.nick, 'Administrador temporal', true)).join('')}
  </ul>`;
  openDialog({ title: `Administradores de ${w.name}`, text: html, confirm: 'Cerrar' });
  document.querySelector('.dialog [data-cancel]')?.remove();
}

/* ---------- Expulsar ---------- */
function applyKick(w, k, local = false) {
  if (!local && !cidIsAdmin(w, k.byCid)) return;
  if (k.cid === state.clientId) {
    partChannel(w.key, `<b>${esc(k.by)}</b> te expulsó de <b>${esc(w.name)}</b>.`);
    toast(`Te expulsaron de ${w.name}`);
    return;
  }
  sys(w.key, `<b>${esc(k.by)}</b> expulsó a <b>${esc(k.nick)}</b> del canal`, 'part');
}
function canKick(w, p) {
  if (p.me || isOwner(w.ch, p.uid)) return false;
  if (iAmOwner(w)) return true;
  return iAmAdmin(w) && !personIsAdmin(w, p);
}

/* ---------- Borrar canal ---------- */
function applyDeleted(w, d, local = false) {
  if (!local && !(d.byCid && w.people.get(d.byCid)?.uid === w.ch.owner_id)) return;
  state.channels.delete(w.key);
  partChannel(w.key, local ? `Eliminaste el canal <b>${esc(w.name)}</b>.` : `<b>${esc(d.by)}</b> eliminó el canal <b>${esc(w.name)}</b>.`);
  renderBrowser();
}
async function deleteChannel(w) {
  const ok = await openDialog({ title: `Eliminar ${w.name}`, text: 'Se cerrará para todas las personas conectadas y se borrarán sus administradores. Después podrás crear otro canal.', confirm: 'Eliminar canal', danger: true });
  if (!ok) return;
  const { data, error } = await supabase.from('channels').delete().eq('id', w.ch.id).select('id');
  if (error || !data?.length) return toast('No se pudo eliminar el canal.');
  emit(w, 'deleted', {}, applyDeleted);
  announceChannelsChanged();
}

/* ---------- Menús ---------- */
function memberMenu(anchor, cid) {
  const w = state.windows.get(state.active);
  const p = w?.people.get(cid);
  if (!p) return;
  const items = [];
  if (!p.me) items.push({ label: 'Mensaje privado', hint: 'También con doble clic en el nick', icon: 'message', onClick: () => openPrivate(p.cid) });
  if (!p.me) items.push({ label: 'Mencionar', icon: 'at', onClick: () => { const i = document.getElementById('input'); i.value = (i.value ? i.value.replace(/\s*$/, ' ') : '') + p.nick + (i.value ? ' ' : ': '); i.focus(); document.getElementById('app').classList.remove('members-open'); } });
  if (iAmAdmin(w) && !p.me) {
    if (!personIsAdmin(w, p)) {
      const perm = !!p.uid && iAmPermAdmin(w);
      items.push({ label: 'Hacer administrador', hint: perm ? 'Permanente: lo conserva en su cuenta' : p.uid ? 'Temporal: solo un admin registrado puede darlo permanente' : 'Temporal: hasta que salga del canal', icon: 'shield', onClick: () => grantAdmin(w, p) });
    } else if (!isOwner(w.ch, p.uid) && (iAmOwner(w) || (p.tmp && !isPermAdmin(w.ch, p.uid)))) {
      items.push({ label: 'Quitar administrador', icon: 'shield-off', onClick: () => revokeAdmin(w, p) });
    }
    if (canKick(w, p)) items.push('-', { label: 'Expulsar del canal', icon: 'door', danger: true, onClick: () => emit(w, 'kick', { cid: p.cid, nick: p.nick }, applyKick) });
  }
  if (p.me && iAmAdmin(w) && !iAmOwner(w)) items.push({ label: 'Dejar de ser administrador', icon: 'shield-off', onClick: () => revokeAdmin(w, p) });
  if (p.me) items.push({ label: 'Cambiar mi nick', icon: 'edit', onClick: changeNickDialog });
  const role = isOwner(w.ch, p.uid) ? 'Creador del canal' : personIsAdmin(w, p) ? (isPermAdmin(w.ch, p.uid) ? 'Administrador' : 'Administrador temporal') : p.reg ? 'Usuario registrado' : 'Invitado';
  openMenu(anchor, items.length ? items : [{ label: 'Sin acciones disponibles', disabled: true }], { title: `${avatarWithRole(p.nick, roleOf(w, p))}<span><b>${esc(p.nick)}</b><small>${role}</small></span>` });
}
function channelMenu(anchor) {
  const w = state.windows.get(state.active);
  if (!w || w.key === 'status') return;
  if (w.kind === 'dm') {
    const open = w.status === 'open';
    return openMenu(anchor, [
      { label: 'Llamada de voz', icon: 'phone', disabled: !open || !!w.call, onClick: () => dm.startCall(w, false) },
      { label: 'Videollamada', icon: 'video', disabled: !open || !!w.call, onClick: () => dm.startCall(w, true) },
      { label: 'Enviar archivo', icon: 'clip', disabled: !open, onClick: () => document.getElementById('file-input').click() },
      { label: 'Exportar a PDF', icon: 'pdf', onClick: () => exportPdf(w) },
      { label: 'Limpiar pantalla', icon: 'eraser', onClick: () => { w.lines = []; w.last = null; document.getElementById('log').innerHTML = ''; } },
      '-',
      { label: 'Cerrar conversación', icon: 'x', danger: true, onClick: () => dm.closeWindow(w) },
    ], { title: `${avatar(w.peer.nick)}<span><b>${esc(w.peer.nick)}</b><small>${esc(dm.statusText(w))}</small></span>` });
  }
  const items = [];
  if (iAmPermAdmin(w)) items.push({ label: 'Editar tema', icon: 'edit', onClick: () => editTopic(w) });
  items.push({ label: participantsInCall(w) ? 'Unirse a la videollamada' : 'Iniciar videollamada grupal', icon: 'video', onClick: () => gc.join(w) });
  items.push({ label: 'Ver administradores', icon: 'shield', onClick: () => adminsDialog(w) });
  items.push({ label: 'Copiar enlace del canal', icon: 'link', onClick: () => navigator.clipboard?.writeText(location.origin + '/#' + w.name.slice(1)).then(() => toast('Enlace copiado')) });
  items.push({ label: 'Exportar a PDF', icon: 'pdf', onClick: () => exportPdf(w) });
  items.push({ label: 'Limpiar pantalla', icon: 'eraser', onClick: () => { w.lines = []; w.last = null; document.getElementById('log').innerHTML = ''; } });
  items.push('-', { label: 'Salir del canal', icon: 'door', onClick: () => partChannel(w.key) });
  if (iAmOwner(w)) {
    items.push({ label: w.ch.is_private ? 'Cambiar contraseña' : 'Hacer privado (con contraseña)', icon: 'lock', onClick: () => passwordDialog(w) });
    if (w.ch.is_private) items.push({ label: 'Quitar contraseña (hacer abierto)', icon: 'unlock', onClick: () => changePassword(w, null) });
    items.push({ label: 'Eliminar canal', icon: 'trash', danger: true, onClick: () => deleteChannel(w) });
  }
  openMenu(anchor, items, { title: `<span><b>${esc(w.name)}</b><small>${w.ch.owner_id ? (iAmOwner(w) ? 'Tu canal' : iAmAdmin(w) ? 'Eres administrador' : 'Canal de usuario') : 'Canal del sistema'}</small></span>` });
}
function userMenu(anchor) {
  const acc = state.registered ? state.account : null;
  const items = [];
  if (acc?.number) items.push({ label: 'Mi número', html: `<span>${esc(t('Mi número'))}: <b class="ugc">${fmtNumber(acc.number)}</b></span>`, hint: 'Tócalo para copiarlo y compartirlo con tus amigos', icon: 'hash', onClick: () => navigator.clipboard?.writeText(String(acc.number)).then(() => toast(t('Número copiado'))) });
  if (acc) items.push({ label: 'Nombre y apellido', hint: acc.firstName ? `${acc.firstName} ${acc.lastName}` : '', icon: 'users', onClick: editNameDialog });
  items.push(
    { label: 'Cambiar mi nick', icon: 'edit', onClick: changeNickDialog },
    { label: document.documentElement.dataset.theme === 'dark' ? 'Tema claro' : 'Tema oscuro', icon: document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon', onClick: toggleTheme },
    { label: 'Idioma', html: `<span class="lang-opt">${esc(t('Idioma'))}: ${flag(getLang())}<span class="ugc">${esc(LANGS[getLang()])}</span></span>`, icon: 'globe', onClick: () => languageMenu(anchor) },
  );
  if (state.registered && !myOwnChannel()) items.push({ label: 'Crear mi canal', icon: 'plus', onClick: () => { activate('status'); createChannelDialog(); } });
  items.push('-', { label: 'Salir del chat', icon: 'logout', onClick: quitChat });
  if (state.registered) items.push({ label: 'Cerrar sesión', icon: 'lock', danger: true, onClick: async () => { await quitChat(); await supabase.auth.signOut(); state.account = null; renderHome('Sesión cerrada.', 'ok'); } });
  openMenu(anchor, items, { title: `${avatar(state.nick)}<span><b>${esc(state.nick)}</b><small>${state.registered ? 'Usuario registrado' : 'Invitado'}</small></span>` });
}

async function editNameDialog() {
  const acc = state.account;
  const v = await openDialog({
    title: 'Nombre y apellido',
    text: esc(t('Solo los verán tus amigos.')),
    fields: [{ name: 'first', label: 'Nombre', value: acc.firstName, max: 60 }, { name: 'last', label: 'Apellido', value: acc.lastName, max: 60 }],
    confirm: 'Guardar',
    validate: async ({ first, last }) => (!first || !last ? t('Escribe tu nombre y apellido.') : ''),
  });
  if (!v) return;
  const { error } = await supabase.rpc('set_my_name', { p_first: v.first, p_last: v.last });
  if (error) return toast(error.message);
  acc.firstName = v.first; acc.lastName = v.last;
  toast(t('Guardado.'));
}

function languageMenu(anchor) {
  openMenu(anchor, Object.entries(LANGS).map(([k, v]) => ({
    label: v, html: `<span class="lang-opt">${flag(k)}<span class="ugc">${esc(v)}</span>${k === getLang() ? ' ✓' : ''}</span>`, onClick: () => {
      setLang(k);
      // Se vuelve a pintar la interfaz en el nuevo idioma
      const active = state.active;
      renderChanList(); updateMe(); updateThemeBtn();
      activate(active);
      retranslate();
    },
  })), { title: `${icon('globe')}<span><b class="ugc">${esc(t('Idioma'))}</b></span>` });
}

async function changeNickDialog() {
  const v = await openDialog({
    title: 'Cambiar mi nick',
    text: state.registered ? 'El nuevo nick quedará reservado en tu cuenta.' : 'Como invitado, el nick dura mientras estés conectado.',
    fields: [{ name: 'nick', label: 'Nuevo nick', prefix: '@', value: state.nick, max: 20 }],
    confirm: 'Cambiar',
    validate: async ({ nick }) => (nick.toLowerCase() === state.nick.toLowerCase() ? '' : await nickProblem(nick)),
  });
  if (!v || v.nick === state.nick) return;
  const nick = v.nick;
  if (state.registered) {
    const { error } = await supabase.from('profiles').update({ nick }).eq('id', state.account.id);
    if (error) return toast(error.code === '23505' ? `El nick ${nick} ya está reservado.` : error.message);
    state.account.nick = nick;
  } else store.set('lastNick', nick);
  const old = state.nick;
  state.nick = nick;
  updateMe();
  trackLobby();
  dm.onNickChange(nick);
  for (const w of state.windows.values()) {
    if (!w.rt || w.kind === 'dm') continue;
    w.rt.track(myPresence(w));
    w.rt.send({ type: 'broadcast', event: 'msg', payload: { from: state.clientId, nick, reg: state.registered, kind: 'action', body: `ahora se llama ${nick} (antes ${old})`, ts: Date.now(), lang: 'es' } });
    sys(w.key, `Ahora eres <b>${esc(nick)}</b>`, 'info');
  }
}

async function quitChat() {
  closeOverlays();
  dm.closeAll();
  for (const w of state.windows.values()) if (w.rt && w.kind !== 'dm') await supabase.removeChannel(w.rt);
  state.windows.clear();
  state.nick = null;
  state.lobby.untrack();
  history.replaceState(null, '', location.pathname);
  renderHome();
}

/* ---------- Sonidos (generados, sin archivos) ---------- */
let audioCtx;
function beep(freqs = [880, 1320], dur = 0.12, vol = 0.08) {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    freqs.forEach((f, i) => {
      const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
      o.frequency.value = f;
      const t = audioCtx.currentTime + i * dur;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(audioCtx.destination); o.start(t); o.stop(t + dur + 0.02);
    });
  } catch { /* sin audio */ }
}
function loopTone(kind) {
  const play = () => (kind === 'ring' ? beep([660, 880, 660, 880], 0.18, 0.12) : beep([440, 480], 0.6, 0.05));
  play();
  const t = setInterval(play, kind === 'ring' ? 2200 : 3000);
  return () => clearInterval(t);
}

/* ---------- Privados ---------- */
const dm = createDM({
  state, supabase, esc, icon, avatar, nickStyle, linkify, time, verified, toast, beep, loopTone,
  sys, addHtml, activate: (k) => activate(k),
  findPerson: (nick) => {
    for (const w of state.windows.values()) for (const p of w.people?.values() || []) if (!p.me && p.nick.toLowerCase() === nick.toLowerCase()) return { cid: p.cid, nick: p.nick, reg: p.reg };
    return null;
  }, ensureIce: () => loadIceServers(SUPABASE_URL, SUPABASE_KEY), renderChanList: () => renderChanList(), updateTitle: () => updateTitle(),
});
function openPrivate(cid) {
  const w = state.windows.get(state.active);
  const p = w?.people?.get(cid);
  if (!p || p.me) return;
  document.getElementById('app').classList.remove('members-open');
  dm.requestPrivate({ cid: p.cid, nick: p.nick, reg: p.reg });
}

/* ---------- Exportar la conversación abierta a PDF ---------- */
// Se genera en el navegador a partir de lo que hay en pantalla (traducciones incluidas)
// y se usa "Guardar como PDF" del diálogo de impresión: respeta acentos, emojis y fotos.
async function exportPdf(w) {
  if (state.active !== w.key) activate(w.key);
  const log = document.getElementById('log');
  if (!w.lines.length || !log) return toast(t('No hay nada que exportar.'));
  toast(t('Preparando el PDF… elige "Guardar como PDF" en la ventana de impresión.'));
  const isDm = w.kind === 'dm';
  const now = new Date();
  const when = now.toLocaleString(getLang(), { dateStyle: 'long', timeStyle: 'short' });
  const people = isDm ? [state.nick, w.peer.nick] : [...w.people.values()].map((p) => p.nick);
  const title = isDm ? `${t('Conversación privada con')} ${w.peer.nick}` : w.name;
  const css = [...document.styleSheets].map((ss) => { try { return [...ss.cssRules].map((r) => r.cssText).join('\n'); } catch { return ''; } }).join('\n');
  const fileName = `chamuflac_${(isDm ? w.peer.nick : w.name.slice(1)).replace(/[^\w-]/g, '')}_${now.toISOString().slice(0, 16).replace(/[:T]/g, '-')}`;
  const html = `<!doctype html><html lang="${getLang()}" data-theme="light"><head><meta charset="utf-8"><title>${esc(fileName)}</title>
    <style>${css}
      html, body { overflow: visible !important; height: auto !important; background: #fff !important; }
      .app { display: block !important; height: auto !important; box-shadow: none !important; }
      .log { overflow: visible !important; height: auto !important; padding: 0 !important; }
      .pdf-head { border-bottom: 2px solid #6355f0; padding: 0 0 12px; margin: 0 0 14px; font-family: system-ui, sans-serif; }
      .pdf-head h1 { margin: 0 0 4px; font-size: 20px; color: #171a21; }
      .pdf-head p { margin: 2px 0; color: #5f6678; font-size: 12px; }
      .pdf-foot { margin-top: 18px; padding-top: 8px; border-top: 1px solid #ddd; color: #5f6678; font-size: 11px; font-family: system-ui, sans-serif; }
      .tr-toggle, .voice-play, .voice-speed, .browser, .tr-note { display: none !important; }
      .tr-orig.hidden { display: block !important; color: #5f6678; font-size: .85em; font-style: italic; }
      .tr-orig.hidden::before { content: '↳ '; }
      .tr-text.hidden { display: inline !important; }
      .gutter time { opacity: 1 !important; }
      .msg, .sys, .bub-row { break-inside: avoid; }
      video { display: none !important; }
      .bmedia img, .att-media img { max-height: 320px; }
      @page { margin: 14mm; }
    </style></head>
    <body><header class="pdf-head"><h1>${esc(title)}</h1>
      <p>${esc(t('Exportado el'))} ${esc(when)} · ${APP_NAME}</p>
      <p>${esc(t('Participantes'))}: ${people.map(esc).join(', ')}</p></header>
      <div class="app ${isDm ? 'in-dm' : ''}"><div class="log">${log.innerHTML}</div></div>
      <p class="pdf-foot">${esc(t('Las conversaciones no se guardan en ningún servidor: este documento es la única copia.'))}</p></body></html>`;
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  doc.open(); doc.write(html); doc.close();
  await Promise.all([...doc.images].map((img) => (img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; }))));
  await new Promise((r) => setTimeout(r, 250));
  frame.contentWindow.focus();
  frame.contentWindow.print();
  setTimeout(() => frame.remove(), 60000);
}

/* ---------- Canales privados ---------- */
const pwKey = (ch) => 'chpw:' + ch.id;
const sessionGetPw = (ch) => { try { return sessionStorage.getItem(pwKey(ch)); } catch { return null; } };
const sessionSetPw = (ch, v) => { try { v ? sessionStorage.setItem(pwKey(ch), v) : sessionStorage.removeItem(pwKey(ch)); } catch { /* nada */ } };
/** Devuelve el secreto del canal privado (pidiendo la contraseña si hace falta) o null si se cancela. */
async function privateAccess(ch) {
  const ask = async (pw) => supabase.rpc('channel_access', { p_channel: ch.id, p_password: pw ?? null });
  const saved = sessionGetPw(ch);
  let r = null;
  if (saved || state.registered) { // los admins registrados entran sin contraseña
    r = await ask(saved);
    if (!r.error && r.data) return r.data;
    if (r.error && r.error.code !== '28P01') { toast(r.error.message); return null; }
  }
  let secret = null;
  const v = await openDialog({
    title: `${ch.name}`,
    text: esc(t('Este canal es privado. Escribe la contraseña para entrar.')),
    fields: [{ name: 'pw', label: 'Contraseña', type: 'password', max: 72 }],
    confirm: 'Entrar',
    validate: async ({ pw }) => {
      if (!pw) return t('Escribe la contraseña.');
      r = await ask(pw);
      if (r.error) return r.error.code === '28P01' ? t('Contraseña incorrecta.') : r.error.message;
      secret = r.data;
      sessionSetPw(ch, pw);
      return '';
    },
  });
  return v ? secret : null;
}
async function passwordDialog(w) {
  const v = await openDialog({
    title: w.ch.is_private ? 'Cambiar contraseña' : 'Hacer privado (con contraseña)',
    text: esc(t('Las personas conectadas (salvo los administradores registrados) tendrán que volver a entrar con la nueva contraseña.')),
    fields: [{ name: 'pw', label: 'Nueva contraseña', type: 'password', max: 72, placeholder: 'Entre 4 y 72 caracteres' }],
    confirm: 'Guardar',
    validate: async ({ pw }) => (pw.length < 4 || pw.length > 72 ? t('La contraseña debe tener entre 4 y 72 caracteres.') : ''),
  });
  if (v) changePassword(w, v.pw);
}
async function changePassword(w, pw) {
  const { error } = await supabase.rpc('set_channel_password', { p_channel: w.ch.id, p_password: pw });
  if (error) return toast(error.message);
  sessionSetPw(w.ch, pw);
  // Todos salen del canal anterior; el creador vuelve a entrar al nuevo
  emit(w, 'rekey', { private: !!pw });
  announceChannelsChanged();
  const name = w.name;
  await partChannel(w.key);
  await loadChannels();
  toast(pw ? t('Contraseña guardada.') : t('El canal ahora es abierto.'));
  joinChannel(name);
}
function applyRekey(w, r, local = false) {
  if (local) return;
  if (!(r.byCid && w.people.get(r.byCid)?.uid === w.ch.owner_id)) return;
  sessionSetPw(w.ch, null);
  const name = w.name;
  partChannel(w.key, `<b>${esc(r.by)}</b> ${esc(t('cambió el acceso a'))} <b>${esc(name)}</b>. ${esc(t('Vuelve a entrar para seguir.'))}`);
  toast(`${name}: ${t('cambió el acceso. Vuelve a entrar.')}`);
  loadChannels().then(() => { renderBrowser(); renderChanList(); });
}

/* ---------- Videollamadas grupales ---------- */
const participantsInCall = (w) => [...(w.people?.values() || [])].filter((p) => p.call).length;
const gc = createGroupCall({ state, esc, icon, avatar, toast, t, ensureIce: () => loadIceServers(SUPABASE_URL, SUPABASE_KEY), retrack: (w) => w.rt?.track(myPresence(w)) });
