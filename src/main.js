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

/* ===================================================================== */
/* Arranque                                                              */
/* ===================================================================== */
if (!configured) renderSetupHelp();
else if (configError) renderFatal(configError);
else boot().catch((e) => renderFatal(e.message || String(e)));
window.addEventListener('unhandledrejection', (e) => console.error(e.reason));

function renderFatal(msg) {
  root.innerHTML = `<div class="dialog"><div class="titlebar">Chat IRC — error</div><div class="dialog-body">
    <p class="error">${esc(msg)}</p>
    <p>Revisa las variables de entorno en Vercel (<i>Settings → Environment Variables</i>) y vuelve a desplegar.</p></div></div>`;
}

function renderSetupHelp() {
  root.innerHTML = `<div class="dialog"><div class="titlebar">Chat IRC — configuración pendiente</div><div class="dialog-body">
    <p>Faltan las variables de entorno de Supabase:</p>
    <pre>VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...</pre>
    <p>En local, ponlas en <code>.env.local</code>. En Vercel: <i>Project → Settings → Environment Variables</i>, y vuelve a desplegar.</p></div></div>`;
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
/* Pantalla de conexión (elige nick)                                     */
/* ===================================================================== */
function renderLogin(error = '') {
  const last = localStorage.getItem('lastNick') || '';
  root.innerHTML = `<form class="dialog" id="login"><div class="titlebar">Conectar al servidor</div><div class="dialog-body">
    <label>Nick <input name="nick" value="${esc(last)}" maxlength="20" autocomplete="nickname" autocapitalize="none" spellcheck="false" required></label>
    <p class="hint">2–20 caracteres: letras, números y <code>[]\\\`_^{|}-</code>. No puede empezar por número.</p>
    <p class="error">${esc(error)}</p>
    <div class="buttons"><button type="submit">Conectar</button></div></div></form>`;
  const form = document.getElementById('login');
  form.nick.focus();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const nick = form.nick.value.trim();
    if (!NICK_RE.test(nick)) return renderLogin('Nick no válido.');
    form.querySelector('button').disabled = true;
    let { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error) return renderLogin('No se pudo conectar: ' + error.message + ' (¿están activados los inicios de sesión anónimos en Supabase?)');
      session = data.session;
    }
    const { data: profile, error } = await supabase.from('profiles').upsert({ id: session.user.id, nick }).select('id, nick').single();
    if (error) return renderLogin(error.code === '23505' ? `El nick ${nick} ya está en uso.` : error.message);
    localStorage.setItem('lastNick', nick);
    state.user = profile;
    renderClient();
  };
}

/* ===================================================================== */
/* Cliente                                                               */
/* ===================================================================== */
function renderClient() {
  root.innerHTML = `<div class="client">
    <div class="titlebar">Chat IRC — <span id="title-nick"></span> <span id="title-win"></span></div>
    <div class="body">
      <nav class="switchbar" id="switchbar"></nav>
      <section class="window">
        <div class="topic" id="topic"></div>
        <div class="main">
          <div class="log" id="log"></div>
          <ul class="nicklist" id="nicklist"></ul>
        </div>
        <form id="input-form"><input id="input" autocomplete="off" spellcheck="false" maxlength="1000" placeholder="Escribe un mensaje o un /comando"></form>
      </section>
    </div></div>`;
  state.windows.clear();
  state.windows.set('status', { key: 'status', name: 'Status', lines: [], unread: false });
  updateTitle();
  statusLine(`*** Conectado como ${state.user.nick}`);
  statusLine('*** Escribe /help para ver los comandos disponibles.');
  const input = document.getElementById('input');
  document.getElementById('input-form').onsubmit = (e) => {
    e.preventDefault();
    const text = input.value;
    input.value = '';
    if (text.trim()) handleInput(text);
  };
  // Historial de lo escrito con ↑ ↓ (como en mIRC)
  const hist = []; let hi = -1;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && input.value.trim()) { hist.unshift(input.value); hi = -1; }
    if (e.key === 'ArrowUp' && hist.length) { hi = Math.min(hi + 1, hist.length - 1); input.value = hist[hi]; e.preventDefault(); }
    if (e.key === 'ArrowDown') { hi = Math.max(hi - 1, -1); input.value = hi < 0 ? '' : hist[hi]; e.preventDefault(); }
    if (e.key === 'Tab') { e.preventDefault(); completeNick(input); }
  });
  document.getElementById('switchbar').onclick = (e) => {
    const b = e.target.closest('[data-win]');
    if (b) activate(b.dataset.win);
  };
  document.getElementById('nicklist').ondblclick = (e) => {
    const li = e.target.closest('[data-nick]');
    if (li) { input.value += li.dataset.nick + ': '; input.focus(); }
  };
  renderSwitchbar();
  joinChannel('#general');
}

