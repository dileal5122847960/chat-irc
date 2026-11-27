/*
 * ChamuFlac para Android — amigos y privados
 * ───────────────────────────────────────────
 * • Bienvenida: mientras se ve el logo, comprueba la versión (check_app_version) y la
 *   sesión guardada. Si la versión es obsoleta, pide actualizar antes de seguir.
 * • La sesión queda recordada en el teléfono: no vuelve a pedir el usuario.
 * • Amigos por número de usuario (8 dígitos): buscar, solicitudes, aceptar, bloquear.
 * • Privados con amigos: el mismo motor que la web (src/dm.js): conexión directa cifrada,
 *   texto, fotos, vídeos, documentos, notas de voz, llamadas y videollamadas.
 * • Bandeja privada "user:<número>" (solo el dueño escucha y solo sus amigos escriben).
 * • Con la app cerrada, los avisos push (función "push" + Firebase) la despiertan.
 */
import '../style.css';
import './app.css';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY } from '../config.js';
import { createDM, loadIceServers } from '../dm.js';
import { createMailbox } from '../mailbox.js';
import { createGroups } from '../groups.js';
import { mountAds } from '../ads.js';
import { qrSvg, scanQR, friendLink, numberFromQr } from '../qr.js';
import { photos, chooseAndEditPhoto, editPhoto, display, applyDisplay, FONT_SIZES, FONT_LABELS, WALLPAPERS, wallSwatch, ACCENTS, accentSwatch } from '../profile.js';
import { t, LANGS, getLang, setLang, initialLang, startI18n, retranslate } from '../i18n.js';
import { APP_NAME, logoSvg, flag } from '../brand.js';
import { esc, icon, verified, nickStyle, avatar, time, linkify, loopTone, playTone, sounds, TONES } from '../common.js';
import {
  isNative, isApp, isDesktop, platform, AUTH_REDIRECT, hideSplash, openExternal, closeExternal, installUpdate, initAppEvents,
  deviceName, initPush, initLocal, notify, clearNotifications, isForeground, shareFile, saveFile, canShareFiles,
} from './native.js';

export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
const NICK_RE = /^[A-Za-z[\]\\`_^{|}][A-Za-z0-9[\]\\`_^{|}-]{1,19}$/;
const SPLASH_MIN = 1200; // la bienvenida se ve al menos este tiempo

setLang(initialLang());
applyDisplay(); // tamaño de letra y fondo elegidos en este dispositivo
startI18n();

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { flowType: 'pkce', detectSessionInUrl: false, persistSession: true, autoRefreshToken: true, storageKey: 'chamuflac-app-auth' },
  realtime: { params: { eventsPerSecond: 20 } },
});

const root = document.getElementById('root');
const store = {
  get: (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } },
  set: (k, v) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* nada */ } },
};

const state = {
  clientId: null, // mi número de usuario (texto): identifica mi bandeja y mi presencia
  nick: null,
  registered: true,
  account: null, // { id, email, nick, number, firstName, lastName }
  windows: new Map(), // privados abiertos (dm.js)
  active: 'status', // 'status' = portada; 'dm:<número>' = conversación a la vista
  friends: new Map(), // número (texto) → { number, nick, first, last, status, byMe }
  tab: store.get('tab') || 'chats',
  update: null, // { status, latest, notes, url }
  ready: false,
  pendingTaps: [],
  inboxOk: null,
};

/* ---------- Tema ---------- */
function applyTheme(th) { document.documentElement.dataset.theme = th; store.set('theme', th); }
applyTheme(store.get('theme') || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));

/* ===================================================================== */
/* Arranque: bienvenida → versión → sesión                               */
/* ===================================================================== */

function renderSplash(text = 'Iniciando…') {
  root.innerHTML = `<section class="m-splash">
    <div class="m-splash-logo">${logoSvg(96, 'sp')}</div>
    <h1 class="ugc">${APP_NAME}</h1>
    <p class="m-tag">Tus amigos, en privado</p>
    <div class="m-splash-foot"><span class="spinner"></span><span id="splash-text">${esc(t(text))}</span></div>
    <small class="m-ver">v${esc(APP_VERSION)}</small>
  </section>`;
  hideSplash();
}
const splashText = (s) => { const el = document.getElementById('splash-text'); if (el) el.textContent = t(s); };
function renderError(e) {
  root.innerHTML = `<section class="m-splash"><div class="m-splash-logo">${logoSvg(72, 'er')}</div>
    <h1>No se pudo iniciar</h1><p class="m-tag ugc">${esc(e?.message || String(e))}</p>
    <button class="btn primary" id="retry">Reintentar</button></section>`;
  document.getElementById('retry').onclick = () => location.reload();
}

async function boot() {
  const started = Date.now();
  splashText('Comprobando versión…');
  const [ver, sess] = await Promise.all([checkVersion(), supabase.auth.getSession()]);
  await new Promise((r) => setTimeout(r, Math.max(0, SPLASH_MIN - (Date.now() - started))));
  if (ver?.status === 'required') return renderUpdateRequired(ver);
  const session = sess.data.session;
  if (!session) return renderAuth('login');
  splashText('Conectando…');
  await afterLogin(session.user);
}

/* ---------- Versión ---------- */
let lastVersionCheck = 0;
async function checkVersion() {
  lastVersionCheck = Date.now();
  try {
    const { data, error } = await supabase.rpc('check_app_version', { p_platform: platform, p_version: APP_VERSION });
    if (error) return null;
    const r = Array.isArray(data) ? data[0] : data;
    if (!r) return null;
    state.update = { status: r.status, latest: r.latest_version, notes: r.notes || '', url: r.download_url || '' };
    return state.update;
  } catch { return null; }
}
function renderUpdateRequired(v) {
  root.innerHTML = `<section class="m-splash m-update">
    <div class="m-splash-logo">${logoSvg(80, 'up')}</div>
    <h1>Actualización obligatoria</h1>
    <p class="m-tag">Hay una versión nueva. Para seguir usando la app tienes que instalarla.</p>
    <p class="m-newver ugc">v${esc(APP_VERSION)} → <b>v${esc(v.latest)}</b></p>
    ${v.notes ? `<p class="m-notes ugc">${esc(v.notes)}</p>` : ''}
    <button class="btn primary block" id="do-update" ${v.url ? '' : 'disabled'}>${icon('download')} Descargar e instalar</button>
    <p class="m-hint">${platform === 'windows' ? 'Se descargará e instalará sola; luego ChamuFlac se abrirá de nuevo.' : 'Al terminar la descarga, ábrela e instala. Si Android lo pide, permite instalar aplicaciones desde esta fuente.'}</p>

  </section>`;
  document.getElementById('do-update').onclick = () => installUpdate(v.url);
}
function renderUpdateStrip() {
  const el = document.getElementById('update-strip');
  if (!el) return;
  const u = state.update;
  const show = u?.status === 'available' && u.url && store.get('skipVersion') !== u.latest;
  el.classList.toggle('hidden', !show);
  if (show) {
    el.innerHTML = `<span>✨ ${esc(t('Nueva versión disponible'))} <b class="ugc">v${esc(u.latest)}</b></span>
      <button class="btn small primary" data-update>${esc(t('Actualizar'))}</button><button class="icon-btn sm" data-skip title="Más tarde">${icon('x')}</button>`;
    el.querySelector('[data-update]').onclick = () => installUpdate(u.url);
    el.querySelector('[data-skip]').onclick = () => { store.set('skipVersion', u.latest); renderUpdateStrip(); };
  }
}

