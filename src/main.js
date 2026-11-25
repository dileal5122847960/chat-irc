import './style.css';
import { supabase, configured, configError } from './supabase.js';

/*
 * Arquitectura
 * ─────────────
 * • Mensajes: Supabase Realtime "Broadcast" (navegador → navegador). No se guardan.
 * • Canales y usuarios conectados: Realtime "Presence". Un canal existe mientras haya gente.
 * • "irc-lobby": canal de presencia global para saber qué nicks están en uso y qué canales hay.
 * • Base de datos: solo cuentas registradas (tabla profiles = nick reservado).
 *   Los invitados no generan ninguna escritura.
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
  root.innerHTML = `<div class="auth"><div class="auth-card"><div class="brand"><span class="logo">#</span><h1>${esc(title)}</h1></div><p class="muted">${html}</p></div></div>`;
}

async function boot() {
  connectLobby();
  const { data: { session } } = await supabase.auth.getSession();
  if (session && session.user.is_anonymous) await supabase.auth.signOut(); // restos del sistema anterior
  else if (session) await loadAccount(session.user);
  if (location.hash.includes('access_token') || location.search.includes('code=')) history.replaceState(null, '', location.pathname);
  renderHome();
}
/** Carga el perfil de la cuenta. Si aún no tiene nick, queda pendiente de elegirlo. */
async function loadAccount(user) {
  const { data: profile } = await supabase.from('profiles').select('nick').eq('id', user.id).maybeSingle();
  if (profile) { state.account = { id: user.id, nick: profile.nick, email: user.email }; state.pendingUser = null; return true; }
  state.account = null;
  state.pendingUser = user;
  return false;
}