function updateTitle() {
  document.getElementById('title-nick').textContent = state.user.nick;
  const w = state.windows.get(state.active);
  document.getElementById('title-win').textContent = w && w.key !== 'status' ? '— ' + w.name : '';
  document.title = (w && w.key !== 'status' ? w.name + ' — ' : '') + 'Chat IRC';
}

/* ---------- Líneas de texto ---------- */
const time = (d) => new Date(d).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
function nickColor(nick) {
  const colors = ['#00007f', '#009300', '#ff0000', '#7f0000', '#9c009c', '#fc7f00', '#009393', '#0000fc', '#ff00ff', '#7f7f7f'];
  let h = 0; for (const c of nick.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return colors[h % colors.length];
}
function linkify(s) {
  return esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
}
function formatMessage(m) {
  const ts = `<span class="ts">[${time(m.created_at)}]</span> `;
  const me = state.user && m.nick.toLowerCase() === state.user.nick.toLowerCase();
  const mention = !me && state.user && new RegExp(`\\b${state.user.nick.replace(/[^\w]/g, '\\$&')}\\b`, 'i').test(m.body);
  if (m.kind === 'action') return `<div class="line action ${mention ? 'mention' : ''}">${ts}* ${esc(m.nick)} ${linkify(m.body)}</div>`;
  if (m.kind === 'notice') return `<div class="line notice">${ts}-${esc(m.nick)}- ${linkify(m.body)}</div>`;
  return `<div class="line ${mention ? 'mention' : ''}">${ts}&lt;<span class="nick" style="color:${nickColor(m.nick)}">${esc(m.nick)}</span>&gt; ${linkify(m.body)}</div>`;
}
function addLine(key, html, { highlight = false } = {}) {
  const w = state.windows.get(key);
  if (!w) return;
  w.lines.push(html);
  if (w.lines.length > 500) w.lines.shift();
  if (state.active === key) {
    const log = document.getElementById('log');
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    log.insertAdjacentHTML('beforeend', html);
    if (log.children.length > 500) log.firstElementChild.remove();
    if (atBottom) log.scrollTop = log.scrollHeight;
  } else {
    w.unread = highlight ? 'highlight' : w.unread || 'msg';
    renderSwitchbar();
  }
}
const sys = (key, text, cls = 'sys') => addLine(key, `<div class="line ${cls}"><span class="ts">[${time(Date.now())}]</span> ${esc(text)}</div>`);
const statusLine = (text) => sys('status', text);
const errorLine = (text) => sys(state.active, text, 'err');

/* ---------- Ventanas ---------- */
function renderSwitchbar() {
  const bar = document.getElementById('switchbar');
  if (!bar) return;
  bar.innerHTML = [...state.windows.values()].map((w) =>
    `<button data-win="${esc(w.key)}" class="${w.key === state.active ? 'active' : ''} ${w.unread || ''}">${esc(w.name)}</button>`).join('');
}
function activate(key) {
  const w = state.windows.get(key);
  if (!w) return;
  state.active = key;
  w.unread = false;
  document.getElementById('log').innerHTML = w.lines.join('');
  document.getElementById('log').scrollTop = 1e9;
  renderTopic(); renderNicklist(); renderSwitchbar(); updateTitle();
  document.getElementById('input').focus();
}
function renderTopic() {
  const w = state.windows.get(state.active);
  const el = document.getElementById('topic');
  el.innerHTML = w.key === 'status' ? 'Ventana de estado' : `<b>${esc(w.name)}</b>${w.topic ? ': ' + linkify(w.topic) : ''}`;
}
function renderNicklist() {
  const w = state.windows.get(state.active);
  const el = document.getElementById('nicklist');
  el.classList.toggle('hidden', w.key === 'status');
  if (w.key === 'status') return;
  const nicks = [...(w.nicks || [])].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
  el.innerHTML = `<li class="count">${nicks.length} usuario${nicks.length === 1 ? '' : 's'}</li>` +
    nicks.map((n) => `<li data-nick="${esc(n)}">${esc(n)}</li>`).join('');
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
  if (!CHAN_RE.test(name)) return errorLine(`*** Nombre de canal no válido: ${name} (ej.: #charla)`);
  const key = name.toLowerCase();
  if (state.windows.has(key)) return activate(key);

  // Busca el canal; si no existe, lo crea (como /join en IRC)
  let { data: ch, error } = await supabase.from('channels').select('*').ilike('name', name).maybeSingle();
  if (error) return errorLine('*** Error: ' + error.message);
  if (!ch) {
    ({ data: ch, error } = await supabase.from('channels').insert({ name, created_by: state.user.id }).select().single());
    if (error) return errorLine('*** No se pudo crear el canal: ' + error.message);
    statusLine(`*** Canal ${ch.name} creado`);
  }

  const w = { key, name: ch.name, id: ch.id, topic: ch.topic, lines: [], nicks: new Set(), unread: false, rt: null };
  state.windows.set(key, w);
  activate(key);
  sys(key, `*** Has entrado en ${ch.name}`, 'join');
  if (ch.topic) sys(key, `*** Topic de ${ch.name}: ${ch.topic}`, 'topic');

  // Últimos 100 mensajes
  const { data: history } = await supabase.from('messages').select('*').eq('channel_id', ch.id).order('created_at', { ascending: false }).limit(100);
  if (history?.length) {
    history.reverse().forEach((m) => addLine(key, formatMessage(m)));
    sys(key, '*** Fin del historial', 'sys');
  }

  // Suscripción en tiempo real: mensajes nuevos, cambios de topic y presencia (lista de nicks)
  const rt = supabase.channel('chan:' + ch.id, { config: { presence: { key: state.user.id } } });
  rt.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `channel_id=eq.${ch.id}` }, ({ new: m }) => {
    const mention = m.user_id !== state.user.id && m.body.toLowerCase().includes(state.user.nick.toLowerCase());
    addLine(key, formatMessage(m), { highlight: mention });
  })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'channels', filter: `id=eq.${ch.id}` }, ({ new: c }) => {
      if (c.topic !== w.topic) { w.topic = c.topic; sys(key, `*** El topic ahora es: ${c.topic}`, 'topic'); if (state.active === key) renderTopic(); }
    })
    .on('presence', { event: 'sync' }, () => {
      w.nicks = new Set(Object.values(rt.presenceState()).map((p) => p[0]?.nick).filter(Boolean));
      if (state.active === key) renderNicklist();
    })
    .on('presence', { event: 'join' }, ({ key: uid, newPresences }) => {
      if (uid !== state.user.id && w.ready) sys(key, `*** ${newPresences[0]?.nick} ha entrado en ${w.name}`, 'join');
    })
    .on('presence', { event: 'leave' }, ({ key: uid, leftPresences }) => {
      if (uid !== state.user.id) sys(key, `*** ${leftPresences[0]?.nick} ha salido de ${w.name}`, 'part');
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await rt.track({ nick: state.user.nick, since: Date.now() });
        setTimeout(() => (w.ready = true), 1500); // evita listar como "entradas" a quienes ya estaban
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') sys(key, '*** Problema de conexión en tiempo real; reintentando…', 'err');
    });
  w.rt = rt;
}

