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

const MAX_FILE = 100 * 1024 * 1024; // 100 MB por archivo
const CHUNK = 32 * 1024;
const REQUEST_TIMEOUT = 60 * 1000;

function iceServers() {
  const servers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  const turn = import.meta.env.VITE_TURN_URL;
  if (turn) servers.push({ urls: turn.split(','), username: import.meta.env.VITE_TURN_USERNAME, credential: import.meta.env.VITE_TURN_CREDENTIAL });
  return servers;
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
      pending: 'Esperando respuesta…', connecting: 'Conectando…', open: 'Conexión directa cifrada de extremo a extremo',
      closed: 'Conversación cerrada', rejected: 'No disponible',
    }[w.status] || '';
  }
  function renderHeader(w) {
    document.getElementById('win-name').innerHTML = `${avatar(w.peer.nick)}<span class="dm-title-nick" style="${nickStyle(w.peer.nick)}">${esc(w.peer.nick)}</span>${w.peer.reg ? verified : ''}`;
    document.getElementById('topic').innerHTML = `<span class="dm-status ${w.status}">${w.status === 'open' ? icon('lock') : ''}${esc(statusText(w))}</span>`;
    const open = w.status === 'open';
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
  }
  /** Llamado por la app al mostrar esta ventana. */
  function onActivate(w) {
    renderHeader(w);
    syncComposer(w);
  }
  function sysLine(w, html, kind = 'info') { ctx.sys(w.key, html, kind); }

  /* ---------------- Señalización y conexión WebRTC ---------------- */
  async function joinSignaling(w) {
    const rt = supabase.channel('dm:' + w.id, { config: { broadcast: { self: false }, presence: { key: state.clientId } } });
    w.rt = rt;
    rt.on('broadcast', { event: 'sig' }, ({ payload }) => payload && payload.from === w.peer.cid && handleSignal(w, payload))
      .on('presence', { event: 'leave' }, ({ key }) => { if (key === w.peer.cid && w.status === 'open') peerGone(w, `<b>${esc(w.peer.nick)}</b> se desconectó.`); });
    await new Promise((resolve) => rt.subscribe(async (s) => {
      if (s === 'SUBSCRIBED') { await rt.track({ nick: state.nick }); resolve(); }
      if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') resolve();
    }));
    createPeer(w);
    // Si en 25 s no hay conexión directa, se avisa en vez de quedarse esperando
    w.connectTimer = setTimeout(() => {
      if (w.status !== 'connecting') return;
      sysLine(w, 'No se pudo establecer la conexión directa. Cierra esta conversación y vuelve a intentarlo con doble clic en el nick.', 'err');
      teardown(w);
      setStatus(w, 'closed');
    }, 25000);
  }
  const signal = (w, data) => w.rt?.send({ type: 'broadcast', event: 'sig', payload: { from: state.clientId, ...data } });

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
      if (pc.connectionState === 'failed') {
        sysLine(w, 'No se pudo establecer la conexión directa. Puede que vuestra red la bloquee.', 'err');
        setStatus(w, 'closed');
      }
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
    const pc = w.pc;
    if (!pc) return;
    try {
      if (description) {
        const collision = description.type === 'offer' && (w.makingOffer || pc.signalingState !== 'stable');
        w.ignoreOffer = !w.polite && collision;
        if (w.ignoreOffer) return;
        await pc.setRemoteDescription(description);
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
    dc.onclose = () => { if (w.status === 'open') peerGone(w, `<b>${esc(w.peer.nick)}</b> cerró la conversación.`); };
    dc.onmessage = (e) => {
      if (typeof e.data === 'string') {
        let m; try { m = JSON.parse(e.data); } catch { return; }
        onData(w, m);
      } else onChunk(w, e.data);
    };
  }
  const sendJSON = (w, obj) => { if (w.dc?.readyState === 'open') w.dc.send(JSON.stringify(obj)); };

  function onData(w, m) {
    switch (m.t) {
      case 'text': return addMessage(w, { mine: false, kind: m.kind === 'action' ? 'action' : 'text', text: String(m.text || '').slice(0, 4000), ts: Date.now() });
      case 'file-start': {
        if (!(m.size > 0 && m.size <= MAX_FILE)) return;
        const f = { ...m, chunks: [], received: 0, mine: false };
        w.incoming.set('current', f);
        addMessage(w, { mine: false, kind: 'file', file: f, ts: Date.now() });
        return;
      }
      case 'file-end': {
        const f = w.incoming.get('current');
        if (!f || f.fid !== m.fid) return;
        w.incoming.delete('current');
        f.blob = new Blob(f.chunks, { type: f.mime || 'application/octet-stream' });
        f.chunks = null;
        f.url = URL.createObjectURL(f.blob);
        updateFile(w, f);
        return;
      }
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
      case 'call-reject': if (w.call) { sysLine(w, `<b>${esc(w.peer.nick)}</b> rechazó la llamada.`, 'err'); endCall(w, false); } return;
      case 'hangup': if (w.call) { sysLine(w, 'Llamada finalizada.'); endCall(w, false); } return;
      case 'bye': return peerGone(w, `<b>${esc(w.peer.nick)}</b> cerró la conversación.`);
      default:
    }
  }
  function onChunk(w, buf) {
    const f = w.incoming.get('current');
    if (!f) return;
    f.chunks.push(buf);
    f.received += buf.byteLength;
    if (f.received > f.size) { w.incoming.delete('current'); return; }
    progress(f, f.received / f.size);
  }

  /* ---------------- Mensajes ---------------- */
  function addMessage(w, m) {
    const nick = m.mine ? state.nick : w.peer.nick;
    const reg = m.mine ? state.registered : w.peer.reg;
    const head = `<b class="nick" style="${nickStyle(nick)}">${esc(nick)}</b>${reg ? verified : ''}`;
    let body;
    if (m.kind === 'action') {
      w.last = null;
      return ctx.addHtml(w.key, `<div class="msg action"><span class="gutter"><time>${time(m.ts)}</time></span><div class="msg-body"><span class="star">*</span> ${head} ${linkify(m.text)}</div></div>`, { count: !m.mine });
    }
    if (m.kind === 'text') body = linkify(m.text);
    else body = fileHtml(m.file);
    const grouped = w.last && w.last.mine === m.mine && m.ts - w.last.ts < 5 * 60 * 1000 && m.kind === 'text' && w.last.kind === 'text';
    w.last = { mine: m.mine, ts: m.ts, kind: m.kind };
    const html = grouped
      ? `<div class="msg cont"><span class="gutter"><time>${time(m.ts)}</time></span><div class="msg-body">${body}</div></div>`
      : `<div class="msg first"><span class="gutter">${avatar(nick)}</span><div class="msg-body"><div class="msg-head">${head}<time>${time(m.ts)}</time></div>${body}</div></div>`;
    ctx.addHtml(w.key, html, { count: !m.mine });
  }
  function fileKind(mime) {
    if (/^image\//.test(mime)) return 'image';
    if (/^video\//.test(mime)) return 'video';
    if (/^audio\//.test(mime)) return 'audio';
    return 'file';
  }
  function fileHtml(f) {
    const id = 'f-' + f.fid;
    if (!f.url) {
      return `<div class="att loading" id="${id}"><span class="att-ico">${icon(f.kind === 'audio' ? 'mic' : f.kind === 'image' ? 'image' : f.kind === 'video' ? 'video' : 'file')}</span>
        <span class="att-info"><b>${esc(f.voice ? 'Nota de voz' : f.name)}</b><small>${fmtSize(f.size)} · <span class="att-pct">0%</span></small><i class="bar"><i></i></i></span></div>`;
    }
    return readyHtml(f, id);
  }
  function readyHtml(f, id) {
    if (f.kind === 'image') return `<a class="att-media" id="${id}" href="${f.url}" target="_blank" rel="noopener"><img src="${f.url}" alt="${esc(f.name)}"></a>`;
    if (f.kind === 'video') return `<div class="att-media" id="${id}"><video src="${f.url}" controls playsinline preload="metadata"></video></div>`;
    if (f.kind === 'audio') return `<div class="att-voice" id="${id}">${icon('mic')}<audio src="${f.url}" controls preload="metadata"></audio>${f.duration ? `<small>${fmtDur(f.duration)}</small>` : ''}</div>`;
    return `<a class="att" id="${id}" href="${f.url}" download="${esc(f.name)}"><span class="att-ico">${icon('file')}</span><span class="att-info"><b>${esc(f.name)}</b><small>${fmtSize(f.size)} · Descargar</small></span><span class="att-dl">${icon('download')}</span></a>`;
  }
  function progress(f, p) {
    const el = document.getElementById('f-' + f.fid);
    if (!el) return;
    const pct = Math.min(100, Math.round(p * 100));
    el.querySelector('.att-pct') && (el.querySelector('.att-pct').textContent = pct + '%');
    el.querySelector('.bar i') && (el.querySelector('.bar i').style.width = pct + '%');
  }
  function updateFile(w, f) {
    const id = 'f-' + f.fid;
    const html = readyHtml(f, id);
    // Actualiza la copia guardada de la ventana y el DOM si está visible
    w.lines = w.lines.map((l) => (l.includes(`id="${id}"`) ? l.replace(new RegExp(`<div class="att loading" id="${id}">[\\s\\S]*?</i></i></span></div>`), html) : l));
    const el = document.getElementById(id);
    if (el) el.outerHTML = html;
  }

  /* ---------------- Enviar ---------------- */
  function sendText(w, text, kind = 'msg') {
    if (w.status !== 'open') return;
    sendJSON(w, { t: 'text', text, kind: kind === 'action' ? 'action' : 'text' });
    addMessage(w, { mine: true, kind: kind === 'action' ? 'action' : 'text', text, ts: Date.now() });
  }
  function sendFile(w, file, extra = {}) {
    if (w.status !== 'open') return;
    if (file.size > MAX_FILE) return toast(`"${file.name}" supera el límite de 100 MB.`);
    if (!file.size) return;
    const f = { fid: crypto.randomUUID(), name: file.name || 'archivo', mime: file.type || 'application/octet-stream', size: file.size, kind: extra.voice ? 'audio' : fileKind(file.type), ...extra };
    const local = { ...f, mine: true };
    addMessage(w, { mine: true, kind: 'file', file: local, ts: Date.now() });
    // Los envíos van en fila: un archivo después de otro
    w.sendQueue = w.sendQueue.then(async () => {
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
        progress(local, off / file.size);
      }
      dc.send(JSON.stringify({ t: 'file-end', fid: f.fid }));
      local.url = URL.createObjectURL(file);
      updateFile(w, local);
    }).catch((e) => sysLine(w, 'Error al enviar el archivo: ' + esc(e.message), 'err'));
  }

  /* ---------------- Notas de voz ---------------- */
  let rec = null;
  async function startVoice(w) {
    if (rec || w.status !== 'open') return;
    if (!window.MediaRecorder) return toast('Tu navegador no permite grabar audio.');
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); } catch { return toast('Permite el acceso al micrófono para grabar notas de voz.'); }
    const mime = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
    const mr = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined);
    const r = { mr, stream, chunks: [], start: Date.now(), w };
    rec = r;
    mr.ondataavailable = (e) => e.data.size && r.chunks.push(e.data);
    mr.start(250);
    document.getElementById('input-form').classList.add('recording');
    const tick = () => { if (rec !== r) return; document.getElementById('rec-time').textContent = fmtDur((Date.now() - r.start) / 1000); r.raf = setTimeout(tick, 250); };
    tick();
  }
  function stopVoice(send) {
    const r = rec;
    if (!r) return;
    rec = null;
    clearTimeout(r.raf);
    document.getElementById('input-form').classList.remove('recording');
    r.mr.onstop = () => {
      r.stream.getTracks().forEach((t) => t.stop());
      const duration = (Date.now() - r.start) / 1000;
      if (!send) return;
      if (duration < 0.8) return toast('La nota de voz es demasiado corta.');
      const type = (r.mr.mimeType || 'audio/webm').split(';')[0];
      const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
      sendFile(r.w, new File(r.chunks, `nota-de-voz.${ext}`, { type }), { voice: true, duration });
    };
    r.mr.stop();
  }

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

  return {
    init, requestPrivate, onActivate, sendText, sendFile, startVoice, stopVoice,
    startCall: (w, video) => startCall(w, video), closeWindow, closeAll, onNickChange,
    statusText,
  };
}
