/*
 * Conversaciones privadas (doble clic en un nick)
 * ────────────────────────────────────────────────
 * • Solicitud → aceptar/rechazar, a través de la "bandeja" en tiempo real de cada
 *   persona (inbox:<clientId>), enviada por REST sin suscribirse a la bandeja ajena.
 * • Al aceptar, ambos se unen a un canal privado (dm:<id>) solo para la señalización
 *   WebRTC y se crea una conexión DIRECTA navegador ↔ navegador.
 * • Texto, fotos, vídeos, notas de voz y documentos viajan por un DataChannel; las
 *   llamadas y videollamadas por la misma conexión. Todo cifrado (DTLS/SRTP) y sin
 *   pasar por la base de datos ni guardarse en ningún servidor.
 */

import { EMOJI, STICKERS, stickerSvg } from './emoji.js';
import { t, LANGS, getLang, translatedFrom } from './i18n.js';
import { translate } from './translate.js';

const MAX_FILE = 100 * 1024 * 1024; // 100 MB por archivo (conexión directa)
const MAX_FILE_RELAY = 5 * 1024 * 1024; // 5 MB por archivo (plan B a través del servidor)
const RELAY_CHUNK = 48 * 1024;
const b64enc = (buf) => { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
const b64dec = (str) => { const s = atob(str); const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out.buffer; };
const CHUNK = 32 * 1024;
const REQUEST_TIMEOUT = 60 * 1000;

// Servidores para establecer conexiones directas. STUN siempre; TURN (Cloudflare, vía la
// Edge Function "turn" de Supabase) cuando está configurado, para redes que bloquean
// la conexión directa (datos móviles, redes de empresa…).
const DEFAULT_ICE = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
let ice = DEFAULT_ICE;
let iceExpires = 0;
let iceLoading = null;
export function iceServers() {
  const turn = import.meta.env.VITE_TURN_URL;
  if (turn) return [...ice, { urls: turn.split(','), username: import.meta.env.VITE_TURN_USERNAME, credential: import.meta.env.VITE_TURN_CREDENTIAL }];
  return ice;
}
/** Pide credenciales TURN temporales (si la función existe). Se renuevan cada pocas horas. */
export function loadIceServers(supabaseUrl, apiKey) {
  if (Date.now() < iceExpires) return Promise.resolve(ice);
  if (iceLoading) return iceLoading;
  iceLoading = (async () => {
    try {
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(`${supabaseUrl}/functions/v1/turn`, { headers: { apikey: apiKey }, signal: ctrl.signal });
      if (!res.ok) throw new Error('sin TURN');
      const data = await res.json();
      const list = Array.isArray(data.iceServers) ? data.iceServers : data.iceServers ? [data.iceServers] : [];
      if (list.length) { ice = [...DEFAULT_ICE, ...list]; iceExpires = Date.now() + 6 * 3600 * 1000; }
    } catch { iceExpires = Date.now() + 10 * 60 * 1000; /* se reintenta más tarde */ }
    iceLoading = null;
    return ice;
  })();
  return iceLoading;
}

export function createDM(ctx) {
  const { state, supabase, esc, icon, avatar, nickStyle, linkify, time, verified, toast } = ctx;
  let inbox = null;
  const pendingRequests = new Map(); // id -> solicitud recibida
  const fmtSize = (n) => (n < 1024 ? n + ' B' : n < 1048576 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB');
  const fmtDur = (s) => `${Math.floor((s || 0) / 60)}:${String(Math.round(s || 0) % 60).padStart(2, '0')}`;

  /* ---------------- Bandejas de entrada ---------------- */
  // Dos vías para pedir un privado:
  //  • 'tab'  (web): bandeja pública por pestaña, inbox:<clientId>. Para hablar con alguien del canal.
  //  • 'user' (amigos, web y app): bandeja privada por número, user:<número>. Solo su dueño la
  //    escucha y solo sus amigos escriben (RLS). Así la app y la web se encuentran.
  // DEV identifica este dispositivo o pestaña: si la misma cuenta está abierta en varios sitios,
  // la conversación se queda en el primero que responde y los demás se retiran.
  const DEV = crypto.randomUUID().slice(0, 12);
  const defaultVia = ctx.defaultVia || 'tab';
  const myNumber = () => (ctx.myNumber ? ctx.myNumber() : null);
  const selfId = (via) => (via === 'user' ? String(myNumber() ?? '') : state.clientId);
  const topicFor = (via, cid) => (via === 'user' ? 'user:' + cid : 'inbox:' + cid);
  const carry = new Map(); // conversación anterior con la misma persona (al reconectar)
  const handled = new Set(); // solicitudes ya atendidas (se pueden recibir repetidas)
  let friendInbox = null;
  function listen(via, id, onStatus) {
    const ch = supabase.channel(topicFor(via, id), { config: { private: via === 'user', broadcast: { self: false } } });
    const tag = (p) => (p ? { ...p, via } : null);
    ch.on('broadcast', { event: 'req' }, ({ payload }) => payload && onRequest(tag(payload)))
      .on('broadcast', { event: 'resp' }, ({ payload }) => payload && onResponse(tag(payload)))
      .on('broadcast', { event: 'cancel' }, ({ payload }) => payload && dismissRequest(payload.id))
      .on('broadcast', { event: 'mail' }, () => ctx.onMailPing?.()) // un amigo dejó mensajes en el buzón
      .on('broadcast', { event: 'receipt' }, ({ payload }) => payload && onReceipt(payload))
      .subscribe((status, err) => onStatus?.(ch, status, err));
    return ch;
  }
  function init() {
    if (defaultVia === 'tab') inbox = listen('tab', state.clientId);
    if (myNumber()) friendInbox = listen('user', myNumber(), (ch, status, err) => { if (friendInbox === ch) ctx.onInboxStatus?.(status, err); });
  }
  async function sendTo(via, cid, event, payload) {
    const ch = supabase.channel(topicFor(via, cid), { config: { private: via === 'user', broadcast: { self: false } } });
    try {
      await ch.httpSend(event, payload); return true;
    } catch { return false; } finally { supabase.removeChannel(ch); }
  }
  const me = (via) => ({ from: selfId(via), nick: state.nick, reg: state.registered, dev: DEV });
  const dmWindows = () => [...state.windows.values()].filter((w) => w.kind === 'dm');
  const isIdle = (w) => ['closed', 'rejected', 'offline'].includes(w.status); // sin conexión en curso
  const findByPeer = (cid) => dmWindows().find((w) => w.peer.cid === cid && w.status !== 'closed' && w.status !== 'rejected');
  const canMail = (w) => w.via === 'user' && !!ctx.mailbox; // amigos: se puede escribir aunque no estén conectados

  /** Abre (o enfoca) un privado con una persona del canal. */
  async function requestPrivate(peer) {
    peer = { ...peer, via: peer.via || defaultVia };
    if (peer.cid === selfId(peer.via)) return;
    const existing = state.windows.get('dm:' + peer.cid);
    if (existing && !isIdle(existing)) return ctx.activate(existing.key);
    if (existing) closeWindow(existing, true);
    // Si esa persona ya nos lo pidió, aceptamos su solicitud directamente
    const theirs = [...pendingRequests.values()].find((r) => r.from === peer.cid);
    if (theirs) return accept(theirs.id);
    const w = makeWindow(peer, crypto.randomUUID(), 'caller');
    w.status = 'pending';
    if (peer.autoCall !== undefined) w.autoCall = peer.autoCall; // llamar en cuanto conecte
    ctx.activate(w.key);
    // Entre amigos no se pide permiso: la conversación conecta sola (y mientras tanto se puede escribir)
    if (w.via !== 'user') sysLine(w, `Esperando a que <b>${esc(peer.nick)}</b> acepte la conversación privada…`);
    const ok = await sendTo(w.via, peer.cid, 'req', { id: w.id, ...me(w.via) });
    if (!ok) { setStatus(w, 'closed'); return sysLine(w, 'No se pudo enviar la solicitud.', 'err'); }
    ctx.onRequestSent?.(peer, w);
    // Entre amigos, la solicitud se repite mientras se espera: llega en cuanto el amigo abre la app
    if (ctx.resendRequests && w.via === 'user') {
      w.resend = setInterval(() => {
        if (w.status !== 'pending') return clearInterval(w.resend);
        sendTo(w.via, peer.cid, 'req', { id: w.id, ...me(w.via) });
      }, ctx.resendRequests * 1000);
    }
    w.timer = setTimeout(() => {
      if (w.status !== 'pending') return;
      if (w.via === 'user') {
        setStatus(w, 'offline');
        sysLine(w, `<b>${esc(peer.nick)}</b> ${esc(t(canMail(w) ? 'no está conectado ahora. Puedes escribirle igual: le llegará cuando abra ChamuFlac.' : 'no está conectado ahora.'))}`);
      } else {
        setStatus(w, 'rejected');
        sysLine(w, `<b>${esc(peer.nick)}</b> no respondió.`, 'err');
      }
      sendTo(w.via, peer.cid, 'cancel', { id: w.id });
    }, REQUEST_TIMEOUT);
  }

  function onRequest(r) {
    if (!r.id || !r.from || typeof r.nick !== 'string') return;
    if (handled.has(r.id) || dmWindows().some((x) => x.id === r.id)) return;
    // Si ya le habíamos pedido nosotros, aceptamos (ambos querían hablar)
    const mine = findByPeer(r.from);
    if (mine && mine.status === 'pending') {
      pendingRequests.set(r.id, r);
      closeWindow(mine, true);
      return accept(r.id);
    }
    if (mine) {
      if (!ctx.autoAccept?.(r)) return; // ya hay conversación abierta
      closeWindow(mine, true); // el otro la rehízo (p. ej. reabrió la app): se reemplaza
    }
    pendingRequests.set(r.id, r);
    if (ctx.autoAccept?.(r)) return accept(r.id, { background: true });
    ctx.beep?.();
    const box = document.getElementById('dm-requests');
    if (!box) return;
    box.insertAdjacentHTML('beforeend', `<div class="dm-req" data-req="${esc(r.id)}">
      ${avatar(r.nick)}<div class="dm-req-text"><b>${esc(r.nick)}${r.reg ? verified : ''}</b><small>quiere hablar contigo en privado</small></div>
      <button class="btn small" data-req-no>Rechazar</button><button class="btn small primary" data-req-ok>Aceptar</button></div>`);
    setTimeout(() => dismissRequest(r.id), REQUEST_TIMEOUT);
    ctx.updateTitle?.();
  }
  function dismissRequest(id) {
    pendingRequests.delete(id);
    document.querySelector(`.dm-req[data-req="${CSS.escape(id)}"]`)?.remove();
  }
  document.addEventListener('click', (e) => {
    const retry = e.target.closest('[data-dm-retry]');
    if (retry) {
      const w = state.windows.get(retry.dataset.dmRetry);
      if (!w) return;
      const person = w.via === 'user' ? { ...w.peer } : ctx.findPerson?.(w.peer.nick);
      if (!person) return toast(`${w.peer.nick}: ${t('no está conectado ahora mismo.')}`);
      closeWindow(w, true);
      requestPrivate(person);
      return;
    }
    const card = e.target.closest('.dm-req');
    if (!card) return;
    if (e.target.closest('[data-req-ok]')) accept(card.dataset.req);
    if (e.target.closest('[data-req-no]')) reject(card.dataset.req);
  });
  async function accept(id, { background = false } = {}) {
    const r = pendingRequests.get(id);
    dismissRequest(id);
    if (!r) return;
    handled.add(id);
    const old = state.windows.get('dm:' + r.from);
    if (old) closeWindow(old, true);
    const w = makeWindow({ cid: r.from, nick: r.nick, reg: !!r.reg, via: r.via || defaultVia }, r.id, 'callee');
    if (r.dev) w.peerDev = r.dev;
    setStatus(w, 'connecting');
    if (!background || !state.active || state.active === w.key) ctx.activate(w.key);
    else ctx.onBackgroundOpen?.(w);
    if (w.via !== 'user') sysLine(w, 'Estableciendo conexión directa…');
    await joinSignaling(w);
    sendTo(w.via, r.from, 'resp', { id: r.id, ok: true, ...me(w.via) });
  }
  function reject(id) {
    const r = pendingRequests.get(id);
    dismissRequest(id);
    if (r) sendTo(r.via || defaultVia, r.from, 'resp', { id, ok: false, ...me(r.via || defaultVia) });
  }
  /** Acepta una solicitud recibida por otra vía (p. ej. al tocar un aviso push). */
  function acceptExternal(r, opts) {
    if (!r?.id || !r.from || handled.has(r.id) || dmWindows().some((x) => x.id === r.id)) return false;
    pendingRequests.set(r.id, { ...r, via: r.via || defaultVia, nick: String(r.nick || r.from) });
    accept(r.id, opts);
    return true;
  }
  async function onResponse(r) {
    const w = dmWindows().find((x) => x.id === r.id);
    if (!w || w.status !== 'pending') return;
    clearTimeout(w.timer);
    if (r.dev) w.peerDev = r.dev; // la conversación sigue con el dispositivo que respondió primero
    if (!r.ok) { setStatus(w, 'rejected'); return sysLine(w, `<b>${esc(w.peer.nick)}</b> rechazó la conversación privada.`, 'err'); }
    setStatus(w, 'connecting');
    if (w.via !== 'user') sysLine(w, `<b>${esc(w.peer.nick)}</b> aceptó. Estableciendo conexión directa…`);
    await joinSignaling(w);
  }

  /* ---------------- Ventana ---------------- */
  function makeWindow(peer, id, role) {
    const w = {
      key: 'dm:' + peer.cid, kind: 'dm', name: peer.nick, peer, id, role, status: 'new',
      via: peer.via || defaultVia, self: selfId(peer.via || defaultVia),
      lines: [], unread: 0, mention: false, last: null,
      rt: null, pc: null, dc: null, polite: role === 'callee', makingOffer: false, ignoreOffer: false,
      sendQueue: Promise.resolve(), incoming: new Map(), call: null,
      msgs: new Map(), unreadMids: [], lastBubble: null,
    };
    const prev = carry.get(w.key);
    if (prev) { carry.delete(w.key); w.lines = prev.lines; w.msgs = prev.msgs; }
    state.windows.set(w.key, w);
    ctx.renderChanList();
    return w;
  }
  function setStatus(w, status) {
    w.status = status;
    if (state.active === w.key) { renderHeader(w); syncComposer(w); }
    ctx.renderChanList();
  }
  function statusText(w) {
    return {
      pending: w.via === 'user' ? 'Conectando…' : 'Esperando respuesta…', connecting: 'Conectando…',
      offline: canMail(w) ? 'sin conexión · tus mensajes le llegarán al conectarse' : 'sin conexión', open: w.relay ? 'en línea · vía servidor (sin cifrado de extremo a extremo)' : 'en línea · cifrado de extremo a extremo',
      away: 'reconectando…', closed: 'Conversación cerrada', rejected: 'No disponible',
    }[w.status] || '';
  }
  function renderHeader(w) {
    document.getElementById('win-name').innerHTML = `${avatar(w.peer.nick)}<span class="dm-title-nick" style="${nickStyle(w.peer.nick)}">${esc(w.peer.nick)}</span>${w.peer.reg ? verified : ''}`;
    document.getElementById('topic').innerHTML = `<span class="dm-status ${w.status} ${w.relay ? 'relay' : ''}">${w.status === 'open' ? icon(w.relay ? 'unlock' : 'lock') : ''}${esc(statusText(w))}</span>`;
    const open = w.status === 'open' && !w.relay; // las llamadas necesitan conexión directa
    document.getElementById('call-audio').disabled = !open || !!w.call;
    document.getElementById('call-video').disabled = !open || !!w.call;
  }
  function syncComposer(w) {
    const open = w.status === 'open';
    const writable = open || canMail(w);
    const input = document.getElementById('input');
    input.disabled = !writable;
    input.placeholder = open ? `Mensaje privado para ${w.peer.nick}` : writable ? t('Mensaje para {nick} (le llegará al conectarse)', { nick: w.peer.nick }) : statusText(w);
    document.getElementById('attach-btn').disabled = !open;
    document.getElementById('mic-btn').disabled = !open;
    document.getElementById('emoji-btn').disabled = !writable;
  }
  /** Llamado por la app al mostrar esta ventana. */
  function onActivate(w) {
    renderHeader(w);
    syncComposer(w);
    markRead(w);
    // Amigo sin conexión en curso: al abrir la conversación se intenta conectar de nuevo
    if (w.via === 'user' && isIdle(w) && ctx.autoReconnect) setTimeout(() => { if (state.active === w.key && isIdle(w)) requestPrivate({ ...w.peer }); }, 0);
  }
  function sysLine(w, html, kind = 'info') { ctx.sys(w.key, html, kind); }

  /* ---------------- Señalización y conexión WebRTC ---------------- */
  async function joinSignaling(w) {
    await ctx.ensureIce?.();
    const rt = supabase.channel('dm:' + w.id, { config: { broadcast: { self: false }, presence: { key: w.self } } });
    w.rt = rt;
    rt.on('broadcast', { event: 'sig' }, ({ payload: p }) => {
      if (!p || p.from !== w.peer.cid) return;
      if (p.to && p.to !== DEV) return lostToOtherDevice(w); // respondió antes otro dispositivo de esta cuenta
      if (!fromPeerDevice(w, p)) return;
      handleSignal(w, p);
    })
      .on('broadcast', { event: 'relay' }, ({ payload: m }) => {
        if (!m || m.from !== w.peer.cid || !fromPeerDevice(w, m) || (m.to && m.to !== DEV)) return;
        if (m.t === 'relay-on') return enableRelay(w, false);
        if (!w.relay) enableRelay(w, false);
        if (m.t === 'chunk' && typeof m.d === 'string') return onChunk(w, b64dec(m.d));
        onData(w, m);
      })
      .on('presence', { event: 'leave' }, ({ key }) => {
        if (key !== w.peer.cid || w.status !== 'open') return;
        setTimeout(() => { if (!rt.presenceState()[w.peer.cid]) peerAway(w); }, 1500); // ignora reconexiones instantáneas
      })
      .on('presence', { event: 'join' }, ({ key }) => { if (key === w.peer.cid && w.status === 'away') peerBack(w); });
    await new Promise((resolve) => rt.subscribe(async (s) => {
      if (s === 'SUBSCRIBED') { await rt.track({ nick: state.nick }); resolve(); }
      if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') resolve();
    }));
    createPeer(w);
    // Si en 15 s no hay conexión directa, se pasa al plan B (a través del servidor)
    w.connectTimer = setTimeout(() => { if (w.status === 'connecting') enableRelay(w, true); }, 15000);
  }
  /** ¿Viene del dispositivo con el que hablamos? (si la otra cuenta está abierta en varios sitios) */
  function fromPeerDevice(w, p) {
    if (!p.dev) return true; // versiones antiguas
    if (!w.peerDev) w.peerDev = p.dev;
    return p.dev === w.peerDev;
  }
  /** Esta cuenta también está en otro dispositivo, que respondió antes: este se retira. */
  function lostToOtherDevice(w) {
    if (w.status === 'closed' || w.role !== 'callee' || w.everDirect) return;
    const wasActive = state.active === w.key;
    closeWindow(w, true);
    carry.delete(w.key);
    if (wasActive) ctx.activate('status');
    toast(`${w.peer.nick}: ${t('la conversación sigue en otro dispositivo.')}`);
  }
  const route = (w) => ({ from: w.self, dev: DEV, ...(w.peerDev ? { to: w.peerDev } : {}) });
  const signal = (w, data) => {
    (w.dbg ||= []).push('tx:' + (data.description?.type || 'ice'));
    return w.rt?.send({ type: 'broadcast', event: 'sig', payload: { ...route(w), ...data } }).then((r) => { if (r !== 'ok') w.dbg.push('tx-fail:' + r); });
  };

  function createPeer(w) {
    const pc = new RTCPeerConnection({ iceServers: iceServers() });
    w.pc = pc;
    pc.onicecandidate = ({ candidate }) => candidate && signal(w, { candidate });
    pc.onnegotiationneeded = async () => {
      try {
        w.makingOffer = true;
        await pc.setLocalDescription();
        signal(w, { description: pc.localDescription });
      } catch (e) { console.warn(e); } finally { w.makingOffer = false; }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' && w.pc === pc && w.status !== 'closed') { enableRelay(w, true); scheduleReconnect(w, 5000); }
    };
    pc.ontrack = ({ track, transceiver }) => {
      if (track.kind === 'audio') w.audioTx ||= transceiver; else w.videoTx ||= transceiver;
      onRemoteTrack(w, track);
    };
    w.remote = new MediaStream();
    // Audio y vídeo se negocian una sola vez al abrir el privado: las llamadas solo
    // conectan o desconectan las pistas (replaceTrack), sin renegociar ni choques.
    if (w.role === 'caller') {
      w.audioTx = pc.addTransceiver('audio', { direction: 'sendrecv' });
      w.videoTx = pc.addTransceiver('video', { direction: 'sendrecv' });
    }
    if (w.role === 'caller') setupDataChannel(w, pc.createDataChannel('chat', { ordered: true }));
    else pc.ondatachannel = (e) => setupDataChannel(w, e.channel);
  }
  async function handleSignal(w, { description, candidate }) {
    (w.dbg ||= []).push('rx:' + (description?.type || 'ice') + (w.pc ? '' : '(sin-pc)'));
    const pc = w.pc;
    if (!pc) return;
    try {
      if (description && description.type === 'offer' && w.role === 'callee' && pc.remoteDescription) {
        restartPeer(w); // el otro rehízo la conexión: se crea una nueva también aquí
        return handleSignal(w, { description });
      }
      if (description) {
        const collision = description.type === 'offer' && (w.makingOffer || pc.signalingState !== 'stable');
        w.ignoreOffer = !w.polite && collision;
        if (w.ignoreOffer) return;
        await pc.setRemoteDescription(description);
        for (const c of (w.pendingIce || []).splice(0)) pc.addIceCandidate(c).catch(() => {});
        if (description.type === 'offer') {
          for (const t of pc.getTransceivers()) {
            if (t.direction === 'recvonly') t.direction = 'sendrecv';
            const kind = t.receiver.track.kind;
            if (kind === 'audio') w.audioTx ||= t; else if (kind === 'video') w.videoTx ||= t;
          }
          await pc.setLocalDescription();
          signal(w, { description: pc.localDescription });
        }
      } else if (candidate) {
        // La señalización puede llegar desordenada: si aún no hay descripción remota,
        // se guarda el candidato y se aplica después.
        if (!pc.remoteDescription) { (w.pendingIce ||= []).push(candidate); return; }
        try { await pc.addIceCandidate(candidate); } catch (e) { if (!w.ignoreOffer) console.warn(e); }
      }
    } catch (e) { console.warn('señalización', e); }
  }

  /* ---------------- Canal de datos ---------------- */
  function setupDataChannel(w, dc) {
    w.dc = dc;
    dc.binaryType = 'arraybuffer';
    dc.bufferedAmountLowThreshold = 1 << 20;
    dc.onopen = () => {
      clearTimeout(w.connectTimer);
      clearTimeout(w.retryTimer);
      const restored = w.relay || w.everDirect;
      w.relay = false;
      w.everDirect = true;
      w.retries = 0;
      setStatus(w, 'open');
      if (restored) sysLine(w, `${icon('lock')} ` + esc(t('Conexión directa restablecida: vuelve el cifrado de extremo a extremo.')), 'join');
      else sysLine(w, `Conexión directa con <b>${esc(w.peer.nick)}</b>. Los mensajes, archivos y llamadas van cifrados de extremo a extremo y no se guardan en ningún sitio.`, 'join');
      if (w.autoCall !== undefined) { const v = w.autoCall; delete w.autoCall; setTimeout(() => startCall(w, v), 300); }
    };
    dc.onclose = () => {
      if (w.dc !== dc || w.status === 'closed' || w.status === 'rejected') return; // conexión antigua o ya cerrada
      if (w.status === 'open' && !w.relay) {
        // La conexión directa se cayó: se sigue por el servidor y se intenta recuperar
        if (w.call) { sysLine(w, esc(t('La llamada se cortó.')), 'err'); endCall(w); }
        enableRelay(w, true);
        scheduleReconnect(w);
      }
    };
    dc.onmessage = (e) => {
      if (typeof e.data === 'string') {
        let m; try { m = JSON.parse(e.data); } catch { return; }
        onData(w, m);
      } else onChunk(w, e.data);
    };
  }
  const sendJSON = (w, obj) => {
    if (w.dc?.readyState === 'open') return w.dc.send(JSON.stringify(obj));
    if (w.relay) return w.rt?.send({ type: 'broadcast', event: 'relay', payload: { ...obj, ...route(w) } });
  };
  /**
   * Plan B: si no hay conexión directa (redes que la bloquean y sin TURN disponible), el
   * privado sigue funcionando a través del servidor de tiempo real. Sin cifrado de extremo a
   * extremo (sí cifrado en tránsito), sin guardar nada y sin llamadas.
   */
  function enableRelay(w, announce) {
    if (w.relay || w.status === 'closed' || w.status === 'rejected' || !w.rt) return;
    w.relay = true;
    clearTimeout(w.connectTimer);
    if (announce) w.rt.send({ type: 'broadcast', event: 'relay', payload: { t: 'relay-on', ...route(w) } });
    if (w.status !== 'away') setStatus(w, 'open');
    sysLine(w, `${icon('unlock')} ` + esc(t(w.everDirect
      ? 'Se perdió la conexión directa. Mientras se intenta recuperar, la conversación sigue a través del servidor (sin cifrado de extremo a extremo; nada se guarda). Las llamadas no están disponibles en este modo.'
      : 'No fue posible la conexión directa entre vuestras redes. La conversación continúa a través del servidor: los mensajes no se guardan, pero no van cifrados de extremo a extremo. Las llamadas no están disponibles en este modo.')), 'err');
  }

  /* ---------------- Reconexión ---------------- */
  /** Rehace la conexión directa desde cero (nuevo RTCPeerConnection y canal de datos). */
  function restartPeer(w) {
    const old = w.pc;
    if (old) { old.onconnectionstatechange = null; old.onicecandidate = null; try { old.close(); } catch { /* nada */ } }
    w.pc = null; w.audioTx = w.videoTx = null; w.pendingIce = []; w.makingOffer = false; w.ignoreOffer = false;
    createPeer(w);
  }
  /** Quien inició el privado intenta recuperar la conexión directa (con reintentos espaciados). */
  function scheduleReconnect(w, delay = 3000) {
    if (w.role !== 'caller') return;
    clearTimeout(w.retryTimer);
    w.retryTimer = setTimeout(() => {
      if (w.status !== 'open' || !w.relay || !w.rt) return;
      if ((w.retries = (w.retries || 0) + 1) > 5) return; // tras 5 intentos se queda en el plan B
      restartPeer(w);
      scheduleReconnect(w, 12000);
    }, delay);
  }
  function peerAway(w) {
    if (w.status !== 'open') return;
    if (w.call) { sysLine(w, esc(t('La llamada se cortó.')), 'err'); endCall(w); }
    setStatus(w, 'away');
    sysLine(w, `<b>${esc(w.peer.nick)}</b> ${esc(t('perdió la conexión. Esperando a que vuelva…'))}`, 'part');
    w.goneTimer = setTimeout(() => peerGone(w, `<b>${esc(w.peer.nick)}</b> ${esc(t('no volvió.'))}`), 45000);
  }
  function peerBack(w) {
    clearTimeout(w.goneTimer);
    setStatus(w, 'open');
    sysLine(w, `<b>${esc(w.peer.nick)}</b> ${esc(t('volvió.'))}`, 'join');
    if (w.dc?.readyState === 'open') return;
    if (!w.relay) enableRelay(w, false);
    w.retries = 0;
    scheduleReconnect(w, 800);
  }

  function onData(w, m) {
    switch (m.t) {
      case 'text': {
        const msg = { mid: safeId(m.mid), mine: false, kind: m.kind === 'action' ? 'action' : 'text', text: String(m.text || '').slice(0, 4000), ts: Date.now(), lang: LANGS[m.lang] ? m.lang : null };
        if (msg.lang && msg.lang !== getLang() && msg.text.trim()) msg.tr = 'pending';
        addMessage(w, msg); receipt(w, msg.mid);
        if (msg.tr) translate(msg.text, msg.lang, getLang()).then((r) => {
          msg.tr = r ? 'done' : 'fail'; msg.trText = r?.text;
          rerender(w, msg.mid);
        });
        return;
      }
      case 'sticker': {
        if (!STICKERS.includes(m.id)) return;
        const msg = { mid: safeId(m.mid), mine: false, kind: 'sticker', sticker: m.id, ts: Date.now() };
        addMessage(w, msg); receipt(w, msg.mid);
        return;
      }
      case 'file-start': {
        if (!(m.size > 0 && m.size <= (w.relay ? MAX_FILE_RELAY : MAX_FILE))) return;
        const f = { fid: safeId(m.fid), name: String(m.name || 'archivo').slice(0, 200), mime: String(m.mime || ''), size: m.size, kind: ['image', 'video', 'audio', 'file'].includes(m.kind) ? m.kind : 'file',
          voice: !!m.voice, duration: Number(m.duration) || 0, wave: Array.isArray(m.wave) ? m.wave.slice(0, 48).map((v) => Math.max(0.05, Math.min(1, Number(v) || 0))) : null, chunks: [], received: 0 };
        w.incoming.set('current', f);
        const msg = { mid: f.fid, mine: false, kind: 'file', file: f, ts: Date.now() };
        addMessage(w, msg); receipt(w, msg.mid);
        return;
      }
      case 'file-end': {
        const f = w.incoming.get('current');
        if (!f || f.fid !== m.fid) return;
        w.incoming.delete('current');
        f.blob = new Blob(f.chunks, { type: f.mime || 'application/octet-stream' });
        f.chunks = null;
        f.url = URL.createObjectURL(f.blob);
        rerender(w, f.fid);
        return;
      }
      case 'ack': return setTick(w, m.mid, 'delivered');
      case 'read': (m.mids || []).forEach((id) => setTick(w, id, 'read')); return;
      case 'nick': {
        const old = w.peer.nick;
        w.peer.nick = w.name = String(m.nick || old).slice(0, 20);
        sysLine(w, `<b>${esc(old)}</b> ahora se llama <b>${esc(w.peer.nick)}</b>`);
        if (state.active === w.key) renderHeader(w);
        ctx.renderChanList();
        return;
      }
      case 'cam': w.peerCam = !!m.on; return renderCallUI(w);
      case 'call': return onCallOffer(w, !!m.video);
      case 'call-accept': return onCallAccepted(w);
      case 'call-reject': if (w.call) { sysLine(w, `📞 <b>${esc(w.peer.nick)}</b> rechazó la llamada.`, 'err'); endCall(w, false); } return;
      case 'hangup': if (w.call) { sysLine(w, w.call.startedAt ? `📞 Llamada finalizada (${fmtDur((Date.now() - w.call.startedAt) / 1000)}).` : '📞 Llamada cancelada.'); endCall(w, false); } return;
      case 'bye': return peerGone(w, `<b>${esc(w.peer.nick)}</b> cerró la conversación.`);
      default:
    }
  }
  const safeId = (v) => String(v || crypto.randomUUID()).replace(/[^\w-]/g, '').slice(0, 40);
  function onChunk(w, buf) {
    const f = w.incoming.get('current');
    if (!f) return;
    f.chunks.push(buf);
    f.received += buf.byteLength;
    if (f.received > f.size) { w.incoming.delete('current'); return; }
    progress(f.fid, f.received / f.size);
  }

  /* ---------------- Confirmaciones de entrega y lectura (✓ ✓✓) ---------------- */
  function receipt(w, mid) {
    sendJSON(w, { t: 'ack', mid });
    w.unreadMids.push(mid);
    markRead(w);
  }
  const isLinked = (w) => w.dc?.readyState === 'open' || (w.relay && w.rt);
  /** Si el privado está a la vista, avisa al otro de que se han leído sus mensajes. */
  function markRead(w) {
    if (!w.unreadMids.length || state.active !== w.key || document.hidden) return;
    const mids = w.unreadMids.splice(0);
    if (isLinked(w)) sendJSON(w, { t: 'read', mids });
    else if (w.via === 'user') sendTo('user', w.peer.cid, 'receipt', { from: w.self, t: 'read', mids });
  }
  /** Acuse que llega por la bandeja (mensajes del buzón): ✓✓ entregado / leído. */
  function onReceipt(p) {
    const w = state.windows.get('dm:' + p.from);
    if (!w || !Array.isArray(p.mids)) return;
    for (const mid of p.mids.slice(0, 200)) setTick(w, String(mid), p.t === 'read' ? 'read' : 'delivered');
  }
  document.addEventListener('visibilitychange', () => { const w = state.windows.get(state.active); if (w?.kind === 'dm') markRead(w); });
  function setTick(w, mid, st) {
    const m = w.msgs.get(mid);
    if (!m || !m.mine) return;
    const order = { failed: -2, queued: -1, sent: 0, delivered: 1, read: 2 };
    if (order[st] <= order[m.tick || 'sent']) return;
    m.tick = st;
    rerender(w, mid);
  }
  const tickHtml = (m) => `<span class="tick ${m.tick || 'sent'}" title="${{ queued: 'Enviando…', failed: 'No enviado', sent: 'Enviado', delivered: 'Entregado', read: 'Leído' }[m.tick || 'sent']}">${icon({ queued: 'clock', failed: 'x', delivered: 'check2', read: 'check2' }[m.tick] || 'check')}</span>`;

  /* ---------------- Burbujas ---------------- */
  function addMessage(w, m) {
    m.mid ||= crypto.randomUUID();
    if (m.mine) m.tick = 'sent';
    m.first = !w.lastBubble || w.lastBubble.mine !== m.mine || m.ts - w.lastBubble.ts > 5 * 60 * 1000;
    w.lastBubble = { mine: m.mine, ts: m.ts };
    w.msgs.set(m.mid, m);
    w.last = null;
    ctx.addHtml(w.key, bubbleHtml(w, m), { count: !m.mine });
    if (!m.mine) ctx.onIncoming?.(w, m);
  }
  function bubbleHtml(w, m) {
    const meta = `<span class="bmeta">${time(m.ts)}${m.mine ? tickHtml(m) : ''}</span>`;
    let cls = '', body;
    if (m.kind === 'text') {
      const onlyEmoji = /^(\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️|\s){1,12}$/u.test(m.text) && !/^[\d#*\s]+$/.test(m.text) && [...new Intl.Segmenter().segment(m.text.trim())].length <= 3;
      if (onlyEmoji) { cls = 'emoji-only'; body = `<div class="big-emoji">${esc(m.text)}</div>`; }
      else body = `<div class="btext">${trBody(m)}<span class="meta-spacer"></span></div>`;
    } else if (m.kind === 'action') {
      body = `<div class="btext"><i>* <span class="ugc">${esc(m.mine ? state.nick : w.peer.nick)}</span> ${trBody(m)}</i><span class="meta-spacer"></span></div>`;
    } else if (m.kind === 'sticker') {
      cls = 'sticker-msg'; body = `<div class="sticker">${stickerSvg(m.sticker)}</div>`;
    } else {
      const f = m.file;
      if (f.kind === 'image' || f.kind === 'video') cls = 'media-msg';
      if (f.voice || f.kind === 'audio') cls = 'voice-msg';
      body = fileHtml(w, m, f);
    }
    return `<div class="bub-row ${m.mine ? 'out' : 'in'} ${m.first ? 'first' : ''} ${cls}" id="m-${m.mid}"><div class="bubble">${body}${meta}</div></div>`;
  }
  /** Cuerpo de texto, traducido si llegó en otro idioma (con opción de ver el original). */
  function trBody(m) {
    if (m.tr === 'pending') return `<span class="tr-wrap">${linkify(m.text)} <small class="tr-note">${esc(t('Traduciendo…'))}</small></span>`;
    if (m.tr === 'done') return `<span class="tr-wrap"><span class="tr-text">${linkify(m.trText)}</span><span class="tr-orig hidden">${linkify(m.text)}</span> <button type="button" class="tr-toggle" data-src="${esc(m.lang)}">${icon('translate')}${esc(translatedFrom(m.lang))} · ${esc(t('Ver original'))}</button></span>`;
    return linkify(m.text);
  }
  /** Vuelve a pintar un mensaje (al terminar una transferencia o cambiar la marca de lectura). */
  function rerender(w, mid) {
    const m = w.msgs.get(mid);
    if (!m) return;
    const html = bubbleHtml(w, m);
    const marker = `id="m-${mid}"`;
    const i = w.lines.findIndex((l) => l.includes(marker));
    if (i >= 0) w.lines[i] = html;
    const el = document.getElementById('m-' + mid);
    if (el) el.outerHTML = html;
  }
  function fileKind(mime) {
    if (/^image\//.test(mime)) return 'image';
    if (/^video\//.test(mime)) return 'video';
    if (/^audio\//.test(mime)) return 'audio';
    return 'file';
  }
  const ring = (fid) => `<span class="progress-ring" data-progress="${fid}" style="--p:0"><span>0%</span></span>`;
  function fileHtml(w, m, f) {
    const loading = !f.url;
    if (f.voice || f.kind === 'audio') {
      const bars = (f.wave || Array(36).fill(0.3)).map((v) => `<i style="height:${Math.max(12, Math.round(v * 100))}%"></i>`).join('');
      const nick = m.mine ? state.nick : w.peer.nick;
      return `<div class="voice" ${loading ? '' : `data-src="${f.url}"`} data-dur="${f.duration || 0}">
        <span class="voice-av">${avatar(nick)}<i class="mic-mini">${icon('mic')}</i></span>
        <button class="voice-play" aria-label="Reproducir" ${loading ? 'disabled' : ''}>${loading ? ring(f.fid) : icon('play')}</button>
        <span class="voice-track"><span class="wave">${bars}</span><small class="voice-time">${fmtDur(f.duration)}</small></span>
        <button class="voice-speed" title="Velocidad">1×</button></div>`;
    }
    if (f.kind === 'image' || f.kind === 'video') {
      const inner = loading ? `<div class="media-ph">${icon(f.kind === 'image' ? 'image' : 'video')}${ring(f.fid)}</div>`
        : f.kind === 'image' ? `<img src="${f.url}" alt="${esc(f.name)}" data-zoom>` : `<video src="${f.url}" controls playsinline preload="metadata"></video>`;
      return `<div class="bmedia">${inner}</div>`;
    }
    const ext = (f.name.split('.').pop() || '').slice(0, 4).toUpperCase();
    const tag = loading ? 'div' : 'a';
    return `<${tag} class="doc" ${loading ? '' : `href="${f.url}" download="${esc(f.name)}"`}><span class="doc-ico">${esc(ext) || icon('file')}</span>
      <span class="doc-info"><b>${esc(f.name)}</b><small>${fmtSize(f.size)}${ext ? ' · ' + esc(ext) : ''}</small></span>
      <span class="doc-dl">${loading ? ring(f.fid) : icon('download')}</span></${tag}>`;
  }
  function progress(fid, p) {
    const pct = Math.min(100, Math.round(p * 100));
    document.querySelectorAll(`[data-progress="${CSS.escape(fid)}"]`).forEach((el) => {
      el.style.setProperty('--p', pct);
      el.firstElementChild.textContent = pct + '%';
    });
  }

  /* Reproductor de notas de voz, visor de fotos */
  let playing = null;
  document.addEventListener('click', (e) => {
    if (!document.querySelector('.app.in-dm')) return;
    const img = e.target.closest('#log img[data-zoom]');
    if (img) return openLightbox(img.src);
    const v = e.target.closest('#log .voice');
    if (!v) return;
    if (e.target.closest('.voice-speed')) {
      const rates = [1, 1.5, 2];
      const r = rates[(rates.indexOf(Number(v.dataset.rate || 1)) + 1) % rates.length];
      v.dataset.rate = r; e.target.closest('.voice-speed').textContent = r + '×';
      if (playing?.el === v) playing.audio.playbackRate = r;
      return;
    }
    if (!v.dataset.src) return;
    if (e.target.closest('.wave') && playing?.el === v && playing.audio.duration) {
      const rect = v.querySelector('.wave').getBoundingClientRect();
      playing.audio.currentTime = ((e.clientX - rect.left) / rect.width) * playing.audio.duration;
      return;
    }
    if (!e.target.closest('.voice-play')) return;
    if (playing?.el === v) { playing.audio.paused ? playing.audio.play() : playing.audio.pause(); return; }
    playing?.audio.pause();
    const audio = new Audio(v.dataset.src);
    audio.playbackRate = Number(v.dataset.rate || 1);
    const btn = v.querySelector('.voice-play');
    const bars = v.querySelectorAll('.wave i');
    playing = { el: v, audio };
    audio.onplay = () => { btn.innerHTML = icon('pause'); };
    audio.onpause = () => { btn.innerHTML = icon('play'); };
    audio.ontimeupdate = () => {
      const d = isFinite(audio.duration) ? audio.duration : Number(v.dataset.dur) || 1;
      const p = audio.currentTime / d;
      bars.forEach((b, i) => b.classList.toggle('played', i / bars.length < p));
      v.querySelector('.voice-time').textContent = fmtDur(audio.currentTime);
    };
    audio.onended = () => { btn.innerHTML = icon('play'); bars.forEach((b) => b.classList.remove('played')); v.querySelector('.voice-time').textContent = fmtDur(Number(v.dataset.dur)); playing = null; };
    audio.play();
  });
  function openLightbox(src) {
    const lb = document.createElement('div');
    lb.className = 'lightbox';
    lb.innerHTML = `<img src="${src}" alt=""><div class="lb-actions"><a href="${src}" download class="icon-btn light" title="Guardar">${icon('download')}</a><button class="icon-btn light" title="Cerrar">${icon('x')}</button></div>`;
    lb.onclick = (e) => { if (!e.target.closest('a')) lb.remove(); };
    document.body.appendChild(lb);
  }

  /* ---------------- Enviar ---------------- */
  function sendText(w, text, kind = 'msg') {
    const mid = crypto.randomUUID();
    const data = { t: 'text', mid, text, kind: kind === 'action' ? 'action' : 'text', lang: getLang() };
    const local = { mid, mine: true, kind: data.kind, text, ts: Date.now() };
    if (w.status !== 'open') return canMail(w) && sendViaMail(w, data, local);
    sendJSON(w, data);
    addMessage(w, local);
  }
  function sendSticker(w, id) {
    if (!STICKERS.includes(id)) return;
    const mid = crypto.randomUUID();
    const local = { mid, mine: true, kind: 'sticker', sticker: id, ts: Date.now() };
    if (w.status !== 'open') return canMail(w) && sendViaMail(w, { t: 'sticker', mid, id }, local);
    sendJSON(w, { t: 'sticker', mid, id });
    addMessage(w, local);
  }
  /** Amigo sin conexión directa: el mensaje se cifra para sus dispositivos y espera en el buzón. */
  async function sendViaMail(w, data, local) {
    addMessage(w, local);
    setTickRaw(w, local.mid, 'queued');
    const r = await ctx.mailbox.send(w.peer.cid, { ...data, ts: local.ts, nick: state.nick });
    if (!r.ok) {
      setTickRaw(w, local.mid, 'failed');
      return sysLine(w, esc(t(r.reason === 'nodevices'
        ? '{nick} todavía no puede recibir mensajes sin conexión: tiene que actualizar la app o entrar una vez en la web.'
        : 'No se pudo enviar el mensaje. Inténtalo de nuevo.', { nick: w.peer.nick })), 'err');
    }
    setTickRaw(w, local.mid, 'sent');
    sendTo('user', w.peer.cid, 'mail', { from: w.self }); // si está conectado, lo recoge al momento
    ctx.onMailSent?.(w);
  }
  function setTickRaw(w, mid, st) { const m = w.msgs.get(mid); if (m && (!m.tick || ['queued', 'sent', 'failed'].includes(m.tick))) { m.tick = st; rerender(w, mid); } }

  /** Mensajes recogidos del buzón: [{ from, at, msg }] (ya descifrados). */
  function receiveMail(items) {
    const byPeer = new Map();
    for (const it of items) {
      const from = String(it.from);
      let w = state.windows.get('dm:' + from);
      if (!w) {
        w = makeWindow({ cid: from, nick: String(it.msg?.nick || ctx.nickOf?.(from) || from).slice(0, 20), reg: true, via: 'user' }, crypto.randomUUID(), 'caller');
        setStatus(w, 'offline');
      }
      const m = it.msg || {};
      if (m.t === 'undecryptable') { sysLine(w, esc(t('No se pudo descifrar un mensaje guardado (quizá se borraron los datos de la app).')), 'err'); continue; }
      const mid = safeId(m.mid);
      if (w.msgs.has(mid)) continue;
      const ts = Math.min(Number(m.ts) || Date.parse(it.at) || Date.now(), Date.now());
      if (m.t === 'text') {
        const msg = { mid, mine: false, kind: m.kind === 'action' ? 'action' : 'text', text: String(m.text || '').slice(0, 4000), ts, lang: LANGS[m.lang] ? m.lang : null };
        if (msg.lang && msg.lang !== getLang() && msg.text.trim()) msg.tr = 'pending';
        addMessage(w, msg);
        if (msg.tr) translate(msg.text, msg.lang, getLang()).then((r) => { msg.tr = r ? 'done' : 'fail'; msg.trText = r?.text; rerender(w, mid); });
      } else if (m.t === 'sticker' && STICKERS.includes(m.id)) {
        addMessage(w, { mid, mine: false, kind: 'sticker', sticker: m.id, ts });
      } else continue;
      w.unreadMids.push(mid);
      (byPeer.get(from) || byPeer.set(from, []).get(from)).push(mid);
    }
    for (const [from, mids] of byPeer) {
      sendTo('user', from, 'receipt', { from: selfId('user'), t: 'ack', mids });
      const w = state.windows.get('dm:' + from);
      if (w) markRead(w);
    }
  }
  function sendFile(w, file, extra = {}) {
    if (w.status !== 'open') return;
    if (file.size > MAX_FILE) return toast(`"${file.name}" supera el límite de 100 MB.`);
    if (w.relay && file.size > MAX_FILE_RELAY) return toast(t('Sin conexión directa, el límite por archivo es de 5 MB.'));
    if (!file.size) return;
    const f = { fid: crypto.randomUUID(), name: file.name || 'archivo', mime: file.type || 'application/octet-stream', size: file.size, kind: extra.voice ? 'audio' : fileKind(file.type), ...extra };
    const local = { ...f };
    addMessage(w, { mid: f.fid, mine: true, kind: 'file', file: local, ts: Date.now() });
    // Los envíos van en fila: un archivo después de otro
    w.sendQueue = w.sendQueue.then(async () => {
      if (w.relay) {
        sendJSON(w, { t: 'file-start', ...f });
        for (let off = 0; off < file.size; off += RELAY_CHUNK) {
          if (!w.relay || !w.rt) return;
          const buf = await file.slice(off, off + RELAY_CHUNK).arrayBuffer();
          await w.rt.send({ type: 'broadcast', event: 'relay', payload: { t: 'chunk', d: b64enc(buf), ...route(w) } });
          progress(f.fid, Math.min(1, (off + buf.byteLength) / file.size));
          await new Promise((r) => setTimeout(r, 70)); // respeta el límite de mensajes por segundo
        }
        sendJSON(w, { t: 'file-end', fid: f.fid });
        local.url = URL.createObjectURL(file);
        return rerender(w, f.fid);
      }
      const dc = w.dc;
      if (!dc || dc.readyState !== 'open') return;
      dc.send(JSON.stringify({ t: 'file-start', ...f }));
      let off = 0;
      while (off < file.size) {
        if (dc.readyState !== 'open') return;
        if (dc.bufferedAmount > 8 * CHUNK * 32) await new Promise((r) => { dc.onbufferedamountlow = () => { dc.onbufferedamountlow = null; r(); }; });
        const buf = await file.slice(off, off + CHUNK).arrayBuffer();
        dc.send(buf);
        off += buf.byteLength;
        progress(f.fid, off / file.size);
      }
      dc.send(JSON.stringify({ t: 'file-end', fid: f.fid }));
      local.url = URL.createObjectURL(file);
      rerender(w, f.fid);
    }).catch((e) => sysLine(w, 'Error al enviar el archivo: ' + esc(e.message), 'err'));
  }

  /* ---------------- Notas de voz (con forma de onda) ---------------- */
  let rec = null;
  async function startVoice(w) {
    if (rec || w.status !== 'open') return;
    if (!window.MediaRecorder) return toast('Tu navegador no permite grabar audio.');
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); } catch { return toast('Permite el acceso al micrófono para grabar notas de voz.'); }
    const mime = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
    const mr = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined);
    const actx = new (window.AudioContext || window.webkitAudioContext)();
    const an = actx.createAnalyser(); an.fftSize = 512;
    actx.createMediaStreamSource(stream).connect(an);
    const r = { mr, stream, actx, an, chunks: [], levels: [], start: Date.now(), w };
    rec = r;
    mr.ondataavailable = (e) => e.data.size && r.chunks.push(e.data);
    mr.start(250);
    document.getElementById('input-form').classList.add('recording');
    const canvas = document.getElementById('rec-wave');
    const data = new Uint8Array(an.fftSize);
    const draw = () => {
      if (rec !== r) return;
      an.getByteTimeDomainData(data);
      let peak = 0; for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128);
      r.levels.push(Math.min(1, peak * 2.2));
      if (canvas) {
        canvas.width = canvas.clientWidth * devicePixelRatio; canvas.height = 28 * devicePixelRatio;
        const c2 = canvas.getContext('2d'); const W = canvas.width, H = canvas.height;
        c2.fillStyle = getComputedStyle(document.body).getPropertyValue('--accent');
        const bw = 3 * devicePixelRatio, gap = 2 * devicePixelRatio, n = Math.floor(W / (bw + gap));
        r.levels.slice(-n).forEach((l, i) => { const h = Math.max(2, l * H); c2.fillRect(i * (bw + gap), (H - h) / 2, bw, h); });
      }
      document.getElementById('rec-time').textContent = fmtDur((Date.now() - r.start) / 1000);
      if (Date.now() - r.start > 10 * 60 * 1000) return stopVoice(true);
      r.raf = requestAnimationFrame(draw);
    };
    draw();
  }
  function stopVoice(send) {
    const r = rec;
    if (!r) return;
    rec = null;
    cancelAnimationFrame(r.raf);
    document.getElementById('input-form').classList.remove('recording');
    r.mr.onstop = () => {
      r.stream.getTracks().forEach((t) => t.stop());
      r.actx.close();
      const duration = (Date.now() - r.start) / 1000;
      if (!send) return;
      if (duration < 0.8) return toast('La nota de voz es demasiado corta.');
      const type = (r.mr.mimeType || 'audio/webm').split(';')[0];
      const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
      const n = 36, step = r.levels.length / n;
      const wave = Array.from({ length: n }, (_, i) => {
        const seg = r.levels.slice(Math.floor(i * step), Math.floor((i + 1) * step) || Math.floor(i * step) + 1);
        return Math.round(Math.max(0.08, ...seg) * 100) / 100;
      });
      sendFile(r.w, new File(r.chunks, `nota-de-voz.${ext}`, { type }), { voice: true, duration, wave });
    };
    r.mr.stop();
  }

  /* ---------------- Emojis y stickers ---------------- */
  let pickerTab = 'emoji';
  const recentEmoji = () => { try { return JSON.parse(localStorage.getItem('recentEmoji')) || []; } catch { return []; } };
  function togglePicker() {
    const p = document.getElementById('picker');
    if (!p) return;
    p.classList.toggle('hidden');
    if (!p.classList.contains('hidden')) renderPicker();
  }
  function renderPicker() {
    const p = document.getElementById('picker');
    const tabs = `<div class="picker-tabs"><button type="button" data-ptab="emoji" class="${pickerTab === 'emoji' ? 'active' : ''}">😀 Emojis</button><button type="button" data-ptab="sticker" class="${pickerTab === 'sticker' ? 'active' : ''}">Stickers</button></div>`;
    let body;
    if (pickerTab === 'emoji') {
      const rec2 = recentEmoji();
      const cats = rec2.length ? [['🕘', 'Recientes', rec2], ...EMOJI] : EMOJI;
      body = `<div class="emoji-cats">${cats.map(([ic, name], i) => `<button type="button" data-cat="${i}" title="${name}">${ic}</button>`).join('')}</div>
        <div class="emoji-scroll">${cats.map(([, name, list], i) => `<div class="emoji-group" id="ecat-${i}"><small>${name}</small><div class="emoji-grid">${list.map((em) => `<button type="button" data-emoji="${em}">${em}</button>`).join('')}</div></div>`).join('')}</div>`;
    } else {
      body = `<div class="sticker-grid">${STICKERS.map((id) => `<button type="button" data-sticker="${id}">${stickerSvg(id)}</button>`).join('')}</div>`;
    }
    p.innerHTML = tabs + `<div class="picker-body">${body}</div>`;
  }
  document.addEventListener('click', (e) => {
    const p = document.getElementById('picker');
    if (!p) return;
    if (e.target.closest('#emoji-btn')) return togglePicker();
    if (!p.contains(e.target)) { p.classList.add('hidden'); return; }
    const tab = e.target.closest('[data-ptab]');
    if (tab) { pickerTab = tab.dataset.ptab; return renderPicker(); }
    const cat = e.target.closest('[data-cat]');
    if (cat) return document.getElementById('ecat-' + cat.dataset.cat)?.scrollIntoView({ block: 'start' });
    const em = e.target.closest('[data-emoji]');
    if (em) {
      const input = document.getElementById('input');
      const v = em.dataset.emoji, s0 = input.selectionStart ?? input.value.length;
      input.value = input.value.slice(0, s0) + v + input.value.slice(input.selectionEnd ?? s0);
      input.selectionStart = input.selectionEnd = s0 + v.length;
      input.dispatchEvent(new Event('input'));
      try { localStorage.setItem('recentEmoji', JSON.stringify([v, ...recentEmoji().filter((x) => x !== v)].slice(0, 24))); } catch { /* nada */ }
      return;
    }
    const st = e.target.closest('[data-sticker]');
    if (st) { const w = state.windows.get(state.active); if (w?.kind === 'dm') sendSticker(w, st.dataset.sticker); p.classList.add('hidden'); }
  });

  /* ---------------- Llamadas ---------------- */
  async function getMedia(video) {
    const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    try {
      return await navigator.mediaDevices.getUserMedia({ audio, video: video ? { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } : false });
    } catch (e) {
      if (video) { toast('No se pudo usar la cámara; la llamada será solo de voz.'); return navigator.mediaDevices.getUserMedia({ audio }); }
      throw e;
    }
  }
  async function startCall(w, video) {
    if (w.relay) return toast(t('Las llamadas necesitan conexión directa, que vuestras redes no permiten ahora mismo.'));
    if (w.status !== 'open' || w.call) return;
    if (document.querySelector('.call-overlay')) return toast('Ya estás en una llamada.');
    let stream;
    try { stream = await getMedia(video); } catch { return toast('Permite el acceso al micrófono' + (video ? ' y a la cámara' : '') + ' para llamar.'); }
    w.call = { video, stream, state: 'calling', micOn: true, camOn: !!stream.getVideoTracks()[0] };
    showCallUI(w, 'Llamando…');
    sendJSON(w, { t: 'call', video });
    w.call.stopTone = ctx.loopTone?.('back');
    sysLine(w, video ? 'Videollamada saliente…' : 'Llamada saliente…');
  }
  function onCallOffer(w, video) {
    if (w.call || document.querySelector('.call-overlay')) { sendJSON(w, { t: 'call-reject' }); return; }
    w.call = { video, state: 'ringing', micOn: true, camOn: false, stopTone: ctx.loopTone?.('ring') };
    if (state.active !== w.key) ctx.activate(w.key);
    showCallUI(w, video ? 'Videollamada entrante' : 'Llamada entrante', true);
    ctx.onCallRing?.(w, video);
  }
  async function acceptCall(w) {
    if (!w.call) return;
    w.call.stopTone?.();
    try { w.call.stream = await getMedia(w.call.video); } catch { toast('Permite el acceso al micrófono para contestar.'); sendJSON(w, { t: 'call-reject' }); return endCall(w, false); }
    w.call.camOn = !!w.call.stream.getVideoTracks()[0];
    attachLocal(w);
    sendJSON(w, { t: 'call-accept' });
    connected(w);
  }
  function onCallAccepted(w) {
    if (!w.call) return;
    w.call.stopTone?.();
    attachLocal(w);
    connected(w);
  }
  function attachLocal(w) {
    const c = w.call;
    w.audioTx?.sender.replaceTrack(c.stream.getAudioTracks()[0] || null);
    w.videoTx?.sender.replaceTrack(c.stream.getVideoTracks()[0] || null);
    const lv = document.querySelector('.call-overlay .local-video');
    if (lv) { lv.srcObject = c.stream; lv.classList.toggle('hidden', !c.camOn); }
  }
  function connected(w) {
    const c = w.call;
    sendJSON(w, { t: 'cam', on: !!c.camOn });
    c.state = 'active';
    c.startedAt = Date.now();
    renderCallUI(w);
    sysLine(w, c.video ? 'Videollamada en curso.' : 'Llamada en curso.', 'join');
    c.timer = setInterval(() => {
      const s = document.querySelector('.call-overlay .call-status');
      if (s && w.call) s.textContent = fmtDur((Date.now() - c.startedAt) / 1000);
      renderCallUI(w); // por si el vídeo remoto empezó o se pausó
    }, 1000);
  }
  function onRemoteTrack(w, track) {
    const remote = w.remote;
    remote.getTracks().filter((t) => t.kind === track.kind).forEach((t) => remote.removeTrack(t));
    remote.addTrack(track);
    track.onmute = track.onunmute = () => renderCallUI(w);
    if (w.call) renderCallUI(w);
  }
  function hangup(w) {
    if (!w.call) return;
    sendJSON(w, { t: w.call.state === 'ringing' ? 'call-reject' : 'hangup' });
    sysLine(w, w.call.startedAt ? `Llamada finalizada (${fmtDur((Date.now() - w.call.startedAt) / 1000)}).` : 'Llamada cancelada.');
    endCall(w, true);
  }
  function endCall(w) {
    const c = w.call;
    if (!c) return;
    c.stopTone?.();
    clearInterval(c.timer);
    clearInterval(c.voiceTimer);
    c.stream?.getTracks().forEach((t) => t.stop());
    w.audioTx?.sender.replaceTrack(null);
    w.videoTx?.sender.replaceTrack(null);
    w.call = null;
    w.peerCam = undefined;
    document.querySelector('.call-overlay')?.remove();
    if (state.active === w.key) renderHeader(w);
  }
  function showCallUI(w, statusLabel, incoming = false) {
    document.querySelector('.call-overlay')?.remove();
    const el = document.createElement('div');
    el.className = 'call-overlay dm-call';
    el.dataset.key = w.key;
    // El vídeo remoto va SIN sonido (los móviles permiten reproducirlo solo) y el audio por separado
    el.innerHTML = `<video class="remote-video" autoplay playsinline muted></video><audio class="remote-audio" autoplay></audio>
      ${incoming ? '' : `<div class="call-top"><button class="icon-btn light" data-call="min" title="Volver al chat">${icon('message')}</button><button class="icon-btn light" data-call="full" title="Pantalla completa">${icon('expand')}</button></div>`}
      <div class="call-peer">${avatar(w.peer.nick)}<h2>${esc(w.peer.nick)}</h2><p class="call-status">${esc(statusLabel)}</p></div>
      <video class="local-video hidden" autoplay playsinline muted></video>
      <div class="call-controls">${incoming
        ? `<button class="round red" data-call="reject" title="Rechazar">${icon('phone-off')}</button><button class="round green" data-call="accept" title="Contestar">${icon(w.call.video ? 'video' : 'phone')}</button>`
        : `<button class="round" data-call="mic" title="Micrófono">${icon('mic')}</button><button class="round" data-call="cam" title="Cámara">${icon('video')}</button><button class="round red" data-call="hangup" title="Colgar">${icon('phone-off')}</button>`}</div>
      <button class="unmute-btn hidden" data-call="unmute">🔊 <span>Tocar para activar el sonido</span></button>
      <p class="call-e2e">${icon('lock')} Conexión directa cifrada de extremo a extremo</p>`;
    document.body.appendChild(el);
    if (w.call.stream) { const lv = el.querySelector('.local-video'); lv.srcObject = w.call.stream; lv.classList.toggle('hidden', !w.call.camOn); }
    el.onclick = (e) => {
      if (el.classList.contains('minimized') && !e.target.closest('[data-call]')) { el.classList.remove('minimized'); return; }
      const a = e.target.closest('[data-call]')?.dataset.call;
      if (!a || !w.call) return;
      if (a === 'accept') { acceptCall(w).then(() => w.call && showCallUI(w, '0:00')); }
      if (a === 'reject') { sendJSON(w, { t: 'call-reject' }); sysLine(w, 'Rechazaste la llamada.'); endCall(w); }
      if (a === 'hangup') hangup(w);
      if (a === 'unmute') { el.querySelectorAll('audio, video.remote-video').forEach((m) => m.play().catch(() => {})); el.querySelector('.unmute-btn').classList.add('hidden'); return; }
      if (a === 'min') { el.classList.add('minimized'); el.classList.remove('full'); return; }
      if (a === 'full') { el.classList.toggle('full'); el.querySelector('[data-call="full"]').innerHTML = icon(el.classList.contains('full') ? 'shrink' : 'expand'); return; }
      if (a === 'mic') { w.call.micOn = !w.call.micOn; w.call.stream.getAudioTracks().forEach((t) => (t.enabled = w.call.micOn)); renderCallUI(w); }
      if (a === 'cam') toggleCam(w);
    };
    renderCallUI(w);
  }
  async function toggleCam(w) {
    const c = w.call;
    if (c.camOn) {
      c.stream.getVideoTracks().forEach((t) => { t.stop(); c.stream.removeTrack(t); });
      w.videoTx?.sender.replaceTrack(null);
      c.camOn = false;
    } else {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
        const t = s.getVideoTracks()[0];
        c.stream.addTrack(t);
        w.videoTx?.sender.replaceTrack(t);
        c.camOn = true;
      } catch { return toast('No se pudo activar la cámara.'); }
    }
    const lv = document.querySelector('.call-overlay .local-video');
    if (lv) { lv.srcObject = c.stream; lv.classList.toggle('hidden', !c.camOn); }
    sendJSON(w, { t: 'cam', on: c.camOn });
    renderCallUI(w);
  }
  /** Ilumina al otro participante cuando llega su voz (sirve para saber si el audio llega). */
  function watchVoice(w, el) {
    const c = w.call;
    if (!c || c.voiceTimer || !w.pc) return;
    c.voiceTimer = setInterval(async () => {
      if (!w.call || !w.pc) return clearInterval(c.voiceTimer);
      let level = 0;
      (await w.pc.getStats()).forEach((r) => { if (r.type === 'inbound-rtp' && r.kind === 'audio' && r.audioLevel != null) level = r.audioLevel; });
      document.querySelector('.call-overlay.dm-call')?.classList.toggle('speaking', level > 0.02);
    }, 300);
  }
  function renderCallUI(w) {
    const el = document.querySelector('.call-overlay');
    const c = w.call;
    if (!el || !c) return;
    const rv = el.querySelector('.remote-video');
    const ra = el.querySelector('.remote-audio');
    if (rv.srcObject !== w.remote) {
      rv.srcObject = w.remote;
      rv.onresize = rv.onloadeddata = rv.onplaying = () => renderCallUI(w);
      rv.play().catch(() => {});
    }
    const tryAudio = () => ra.play().then(() => el.querySelector('.unmute-btn')?.classList.add('hidden'))
      .catch(() => el.querySelector('.unmute-btn')?.classList.remove('hidden')); // el navegador bloqueó el sonido
    if (ra.srcObject !== w.remote) { ra.srcObject = w.remote; tryAudio(); }
    else if (ra.paused) tryAudio();
    watchVoice(w, el);
    if (rv.paused) rv.play().catch(() => {});
    // Hay imagen si la pista está viva y llegan fotogramas (algunos móviles no actualizan "muted")
    const vt = w.remote.getVideoTracks()[0];
    const flowing = rv.currentTime !== rv.__lastT; // el vídeo avanza desde la última comprobación
    rv.__lastT = rv.currentTime;
    const hasVideo = w.peerCam !== false && !!(vt && vt.readyState === 'live' && rv.videoWidth > 0 && (!vt.muted || flowing));
    el.classList.toggle('has-video', hasVideo);
    const mic = el.querySelector('[data-call="mic"]');
    if (mic) { mic.innerHTML = icon(c.micOn ? 'mic' : 'mic-off'); mic.classList.toggle('off', !c.micOn); }
    const cam = el.querySelector('[data-call="cam"]');
    if (cam) { cam.innerHTML = icon(c.camOn ? 'video' : 'video-off'); cam.classList.toggle('off', !c.camOn); }
  }

  /* ---------------- Cierre ---------------- */
  function peerGone(w, html) {
    if (w.status === 'closed' || w.status === 'offline') return;
    clearTimeout(w.goneTimer); clearTimeout(w.retryTimer);
    if (w.call) endCall(w);
    sysLine(w, `${html} <button type="button" class="link" data-dm-retry="${esc(w.key)}">${esc(t('Volver a conectar'))}</button>`, 'part');
    teardown(w);
    setStatus(w, w.via === 'user' ? 'offline' : 'closed'); // con amigos se puede seguir escribiendo (buzón)
  }
  function teardown(w) {
    try { w.dc?.close(); } catch { /* nada */ }
    try { w.pc?.close(); } catch { /* nada */ }
    if (w.rt) supabase.removeChannel(w.rt);
    w.dc = w.pc = w.rt = null;
  }
  /** Cierra la ventana (botón ✕ o "Cerrar conversación"). */
  function closeWindow(w, silent = false) {
    clearTimeout(w.timer);
    clearInterval(w.resend);
    if (w.status === 'pending' && !silent) sendTo(w.via, w.peer.cid, 'cancel', { id: w.id });
    if (w.call) hangup(w);
    sendJSON(w, { t: 'bye' });
    clearTimeout(w.goneTimer); clearTimeout(w.retryTimer); clearTimeout(w.connectTimer);
    w.status = 'closed'; // la ventana vieja ya no reacciona (su clave puede reutilizarla otra)
    setTimeout(() => teardown(w), 200);
    state.windows.delete(w.key);
    if (silent) carry.set(w.key, { lines: w.lines, msgs: w.msgs }); // se reemplaza: se conserva lo ya hablado
    if (!silent && state.active === w.key) ctx.activate('status');
    ctx.renderChanList();
  }
  function closeAll() {
    for (const w of dmWindows()) closeWindow(w, true);
    if (inbox) supabase.removeChannel(inbox);
    if (friendInbox) supabase.removeChannel(friendInbox);
    inbox = friendInbox = null;
    pendingRequests.clear();
  }
  function onNickChange(nick) { for (const w of dmWindows()) sendJSON(w, { t: 'nick', nick }); }

  if (import.meta.env.DEV) window.__dmWindows = dmWindows; // solo en desarrollo, para pruebas
  /** Estadísticas de la llamada (consola: await __callStats()) para diagnosticar audio/vídeo. */
  window.__callStats = async () => {
    const w = dmWindows().find((x) => x.call);
    if (!w?.pc) return null;
    const out = {};
    (await w.pc.getStats()).forEach((r) => {
      if (r.type === 'inbound-rtp' || r.type === 'outbound-rtp') out[r.type + ':' + r.kind] = { bytes: r.bytesReceived ?? r.bytesSent, level: r.audioLevel };
    });
    const ra = document.querySelector('.call-overlay .remote-audio');
    out.audioEl = ra ? { paused: ra.paused, muted: ra.muted, tracks: ra.srcObject?.getAudioTracks().map((t) => t.readyState + (t.muted ? '/muted' : '')) } : null;
    out.senders = w.pc.getTransceivers().map((t) => (t.receiver.track.kind + ':' + (t.sender.track ? t.sender.track.kind + (t.sender.track.enabled ? '' : '(off)') : 'null') + ':' + t.currentDirection));
    return out;
  };
  // Diagnóstico (consola del navegador: __dmDebug())
  window.__dmDebug = () => dmWindows().map((w) => ({ peer: w.peer.nick, role: w.role, status: w.status, relay: !!w.relay, everDirect: !!w.everDirect, retries: w.retries || 0, rt: w.rt?.state, pc: w.pc?.connectionState, ice: w.pc?.iceConnectionState, sig: w.pc?.signalingState, dc: w.dc?.readyState, log: w.dbg }));
  return {
    init, requestPrivate, acceptExternal, receiveMail, onActivate, sendText, sendFile, sendSticker, startVoice, stopVoice,
    startCall: (w, video) => startCall(w, video), closeWindow, closeAll, onNickChange,
    statusText,
  };
}
