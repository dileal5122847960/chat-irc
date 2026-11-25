import './style.css';
import { supabase, configured, configError } from './supabase.js';

const root = document.getElementById('root');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const NICK_RE = /^[A-Za-z[\]\\`_^{|}][A-Za-z0-9[\]\\`_^{|}-]{1,19}$/;
const CHAN_RE = /^#[A-Za-z0-9_-]{1,30}$/;

const state = {
  user: null, // { id, nick }
  windows: new Map(), // clave -> ventana ('status' o '#canal' en minúsculas)
  active: 'status',
};

/* ---------- Iconos (SVG en línea) ---------- */
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
  chat: '<path d="M4 5h16v11H8l-4 4z"/>',
};
const icon = (n, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[n]}</svg>`;

/* ---------- Tema claro/oscuro ---------- */
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('theme', t); } catch { /* sin almacenamiento */ }
}
applyTheme((() => { try { return localStorage.getItem('theme'); } catch { return null; } })() || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));

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
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return renderLogin();
  const { data: profile } = await supabase.from('profiles').select('id, nick').eq('id', session.user.id).maybeSingle();
  if (!profile) return renderLogin();
  state.user = profile;
  renderClient();
}

/* ===================================================================== */
/* Pantalla de entrada (elige nick)                                      */
/* ===================================================================== */
function renderLogin(error = '') {
  let last = '';
  try { last = localStorage.getItem('lastNick') || ''; } catch { /* nada */ }
  root.innerHTML = `<div class="auth"><form class="auth-card" id="login">
    <div class="brand"><span class="logo">#</span><div><h1>Chat IRC</h1><p class="muted">Canales, nicks y conversación en tiempo real</p></div></div>
    <label for="nick">Elige tu nick</label>
    <div class="nick-field"><span>@</span><input id="nick" name="nick" value="${esc(last)}" maxlength="20" autocomplete="nickname" autocapitalize="none" spellcheck="false" placeholder="tu_nick" required></div>
    <p class="hint">2–20 caracteres. Letras, números y <code>_ - [ ] { } ^ |</code>. No puede empezar por número.</p>
    <p class="error" role="alert">${esc(error)}</p>
    <button class="btn primary block" type="submit">Entrar al chat</button>
    <p class="muted small center">Sin registro: entras como invitado con tu nick.</p>
  </form></div>`;
  const form = document.getElementById('login');
  form.nick.focus();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const nick = form.nick.value.trim();
    if (!NICK_RE.test(nick)) return renderLogin('Ese nick no es válido.');
    const btn = form.querySelector('button');
    btn.disabled = true; btn.textContent = 'Conectando…';
    let { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error) return renderLogin('No se pudo conectar: ' + error.message);
      session = data.session;
    }
    const { data: profile, error } = await supabase.from('profiles').upsert({ id: session.user.id, nick }).select('id, nick').single();
    if (error) return renderLogin(error.code === '23505' ? `El nick ${nick} ya está en uso. Prueba otro.` : error.message);
    try { localStorage.setItem('lastNick', nick); } catch { /* nada */ }
    state.user = profile;
    renderClient();
  };
}

/* ===================================================================== */
/* Cliente                                                               */
/* ===================================================================== */
const COMMANDS = [
  ['/join', '#canal', 'Entra en un canal (lo crea si no existe)'],
  ['/part', '', 'Sale del canal actual'],
  ['/me', 'acción', 'Describe una acción: * nick saluda'],
  ['/nick', 'nuevo', 'Cambia tu nick'],
  ['/topic', 'texto', 'Cambia el tema del canal (quien lo creó)'],
  ['/list', '', 'Muestra todos los canales'],
  ['/clear', '', 'Limpia la ventana'],
  ['/help', '', 'Muestra la ayuda'],
  ['/quit', '', 'Desconecta'],
];

function renderClient() {
  root.innerHTML = `<div class="app" id="app">
    <aside class="sidebar">
      <header class="side-head"><span class="logo sm">#</span><b>Chat IRC</b>
        <button class="icon-btn mobile-only" id="close-side" title="Cerrar">${icon('x')}</button></header>
      <div class="side-section">
        <div class="side-label">Canales <button class="icon-btn sm" id="add-chan" title="Unirse o crear canal">${icon('plus')}</button></div>
        <nav id="chan-list"></nav>
      </div>
      <footer class="me">
        <span class="avatar" id="me-avatar"></span>
        <div class="me-info"><b id="me-nick"></b><small><i class="dot on"></i> Conectado</small></div>
        <button class="icon-btn" id="theme-btn" title="Cambiar tema"></button>
        <button class="icon-btn" id="quit-btn" title="Desconectar">${icon('logout')}</button>
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
          <input id="input" autocomplete="off" spellcheck="true" maxlength="1000" placeholder="Escribe un mensaje…">
          <button class="send" type="submit" title="Enviar">${icon('send')}</button>
        </div>
        <p class="composer-hint">Enter para enviar · <kbd>/</kbd> comandos · <kbd>Tab</kbd> completa nicks · <kbd>↑</kbd> recupera lo escrito</p>
      </form>
    </main>
  </div>`;
  state.windows.clear();
  state.windows.set('status', { key: 'status', name: 'Inicio', lines: [], unread: 0, mention: false, last: null });
  document.getElementById('me-avatar').outerHTML = avatar(state.user.nick, 'me-avatar');
  updateMe();
  updateThemeBtn();

  const input = document.getElementById('input');
  const pop = document.getElementById('cmd-pop');
  document.getElementById('input-form').onsubmit = (e) => {
    e.preventDefault();
    const text = input.value;
    input.value = '';
    hidePop();
    if (text.trim()) handleInput(text);
  };
  // Historial de lo escrito con ↑ ↓, autocompletado de nicks y menú de comandos
  const hist = []; let hi = -1; let popIndex = 0;
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
  function hidePop() { pop.classList.add('hidden'); popIndex = 0; }
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
    if (e.key === 'ArrowUp' && hist.length && !input.value.slice(0, input.selectionStart).includes('\n')) { hi = Math.min(hi + 1, hist.length - 1); input.value = hist[hi]; e.preventDefault(); }
    if (e.key === 'ArrowDown' && hi >= 0) { hi -= 1; input.value = hi < 0 ? '' : hist[hi]; e.preventDefault(); }
    if (e.key === 'Tab' && !popOpen) { e.preventDefault(); completeNick(input); }
  });

  const app = document.getElementById('app');
  const closeSide = () => app.classList.remove('side-open');
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
  document.getElementById('add-chan').onclick = () => {
    const name = prompt('Nombre del canal al que unirte (se crea si no existe):', '#');
    if (name && name.trim() && name.trim() !== '#') { joinChannel(name.trim().startsWith('#') ? name.trim() : '#' + name.trim()); closeSide(); }
  };
  document.getElementById('quit-btn').onclick = () => handleInput('/quit');
  document.getElementById('theme-btn').onclick = () => { applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); updateThemeBtn(); };
  document.getElementById('members').onclick = (e) => {
    const li = e.target.closest('[data-nick]');
    if (li) { input.value = (input.value ? input.value.replace(/\s*$/, ' ') : '') + li.dataset.nick + (input.value ? ' ' : ': '); input.focus(); app.classList.remove('members-open'); }
  };

  statusLine(`Conectado como ${state.user.nick}. Escribe /help para ver los comandos.`);
  renderChanList();
  joinChannel('#general');
}

function updateMe() {
  document.getElementById('me-nick').textContent = state.user.nick;
  const av = document.getElementById('me-avatar');
  if (av) av.outerHTML = avatar(state.user.nick, 'me-avatar');
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
function avatar(nick, id = '') {
  return `<span class="avatar" ${id ? `id="${id}"` : ''} style="${nickStyle(nick)}">${esc(nick.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '?')}</span>`;
}

/* ---------- Mensajes ---------- */
const time = (d) => new Date(d).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
const dayLabel = (d) => {
  const dt = new Date(d); const today = new Date();
  const diff = Math.round((new Date(today.toDateString()) - new Date(dt.toDateString())) / 864e5);
  return diff === 0 ? 'Hoy' : diff === 1 ? 'Ayer' : dt.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });
};
function linkify(s) {
  return esc(s)
    .replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\*([^*\n]+)\*/g, '<b>$1</b>')
    .replace(/(^|\s)_([^_\n]+)_(?=\s|$)/g, '$1<i>$2</i>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>');
}
function mentionsMe(m) {
  if (!state.user || m.user_id === state.user.id) return false;
  return new RegExp(`(^|[^\\w])${state.user.nick.replace(/[^\w]/g, '\\$&')}([^\\w]|$)`, 'i').test(m.body);
}
function formatMessage(w, m) {
  const ts = new Date(m.created_at).getTime();
  let html = '';
  const day = new Date(m.created_at).toDateString();
  if (!w.last || w.last.day !== day) { html += `<div class="day-sep"><span>${esc(dayLabel(m.created_at))}</span></div>`; w.last = null; }
  const mention = mentionsMe(m);
  if (m.kind === 'action') {
    html += `<div class="msg action ${mention ? 'mention' : ''}"><span class="gutter"><time>${time(ts)}</time></span><div class="msg-body"><span class="star">*</span> <b class="nick" style="${nickStyle(m.nick)}">${esc(m.nick)}</b> ${linkify(m.body)}</div></div>`;
    w.last = { day, nick: null, ts };
    return html;
  }
  const grouped = w.last && w.last.nick === m.nick && ts - w.last.ts < 5 * 60 * 1000;
  if (grouped) {
    html += `<div class="msg cont ${mention ? 'mention' : ''}"><span class="gutter"><time>${time(ts)}</time></span><div class="msg-body">${linkify(m.body)}</div></div>`;
  } else {
    html += `<div class="msg first ${mention ? 'mention' : ''}"><span class="gutter">${avatar(m.nick)}</span><div class="msg-body"><div class="msg-head"><b class="nick" style="${nickStyle(m.nick)}">${esc(m.nick)}</b><time>${time(ts)}</time></div>${linkify(m.body)}</div></div>`;
  }
  w.last = { day, nick: m.nick, ts };
  return html;
}
function addHtml(key, html, { count = false, mention = false } = {}) {
  const w = state.windows.get(key);
  if (!w) return;
  w.lines.push(html);
  if (w.lines.length > 600) w.lines.shift();
  if (state.active === key && !document.hidden) {
    const log = document.getElementById('log');
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    log.insertAdjacentHTML('beforeend', html);
    if (atBottom) log.scrollTop = log.scrollHeight;
  } else {
    if (state.active === key) document.getElementById('log').insertAdjacentHTML('beforeend', html);
    if (count) { w.unread = (w.unread || 0) + 1; if (mention) w.mention = true; renderChanList(); updateTitle(); }
  }
}
function addMessage(key, m, live = false) {
  const w = state.windows.get(key);
  if (!w) return;
  const mine = m.user_id === state.user.id;
  addHtml(key, formatMessage(w, m), { count: live && !mine, mention: live && mentionsMe(m) });
}
function sys(key, text, kind = 'info') {
  const w = state.windows.get(key);
  if (!w) return;
  w.last = w.last ? { ...w.last, nick: null } : null;
  addHtml(key, `<div class="sys ${kind}"><span class="gutter"><time>${time(Date.now())}</time></span><div class="msg-body">${text}</div></div>`);
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
}
function activate(key) {
  const w = state.windows.get(key);
  if (!w) return;
  state.active = key;
  w.unread = 0; w.mention = false;
  const log = document.getElementById('log');
  log.innerHTML = w.lines.join('') || (key === 'status' ? '' : '<div class="empty">Aún no hay mensajes. ¡Rompe el hielo!</div>');
  log.scrollTop = log.scrollHeight;
  document.getElementById('win-name').innerHTML = key === 'status' ? esc(w.name) : `${icon('hash', 'title-hash')}${esc(w.name.slice(1))}`;
  document.getElementById('input').placeholder = key === 'status' ? 'Escribe un /comando… (prueba /join #canal)' : `Mensaje en ${w.name}`;
  renderTopic(); renderMembers(); renderChanList(); updateTitle();
  if (matchMedia('(pointer:fine)').matches) document.getElementById('input').focus();
}
function renderTopic() {
  const w = state.windows.get(state.active);
  document.getElementById('topic').innerHTML = w.key === 'status' ? 'Mensajes del sistema y resultados de comandos' : (w.topic ? linkify(w.topic) : '<span class="muted">Sin tema · /topic para añadir uno</span>');
}
function renderMembers() {
  const w = state.windows.get(state.active);
  const el = document.getElementById('members');
  const btn = document.getElementById('toggle-members');
  const isStatus = w.key === 'status';
  el.classList.toggle('hidden', isStatus);
  btn.classList.toggle('hidden', isStatus);
  if (isStatus) return;
  const nicks = [...(w.nicks || [])].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
  document.getElementById('member-count').textContent = nicks.length;
  el.innerHTML = `<div class="side-label">En línea — ${nicks.length}</div>` +
    nicks.map((n) => `<button class="member" data-nick="${esc(n)}" title="Mencionar a ${esc(n)}"><span class="av-wrap">${avatar(n)}<i class="dot on"></i></span><span class="member-nick" style="${nickStyle(n)}">${esc(n)}</span>${n === state.user.nick ? '<small>tú</small>' : ''}</button>`).join('');
}
function completeNick(input) {
  const w = state.windows.get(state.active);
  const m = input.value.match(/(\S+)$/);
  if (!m || !w.nicks) return;
  const found = [...w.nicks].find((n) => n.toLowerCase().startsWith(m[1].toLowerCase()));
  if (found) input.value = input.value.slice(0, -m[1].length) + found + (m.index === 0 ? ': ' : ' ');
}

/* ===================================================================== */
/* Canales: base de datos + tiempo real                                  */
/* ===================================================================== */
async function joinChannel(name) {
  if (!CHAN_RE.test(name)) return errorLine(`Nombre de canal no válido: ${name}. Usa letras, números, - o _ (ej.: #charla).`);
  const key = name.toLowerCase();
  if (state.windows.has(key)) return activate(key);

  // Busca el canal; si no existe, lo crea (como /join en IRC)
  let { data: ch, error } = await supabase.from('channels').select('*').ilike('name', name).maybeSingle();
  if (error) return errorLine('Error: ' + error.message);
  if (!ch) {
    ({ data: ch, error } = await supabase.from('channels').insert({ name, created_by: state.user.id }).select().single());
    if (error) return errorLine('No se pudo crear el canal: ' + error.message);
    statusLine(`Canal ${ch.name} creado.`);
  }

  const w = { key, name: ch.name, id: ch.id, topic: ch.topic, lines: [], nicks: new Set([state.user.nick]), unread: 0, mention: false, last: null, rt: null };
  state.windows.set(key, w);
  activate(key);

  // Últimos 100 mensajes, en orden cronológico, y después el aviso de entrada
  const { data: history } = await supabase.from('messages').select('*').eq('channel_id', ch.id).order('created_at', { ascending: false }).limit(100);
  if (history?.length) history.reverse().forEach((m) => addMessage(key, m));
  if (state.active === key) document.querySelector('#log .empty')?.remove();
  sys(key, `Has entrado en <b>${esc(ch.name)}</b>${ch.topic ? ` — ${linkify(ch.topic)}` : ''}`, 'join');

  // Tiempo real: mensajes nuevos, cambios de topic y presencia (lista de nicks)
  const rt = supabase.channel('chan:' + ch.id, { config: { presence: { key: state.user.id } } });
  rt.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `channel_id=eq.${ch.id}` }, ({ new: m }) => {
    if (state.active === key) document.querySelector('#log .empty')?.remove();
    addMessage(key, m, true);
  })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'channels', filter: `id=eq.${ch.id}` }, ({ new: c }) => {
      if (c.topic !== w.topic) { w.topic = c.topic; sys(key, `Nuevo tema: ${linkify(c.topic)}`, 'topic'); if (state.active === key) renderTopic(); }
    })
    .on('presence', { event: 'sync' }, () => {
      w.nicks = new Set(Object.values(rt.presenceState()).map((p) => p[0]?.nick).filter(Boolean));
      w.nicks.add(state.user.nick);
      if (state.active === key) renderMembers();
    })
    .on('presence', { event: 'join' }, ({ key: uid, newPresences }) => {
      if (uid !== state.user.id && w.ready) sys(key, `<b>${esc(newPresences[0]?.nick)}</b> ha entrado`, 'join');
    })
    .on('presence', { event: 'leave' }, ({ key: uid, leftPresences }) => {
      if (uid !== state.user.id) sys(key, `<b>${esc(leftPresences[0]?.nick)}</b> ha salido`, 'part');
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await rt.track({ nick: state.user.nick, since: Date.now() });
        setTimeout(() => (w.ready = true), 1500); // no anuncia a quienes ya estaban
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') sys(key, 'Problema de conexión en tiempo real; reintentando…', 'err');
    });
  w.rt = rt;
}