/* ===================================================================== */
/* Acceso: ingresar / crear cuenta / Google                              */
/* ===================================================================== */
let pendingUser = null;
function renderAuth(mode = 'login', message = '', kind = 'error') {
  const reg = mode === 'register';
  const setup = mode === 'setup'; // cuenta sin nick o sin nombre (p. ej. primera vez con Google)
  const needNick = setup && !state.account;
  root.innerHTML = `<section class="m-auth">
    <header class="m-auth-head">${logoSvg(56, 'au')}<h1 class="ugc">${APP_NAME}</h1>
      <p class="m-tag">${setup ? 'Completa tu perfil' : reg ? 'Crea tu cuenta' : 'Tus amigos, en privado'}</p></header>
    <form class="m-form" id="auth-form" novalidate>
      ${reg || needNick ? `<label>Nick<input name="nick" autocomplete="username" maxlength="20" placeholder="tu_nick" value="${esc(suggestNick())}" required></label>` : ''}
      ${reg || setup ? `<div class="name-row"><label>Nombre<input name="first" autocomplete="given-name" maxlength="60" value="${esc(suggestName('first'))}" required></label>
        <label>Apellido<input name="last" autocomplete="family-name" maxlength="60" value="${esc(suggestName('last'))}" required></label></div>
        <p class="m-hint">Tu nombre y apellido solo los verán tus amigos.</p>` : ''}
      ${setup ? '' : `<label>Correo electrónico<input name="email" type="email" autocomplete="email" inputmode="email" value="${esc(store.get('lastEmail'))}" required></label>
        <label>Contraseña<input name="password" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}" minlength="6" required></label>`}
      <p class="m-msg ${kind}" id="auth-msg">${message}</p>
      <button class="btn primary block" type="submit">${setup ? 'Continuar' : reg ? 'Crear cuenta' : 'Ingresar'}</button>
      ${setup ? `<button type="button" class="link" id="auth-out">Cerrar sesión</button>` : `
        <div class="m-or"><span>o</span></div>
        <button type="button" class="btn google block" id="google-btn">${GOOGLE_SVG} Continuar con Google</button>
        <button type="button" class="link" id="auth-switch">${reg ? 'Ya tengo cuenta: ingresar' : '¿No tienes cuenta? Crear una'}</button>`}
    </form>
    <div class="m-auth-foot"><button type="button" class="chip-btn" id="lang-btn">${flag(getLang())} ${esc(LANGS[getLang()])}</button></div>
  </section>`;
  hideSplash();
  const form = document.getElementById('auth-form');
  form.onsubmit = (e) => { e.preventDefault(); submitAuth(form, mode); };
  document.getElementById('auth-switch')?.addEventListener('click', () => renderAuth(reg ? 'login' : 'register'));
  document.getElementById('google-btn')?.addEventListener('click', signInWithGoogle);
  document.getElementById('auth-out')?.addEventListener('click', logout);
  document.getElementById('lang-btn').onclick = () => languageMenu(() => renderAuth(mode));
}
const GOOGLE_SVG = '<svg class="ico" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2A11.9 11.9 0 0 1 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3a12 12 0 0 1-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z"/></svg>';
function suggestNick() {
  if (state.account) return '';
  const meta = pendingUser?.user_metadata || {};
  return String(meta.nick || meta.name || meta.full_name || '').replace(/[^A-Za-z0-9_-]/g, '').replace(/^\d+/, '').slice(0, 20);
}
function suggestName(part) {
  if (state.account) return part === 'first' ? state.account.firstName : state.account.lastName;
  const meta = pendingUser?.user_metadata || {};
  if (part === 'first') return meta.given_name || meta.first_name || String(meta.full_name || meta.name || '').split(' ')[0] || '';
  return meta.family_name || meta.last_name || String(meta.full_name || meta.name || '').split(' ').slice(1).join(' ') || '';
}
const setAuthMsg = (html, kind = 'error') => { const el = document.getElementById('auth-msg'); if (el) { el.className = 'm-msg ' + kind; el.innerHTML = html; } };

async function submitAuth(form, mode) {
  const btn = form.querySelector('button[type=submit]');
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = t('Comprobando…');
  const fail = (html) => { btn.disabled = false; btn.textContent = label; setAuthMsg(html); };
  try {
    const f = Object.fromEntries(new FormData(form));
    const names = 'first' in f ? { first: f.first.trim(), last: f.last.trim() } : null;
    if (names && (!names.first || !names.last)) return fail(esc(t('Escribe tu nombre y apellido.')));
    if ('nick' in f) {
      const nick = f.nick.trim();
      if (!NICK_RE.test(nick)) return fail(esc(t('Ese nick no es válido: 2–20 caracteres, letras, números y _ - [ ] { } ^ |, sin empezar por número.')));
      if (mode === 'register') {
        const { data } = await supabase.rpc('nick_available', { p_nick: nick });
        if (data === false) return fail(esc(t('Ese nick ya está registrado. Elige otro.')));
      }
    }
    if (mode === 'login') {
      store.set('lastEmail', f.email.trim());
      const { data, error } = await supabase.auth.signInWithPassword({ email: f.email.trim(), password: f.password });
      if (error) return fail(esc(t(error.message === 'Invalid login credentials' ? 'Correo o contraseña incorrectos.' : error.message)));
      return afterLogin(data.user);
    }
    if (mode === 'register') {
      store.set('lastEmail', f.email.trim());
      const { data, error } = await supabase.auth.signUp({
        email: f.email.trim(), password: f.password,
        options: { data: { nick: f.nick.trim(), first_name: names.first, last_name: names.last } },
      });
      if (error) return fail(esc(t(/already registered|already exists/i.test(error.message) ? 'Ese correo ya tiene una cuenta. Inicia sesión.' : error.message)));
      if (!data.session) return renderAuth('login', esc(t('Cuenta creada. Ya puedes ingresar.')), 'ok');
      return afterLogin(data.user);
    }
    // Completar perfil
    if (!state.account) {
      const { error } = await supabase.rpc('claim_nick', { p_nick: f.nick.trim() });
      if (error) return fail(esc(t(error.code === '23505' ? 'Ese nick ya está registrado. Elige otro.' : error.message)));
    }
    const { error } = await supabase.rpc('set_my_name', { p_first: names.first, p_last: names.last });
    if (error) return fail(esc(error.message));
    const { data: { user } } = await supabase.auth.getUser();
    return afterLogin(user);
  } catch (e) { fail(esc(e.message || String(e))); }
}

async function signInWithGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: isApp ? AUTH_REDIRECT : location.origin + location.pathname, skipBrowserRedirect: true } });
  if (error) return setAuthMsg(esc(error.message));
  openExternal(data.url);
}
/** Vuelta del acceso con Google: com.chamuflac.app://auth?code=… */
async function handleAuthUrl(url) {
  if (!url?.startsWith(AUTH_REDIRECT)) return;
  closeExternal();
  const u = new URL(url.replace(AUTH_REDIRECT, 'https://x/auth'));
  const code = u.searchParams.get('code');
  const err = u.searchParams.get('error_description');
  if (err) return renderAuth('login', esc(err));
  if (!code) return;
  renderSplash('Conectando…');
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return renderAuth('login', esc(error.message));
  afterLogin(data.user);
}

/** Con sesión: carga la cuenta; si falta el nick o el nombre, los pide; si no, entra. */
async function afterLogin(user) {
  const { data, error } = await supabase.rpc('my_account');
  if (error) {
    if (/JWT|token|session/i.test(error.message)) { await supabase.auth.signOut(); return renderAuth('login'); }
    throw error;
  }
  const p = Array.isArray(data) ? data[0] : data;
  if (!p?.nick) { state.account = null; pendingUser = user; return renderAuth('setup'); }
  state.account = { id: user.id, email: user.email, nick: p.nick, number: p.user_number, firstName: p.first_name || '', lastName: p.last_name || '', attitude: p.attitude || '' };
  if (!state.account.firstName || !state.account.lastName) return renderAuth('setup');
  pendingUser = null;
  if (pin.isSet()) return showLock(() => enterApp()); // bloqueo con PIN al abrir
  enterApp();
}

async function logout() {
  const id = Number(store.get('deviceId:' + state.account?.id)) || null;
  if (id) await supabase.from('devices').update({ push_token: null }).eq('id', id); // sin avisos en este teléfono
  groups?.stop();
  dm?.closeAll();
  state.ready = false;
  state.account = null;
  await supabase.auth.signOut();
  clearNotifications();
  renderAuth('login');
}

/* ===================================================================== */
/* App: portada (chats y amigos) + conversación                          */
/* ===================================================================== */
let dm = null;
let groups = null;
function enterApp() {
  const a = state.account;
  state.clientId = String(a.number);
  state.nick = a.nick;
  photos.setOwner(a.id);
  loadIceServers(SUPABASE_URL, SUPABASE_KEY);
  renderShell();
  const dctx = dmContext();
  dm = createDM(dctx);
  groups = createGroups({
    supabase, mailbox, t, esc, icon, toast, openDialog, closeOverlays, SUPABASE_URL, SUPABASE_KEY,
    dm: () => dm, myNumber: () => state.clientId, myNick: () => state.nick,
    friends: () => [...state.friends.values()].filter((f) => f.status === 'accepted').map((f) => ({ number: String(f.number), nick: f.nick })),
    avatar: (f) => photos.avatar('u:' + f.number, f.nick),
    open: (key) => activate(key),
    onChange: () => renderLists(),
  });
  dctx.groups = groups;
  dm.init();
  state.ready = true;
  mailbox.register(state.account.id).then(() => { groups.start(); fetchMail(); }); // dispositivo + clave del buzón; luego, grupos y mensajes pendientes
  loadFriends().then(() => { for (const d of state.pendingTaps.splice(0)) handleTap(d); });
  initPush({ onToken: (token) => mailbox.register(state.account.id, token), onTap: handleTap });
  if (!store.get('onboarded')) showOnboarding();
}

function dmContext() {
  return {
    state, supabase, esc, icon, avatar, nickStyle, linkify, time, verified, toast, loopTone,
    beep: () => playTone('msg'),
    sys, addHtml, activate, renderChanList: renderLists, updateTitle: () => {},
    photos, // foto de perfil: viaja directamente entre amigos
    // Compartir (correo, otras apps) y guardar archivos del chat
    canShareFiles, shareFile,
    saveFile: async (file) => { const where = await saveFile(file); if (where) toast(t('Guardado en {lugar}.', { lugar: where })); },
    onOnceChange: (on) => {
      document.getElementById('once-btn')?.classList.toggle('on', on);
      if (on) toast(t('La próxima foto, vídeo o audio se podrá ver una sola vez.'));
    },
    myProfile: () => ({ first: state.account?.firstName, last: state.account?.lastName, attitude: state.account?.attitude }),
    onPeerProfile: (w, p) => {
      const f = state.friends.get(String(w.peer.cid));
      if (f) { if (p.nick) f.nick = p.nick; if (p.first !== undefined) { f.first = p.first; f.last = p.last; } if (p.attitude !== undefined) f.attitude = p.attitude; }
      renderLists();
    },
    ensureIce: () => loadIceServers(SUPABASE_URL, SUPABASE_KEY),
    findPerson: (nick) => {
      const f = [...state.friends.values()].find((x) => x.status === 'accepted' && x.nick.toLowerCase() === nick.toLowerCase());
      return f ? { cid: String(f.number), nick: f.nick, reg: true } : null;
    },
    // Bandeja privada por número. Mientras se espera, la solicitud se repite cada 4 s: así llega
    // en cuanto el amigo abre la app (por ejemplo, al tocar el aviso push).
    defaultVia: 'user',
    myNumber: () => state.clientId,
    resendRequests: 4,
    onInboxStatus: (status) => { state.inboxOk = status === 'SUBSCRIBED'; renderConn(); },
    // Entre amigos no hace falta aceptar: la conversación se abre sola
    autoAccept: (r) => state.friends.get(String(r.from))?.status === 'accepted',
    // Buzón: con amigos se puede escribir aunque no estén conectados (los avisa la función push)
    mailbox,
    autoReconnect: true,
    onMailPing: () => fetchMail(),
    onGroupPing: () => groups?.load(), // me agregaron a un grupo (o me quitaron)
    onMailSent: (w) => sendPush(w.peer.cid, 'msg', ''),
    nickOf: (number) => state.friends.get(String(number))?.nick,
    // Solo las llamadas despiertan al amigo al conectar; los mensajes lo avisan al dejarlos en el buzón
    onRequestSent: (peer, w) => { if (w.autoCall !== undefined) sendPush(peer.cid, 'call', w.id, !!w.autoCall); },
    onBackgroundOpen: (w) => { renderLists(); if (isForeground()) playTone('msg'); },
    onIncoming: (w, m) => {
      if (isForeground() && state.active === w.key) return;
      if (isForeground()) { playTone('msg'); try { navigator.vibrate?.(25); } catch { /* nada */ } }
      else notify({ title: w.group ? `${m.nick} · ${w.name}` : w.peer.nick, body: previewText(m), peer: w.peer.cid });
    },
    noTranscribe: isNative || isDesktop, // el reconocimiento de voz del navegador no está en las apps
    onBuzz: () => { playTone('call', 'digital'); if (isDesktop) window.chamuflacDesktop?.attention(); },
    onCallRing: (w, video) => { if (!isForeground()) notify({ title: w.peer.nick, body: t(video ? 'Videollamada entrante' : 'Llamada entrante'), peer: w.peer.cid, call: true }); },
  };
}
const previewText = (m) => (m.kind === 'sticker' ? '😀 Sticker' : m.kind === 'file' ? (m.file?.voice ? '🎤 ' + t('Nota de voz') : '📎 ' + (m.file?.name || '')) : String(m.text || '').slice(0, 120));

/* ---------- Dispositivo, buzón y avisos push ---------- */
const mailbox = createMailbox({ supabase, platform, version: APP_VERSION, deviceName });
async function fetchMail() {
  if (!state.ready) return;
  const items = await mailbox.fetch();
  const forGroups = items.filter((it) => it.msg?.g);
  const forDm = items.filter((it) => !it.msg?.g);
  if (forDm.length) dm.receiveMail(forDm);
  if (forGroups.length) await groups?.receiveMail(forGroups);
}
async function sendPush(to, kind, id, video = false) {
  if (!to) return;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    await fetch(`${SUPABASE_URL}/functions/v1/push`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: Number(to), kind, id, video }),
    });
  } catch { /* sin aviso: si el amigo tiene la app abierta, la bandeja ya lo recibió */ }
}
/** Toque en un aviso push: abrir la conversación (o la lista de amigos). */
function handleTap(d) {
  if (!state.ready) return state.pendingTaps.push(d);
  if (d.kind === 'friend') { setTab('friends'); activate('status'); return loadFriends(); }
  if (d.kind === 'group' && d.id) return Promise.all([groups?.load(), fetchMail()]).then(() => activate('g:' + d.id));
  const from = String(d.from || '');
  if (from.startsWith('g:')) return activate(from); // aviso local de un grupo
  if (!from) return;
  if (d.kind === 'msg' || !d.id) return fetchMail().then(() => openChat(from)); // mensaje en el buzón
  const w = state.windows.get('dm:' + from);
  if (w && !['closed', 'rejected', 'offline'].includes(w.status)) return activate(w.key);
  if (d.id && dm.acceptExternal({ id: d.id, from, nick: d.nick || state.friends.get(from)?.nick || from, reg: true })) return;
  openChat(from);
}

/* ---------- Bloqueo con PIN (solo en este dispositivo) ---------- */
const pin = {
  key: () => 'pin:' + (state.account?.id || ''),
  isSet: () => !!store.get(pin.key()),
  async hash(p, salt) { const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + p)); return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join(''); },
  async set(p) { const salt = crypto.randomUUID(); store.set(pin.key(), JSON.stringify({ salt, h: await pin.hash(p, salt) })); },
  async check(p) { try { const { salt, h } = JSON.parse(store.get(pin.key())); return (await pin.hash(p, salt)) === h; } catch { return false; } },
  clear: () => store.set(pin.key(), null),
};
let locked = false;
/** Pantalla de bloqueo: tapa todo hasta escribir el PIN. */
function showLock(onOk) {
  if (locked) return;
  locked = true;
  let fails = 0, waitUntil = 0;
  const el = document.createElement('div');
  el.className = 'pin-lock';
  el.innerHTML = `<div class="pin-card">${logoSvg(64, 'pl')}<h2>${esc(t('ChamuFlac está bloqueada'))}</h2>
    <form><input type="password" inputmode="numeric" autocomplete="off" maxlength="8" placeholder="••••" aria-label="PIN"><p class="m-msg error"></p>
    <button class="btn primary block">${esc(t('Desbloquear'))}</button></form>
    <button type="button" class="link" data-forgot>${esc(t('¿Olvidaste el PIN?'))}</button></div>`;
  document.body.appendChild(el);
  const input = el.querySelector('input'), msg = el.querySelector('.m-msg');
  setTimeout(() => input.focus(), 50);
  el.querySelector('form').onsubmit = async (e) => {
    e.preventDefault();
    if (Date.now() < waitUntil) { msg.textContent = t('Espera unos segundos e inténtalo de nuevo.'); return; }
    if (await pin.check(input.value)) { el.remove(); locked = false; onOk?.(); return; }
    fails++; input.value = '';
    if (fails >= 5) { waitUntil = Date.now() + 30000; fails = 0; msg.textContent = t('Demasiados intentos. Espera 30 segundos.'); }
    else msg.textContent = t('PIN incorrecto.');
  };
  el.querySelector('[data-forgot]').onclick = async () => {
    const ok = await openDialog({ title: t('¿Olvidaste el PIN?'), text: esc(t('Cierra la sesión y vuelve a entrar con tu correo y contraseña. El PIN se borra de este dispositivo.')), confirm: t('Cerrar sesión'), danger: true });
    if (!ok) return;
    pin.clear(); el.remove(); locked = false; logout();
  };
}
// Al volver tras más de un minuto en segundo plano, se pide el PIN otra vez
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (state.ready && pin.isSet() && hiddenAt && Date.now() - hiddenAt > 60000) showLock();
});
function pinMenu() {
  openMenu(null, pin.isSet() ? [
    { label: t('Cambiar PIN'), icon: 'edit', run: setPinDialog },
    { label: t('Quitar el bloqueo'), icon: 'unlock', danger: true, run: async () => {
      const v = await openDialog({ title: t('Quitar el bloqueo'), fields: [{ name: 'p', label: t('PIN actual'), inputmode: 'numeric', type: 'password', max: 8 }], confirm: t('Quitar'), danger: true, validate: async ({ p }) => ((await pin.check(p)) ? '' : esc(t('PIN incorrecto.'))) });
      if (v) { pin.clear(); toast(t('Bloqueo desactivado.')); }
    } },
  ] : [{ label: t('Activar bloqueo con PIN'), icon: 'lock', run: setPinDialog }],
  `<b>${esc(t('Bloqueo con PIN'))}</b><small>${esc(t('Pide un PIN al abrir la app y al volver a ella después de un minuto. Solo se guarda en este dispositivo.'))}</small>`);
}
async function setPinDialog() {
  const v = await openDialog({
    title: t('Elige un PIN'), text: esc(t('De 4 a 8 números. Si lo olvidas, tendrás que volver a iniciar sesión.')),
    fields: [{ name: 'p1', label: t('PIN'), inputmode: 'numeric', type: 'password', max: 8 }, { name: 'p2', label: t('Repite el PIN'), inputmode: 'numeric', type: 'password', max: 8 }],
    confirm: t('Guardar'),
    validate: ({ p1, p2 }) => (!/^\d{4,8}$/.test(p1) ? esc(t('El PIN tiene que tener de 4 a 8 números.')) : p1 !== p2 ? esc(t('Los dos PIN no coinciden.')) : ''),
  });
  if (!v) return;
  await pin.set(v.p1);
  toast(t('Bloqueo con PIN activado.'));
}

/* ---------- Bienvenida (solo la primera vez) ---------- */
function showOnboarding() {
  const slides = [
    ['🔢', t('Tu número'), t('Tienes un número de 8 dígitos. Compártelo (o tu código QR) para que tus amigos te agreguen. Tu correo nunca se muestra.')],
    ['🔒', t('Privados de verdad'), t('Lo que hablas con tus amigos va cifrado de extremo a extremo y no se guarda en ningún servidor. Ni nosotros podemos leerlo.')],
    ['✨', t('Hazla tuya'), t('Pon tu foto y tu actitud, elige tonos, colores y fondo. Prueba el «+» del chat: juegos, pizarra y más.')],
  ];
  let i = 0;
  const el = document.createElement('div');
  el.className = 'onboard';
  const draw = () => {
    const [ico, title, text] = slides[i];
    el.innerHTML = `<div class="onboard-card"><div class="onboard-ico">${ico}</div><h2>${esc(title)}</h2><p>${esc(text)}</p>
      <div class="onboard-dots">${slides.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('')}</div>
      <button type="button" class="btn primary block" data-next>${esc(t(i < slides.length - 1 ? 'Siguiente' : 'Empezar'))}</button>
      ${i < slides.length - 1 ? `<button type="button" class="link" data-skip>${esc(t('Saltar'))}</button>` : ''}</div>`;
  };
  draw();
  document.body.appendChild(el);
  el.onclick = (e) => {
    if (e.target.closest('[data-skip]') || (e.target.closest('[data-next]') && i === slides.length - 1)) { store.set('onboarded', '1'); el.remove(); return; }
    if (e.target.closest('[data-next]')) { i++; draw(); }
  };
}

/* ---------- Estructura de la pantalla ---------- */
function renderShell() {
  root.innerHTML = `<div class="mapp" id="mapp">
    <section class="m-home" id="home">
      <header class="m-head">
        <span class="m-brand">${logoSvg(30, 'hd')}<b class="ugc">${APP_NAME}</b></span>
        <span class="m-conn" id="m-conn"></span>
        <button class="me-photo" id="me-photo" title="Mi perfil">${photos.avatar('me', state.nick)}</button>
        <button class="icon-btn" id="menu-btn" title="Opciones">${icon('dots')}</button>
      </header>
      <div class="update-strip hidden" id="update-strip"></div>
      <div id="ad-slot"></div>
      <nav class="m-tabs" id="m-tabs">
        <button data-tab="chats">Chats<span class="badge" id="badge-chats"></span></button>
        <button data-tab="friends">Amigos<span class="badge" id="badge-friends"></span></button>
      </nav>
      <div class="m-list" id="m-list"></div>
      <button class="fab" id="add-friend" title="Agregar amigo">${icon('user-plus')}</button>
    </section>
    <div class="app m-chat hidden" id="app">
      <div class="m-chat-empty">${logoSvg(64, 'em')}<b>${esc(t('Elige una conversación'))}</b><small>${esc(t('Tus privados están cifrados de extremo a extremo y no se guardan en ningún servidor.'))}</small></div>
      <main class="chat">
        <header class="chat-head">
          <button class="icon-btn" id="back-btn" title="Volver">${icon('back')}</button>
          <div class="chat-title"><h2 id="win-name"></h2><p id="topic"></p></div>
          <button class="icon-btn" id="call-audio" title="Llamada de voz">${icon('phone')}</button>
          <button class="icon-btn" id="call-video" title="Videollamada">${icon('video')}</button>
          <button class="icon-btn" id="chat-menu" title="Opciones">${icon('dots')}</button>
        </header>
        <div class="chat-body"><div class="log" id="log"></div></div>
        <form class="composer" id="input-form">
          <div class="picker hidden" id="picker"></div>
          <div class="input-wrap">
            <button type="button" class="icon-btn dm-only" id="emoji-btn" title="Emojis y stickers">${icon('smile')}</button>
            <button type="button" class="icon-btn dm-only" id="attach-btn" title="Enviar foto, vídeo o documento">${icon('clip')}</button>
            <button type="button" class="icon-btn dm-only" id="tools-btn" title="Juegos, pizarra, ubicación y zumbido">${icon('plus')}</button>
            <button type="button" class="icon-btn dm-only once-btn" id="once-btn" title="Ver una vez: la próxima foto, vídeo o audio se podrá abrir una sola vez"><span class="once-ico">1</span></button>
            <input id="input" autocomplete="off" spellcheck="true" maxlength="4000" placeholder="Escribe un mensaje…">
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
    </div>
    <div class="dm-requests" id="dm-requests" aria-live="polite"></div>
  </div>`;
  hideSplash();
  stickToBottom(document.getElementById('log'));
  document.getElementById('m-tabs').onclick = (e) => { const b = e.target.closest('[data-tab]'); if (b) setTab(b.dataset.tab); };
  document.getElementById('menu-btn').onclick = (e) => accountMenu(e.currentTarget);
  document.getElementById('me-photo').onclick = () => profileSheet();
  document.getElementById('add-friend').onclick = addFriendDialog;
  document.getElementById('m-list').onclick = onListClick;
  document.getElementById('back-btn').onclick = () => activate('status');
  document.getElementById('chat-menu').onclick = (e) => chatMenu(e.currentTarget);
  const cur = () => state.windows.get(state.active);
  document.getElementById('call-audio').onclick = () => cur() && dm.startCall(cur(), false);
  document.getElementById('call-video').onclick = () => cur() && dm.startCall(cur(), true);
  document.getElementById('attach-btn').onclick = () => document.getElementById('file-input').click();
  document.getElementById('file-input').onchange = (e) => { const w = cur(); if (w) [...e.target.files].forEach((f) => dm.sendFile(w, f)); e.target.value = ''; };
  document.getElementById('mic-btn').onclick = () => cur() && dm.startVoice(cur());
  document.getElementById('once-btn').onclick = () => dm.setOnceMode(!dm.isOnceMode());
  document.getElementById('tools-btn').onclick = (e) => { const w = state.windows.get(state.active); if (w?.kind === 'dm') dm.openTools(w, e.currentTarget); };
  // Pegar (Ctrl+V: capturas de pantalla, imágenes, archivos) o arrastrar archivos al chat
  const sendFiles = (files) => { const w = cur(); if (w && files.length) files.forEach((f) => dm.sendFile(w, f)); };
  document.getElementById('input').addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length && cur()) { e.preventDefault(); sendFiles(files); }
  });
  const chatEl = document.querySelector('.m-chat');
  chatEl.addEventListener('dragover', (e) => { if (cur()) { e.preventDefault(); chatEl.classList.add('dragging'); } });
  chatEl.addEventListener('dragleave', (e) => { if (!chatEl.contains(e.relatedTarget)) chatEl.classList.remove('dragging'); });
  chatEl.addEventListener('drop', (e) => { chatEl.classList.remove('dragging'); if (!cur()) return; e.preventDefault(); sendFiles([...e.dataTransfer.files]); });
  document.getElementById('rec-cancel').onclick = () => dm.stopVoice(false);
  document.getElementById('rec-send').onclick = () => dm.stopVoice(true);
  const input = document.getElementById('input');
  const wrap = input.closest('.input-wrap');
  input.addEventListener('input', () => wrap.classList.toggle('has-text', input.value.trim().length > 0));
  document.getElementById('input-form').onsubmit = (e) => {
    e.preventDefault();
    const text = input.value.trim();
    const w = cur();
    if (!text || !w) return;
    input.value = ''; input.dispatchEvent(new Event('input'));
    document.getElementById('picker')?.classList.add('hidden');
    dm.sendText(w, text.slice(0, 4000));
  };
  renderUpdateStrip();
  setTab(state.tab);
  mountAds(document.getElementById('ad-slot'), { supabase, platform, t, esc, open: openExternal, number: () => state.account?.number, invite: inviteFriends });
}
/** Si se estaba viendo el final de la conversación, sigue pegado abajo aunque cambie el tamaño
 *  (al abrirse el teclado del móvil, al cargar una foto…): lo último nunca queda tapado. */
function stickToBottom(log) {
  let stick = true;
  log.addEventListener('scroll', () => { stick = log.scrollHeight - log.scrollTop - log.clientHeight < 150; }, { passive: true });
  const keep = () => { if (stick) log.scrollTop = log.scrollHeight; };
  new ResizeObserver(keep).observe(log);
  window.visualViewport?.addEventListener('resize', keep);
}
function renderConn() {
  const el = document.getElementById('m-conn');
  if (!el) return;
  el.className = 'm-conn ' + (state.inboxOk ? 'on' : state.inboxOk === false ? 'off' : '');
  el.title = t(state.inboxOk ? 'Conectado' : state.inboxOk === false ? 'Sin conexión con el servidor' : 'Conectando…');
}

function setTab(tab) {
  state.tab = tab === 'friends' ? 'friends' : 'chats';
  store.set('tab', state.tab);
  document.querySelectorAll('#m-tabs [data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === state.tab));
  renderLists();
}

/* ---------- Listas: chats y amigos ---------- */
const dmWindows = () => [...state.windows.values()].filter((w) => w.kind === 'dm');
function renderLists() {
  const list = document.getElementById('m-list');
  if (!list) return;
  const chats = dmWindows();
  const unread = chats.reduce((n, w) => n + (w.unread || 0), 0);
  const incoming = [...state.friends.values()].filter((f) => f.status === 'pending' && !f.byMe);
  document.getElementById('badge-chats').textContent = unread ? (unread > 99 ? '99+' : unread) : '';
  document.getElementById('badge-friends').textContent = incoming.length || '';
  if (state.active !== 'status' && !wide()) return; // la lista se pinta al volver a la portada (o siempre, en dos columnas)
  list.innerHTML = state.tab === 'chats' ? chatsHtml(chats) : friendsHtml(incoming);
}
const wide = () => matchMedia('(min-width: 880px)').matches; // dos columnas: lista + conversación
addEventListener('resize', () => renderLists());
function chatsHtml(chats) {
  const newGroup = `<button class="m-new-group" data-new-group>${icon('users')}<span>${esc(t('Nuevo grupo'))}</span></button>`;
  if (!chats.length) {
    return newGroup + `<div class="m-empty">${icon('message')}<p><b>Aún no hay conversaciones</b></p>
      <p class="muted">Toca a un amigo para hablar. Las conversaciones no se guardan en ningún servidor.</p>
      <button class="btn small" data-goto="friends">Ver amigos</button></div>`;
  }
  // Lo más reciente arriba
  return newGroup + [...chats].sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0)).map((w) => {
    const last = [...w.msgs.values()].pop();
    const sub = last ? (last.mine ? '✓ ' : w.group && last.nick ? last.nick + ': ' : '') + previewText(last) : dm.statusText(w);
    const av = w.group ? `<span class="avatar grp">${icon('users')}</span>` : `${photos.avatar((w.via === 'user' ? 'u:' : 't:') + w.peer.cid, w.peer.nick)}<i class="dm-dot ${w.status}"></i>`;
    return `<button class="m-row ${w.key === state.active ? 'active' : ''}" ${w.group ? `data-open="${esc(w.key)}"` : `data-chat="${esc(w.peer.cid)}"`}>
      <span class="m-av">${av}</span>
      <span class="m-row-main"><b class="ugc">${esc(w.peer.nick)}</b><small class="${last ? 'ugc' : ''}">${esc(sub)}</small></span>
      ${w.call ? `<span class="m-row-ico">${icon('phone')}</span>` : ''}
      ${w.unread ? `<span class="badge mention">${w.unread > 99 ? '99+' : w.unread}</span>` : ''}
    </button>`;
  }).join('');
}
function friendsHtml(incoming) {
  const all = [...state.friends.values()];
  const friends = all.filter((f) => f.status === 'accepted');
  const sent = all.filter((f) => f.status === 'pending' && f.byMe);
  const blocked = all.filter((f) => f.status === 'blocked');
  const name = (f) => [f.first, f.last].filter(Boolean).join(' ');
  let html = `<div class="m-mine"><span>Tu número</span><button class="chip-btn" data-copy-number>${esc(fmtNumber(state.account.number))} ${icon('copy')}</button>
    <button class="icon-btn sm" data-refresh title="Actualizar">${icon('refresh')}</button></div>
    <div class="m-qr-row"><button type="button" class="btn small" data-myqr>▦ ${esc(t('Mi código QR'))}</button><button type="button" class="btn small" data-scanqr>📷 ${esc(t('Escanear QR'))}</button></div>`;
  if (incoming.length) {
    html += `<h3 class="m-sec">Solicitudes recibidas</h3>` + incoming.map((f) => `<div class="m-row static">
      <span class="m-av">${avatar(f.nick)}</span><span class="m-row-main"><b class="ugc">${esc(f.nick)}</b><small>${esc(fmtNumber(f.number))}</small></span>
      <button class="btn small" data-reject="${f.number}">Rechazar</button><button class="btn small primary" data-accept="${f.number}">Aceptar</button></div>`).join('');
  }
  html += `<h3 class="m-sec">Amigos</h3>`;
  html += friends.length ? friends.map((f) => `<div class="m-row friend" data-friend="${f.number}">
      <button class="m-row-open" data-chat="${f.number}"><span class="m-av ${state.windows.get('dm:' + f.number)?.status === 'open' ? 'online' : ''}">${photos.avatar('u:' + f.number, f.nick)}</span>
      <span class="m-row-main"><b class="ugc">${esc(f.nick)}</b><small class="ugc">${esc(name(f))}</small>${f.attitude ? `<small class="attitude ugc">“${esc(f.attitude)}”</small>` : ''}</span></button>
      <button class="icon-btn" data-call="${f.number}" title="Llamada de voz">${icon('phone')}</button>
      <button class="icon-btn" data-vcall="${f.number}" title="Videollamada">${icon('video')}</button>
      <button class="icon-btn" data-fmenu="${f.number}" title="Opciones">${icon('dots')}</button></div>`).join('')
    : `<div class="m-empty small"><p class="muted">Aún no tienes amigos. Toca el botón rojo de abajo y escribe el número de la otra persona: le llegará tu solicitud.</p></div>`;
  if (sent.length) {
    html += `<h3 class="m-sec">Solicitudes enviadas</h3>` + sent.map((f) => `<div class="m-row static">
      <span class="m-av">${avatar(f.nick)}</span><span class="m-row-main"><b class="ugc">${esc(f.nick)}</b><small>Esperando respuesta…</small></span>
      <button class="btn small" data-cancel="${f.number}">Cancelar</button></div>`).join('');
  }
  if (blocked.length) {
    html += `<h3 class="m-sec">Bloqueados</h3>` + blocked.map((f) => `<div class="m-row static">
      <span class="m-av">${avatar(f.nick)}</span><span class="m-row-main"><b class="ugc">${esc(f.nick)}</b><small>${esc(fmtNumber(f.number))}</small></span>
      <button class="btn small" data-unblock="${f.number}">Desbloquear</button></div>`).join('');
  }
  return html;
}
const fmtNumber = (n) => String(n || '').replace(/(\d{4})(\d{4})/, '$1 $2');

async function onListClick(e) {
  const b = e.target.closest('button');
  if (!b) return;
  const d = b.dataset;
  if (d.goto) return setTab(d.goto);
  if (d.open) return activate(d.open);
  if ('newGroup' in d) return groups.createDialog();
  if (d.chat) return openChat(d.chat);
  if (d.call || d.vcall) return openChat(d.call || d.vcall, !!d.vcall);
  if (d.fmenu) return friendMenu(b, d.fmenu);
  if ('copyNumber' in d) return copyNumber();
  if ('refresh' in d) { await loadFriends(); return toast(t('Lista actualizada.')); }
  if ('myqr' in d) return myQrDialog();
  if ('scanqr' in d) return scanFriend();
  const run = async (fn, args, ok) => {
    b.disabled = true;
    const { data, error } = await supabase.rpc(fn, args);
    if (error) toast(t(error.message)); else if (ok) toast(t(ok));
    await loadFriends();
    return data;
  };
  if (d.accept) return run('respond_friend_request', { p_number: Number(d.accept), p_accept: true }, 'Ahora son amigos.');
  if (d.reject) return run('respond_friend_request', { p_number: Number(d.reject), p_accept: false });
  if (d.cancel) return run('remove_friend', { p_number: Number(d.cancel) });
  if (d.unblock) return run('block_user', { p_number: Number(d.unblock), p_block: false });
}

/** Abre la conversación con un amigo (y, si se pide, llama al conectar). */
function openChat(number, video) {
  const key = 'dm:' + number;
  const w = state.windows.get(key);
  const callWanted = video !== undefined;
  const idle = !w || ['closed', 'rejected', 'offline'].includes(w.status);
  if (w && (!idle || !callWanted)) {
    activate(key); // si no hay conexión, al mostrarse intenta conectar sola (autoReconnect)
    if (callWanted && w.status === 'open' && !w.relay && !w.call) dm.startCall(w, video);
    return;
  }
  const f = state.friends.get(String(number));
  if (!f || f.status !== 'accepted') return w ? activate(key) : toast(t('Solo puedes hablar con tus amigos.'));
  dm.requestPrivate({ cid: String(f.number), nick: f.nick, reg: true, ...(callWanted ? { autoCall: video } : {}) });
}

async function loadFriends() {
  const { data, error } = await supabase.rpc('list_friends');
  if (error) return;
  state.friends = new Map((data || []).map((f) => [String(f.user_number), {
    number: f.user_number, nick: f.nick, first: f.first_name || '', last: f.last_name || '', status: f.status, byMe: !!f.requested_by_me, attitude: f.attitude || '',
  }]));
  renderLists();
}

/* ---------- Ventanas (dm.js) ---------- */
function activate(key) {
  const w = state.windows.get(key);
  closeOverlays();
  const app = document.getElementById('app');
  const home = document.getElementById('home');
  if (!app) return;
  if (!w || key === 'status') {
    state.active = 'status';
    app.classList.add('hidden'); app.classList.remove('in-dm');
    home.classList.remove('hidden');
    return renderLists();
  }
  state.active = key;
  w.unread = 0; w.mention = false;
  home.classList.add('hidden');
  app.classList.remove('hidden'); app.classList.add('in-dm');
  const log = document.getElementById('log');
  log.innerHTML = w.lines.join('');
  log.scrollTop = log.scrollHeight;
  document.getElementById('input').disabled = false;
  dm.onActivate(w);
  clearNotifications(w.peer.cid);
  renderLists();
}
function onBack() {
  if (closeOverlays()) return true;
  if (document.querySelector('.call-overlay')) return false; // en llamada: a segundo plano, sin colgar
  if (state.active !== 'status') { activate('status'); return true; }
  return false;
}
function addHtml(key, html, { count = false } = {}) {
  const w = state.windows.get(key);
  if (!w) return;
  w.lines.push(html);
  if (w.lines.length > 500) w.lines.shift();
  if (state.active === key) {
    const log = document.getElementById('log');
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 150;
    log.insertAdjacentHTML('beforeend', html);
    if (log.children.length > 500) log.firstElementChild.remove();
    // Lo que escribo yo siempre queda a la vista (también tras dibujarse fotos o audios)
    if (atBottom || html.includes('bub-row out')) { log.scrollTop = log.scrollHeight; requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; }); }
  }
  if (count && (state.active !== key || !isForeground())) w.unread = (w.unread || 0) + 1;
  renderLists();
}
function sys(key, html, kind = 'info') {
  const w = state.windows.get(key);
  if (!w) return;
  w.last = null;
  addHtml(key, `<div class="sys ${kind}"><span class="gutter"><time>${time(Date.now())}</time></span><div class="msg-body">${html}</div></div>`);
}
function onResume() {
  if (!state.ready) return;
  loadFriends();
  fetchMail();
  groups?.load();
  const w = state.windows.get(state.active);
  if (w) { w.unread = 0; clearNotifications(w.peer.cid); renderLists(); }
  if (Date.now() - lastVersionCheck > 10 * 60 * 1000) checkVersion().then((v) => {
    if (v?.status === 'required' && !document.querySelector('.call-overlay')) { dm.closeAll(); state.ready = false; renderUpdateRequired(v); } else renderUpdateStrip();
  });
}

/* ---------- Menús y diálogos ---------- */
function closeOverlays() {
  const open = document.querySelectorAll('.menu-pop, .dialog-wrap, .sheet-scrim');
  open.forEach((el) => el.remove());
  return open.length > 0;
}
function openMenu(anchor, items, title = '') {
  closeOverlays();
  const m = document.createElement('div');
  m.className = 'menu-pop m-sheet';
  m.innerHTML = (title ? `<div class="menu-title">${title}</div>` : '') + items.map((it, i) => it === '-' ? '<hr>' : `<button data-i="${i}" class="${it.danger ? 'danger' : ''} ${it.chosen ? 'chosen' : ''}">${it.icon ? icon(it.icon) : ''}${it.lead || ''}<span>${esc(it.label)}</span>${it.chosen ? icon('check') : ''}${it.hint ? `<small class="ugc">${esc(it.hint)}</small>` : ''}</button>`).join('');
  const scrim = document.createElement('div');
  scrim.className = 'sheet-scrim';
  scrim.onclick = () => closeOverlays();
  document.body.append(scrim, m);
  m.onclick = (e) => { const b = e.target.closest('[data-i]'); if (!b) return; closeOverlays(); items[b.dataset.i].run?.(); };
}
function openDialog({ title, text = '', fields = [], confirm = 'Aceptar', danger = false, validate }) {
  closeOverlays();
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'dialog-wrap';
    wrap.innerHTML = `<form class="dialog m-dialog" novalidate><h3>${esc(title)}</h3>${text ? `<p class="muted">${text}</p>` : ''}
      ${fields.map((f) => `<label>${esc(f.label)}<input name="${f.name}" type="${f.type || 'text'}" value="${esc(f.value || '')}" maxlength="${f.max || 100}" ${f.inputmode ? `inputmode="${f.inputmode}"` : ''} placeholder="${esc(f.placeholder || '')}"></label>`).join('')}
      <p class="m-msg error" data-err></p>
      <div class="dialog-actions"><button type="button" class="btn" data-cancel>Cancelar</button><button class="btn ${danger ? 'danger' : 'primary'}" type="submit">${esc(confirm)}</button></div></form>`;
    document.body.appendChild(wrap);
    const form = wrap.querySelector('form');
    const done = (v) => { wrap.remove(); resolve(v); };
    wrap.onclick = (e) => { if (e.target === wrap) done(null); };
    wrap.querySelector('[data-cancel]').onclick = () => done(null);
    form.onsubmit = async (e) => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(form));
      const err = validate ? await validate(v) : '';
      if (err) { form.querySelector('[data-err]').innerHTML = err; return; }
      done(v);
    };
    form.querySelector('input')?.focus();
  });
}
let toastTimer;
function toast(text) {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

/** Mi código QR: escaneado con la cámara del teléfono abre ChamuFlac para agregarme. */
function myQrDialog() {
  openDialog({
    title: t('Mi código QR'),
    text: `${qrSvg(friendLink(state.account.number))}<span class="qr-num">${esc(fmtNumber(state.account.number))}</span><br>${esc(t('Pídele a tu amigo que lo escanee para agregarte.'))}`,
    confirm: t('Aceptar'),
  });
}
async function scanFriend() {
  const text = await scanQR({ t, esc });
  if (text === null) return;
  const n = numberFromQr(text);
  if (!n) return toast(t('Ese código QR no es de ChamuFlac.'));
  addFriendDialog(n);
}
async function addFriendDialog(prefill) {
  let found = null;
  const v = await openDialog({
    title: t('Agregar amigo'),
    text: esc(t('Escribe el número de 8 dígitos de la otra persona. Lo ve en la app, en Amigos.')),
    fields: [{ name: 'number', label: t('Número'), inputmode: 'numeric', max: 12, placeholder: '1234 5678', value: prefill ? fmtNumber(prefill) : '' }],
    confirm: t('Enviar solicitud'),
    validate: async ({ number }) => {
      const n = Number(String(number).replace(/\D/g, ''));
      if (!(n >= 10000000 && n <= 99999999)) return esc(t('El número tiene 8 dígitos.'));
      if (n === Number(state.account.number)) return esc(t('Ese es tu propio número.'));
      const { data } = await supabase.rpc('find_user', { p_number: n });
      found = Array.isArray(data) ? data[0] : data;
      if (!found) return esc(t('No existe ningún usuario con ese número.'));
      if (found.relation === 'accepted') return esc(t('{nick} ya es tu amigo.', { nick: found.nick }));
      if (found.relation === 'blocked') return esc(t('Tienes bloqueado a {nick}.', { nick: found.nick }));
      return '';
    },
  });
  if (!v || !found) return;
  const { data, error } = await supabase.rpc('send_friend_request', { p_number: found.user_number });
  if (error) return toast(t(error.message));
  if (data === 'accepted') toast(t('{nick} ya te había invitado: ahora son amigos.', { nick: found.nick }));
  else { toast(t('Solicitud enviada a {nick}.', { nick: found.nick })); sendPush(found.user_number, 'friend', 'friend'); }
  setTab('friends');
  loadFriends();
}
function friendMenu(anchor, number) {
  const f = state.friends.get(String(number));
  if (!f) return;
  openMenu(anchor, [
    { label: t('Enviar mensaje'), icon: 'message', run: () => openChat(number) },
    { label: t('Copiar número'), icon: 'copy', hint: fmtNumber(f.number), run: () => copyText(String(f.number)) },
    '-',
    { label: t('Eliminar amigo'), icon: 'trash', danger: true, run: async () => {
      const ok = await openDialog({ title: t('Eliminar amigo'), text: esc(t('{nick} dejará de estar en tu lista. Pueden volver a agregarse.', { nick: f.nick })), confirm: t('Eliminar'), danger: true });
      if (!ok) return;
      await supabase.rpc('remove_friend', { p_number: f.number });
      closeChatWith(number); loadFriends();
    } },
    { label: t('Bloquear'), icon: 'ban', danger: true, run: async () => {
      const ok = await openDialog({ title: t('Bloquear'), text: esc(t('{nick} no podrá escribirte, llamarte ni encontrarte por tu número.', { nick: f.nick })), confirm: t('Bloquear'), danger: true });
      if (!ok) return;
      await supabase.rpc('block_user', { p_number: f.number, p_block: true });
      closeChatWith(number); loadFriends();
    } },
  ], `<b class="ugc">${esc(f.nick)}</b>`);
}
function closeChatWith(number) { const w = state.windows.get('dm:' + number); if (w) dm.closeWindow(w); }
function chatMenu(anchor) {
  const w = state.windows.get(state.active);
  if (!w) return;
  if (w.group) return openMenu(anchor, groups.menuItems(w).map((it) => (it === '-' ? it : { ...it, run: it.act })));
  openMenu(anchor, [
    ...(['closed', 'rejected', 'offline'].includes(w.status) ? [{ label: t('Volver a conectar'), icon: 'refresh', run: () => openChat(w.peer.cid) }] : []),
    { label: t('Buscar en la conversación'), icon: 'search', run: () => dm.openSearch() },
    { label: t('Mensajes temporales'), icon: 'clock', hint: dm.ttlOf(w) ? ttlText(dm.ttlOf(w)) : t('Desactivados'), run: () => ttlMenu(w) },
    { label: t('Enviar zumbido'), icon: 'zap', run: () => dm.sendBuzz(w) },
    { label: t('Código de seguridad'), icon: 'shield', run: () => securityDialog(w) },
    '-',
    { label: t('Cerrar conversación'), icon: 'x', danger: true, run: () => dm.closeWindow(w) },
  ]);
}
const TTLS = [0, 3600, 86400, 7 * 86400];
const ttlText = (s) => (!s ? t('Desactivados') : dm.ttlLabel(s));
function ttlMenu(w) {
  openMenu(null, TTLS.map((s) => ({ label: ttlText(s), chosen: dm.ttlOf(w) === s, run: () => dm.setTtl(w, s) })),
    `<b>${esc(t('Mensajes temporales'))}</b><small>${esc(t('Los mensajes nuevos se borran solos de los dos dispositivos pasado ese tiempo.'))}</small>`);
}
async function securityDialog(w) {
  const code = await dm.securityCode(w);
  await openDialog({
    title: t('Código de seguridad'),
    text: code
      ? `${esc(t('Si en el teléfono de {nick} aparece el mismo código, la conversación está cifrada de extremo a extremo con esa persona y nadie en el medio puede leerla.', { nick: w.peer.nick }))}<br><br><b class="sec-code">${esc(code)}</b>`
      : esc(t('Solo se puede comprobar con la conexión directa abierta. Abre la conversación con tu amigo conectado y vuelve a intentarlo.')),
    confirm: t('Aceptar'),
  });
}
function accountMenu(anchor) {
  const a = state.account;
  openMenu(anchor, [
    { label: t('Mi perfil'), lead: photos.avatar('me', a.nick), hint: `${a.firstName} ${a.lastName} · ${fmtNumber(a.number)}`, run: profileSheet },
    { label: t('Sonidos'), icon: 'phone', hint: `${t(TONES.msg[sounds.get('msg')].label)} · ${t(TONES.call[sounds.get('call')].label)}`, run: soundsMenu },
    { label: t('Color de la app'), lead: accentSwatch(display.accent()), hint: t(ACCENTS[display.accent()].label), run: accentMenu },
    { label: t('Tamaño de letra'), icon: 'edit', hint: t(FONT_LABELS[display.font()]), run: fontMenu },
    { label: t('Fondo del chat'), icon: 'sparkle', hint: t(display.wall() === 'foto' ? 'Foto propia' : WALLPAPERS[display.wall()].label), run: wallMenu },
    { label: t('Idioma'), icon: 'globe', hint: LANGS[getLang()], run: () => languageMenu(() => renderLists()) },
    { label: t('Cambiar tema'), icon: document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon', run: () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark') },
    '-',
    { label: t('Cerrar sesión'), icon: 'logout', danger: true, run: async () => {
      const ok = await openDialog({ title: t('Cerrar sesión'), text: esc(t('Dejarás de recibir avisos en este teléfono hasta que vuelvas a ingresar.')), confirm: t('Cerrar sesión'), danger: true });
      if (ok) logout();
    } },
  ], `<b class="ugc">${esc(a.nick)}</b><small><span class="ugc">${esc(a.email || '')}</span> · v${esc(APP_VERSION)}</small>`);
}
/* ---------- Foto, letra y fondo ---------- */
/** Mi perfil: cómo me ven mis amigos (foto, nick, nombre) y opciones para cambiarlo. */
function profileSheet() {
  const a = state.account;
  const has = !!photos.mine();
  openMenu(null, [
    { label: t(has ? 'Cambiar foto' : 'Elegir foto'), icon: 'image', run: async () => {
      const r = await chooseAndEditPhoto(t);
      if (!r) return profileSheet();
      photos.setMine(r.photo, r.source); dm?.broadcastPhoto(); toast(t('Foto guardada. La verán tus amigos al hablar contigo.'));
      profileSheet();
    } },
    ...(has ? [
      { label: t('Ajustar foto'), icon: 'expand', run: async () => {
        const src = photos.mineSource() || photos.mine();
        const photo = await editPhoto(src, t);
        if (photo) { photos.setMine(photo); dm?.broadcastPhoto(); }
        profileSheet();
      } },
      { label: t('Quitar foto'), icon: 'trash', danger: true, run: () => { photos.setMine(null); dm?.broadcastPhoto(); profileSheet(); } },
    ] : []),
    '-',
    { label: t('Actitud'), icon: 'sparkle', hint: a.attitude || t('Escribe una frase para tus amigos'), run: attitudeDialog },
    { label: t('Cambiar mi nick'), icon: 'at', hint: a.nick, run: changeNickDialog },
    { label: t('Nombre y apellido'), icon: 'edit', hint: `${a.firstName} ${a.lastName}`, run: editNameDialog },
    { label: t('Bloqueo con PIN'), icon: 'lock', hint: t(pin.isSet() ? 'Activado' : 'Desactivado'), run: pinMenu },
    { label: t('Copiar mi número'), icon: 'copy', hint: fmtNumber(a.number), run: copyNumber },
  ], `<div class="profile-card">${photos.avatar('me', a.nick)}<b class="ugc">${esc(a.nick)}</b><small>${esc(t('Nick'))}</small><span class="ugc">${esc(`${a.firstName} ${a.lastName}`)}</span><small>${esc(t('Nombre y apellido (solo lo ven tus amigos)'))}</small>${a.attitude ? `<span class="attitude big ugc">“${esc(a.attitude)}”</span>` : ''}
    <small>${esc(t('Así te ven tus amigos en los privados. La foto no se guarda en ningún servidor.'))}</small></div>`);
}
/* ---------- Tonos de mensaje y de llamada ---------- */
function soundsMenu() {
  openMenu(null, [
    { label: t('Tono de mensajes'), icon: 'message', hint: t(TONES.msg[sounds.get('msg')].label), run: () => toneMenu('msg') },
    { label: t('Tono de llamadas'), icon: 'phone', hint: t(TONES.call[sounds.get('call')].label), run: () => toneMenu('call') },
  ], esc(t('Sonidos')));
}
/** Elegir tono: al tocarlo suena y queda elegido (el menú sigue abierto para probar otros). */
function toneMenu(kind) {
  openMenu(null, Object.keys(TONES[kind]).map((id) => ({
    label: t(TONES[kind][id].label), chosen: sounds.get(kind) === id, icon: id === 'silencio' ? 'mic-off' : 'play',
    run: () => { sounds.set(kind, id); playTone(kind, id); setTimeout(() => toneMenu(kind), 150); },
  })), esc(t(kind === 'msg' ? 'Tono de mensajes' : 'Tono de llamadas')));
}
function accentMenu() {
  openMenu(null, Object.keys(ACCENTS).map((k) => ({ label: t(ACCENTS[k].label), chosen: display.accent() === k, lead: accentSwatch(k), run: () => { display.setAccent(k); accentMenu(); } })), esc(t('Color de la app')));
}
function fontMenu() {
  openMenu(null, Object.keys(FONT_SIZES).map((k) => ({ label: t(FONT_LABELS[k]), chosen: display.font() === k, lead: `<b class="fs-sample" style="font-size:${FONT_SIZES[k]}em">Aa</b>`, run: () => display.setFont(k) })), esc(t('Tamaño de letra')));
}
function wallMenu() {
  openMenu(null, [
    ...Object.keys(WALLPAPERS).map((k) => ({ label: t(WALLPAPERS[k].label), chosen: display.wall() === k, lead: wallSwatch(k), run: () => display.setWall(k) })),
    { label: t('Una foto mía…'), chosen: display.wall() === 'foto', icon: 'image', run: async () => {
      const img = await pickImage({ max: 1280, square: false, quality: 0.7 });
      if (img) display.setWall('foto', img);
    } },
  ], esc(t('Fondo del chat')));
}
photos.onChange(() => {
  const me = document.getElementById('me-photo'); if (me) me.innerHTML = photos.avatar('me', state.nick);
  renderLists(); const w = state.windows.get(state.active); if (w) dm?.onActivate(w); });

/** Actitud: una frase que ven tus amigos (aunque no estés conectado). */
async function attitudeDialog() {
  const a = state.account;
  const v = await openDialog({
    title: t('Actitud'), text: esc(t('Una frase que verán tus amigos debajo de tu nombre. Déjala vacía para quitarla.')),
    fields: [{ name: 'attitude', label: t('Tu actitud'), value: a.attitude || '', max: 140, placeholder: t('¿Cuál es tu actitud hoy?') }],
    confirm: t('Guardar'),
  });
  if (!v) return profileSheet();
  const { error } = await supabase.rpc('set_my_attitude', { p_text: v.attitude });
  if (error) { toast(t(error.message)); return profileSheet(); }
  a.attitude = v.attitude.trim();
  dm?.broadcastProfile(); // a los amigos conectados les llega al instante
  toast(t('Guardado.'));
  profileSheet();
}
/** El nick es de la cuenta: cambia en todos tus dispositivos y les llega a tus amigos. */
async function changeNickDialog() {
  const a = state.account;
  const v = await openDialog({
    title: t('Cambiar mi nick'), text: esc(t('Es el nombre que se ve en grande. Es de tu cuenta: cambia en todos tus dispositivos.')),
    fields: [{ name: 'nick', label: t('Nick'), value: a.nick, max: 20 }],
    confirm: t('Guardar'),
    validate: async ({ nick }) => {
      const n = nick.trim();
      if (!NICK_RE.test(n)) return esc(t('Ese nick no es válido: 2–20 caracteres, letras, números y _ - [ ] { } ^ |, sin empezar por número.'));
      if (n.toLowerCase() === a.nick.toLowerCase()) return '';
      const { error } = await supabase.from('profiles').update({ nick: n }).eq('id', a.id);
      if (error) return esc(t(error.code === '23505' ? 'Ese nick ya está registrado. Elige otro.' : error.message));
      return '';
    },
  });
  if (!v) return profileSheet();
  const n = v.nick.trim();
  if (n !== a.nick) { a.nick = state.nick = n; dm?.onNickChange(n); dm?.broadcastProfile(); toast(t('Guardado.')); }
  const me = document.getElementById('me-photo'); if (me) me.innerHTML = photos.avatar('me', n);
  profileSheet();
}

async function editNameDialog() {
  const a = state.account;
  const v = await openDialog({
    title: t('Nombre y apellido'), text: esc(t('Solo lo verán tus amigos.')),
    fields: [{ name: 'first', label: t('Nombre'), value: a.firstName, max: 60 }, { name: 'last', label: t('Apellido'), value: a.lastName, max: 60 }],
    confirm: t('Guardar'),
    validate: ({ first, last }) => (!first.trim() || !last.trim() ? esc(t('Escribe tu nombre y apellido.')) : ''),
  });
  if (!v) return;
  const { error } = await supabase.rpc('set_my_name', { p_first: v.first.trim(), p_last: v.last.trim() });
  if (error) return toast(error.message);
  a.firstName = v.first.trim(); a.lastName = v.last.trim();
  dm?.broadcastProfile(); // a los amigos conectados les llega al instante
  toast(t('Guardado.'));
  profileSheet();
}
function languageMenu(after) {
  openMenu(null, Object.entries(LANGS).map(([code, name]) => ({ label: name, run: () => { setLang(code); retranslate(); after?.(); } })), esc(t('Idioma')));
}
/** Invitar amigos: el texto con mi número y los enlaces para descargar ChamuFlac. */
async function inviteFriends() {
  const text = t('¡Hablemos por ChamuFlac! Mi número es {n}. Descárgala o entra desde el navegador: {url}', { n: fmtNumber(state.account.number), url: 'https://chat-irc.vercel.app' });
  try {
    if (isNative) { const { Share } = await import('@capacitor/share'); return await Share.share({ text, dialogTitle: t('Invitar') }); }
    if (navigator.share) return await navigator.share({ text });
  } catch { return; }
  copyText(text, t('Invitación copiada: pégala donde quieras.'));
}
const copyNumber = () => copyText(String(state.account.number), t('Número copiado: {n}', { n: fmtNumber(state.account.number) }));
async function copyText(text, msg) {
  try { await navigator.clipboard.writeText(text); toast(msg || t('Copiado.')); } catch { toast(text); }
}

if (import.meta.env.DEV) window.__app = { state, supabase, handleTap, openChat, createClient, get dm() { return dm; } };

/* ---------- ¡En marcha! ---------- */
renderSplash();
initAppEvents({ onUrl: handleAuthUrl, onResume, onBack });
initLocal({ onTap: (extra) => extra.from && openChat(String(extra.from)) });
boot().catch((e) => renderError(e));
