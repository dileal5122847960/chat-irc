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

  /* ---------------- Bandeja de entrada ---------------- */
  function init() {
    inbox = supabase.channel('inbox:' + state.clientId, { config: { broadcast: { self: false } } });
    inbox
      .on('broadcast', { event: 'req' }, ({ payload }) => payload && onRequest(payload))
      .on('broadcast', { event: 'resp' }, ({ payload }) => payload && onResponse(payload))
      .on('broadcast', { event: 'cancel' }, ({ payload }) => payload && dismissRequest(payload.id))
      .subscribe();
  }
  async function sendTo(cid, event, payload) {
    const ch = supabase.channel('inbox:' + cid, { config: { broadcast: { self: false } } });
    try { await ch.httpSend(event, payload); return true; } catch { return false; } finally { supabase.removeChannel(ch); }
  }
  const me = () => ({ from: state.clientId, nick: state.nick, reg: state.registered });
  const dmWindows = () => [...state.windows.values()].filter((w) => w.kind === 'dm');
  const findByPeer = (cid) => dmWindows().find((w) => w.peer.cid === cid && w.status !== 'closed' && w.status !== 'rejected');

  /** Abre (o enfoca) un privado con una persona del canal. */
  async function requestPrivate(peer) {
    if (peer.cid === state.clientId) return;
    const existing = state.windows.get('dm:' + peer.cid);
    if (existing && existing.status !== 'closed' && existing.status !== 'rejected') return ctx.activate(existing.key);
    if (existing) closeWindow(existing, true);
    // Si esa persona ya nos lo pidió, aceptamos su solicitud directamente
    const theirs = [...pendingRequests.values()].find((r) => r.from === peer.cid);
    if (theirs) return accept(theirs.id);
    const w = makeWindow(peer, crypto.randomUUID(), 'caller');
    w.status = 'pending';
    ctx.activate(w.key);
    sysLine(w, `Esperando a que <b>${esc(peer.nick)}</b> acepte la conversación privada…`);
    const ok = await sendTo(peer.cid, 'req', { id: w.id, ...me() });
    if (!ok) { setStatus(w, 'closed'); return sysLine(w, 'No se pudo enviar la solicitud.', 'err'); }
    w.timer = setTimeout(() => {
      if (w.status !== 'pending') return;
      setStatus(w, 'rejected');
      sysLine(w, `<b>${esc(peer.nick)}</b> no respondió.`, 'err');
      sendTo(peer.cid, 'cancel', { id: w.id });
    }, REQUEST_TIMEOUT);
  }

  function onRequest(r) {
    if (!r.id || !r.from || typeof r.nick !== 'string') return;
    // Si ya le habíamos pedido nosotros, aceptamos (ambos querían hablar)
    const mine = findByPeer(r.from);
    if (mine && mine.status === 'pending') {
      pendingRequests.set(r.id, r);
      closeWindow(mine, true);
      return accept(r.id);
    }
    if (mine) return; // ya hay conversación abierta
    pendingRequests.set(r.id, r);
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
    const card = e.target.closest('.dm-req');
    if (!card) return;
    if (e.target.closest('[data-req-ok]')) accept(card.dataset.req);
    if (e.target.closest('[data-req-no]')) reject(card.dataset.req);
  });
  async function accept(id) {
    const r = pendingRequests.get(id);
    dismissRequest(id);
    if (!r) return;
    const w = makeWindow({ cid: r.from, nick: r.nick, reg: !!r.reg }, r.id, 'callee');
    setStatus(w, 'connecting');
    ctx.activate(w.key);
    sysLine(w, 'Estableciendo conexión directa…');
    await joinSignaling(w);
    sendTo(r.from, 'resp', { id: r.id, ok: true, ...me() });
  }
  function reject(id) {
    const r = pendingRequests.get(id);
    dismissRequest(id);
    if (r) sendTo(r.from, 'resp', { id, ok: false, ...me() });
  }
  async function onResponse(r) {
    const w = dmWindows().find((x) => x.id === r.id);
    if (!w || w.status !== 'pending') return;
    clearTimeout(w.timer);
    if (!r.ok) { setStatus(w, 'rejected'); return sysLine(w, `<b>${esc(w.peer.nick)}</b> rechazó la conversación privada.`, 'err'); }
    setStatus(w, 'connecting');
    sysLine(w, `<b>${esc(w.peer.nick)}</b> aceptó. Estableciendo conexión directa…`);
    await joinSignaling(w);
  }

  /* ---------------- Ventana ---------------- */
  function makeWindow(peer, id, role) {
    const w = {
      key: 'dm:' + peer.cid, kind: 'dm', name: peer.nick, peer, id, role, status: 'new',
      lines: [], unread: 0, mention: false, last: null,
      rt: null, pc: null, dc: null, polite: role === 'callee', makingOffer: false, ignoreOffer: false,
      sendQueue: Promise.resolve(), incoming: new Map(), call: null,
      msgs: new Map(), unreadMids: [], lastBubble: null,
    };
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
      pending: 'Esperando respuesta…', connecting: 'Conectando…', open: w.relay ? 'en línea · vía servidor (sin cifrado de extremo a extremo)' : 'en línea · cifrado de extremo a extremo',
      closed: 'Conversación cerrada', rejected: 'No disponible',
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
    const input = document.getElementById('input');
    input.disabled = !open;
    input.placeholder = open ? `Mensaje privado para ${w.peer.nick}` : statusText(w);
    document.getElementById('attach-btn').disabled = !open;
    document.getElementById('mic-btn').disabled = !open;
    document.getElementById('emoji-btn').disabled = !open;
  }
  /** Llamado por la app al mostrar esta ventana. */
  function onActivate(w) {
    renderHeader(w);
    syncComposer(w);
    markRead(w);
  }
  function sysLine(w, html, kind = 'info') { ctx.sys(w.key, html, kind); }

  /* ---------------- Señalización y conexión WebRTC ---------------- */
  async function joinSignaling(w) {
    await ctx.ensureIce?.();
    const rt = supabase.channel('dm:' + w.id, { config: { broadcast: { self: false }, presence: { key: state.clientId } } });
    w.rt = rt;
    rt.on('broadcast', { event: 'sig' }, ({ payload }) => payload && payload.from === w.peer.cid && handleSignal(w, payload))
      .on('broadcast', { event: 'relay' }, ({ payload: m }) => {
        if (!m || m.from !== w.peer.cid) return;
        if (m.t === 'relay-on') return enableRelay(w, false);
        if (!w.relay) enableRelay(w, false);
        if (m.t === 'chunk' && typeof m.d === 'string') return onChunk(w, b64dec(m.d));
        onData(w, m);
      })
      .on('presence', { event: 'leave' }, ({ key }) => { if (key === w.peer.cid && w.status === 'open') peerGone(w, `<b>${esc(w.peer.nick)}</b> se desconectó.`); });
    await new Promise((resolve) => rt.subscribe(async (s) => {
      if (s === 'SUBSCRIBED') { await rt.track({ nick: state.nick }); resolve(); }
      if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') resolve();
    }));
    createPeer(w);
    // Si en 15 s no hay conexión directa, se pasa al plan B (a través del servidor)
    w.connectTimer = setTimeout(() => { if (w.status === 'connecting') enableRelay(w, true); }, 15000);
  }
  const signal = (w, data) => {
    (w.dbg ||= []).push('tx:' + (data.description?.type || 'ice'));
    return w.rt?.send({ type: 'broadcast', event: 'sig', payload: { from: state.clientId, ...data } }).then((r) => { if (r !== 'ok') w.dbg.push('tx-fail:' + r); });
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
      if (pc.connectionState === 'failed' && w.status !== 'closed') enableRelay(w, true);
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
      setStatus(w, 'open');
      sysLine(w, `Conexión directa con <b>${esc(w.peer.nick)}</b>. Los mensajes, archivos y llamadas van cifrados de extremo a extremo y no se guardan en ningún sitio.`, 'join');
    };
    dc.onclose = () => {
      if (w.status !== 'open' || w.relay) return;
      // Si la conexión directa se cae pero la otra persona sigue aquí, se continúa por el servidor
      if (w.rt?.presenceState()[w.peer.cid]) enableRelay(w, true);
      else peerGone(w, `<b>${esc(w.peer.nick)}</b> cerró la conversación.`);
    };
    dc.onmessage = (e) => {
      if (typeof e.data === 'string') {
        let m; try { m = JSON.parse(e.data); } catch { return; }
        onData(w, m);
      } else onChunk(w, e.data);
    };
  }
  const sendJSON = (w, obj) => {
    if (w.relay) return w.rt?.send({ type: 'broadcast', event: 'relay', payload: { ...obj, from: state.clientId } });
    if (w.dc?.readyState === 'open') w.dc.send(JSON.stringify(obj));
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
    if (announce) w.rt.send({ type: 'broadcast', event: 'relay', payload: { t: 'relay-on', from: state.clientId } });
    try { w.dc?.close(); } catch { /* nada */ }
    setStatus(w, 'open');
    sysLine(w, `${icon('unlock')} ` + esc(t('No fue posible la conexión directa entre vuestras redes. La conversación continúa a través del servidor: los mensajes no se guardan, pero no van cifrados de extremo a extremo. Las llamadas no están disponibles en este modo.')), 'err');
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
  /** Si el privado está a la vista, avisa al otro de que se han leído sus mensajes. */
  function markRead(w) {
    if (!w.unreadMids.length || state.active !== w.key || document.hidden) return;
    sendJSON(w, { t: 'read', mids: w.unreadMids.splice(0) });
  }
  document.addEventListener('visibilitychange', () => { const w = state.windows.get(state.active); if (w?.kind === 'dm') markRead(w); });
  function setTick(w, mid, st) {
    const m = w.msgs.get(mid);
    if (!m || !m.mine) return;
    const order = { sent: 0, delivered: 1, read: 2 };
    if (order[st] <= order[m.tick || 'sent']) return;
    m.tick = st;
    rerender(w, mid);
  }
  const tickHtml = (m) => `<span class="tick ${m.tick || 'sent'}" title="${{ sent: 'Enviado', delivered: 'Entregado', read: 'Leído' }[m.tick || 'sent']}">${icon(m.tick === 'delivered' || m.tick === 'read' ? 'check2' : 'check')}</span>`;

  /* ---------------- Burbujas ---------------- */
  function addMessage(w, m) {
    m.mid ||= crypto.randomUUID();
    if (m.mine) m.tick = 'sent';
    m.first = !w.lastBubble || w.lastBubble.mine !== m.mine || m.ts - w.lastBubble.ts > 5 * 60 * 1000;
    w.lastBubble = { mine: m.mine, ts: m.ts };
    w.msgs.set(m.mid, m);
    w.last = null;
    ctx.addHtml(w.key, bubbleHtml(w, m), { count: !m.mine });
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
    if (w.status !== 'open') return;
    const mid = crypto.randomUUID();
    sendJSON(w, { t: 'text', mid, text, kind: kind === 'action' ? 'action' : 'text', lang: getLang() });
    addMessage(w, { mid, mine: true, kind: kind === 'action' ? 'action' : 'text', text, ts: Date.now() });
  }
  function sendSticker(w, id) {
    if (w.status !== 'open' || !STICKERS.includes(id)) return;
    const mid = crypto.randomUUID();
    sendJSON(w, { t: 'sticker', mid, id });
    addMessage(w, { mid, mine: true, kind: 'sticker', sticker: id, ts: Date.now() });
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
          await w.rt.send({ type: 'broadcast', event: 'relay', payload: { t: 'chunk', d: b64enc(buf), from: state.clientId } });
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
    c.stream?.getTracks().forEach((t) => t.stop());
    w.audioTx?.sender.replaceTrack(null);
    w.videoTx?.sender.replaceTrack(null);
    w.call = null;
    document.querySelector('.call-overlay')?.remove();
    if (state.active === w.key) renderHeader(w);
  }
  function showCallUI(w, statusLabel, incoming = false) {
    document.querySelector('.call-overlay')?.remove();
    const el = document.createElement('div');
    el.className = 'call-overlay';
    el.dataset.key = w.key;
    el.innerHTML = `<video class="remote-video" autoplay playsinline></video>
      <div class="call-peer">${avatar(w.peer.nick)}<h2>${esc(w.peer.nick)}</h2><p class="call-status">${esc(statusLabel)}</p></div>
      <video class="local-video hidden" autoplay playsinline muted></video>
      <div class="call-controls">${incoming
        ? `<button class="round red" data-call="reject" title="Rechazar">${icon('phone-off')}</button><button class="round green" data-call="accept" title="Contestar">${icon(w.call.video ? 'video' : 'phone')}</button>`
        : `<button class="round" data-call="mic" title="Micrófono">${icon('mic')}</button><button class="round" data-call="cam" title="Cámara">${icon('video')}</button><button class="round red" data-call="hangup" title="Colgar">${icon('phone-off')}</button>`}</div>
      <p class="call-e2e">${icon('lock')} Conexión directa cifrada de extremo a extremo</p>`;
    document.body.appendChild(el);
    if (w.call.stream) { const lv = el.querySelector('.local-video'); lv.srcObject = w.call.stream; lv.classList.toggle('hidden', !w.call.camOn); }
    el.onclick = (e) => {
      const a = e.target.closest('[data-call]')?.dataset.call;
      if (!a || !w.call) return;
      if (a === 'accept') { acceptCall(w).then(() => w.call && showCallUI(w, '0:00')); }
      if (a === 'reject') { sendJSON(w, { t: 'call-reject' }); sysLine(w, 'Rechazaste la llamada.'); endCall(w); }
      if (a === 'hangup') hangup(w);
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
    renderCallUI(w);
  }
  function renderCallUI(w) {
    const el = document.querySelector('.call-overlay');
    const c = w.call;
    if (!el || !c) return;
    const vt = w.remote.getVideoTracks()[0];
    const hasVideo = !!(vt && !vt.muted && vt.readyState === 'live');
    el.classList.toggle('has-video', hasVideo);
    const rv = el.querySelector('.remote-video');
    if (rv.srcObject !== w.remote) { rv.srcObject = w.remote; rv.play().catch(() => {}); }
    const mic = el.querySelector('[data-call="mic"]');
    if (mic) { mic.innerHTML = icon(c.micOn ? 'mic' : 'mic-off'); mic.classList.toggle('off', !c.micOn); }
    const cam = el.querySelector('[data-call="cam"]');
    if (cam) { cam.innerHTML = icon(c.camOn ? 'video' : 'video-off'); cam.classList.toggle('off', !c.camOn); }
  }

  /* ---------------- Cierre ---------------- */
  function peerGone(w, html) {
    if (w.status === 'closed') return;
    if (w.call) endCall(w);
    sysLine(w, html, 'part');
    teardown(w);
    setStatus(w, 'closed');
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
    if (w.status === 'pending' && !silent) sendTo(w.peer.cid, 'cancel', { id: w.id });
    if (w.call) hangup(w);
    sendJSON(w, { t: 'bye' });
    setTimeout(() => teardown(w), 200);
    state.windows.delete(w.key);
    if (!silent && state.active === w.key) ctx.activate('status');
    ctx.renderChanList();
  }
  function closeAll() {
    for (const w of dmWindows()) closeWindow(w, true);
    if (inbox) supabase.removeChannel(inbox);
    inbox = null;
    pendingRequests.clear();
  }
  function onNickChange(nick) { for (const w of dmWindows()) sendJSON(w, { t: 'nick', nick }); }

  // Diagnóstico (consola del navegador: __dmDebug())
  window.__dmDebug = () => dmWindows().map((w) => ({ peer: w.peer.nick, role: w.role, status: w.status, relay: !!w.relay, rt: w.rt?.state, pc: w.pc?.connectionState, ice: w.pc?.iceConnectionState, sig: w.pc?.signalingState, dc: w.dc?.readyState, log: w.dbg }));
  return {
    init, requestPrivate, onActivate, sendText, sendFile, sendSticker, startVoice, stopVoice,
    startCall: (w, video) => startCall(w, video), closeWindow, closeAll, onNickChange,
    statusText,
  };
}