async function partChannel(key) {
  const w = state.windows.get(key);
  if (!w || key === 'status') return errorLine('*** No estás en un canal');
  await w.rt?.unsubscribe();
  supabase.removeChannel(w.rt);
  state.windows.delete(key);
  statusLine(`*** Has salido de ${w.name}`);
  activate(state.windows.has('#general') ? '#general' : 'status');
}

async function sendMessage(body, kind = 'msg') {
  const w = state.windows.get(state.active);
  if (!w || w.key === 'status') return errorLine('*** Únete a un canal para hablar (/join #canal)');
  const { error } = await supabase.from('messages').insert({ channel_id: w.id, user_id: state.user.id, nick: state.user.nick, kind, body: body.slice(0, 1000) });
  if (error) errorLine('*** No se pudo enviar: ' + error.message);
}

/* ===================================================================== */
/* Comandos                                                              */
/* ===================================================================== */
const HELP = [
  '/join #canal — entra en un canal (lo crea si no existe)',
  '/part — sale del canal actual',
  '/me acción — mensaje de acción (* nick saluda)',
  '/nick nuevo — cambia tu nick',
  '/topic texto — cambia el topic (solo quien creó el canal)',
  '/list — lista los canales',
  '/clear — limpia la ventana',
  '/quit — desconecta',
  'Tab completa nicks · ↑/↓ recupera lo escrito · doble clic en un nick para mencionarlo',
];
async function handleInput(text) {
  if (!text.startsWith('/') || text.startsWith('//')) return sendMessage(text.replace(/^\/\//, '/'));
  const [cmd, ...rest] = text.slice(1).split(' ');
  const arg = rest.join(' ').trim();
  switch (cmd.toLowerCase()) {
    case 'join': case 'j':
      if (!arg) return errorLine('*** Uso: /join #canal');
      return joinChannel(arg.startsWith('#') ? arg.split(' ')[0] : '#' + arg.split(' ')[0]);
    case 'part': case 'leave':
      return partChannel(state.active);
    case 'me':
      return arg ? sendMessage(arg, 'action') : errorLine('*** Uso: /me acción');
    case 'nick': {
      if (!NICK_RE.test(arg)) return errorLine('*** Nick no válido');
      const old = state.user.nick;
      const { error } = await supabase.from('profiles').update({ nick: arg }).eq('id', state.user.id);
      if (error) return errorLine(error.code === '23505' ? `*** El nick ${arg} ya está en uso` : '*** ' + error.message);
      state.user.nick = arg;
      localStorage.setItem('lastNick', arg);
      updateTitle();
      for (const w of state.windows.values()) {
        if (w.rt) { await w.rt.track({ nick: arg, since: Date.now() }); sys(w.key, `*** Ahora eres conocido como ${arg} (antes ${old})`, 'sys'); }
      }
      return statusLine(`*** Ahora eres conocido como ${arg}`);
    }
    case 'topic': {
      const w = state.windows.get(state.active);
      if (!w?.id) return errorLine('*** No estás en un canal');
      if (!arg) return sys(w.key, `*** Topic: ${w.topic || '(sin topic)'}`, 'topic');
      const { data, error } = await supabase.from('channels').update({ topic: arg.slice(0, 300) }).eq('id', w.id).select();
      if (error || !data?.length) return errorLine('*** No tienes permiso para cambiar el topic de este canal');
      return;
    }
    case 'list': {
      const { data } = await supabase.from('channels').select('name, topic').order('name');
      statusLine('*** Canales:');
      (data || []).forEach((c) => statusLine(`  ${c.name}  ${c.topic}`));
      return activate('status');
    }
    case 'clear': {
      const w = state.windows.get(state.active);
      w.lines = []; document.getElementById('log').innerHTML = '';
      return;
    }
    case 'help':
      HELP.forEach((h) => sys(state.active, h, 'sys'));
      return;
    case 'quit': case 'exit':
      for (const w of state.windows.values()) if (w.rt) supabase.removeChannel(w.rt);
      await supabase.auth.signOut();
      return renderLogin('Desconectado.');
    default:
      return errorLine(`*** Comando desconocido: /${cmd}. Escribe /help`);
  }
}