async function partChannel(key) {
  const w = state.windows.get(key);
  if (!w || key === 'status') return errorLine('No estás en un canal.');
  if (w.rt) await supabase.removeChannel(w.rt);
  state.windows.delete(key);
  statusLine(`Has salido de ${w.name}.`);
  if (state.active === key) activate(state.windows.has('#general') ? '#general' : [...state.windows.keys()].pop());
  else renderChanList();
}

// Los envíos salen en fila para que lleguen en el mismo orden en que se escribieron.
let sendQueue = Promise.resolve();
function sendMessage(body, kind = 'msg') {
  const w = state.windows.get(state.active);
  if (!w || w.key === 'status') return errorLine('Únete a un canal para hablar: /join #canal');
  const row = { channel_id: w.id, user_id: state.user.id, nick: state.user.nick, kind, body: body.slice(0, 1000) };
  sendQueue = sendQueue.then(async () => {
    const { error } = await supabase.from('messages').insert(row);
    if (error) sys(w.key, esc('No se pudo enviar: ' + error.message), 'err');
  });
  return sendQueue;
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
      if (!NICK_RE.test(arg)) return errorLine('Nick no válido.');
      const old = state.user.nick;
      const { error } = await supabase.from('profiles').update({ nick: arg }).eq('id', state.user.id);
      if (error) return errorLine(error.code === '23505' ? `El nick ${arg} ya está en uso.` : error.message);
      state.user.nick = arg;
      try { localStorage.setItem('lastNick', arg); } catch { /* nada */ }
      updateMe();
      for (const w of state.windows.values()) {
        if (w.rt) { await w.rt.track({ nick: arg, since: Date.now() }); sys(w.key, `Ahora eres <b>${esc(arg)}</b> (antes ${esc(old)})`, 'info'); }
      }
      return statusLine(`Ahora eres ${arg}.`);
    }
    case 'topic': {
      const w = state.windows.get(state.active);
      if (!w?.id) return errorLine('No estás en un canal.');
      if (!arg) return sys(w.key, `Tema: ${w.topic ? linkify(w.topic) : '(sin tema)'}`, 'topic');
      const { data, error } = await supabase.from('channels').update({ topic: arg.slice(0, 300) }).eq('id', w.id).select();
      if (error || !data?.length) return errorLine('Solo quien creó el canal puede cambiar el tema.');
      return;
    }
    case 'list': {
      const { data } = await supabase.from('channels').select('name, topic').order('name');
      sys(state.active, '<b>Canales disponibles</b> (haz clic para entrar):<br>' + (data || []).map((c) => `<a href="#" data-join="${esc(c.name)}">${esc(c.name)}</a> ${c.topic ? '— ' + esc(c.topic) : ''}`).join('<br>'), 'info');
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
      for (const w of state.windows.values()) if (w.rt) supabase.removeChannel(w.rt);
      await supabase.auth.signOut();
      return renderLogin();
    default:
      return errorLine(`Comando desconocido: /${cmd}. Escribe /help.`);
  }
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-join]');
  if (a) { e.preventDefault(); joinChannel(a.dataset.join); }
});