/* ---------- Lobby global (presencia) ---------- */
function connectLobby() {
  const lobby = supabase.channel('irc-lobby', { config: { presence: { key: state.clientId } } });
  state.lobby = lobby;
  state.lobbyReady = new Promise((resolve) => {
    lobby
      .on('presence', { event: 'sync' }, () => {
        resolve();
        renderActiveChannels();
        if (state.windows.has('status')) refreshListIfOpen();
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
  const chans = [...state.windows.values()].filter((w) => w.key !== 'status').map((w) => w.name);
  state.lobby.track({ nick: state.nick, reg: state.registered, uid: state.account?.id || null, chans });
}
function activeChannels() {
  const counts = new Map();
  for (const e of lobbyEntries()) for (const c of e.chans || []) {
    const k = c.toLowerCase();
    counts.set(k, { name: counts.get(k)?.name || c, n: (counts.get(k)?.n || 0) + 1 });
  }
  for (const w of state.windows.values()) if (w.key !== 'status') {
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
  if (state.account) {
    body = `<div class="welcome-back">${avatar(state.account.nick)}<div><b>Hola, ${esc(state.account.nick)} ${verified}</b><small class="muted">${esc(state.account.email || '')}</small></div></div>
      <form id="home-form">${msg}<button class="btn primary block" type="submit">Entrar al chat</button></form>
      <button class="btn ghost block" id="logout-btn">${icon('logout')} Cerrar sesión</button>`;
  } else if (state.pendingUser) {
    body = `<div class="welcome-back"><span class="avatar">${icon('check')}</span><div><b>Sesión iniciada</b><small class="muted">${esc(state.pendingUser.email || '')}</small></div></div>
      <p class="lead">Elige el nick que quieres reservar. Será solo tuyo.</p>
      <form id="home-form">${nickField(suggestNick(state.pendingUser))}${msg}<button class="btn primary block" type="submit">Reservar nick y entrar</button></form>
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
      <form id="home-form">${isLogin ? email + pass : nickField('') + email + pass + '<p class="hint">Tu nick quedará reservado: nadie más podrá usarlo.</p>'}${msg}
        <button class="btn primary block" type="submit">${isLogin ? 'Iniciar sesión' : 'Crear cuenta'}</button></form>
      <p class="alt-links">${isLogin ? '¿No tienes cuenta? <button type="button" class="link" data-view="register">Crear cuenta</button>' : '¿Ya tienes cuenta? <button type="button" class="link" data-view="login">Iniciar sesión</button>'}</p>`;
  }
  root.innerHTML = `<div class="auth"><div class="auth-card">
    <div class="brand"><span class="logo">#</span><div><h1>Chat IRC</h1><p class="muted">Canales, nicks y conversación en tiempo real</p></div></div>
    ${body}
    <p class="muted small center note">Las conversaciones no se guardan: solo ves lo que se dice mientras estás conectado.</p>
  </div></div>`;

  root.querySelectorAll('[data-view]').forEach((b) => (b.onclick = () => { homeView = b.dataset.view; renderHome(); }));
  document.getElementById('google-btn')?.addEventListener('click', signInWithGoogle);
  const logout = document.getElementById('logout-btn');
  if (logout) logout.onclick = async () => { await supabase.auth.signOut(); state.account = null; state.pendingUser = null; homeView = 'guest'; renderHome('Sesión cerrada.', 'ok'); };
  const form = document.getElementById('home-form');
  const first = [...form.querySelectorAll('input')].find((i) => !i.value) || form.querySelector('input');
  if (matchMedia('(pointer:fine)').matches) first?.focus();
  form.onsubmit = (e) => { e.preventDefault(); submitHome(form); };
}
function renderActiveChannels() {
  // La lista de canales se muestra dentro del chat (ventana "Canales").
  if (state.active === 'status' && document.getElementById('browser')) renderBrowser();
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
      state.account = { id: state.pendingUser.id, nick: data || nick, email: state.pendingUser.email };
      state.pendingUser = null;
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
        options: { data: { nick }, emailRedirectTo: location.origin + '/' },
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
const COMMANDS = [
  ['/join', '#canal', 'Entra en un canal (se crea al entrar)'],
  ['/part', '', 'Sale del canal actual'],
  ['/me', 'acción', 'Describe una acción: * nick saluda'],
  ['/nick', 'nuevo', 'Cambia tu nick'],
  ['/topic', 'texto', 'Cambia el tema del canal'],
  ['/list', '', 'Canales activos ahora'],
  ['/clear', '', 'Limpia la ventana'],
  ['/help', '', 'Muestra la ayuda'],
  ['/quit', '', 'Sale del chat'],
];

function enterChat(nick, registered, channel) {
  state.nick = nick;
  state.registered = registered;
  renderClient();
  if (channel) joinChannel(channel);
  else activate('status');
}

function renderClient() {
  root.innerHTML = `<div class="app" id="app">
    <aside class="sidebar">
      <header class="side-head"><span class="logo sm">#</span><b>Chat IRC</b>
        <button class="icon-btn mobile-only" id="close-side" title="Cerrar">${icon('x')}</button></header>
      <div class="side-section">
        <div class="side-label">Tus canales <button class="icon-btn sm" id="add-chan" title="Unirse o crear canal">${icon('plus')}</button></div>
        <nav id="chan-list"></nav>
        <div class="side-label spaced">Activos ahora</div>
        <nav id="live-list"></nav>
      </div>
      <footer class="me">
        <span id="me-avatar"></span>
        <div class="me-info"><b id="me-nick"></b><small><i class="dot on"></i> ${state.registered ? 'Registrado' : 'Invitado'}</small></div>
        <button class="icon-btn" id="theme-btn" title="Cambiar tema"></button>
        <button class="icon-btn" id="quit-btn" title="Salir del chat">${icon('logout')}</button>
      </footer>
    </aside>
    <div class="scrim" id="scrim"></div>
    <main class="chat">
      <header class="chat-head">
        <button class="icon-btn mobile-only" id="open-side" title="Canales">${icon('menu')}</button>
        <div class="chat-title"><h2 id="win-name"></h2><p id="topic"></p></div>
        <button class="icon-btn" id="toggle-members" title="Usuarios">${icon('users')}<span id="member-count"></span></button>
      </header>
      <div class="chat-body">
        <div class="log" id="log"></div>
        <aside class="members" id="members"></aside>
      </div>
      <form class="composer" id="input-form">
        <div class="cmd-pop hidden" id="cmd-pop"></div>
        <div class="input-wrap">
          <input id="input" autocomplete="off" spellcheck="true" maxlength="${MAX_MSG}" placeholder="Escribe un mensaje…">
          <button class="send" type="submit" title="Enviar">${icon('send')}</button>
        </div>
        <p class="composer-hint">Enter para enviar · <kbd>/</kbd> comandos · <kbd>Tab</kbd> completa nicks · <kbd>↑</kbd> recupera lo escrito</p>
      </form>
    </main>
  </div>`;
  state.windows.clear();
  state.windows.set('status', { key: 'status', name: 'Canales', lines: [], unread: 0, mention: false, last: null });
  updateMe();
  updateThemeBtn();
  bindComposer();

  const app = document.getElementById('app');
  const closeSide = () => app.classList.remove('side-open');
  document.getElementById('chan-list').onclick = (e) => {
    const b = e.target.closest('[data-win]');
    if (!b) return;
    if (e.target.closest('[data-part]')) return partChannel(b.dataset.win);
    activate(b.dataset.win); closeSide();
  };
  document.getElementById('live-list').onclick = (e) => {
    const b = e.target.closest('[data-join]');
    if (b) { joinChannel(b.dataset.join); closeSide(); }
  };
  document.getElementById('open-side').onclick = () => app.classList.add('side-open');
  document.getElementById('close-side').onclick = closeSide;
  document.getElementById('scrim').onclick = () => { closeSide(); app.classList.remove('members-open'); };
  document.getElementById('toggle-members').onclick = () => {
    if (matchMedia('(max-width: 900px)').matches) app.classList.toggle('members-open');
    else app.classList.toggle('members-hidden');
  };
  document.getElementById('add-chan').onclick = () => {
    const name = prompt('Canal al que unirte (se crea si no existe):', '#');
    if (name && name.trim() && name.trim() !== '#') { joinChannel(name.trim().startsWith('#') ? name.trim() : '#' + name.trim()); closeSide(); }
  };
  document.getElementById('quit-btn').onclick = () => handleInput('/quit');
  document.getElementById('theme-btn').onclick = () => { applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); updateThemeBtn(); };
  document.getElementById('members').onclick = (e) => {
    const li = e.target.closest('[data-nick]');
    const input = document.getElementById('input');
    if (li) { input.value = (input.value ? input.value.replace(/\s*$/, ' ') : '') + li.dataset.nick + (input.value ? ' ' : ': '); input.focus(); app.classList.remove('members-open'); }
  };

  statusLine(`Conectado como ${state.nick}${state.registered ? ' (registrado)' : ' (invitado)'}. Escribe /help para ver los comandos.`);
  statusLine('Las conversaciones no se guardan: solo verás los mensajes enviados mientras estés en el canal.');
  renderChanList();
  trackLobby();
}

function bindComposer() {
  const input = document.getElementById('input');
  const pop = document.getElementById('cmd-pop');
  document.getElementById('input-form').onsubmit = (e) => {
    e.preventDefault();
    const text = input.value;
    input.value = '';
    hidePop();
    if (text.trim()) handleInput(text);
  };
  const hist = []; let hi = -1; let popIndex = 0;
  function hidePop() { pop.classList.add('hidden'); popIndex = 0; }
  input.addEventListener('input', () => {
    const v = input.value;
    if (v.startsWith('/') && !v.includes(' ')) {
      const items = COMMANDS.filter(([c]) => c.startsWith(v.toLowerCase()));
      if (!items.length) return hidePop();
      popIndex = Math.min(popIndex, items.length - 1);
      pop.innerHTML = items.map(([c, a, d], i) => `<button type="button" data-cmd="${c}" class="${i === popIndex ? 'sel' : ''}"><b>${c}</b> <span class="arg">${esc(a)}</span><small>${esc(d)}</small></button>`).join('');
      pop.classList.remove('hidden');
    } else hidePop();
  });
  pop.onmousedown = (e) => {
    e.preventDefault();
    const b = e.target.closest('[data-cmd]');
    if (b) { input.value = b.dataset.cmd + ' '; hidePop(); input.focus(); }
  };
  input.addEventListener('keydown', (e) => {
    const popOpen = !pop.classList.contains('hidden');
    if (popOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      const n = pop.children.length;
      popIndex = (popIndex + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
      [...pop.children].forEach((c, i) => c.classList.toggle('sel', i === popIndex));
      e.preventDefault(); return;
    }
    if (popOpen && (e.key === 'Tab' || (e.key === 'Enter' && pop.children[popIndex] && input.value !== pop.children[popIndex].dataset.cmd))) {
      input.value = pop.children[popIndex].dataset.cmd + ' ';
      hidePop(); e.preventDefault(); return;
    }
    if (e.key === 'Escape') return hidePop();
    if (e.key === 'Enter' && input.value.trim()) { hist.unshift(input.value); hi = -1; }
    if (e.key === 'ArrowUp' && hist.length) { hi = Math.min(hi + 1, hist.length - 1); input.value = hist[hi]; e.preventDefault(); }
    if (e.key === 'ArrowDown' && hi >= 0) { hi -= 1; input.value = hi < 0 ? '' : hist[hi]; e.preventDefault(); }
    if (e.key === 'Tab' && !popOpen) { e.preventDefault(); completeNick(input); }
  });
}

function updateMe() {
  document.getElementById('me-nick').innerHTML = esc(state.nick) + (state.registered ? ' ' + verified : '');
  document.getElementById('me-avatar').innerHTML = avatar(state.nick);
  updateTitle();
}
function updateThemeBtn() {
  const b = document.getElementById('theme-btn');
  if (b) b.innerHTML = icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon');
}
function updateTitle() {
  const w = state.windows.get(state.active);
  const unread = [...state.windows.values()].reduce((n, x) => n + (x.unread || 0), 0);
  document.title = (unread ? `(${unread}) ` : '') + (w && w.key !== 'status' ? w.name + ' · ' : '') + 'Chat IRC';
}

/* ---------- Avatares y colores ---------- */
function hue(nick) { let h = 0; for (const c of nick.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; }
const nickStyle = (nick) => `--h:${hue(nick)}`;
function avatar(nick) {
  return `<span class="avatar" style="${nickStyle(nick)}">${esc(nick.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '?')}</span>`;
}

/* ---------- Mensajes ---------- */
const time = (d) => new Date(d).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
function linkify(s) {
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
function formatMessage(w, m) {
  const mention = mentionsMe(m);
  const nickHtml = `<b class="nick" style="${nickStyle(m.nick)}">${esc(m.nick)}</b>${m.reg ? verified : ''}`;
  if (m.kind === 'action') {
    w.last = null;
    return `<div class="msg action ${mention ? 'mention' : ''}"><span class="gutter"><time>${time(m.ts)}</time></span><div class="msg-body"><span class="star">*</span> ${nickHtml} ${linkify(m.body)}</div></div>`;
  }
  const grouped = w.last && w.last.from === m.from && w.last.nick === m.nick && m.ts - w.last.ts < 5 * 60 * 1000;
  w.last = { from: m.from, nick: m.nick, ts: m.ts };
  if (grouped) return `<div class="msg cont ${mention ? 'mention' : ''}"><span class="gutter"><time>${time(m.ts)}</time></span><div class="msg-body">${linkify(m.body)}</div></div>`;
  return `<div class="msg first ${mention ? 'mention' : ''}"><span class="gutter">${avatar(m.nick)}</span><div class="msg-body"><div class="msg-head">${nickHtml}<time>${time(m.ts)}</time></div>${linkify(m.body)}</div></div>`;
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
    if (log.children.length > 500) log.firstElementChild.remove();
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
  const mine = m.from === state.clientId;
  addHtml(key, formatMessage(w, m), { count: !mine, mention: mentionsMe(m) });
}
function sys(key, html, kind = 'info') {
  const w = state.windows.get(key);
  if (!w) return;
  w.last = null;
  addHtml(key, `<div class="sys ${kind}"><span class="gutter"><time>${time(Date.now())}</time></span><div class="msg-body">${html}</div></div>`);
}
const statusLine = (text) => sys('status', esc(text));
const errorLine = (text) => sys(state.active, esc(text), 'err');
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  const w = state.windows.get(state.active);
  if (w && w.unread) { w.unread = 0; w.mention = false; renderChanList(); updateTitle(); }
});

/* ---------- Ventanas / canales ---------- */
function renderChanList() {
  const el = document.getElementById('chan-list');
  if (!el) return;
  el.innerHTML = [...state.windows.values()].map((w) => {
    const isStatus = w.key === 'status';
    const badge = w.unread ? `<span class="badge ${w.mention ? 'mention' : ''}">${w.unread > 99 ? '99+' : w.unread}</span>` : '';
    return `<button data-win="${esc(w.key)}" class="chan ${w.key === state.active ? 'active' : ''} ${w.unread ? 'unread' : ''}">
      ${icon(isStatus ? 'home' : 'hash')}<span class="chan-name">${esc(isStatus ? w.name : w.name.slice(1))}</span>${badge}
      ${!isStatus ? `<span class="part" data-part title="Salir del canal">${icon('x')}</span>` : ''}</button>`;
  }).join('');
  renderLiveList();
}
function renderLiveList() {
  const el = document.getElementById('live-list');
  if (!el) return;
  const list = activeChannels().filter((c) => !state.windows.has(c.name.toLowerCase()));
  el.innerHTML = list.slice(0, 15).map((c) => `<button class="chan" data-join="${esc(c.name)}">${icon('hash')}<span class="chan-name">${esc(c.name.slice(1))}</span><span class="count">${c.n}</span></button>`).join('')
    || '<p class="side-empty">No hay otros canales activos.</p>';
}
function refreshListIfOpen() { renderLiveList(); renderActiveChannels(); }

/** Lista de canales activos + crear/unirse (ventana "Canales"). */
function browserHtml() {
  const list = activeChannels();
  const joined = (k) => state.windows.has(k);
  const items = list.map((c) => `<button class="room" data-join="${esc(c.name)}">
      <span class="room-ico">${icon('hash')}</span>
      <span class="room-info"><b>${esc(c.name.slice(1))}</b><small>${c.n} ${c.n === 1 ? 'persona' : 'personas'} conectada${c.n === 1 ? '' : 's'}</small></span>
      <span class="room-go">${joined(c.name.toLowerCase()) ? 'Abrir' : 'Entrar'}</span></button>`).join('');
  return `<div class="browser" id="browser">
    <h3>Canales activos</h3>
    <p class="muted">Elige un canal para entrar o crea uno nuevo. Los canales existen mientras haya alguien dentro.</p>
    <form class="room-new" id="room-new"><div class="field"><span>#</span><input id="room-name" maxlength="30" autocapitalize="none" spellcheck="false" placeholder="nombre-del-canal" required></div><button class="btn primary" type="submit">${icon('plus')} Crear o unirse</button></form>
    <div class="rooms">${items || `<div class="rooms-empty">No hay canales activos ahora mismo.<br><button class="link" data-join="#general">Entra en #general</button> o crea el tuyo.</div>`}</div>
  </div>`;
}
function renderBrowser() {
  const el = document.getElementById('browser');
  if (!el) return;
  const typed = document.getElementById('room-name')?.value || '';
  const focused = document.activeElement?.id === 'room-name';
  el.outerHTML = browserHtml();
  const inp = document.getElementById('room-name');
  inp.value = typed;
  if (focused) inp.focus();
  bindBrowser();
}
function bindBrowser() {
  const form = document.getElementById('room-new');
  if (!form) return;
  form.onsubmit = (e) => {
    e.preventDefault();
    const v = document.getElementById('room-name').value.trim().replace(/^#/, '');
    if (v) joinChannel('#' + v);
  };
}

function activate(key) {
  const w = state.windows.get(key);
  if (!w) return;
  state.active = key;
  w.unread = 0; w.mention = false;
  const log = document.getElementById('log');
  if (key === 'status') {
    log.innerHTML = browserHtml() + w.lines.join('');
    log.scrollTop = 0;
    bindBrowser();
  } else {
    log.innerHTML = w.lines.join('') || '<div class="empty">Aún no hay mensajes. ¡Rompe el hielo!</div>';
    log.scrollTop = log.scrollHeight;
  }
  document.getElementById('win-name').innerHTML = key === 'status' ? esc(w.name) : `${icon('hash', 'title-hash')}${esc(w.name.slice(1))}`;
  document.getElementById('input').placeholder = key === 'status' ? 'Escribe un /comando… (prueba /join #canal)' : `Mensaje en ${w.name}`;
  history.replaceState(null, '', key === 'status' ? location.pathname : '#' + w.name.slice(1));
  renderTopic(); renderMembers(); renderChanList(); updateTitle();
  if (matchMedia('(pointer:fine)').matches) document.getElementById('input').focus();
}
function renderTopic() {
  const w = state.windows.get(state.active);
  document.getElementById('topic').innerHTML = w.key === 'status' ? 'Elige un canal o crea uno nuevo' : (w.topic ? linkify(w.topic) : '<span class="muted">Sin tema · /topic para añadir uno</span>');
}
function renderMembers() {
  const w = state.windows.get(state.active);
  const el = document.getElementById('members');
  const btn = document.getElementById('toggle-members');
  const isStatus = w.key === 'status';
  el.classList.toggle('hidden', isStatus);
  btn.classList.toggle('hidden', isStatus);
  if (isStatus) return;
  const people = [...(w.people || new Map()).values()].sort((a, b) => a.nick.localeCompare(b.nick, 'es', { sensitivity: 'base' }));
  document.getElementById('member-count').textContent = people.length;
  el.innerHTML = `<div class="side-label">En línea — ${people.length}</div>` +
    people.map((p) => `<button class="member" data-nick="${esc(p.nick)}" title="Mencionar a ${esc(p.nick)}"><span class="av-wrap">${avatar(p.nick)}<i class="dot on"></i></span><span class="member-nick" style="${nickStyle(p.nick)}">${esc(p.nick)}</span>${p.reg ? verified : ''}${p.me ? '<small>tú</small>' : ''}</button>`).join('');
}
function completeNick(input) {
  const w = state.windows.get(state.active);
  const m = input.value.match(/(\S+)$/);
  if (!m || !w.people) return;
  const found = [...w.people.values()].map((p) => p.nick).find((n) => n.toLowerCase().startsWith(m[1].toLowerCase()));
  if (found) input.value = input.value.slice(0, -m[1].length) + found + (m.index === 0 ? ': ' : ' ');
}

/* ===================================================================== */
/* Canales en tiempo real (Broadcast + Presence, sin base de datos)      */
/* ===================================================================== */
function myPresence(w) {
  return { nick: state.nick, reg: state.registered, topic: w.topic || '', topicTs: w.topicTs || 0, topicBy: w.topicBy || '' };
}
function joinChannel(name) {
  if (!CHAN_RE.test(name)) return errorLine(`Nombre de canal no válido: ${name}. Usa letras, números, - o _ (ej.: #charla).`);
  const key = name.toLowerCase();
  if (state.windows.has(key)) return activate(key);
  const existing = activeChannels().find((c) => c.name.toLowerCase() === key);
  const w = { key, name: existing?.name || name, topic: '', topicTs: 0, topicBy: '', lines: [], people: new Map(), unread: 0, mention: false, last: null, rt: null, ready: false };
  state.windows.set(key, w);
  activate(key);
  sys(key, `Has entrado en <b>${esc(w.name)}</b>. Los mensajes no se guardan.`, 'join');

  const rt = supabase.channel('irc:' + key, { config: { broadcast: { self: false }, presence: { key: state.clientId } } });
  rt.on('broadcast', { event: 'msg' }, ({ payload: m }) => {
    if (!m || typeof m.body !== 'string' || typeof m.nick !== 'string') return;
    m.body = m.body.slice(0, MAX_MSG);
    m.ts = Math.min(Number(m.ts) || Date.now(), Date.now());
    addMessage(key, m);
  })
    .on('broadcast', { event: 'topic' }, ({ payload: t }) => setTopic(w, t, true))
    .on('presence', { event: 'sync' }, () => {
      const people = new Map();
      let best = null;
      for (const [cid, metas] of Object.entries(rt.presenceState())) {
        const p = metas[0];
        if (!p?.nick) continue;
        people.set(cid, { nick: p.nick, reg: !!p.reg, me: cid === state.clientId });
        if (p.topicTs && (!best || p.topicTs > best.topicTs)) best = p;
      }
      w.people = people;
      if (best && best.topicTs > w.topicTs) setTopic(w, { topic: best.topic, ts: best.topicTs, by: best.topicBy }, false);
      if (state.active === key) renderMembers();
    })
    .on('presence', { event: 'join' }, ({ key: cid, newPresences }) => {
      if (cid !== state.clientId && w.ready && newPresences[0]?.nick) sys(key, `<b>${esc(newPresences[0].nick)}</b> ha entrado`, 'join');
    })
    .on('presence', { event: 'leave' }, ({ key: cid, leftPresences }) => {
      if (cid !== state.clientId && leftPresences[0]?.nick) sys(key, `<b>${esc(leftPresences[0].nick)}</b> ha salido`, 'part');
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
function setTopic(w, t, announce) {
  if (!t || typeof t.topic !== 'string') return;
  const ts = Number(t.ts) || Date.now();
  if (ts <= w.topicTs) return;
  w.topic = t.topic.slice(0, 300); w.topicTs = ts; w.topicBy = String(t.by || '').slice(0, 20);
  if (announce) sys(w.key, `<b>${esc(w.topicBy)}</b> cambió el tema: ${linkify(w.topic)}`, 'topic');
  else if (w.topic) sys(w.key, `Tema: ${linkify(w.topic)}`, 'topic');
  if (state.active === w.key) renderTopic();
  w.rt?.track(myPresence(w)); // así el tema llega a quien entre después
}

async function partChannel(key) {
  const w = state.windows.get(key);
  if (!w || key === 'status') return errorLine('No estás en un canal.');
  if (w.rt) await supabase.removeChannel(w.rt);
  state.windows.delete(key);
  statusLine(`Has salido de ${w.name}.`);
  trackLobby();
  if (state.active === key) activate('status');
  else renderChanList();
}

let lastSend = 0;
function sendMessage(body, kind = 'msg') {
  const w = state.windows.get(state.active);
  if (!w || w.key === 'status') return errorLine('Únete a un canal para hablar: /join #canal');
  if (Date.now() - lastSend < 250) return errorLine('Más despacio: espera un momento entre mensajes.');
  lastSend = Date.now();
  const m = { from: state.clientId, nick: state.nick, reg: state.registered, kind, body: body.slice(0, MAX_MSG), ts: Date.now() };
  addMessage(w.key, m); // eco local inmediato
  w.rt.send({ type: 'broadcast', event: 'msg', payload: m }).then((r) => {
    if (r !== 'ok') sys(w.key, 'No se pudo enviar el último mensaje (conexión inestable).', 'err');
  });
}

/* ===================================================================== */
/* Comandos                                                              */
/* ===================================================================== */
async function handleInput(text) {
  if (!text.startsWith('/') || text.startsWith('//')) return sendMessage(text.replace(/^\/\//, '/'));
  const [cmd, ...rest] = text.slice(1).split(' ');
  const arg = rest.join(' ').trim();
  switch (cmd.toLowerCase()) {
    case 'join': case 'j':
      if (!arg) return errorLine('Uso: /join #canal');
      return joinChannel(arg.startsWith('#') ? arg.split(' ')[0] : '#' + arg.split(' ')[0]);
    case 'part': case 'leave':
      return partChannel(state.active);
    case 'me':
      return arg ? sendMessage(arg, 'action') : errorLine('Uso: /me acción');
    case 'nick': {
      const nick = arg;
      if (nick.toLowerCase() === state.nick.toLowerCase()) return;
      const problem = await nickProblem(nick);
      if (problem) return errorLine(problem);
      if (state.registered) {
        const { error } = await supabase.from('profiles').update({ nick }).eq('id', state.account.id);
        if (error) return errorLine(error.code === '23505' ? `El nick ${nick} ya está reservado.` : error.message);
        state.account.nick = nick;
      } else store.set('lastNick', nick);
      const old = state.nick;
      state.nick = nick;
      updateMe();
      trackLobby();
      for (const w of state.windows.values()) {
        if (!w.rt) continue;
        w.rt.track(myPresence(w));
        w.rt.send({ type: 'broadcast', event: 'msg', payload: { from: state.clientId, nick, reg: state.registered, kind: 'action', body: `ahora se llama ${nick} (antes ${old})`, ts: Date.now() } });
        sys(w.key, `Ahora eres <b>${esc(nick)}</b>${state.registered ? ' (reservado en tu cuenta)' : ''}`, 'info');
      }
      return;
    }
    case 'topic': {
      const w = state.windows.get(state.active);
      if (!w?.rt) return errorLine('No estás en un canal.');
      if (!arg) return sys(w.key, `Tema: ${w.topic ? linkify(w.topic) : '(sin tema)'}`, 'topic');
      const t = { topic: arg.slice(0, 300), ts: Date.now(), by: state.nick };
      w.rt.send({ type: 'broadcast', event: 'topic', payload: t });
      setTopic(w, t, true);
      return;
    }
    case 'list': {
      const list = activeChannels();
      sys(state.active, '<b>Canales activos ahora</b> (clic para entrar):<br>' + (list.map((c) => `<a href="#" data-join="${esc(c.name)}">${esc(c.name)}</a> — ${c.n} ${c.n === 1 ? 'persona' : 'personas'}`).join('<br>') || 'Ninguno. Crea uno con /join #nombre'), 'info');
      return;
    }
    case 'clear': {
      const w = state.windows.get(state.active);
      w.lines = []; w.last = null; document.getElementById('log').innerHTML = '';
      return;
    }
    case 'help':
      sys(state.active, '<b>Comandos</b><br>' + COMMANDS.map(([c, a, d]) => `<code>${c}${a ? ' ' + esc(a) : ''}</code> — ${esc(d)}`).join('<br>'), 'info');
      return;
    case 'quit': case 'exit':
      for (const w of state.windows.values()) if (w.rt) await supabase.removeChannel(w.rt);
      state.windows.clear();
      state.nick = null;
      state.lobby.untrack();
      history.replaceState(null, '', location.pathname);
      return renderHome();
    default:
      return errorLine(`Comando desconocido: /${cmd}. Escribe /help.`);
  }
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('#log [data-join]');
  if (a) { e.preventDefault(); joinChannel(a.dataset.join); }
});
