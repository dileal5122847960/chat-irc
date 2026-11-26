/*
 * Videollamadas grupales dentro de un canal
 * ──────────────────────────────────────────
 * • Malla WebRTC: cada participante se conecta directamente con cada uno de los demás
 *   (audio y vídeo cifrados con DTLS-SRTP, sin servidor de medios).
 * • Quién está en la llamada se sabe por la presencia del canal (campo "call").
 * • La señalización (SDP/ICE) viaja por el propio canal en tiempo real, dirigida a
 *   un participante concreto. Se usa "perfect negotiation" para evitar choques.
 * • Recomendado hasta ~6 personas; límite 8.
 */
import { iceServers } from './dm.js';

const MAX_PARTICIPANTS = 8;

export function createGroupCall(ctx) {
  const { state, esc, icon, avatar, toast, t } = ctx;
  let call = null; // { w, stream, peers: Map(cid -> peer), micOn, camOn, startedAt, timer }

  const participants = (w) => [...(w.people?.values() || [])].filter((p) => p.call);
  const isActiveIn = (w) => call && call.w === w;

  /* ---------------- Aviso "videollamada en curso" ---------------- */
  function renderBanner(w) {
    const el = document.getElementById('call-banner');
    if (!el) return;
    if (!w || w.kind === 'dm' || w.key === 'status') { el.classList.add('hidden'); return; }
    const list = participants(w);
    if (!list.length || isActiveIn(w)) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.innerHTML = `<span class="cb-dot"></span>${icon('video')}<span class="cb-text"><b>${esc(t('Videollamada en curso'))}</b> · <span class="ugc">${list.map((p) => esc(p.nick)).join(', ')}</span></span>
      <button class="btn small primary" data-gc-join>${esc(t('Unirse'))}</button>`;
  }
  document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-gc-join]')) return;
    const w = state.windows.get(state.active);
    if (w) join(w);
  });

  /* ---------------- Entrar / salir ---------------- */
  async function join(w) {
    if (!w?.rt || w.kind === 'dm') return;
    if (call) { if (call.w !== w) toast(t('Ya estás en una llamada.')); else showUI(); return; }
    if (document.querySelector('.call-overlay')) return toast(t('Ya estás en una llamada.'));
    if (participants(w).length >= MAX_PARTICIPANTS) return toast(t('La videollamada está llena (máximo 8 personas).'));
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } });
    } catch {
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); toast(t('No se pudo usar la cámara; la llamada será solo de voz.')); } catch { return toast(t('Permite el acceso al micrófono y a la cámara para llamar.')); }
    }
    await ctx.ensureIce?.();
    call = { w, stream, peers: new Map(), micOn: true, camOn: !!stream.getVideoTracks()[0], startedAt: Date.now() };
    w.inCall = true;
    ctx.retrack(w); // la presencia anuncia que estamos en la llamada
    showUI();
    call.timer = setInterval(updateTimer, 1000);
    renderBanner(w);
    syncPeers(w);
  }
  function leave() {
    if (!call) return;
    const w = call.w;
    w.rt?.send({ type: 'broadcast', event: 'gc', payload: { to: '*', from: state.clientId, bye: true } });
    clearInterval(call.timer);
    call.peers.forEach((p) => p.pc.close());
    call.stream.getTracks().forEach((tr) => tr.stop());
    call = null;
    w.inCall = false;
    if (w.rt) ctx.retrack(w);
    document.querySelector('.call-overlay.group')?.remove();
    renderBanner(w);
  }

  /* ---------------- Conexiones con cada participante ---------------- */
  /** Llamado cuando cambia la presencia del canal: conecta con quien entra y suelta a quien sale. */
  function syncPeers(w) {
    renderBanner(w);
    if (!isActiveIn(w)) return;
    const inCall = new Set(participants(w).filter((p) => !p.me).map((p) => p.cid));
    for (const cid of inCall) if (!call.peers.has(cid)) connect(cid);
    const inChannel = new Set(w.people.keys());
    for (const [cid, p] of call.peers) {
      // Se suelta a quien salió de la llamada (con margen para conexiones recién creadas)
      const gone = !inChannel.has(cid) || (!inCall.has(cid) && Date.now() - p.created > 10000);
      if (gone) { p.pc.close(); call.peers.delete(cid); }
    }
    renderTiles();
  }
  /*
   * En cada pareja solo uno inicia (el de identificador menor): crea los canales de
   * audio y vídeo y envía la oferta. El otro responde enchufando sus pistas en esos
   * mismos canales. Así nunca hay ofertas cruzadas ni canales duplicados.
   */
  const localTrack = (kind) => (kind === 'video' ? (call.camOn ? call.stream.getVideoTracks()[0] : null) : call.stream.getAudioTracks()[0]) || null;
  function connect(cid) {
    const pc = new RTCPeerConnection({ iceServers: iceServers() });
    const offerer = state.clientId < cid;
    const peer = { cid, pc, offerer, remote: new MediaStream(), created: Date.now(), pendingIce: [] };
    call.peers.set(cid, peer);
    pc.onicecandidate = ({ candidate }) => candidate && send(cid, { candidate });
    pc.ontrack = ({ track }) => {
      peer.remote.getTracks().filter((x) => x.kind === track.kind).forEach((x) => peer.remote.removeTrack(x));
      peer.remote.addTrack(track);
      track.onmute = track.onunmute = renderTiles;
      renderTiles();
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' && peer.offerer) offer(peer, true);
      renderTiles();
    };
    if (offerer) {
      for (const kind of ['audio', 'video']) pc.addTransceiver(kind, { direction: 'sendrecv' }).sender.replaceTrack(localTrack(kind));
      offer(peer);
    }
  }
  async function offer(peer, iceRestart = false) {
    try {
      await peer.pc.setLocalDescription(await peer.pc.createOffer({ iceRestart }));
      send(peer.cid, { description: peer.pc.localDescription });
    } catch { /* la conexión se cerró */ }
  }
  function send(to, data) {
    call?.w.rt?.send({ type: 'broadcast', event: 'gc', payload: { to, from: state.clientId, ...data } });
  }
  function dropPeer(cid) {
    const p = call?.peers.get(cid);
    if (!p) return;
    p.pc.close();
    call.peers.delete(cid);
    renderTiles();
  }
  /** Señalización recibida por el canal. */
  async function onSignal(w, msg) {
    if (!isActiveIn(w) || !msg.from || msg.from === state.clientId) return;
    if (msg.bye) return dropPeer(msg.from);
    if (msg.to !== state.clientId) return;
    let peer = call.peers.get(msg.from);
    if (!peer) {
      // Puede llegar la señal antes que la actualización de presencia: basta con que esté en el canal
      if (!w.people.has(msg.from)) return;
      connect(msg.from);
      peer = call.peers.get(msg.from);
    }
    const pc = peer.pc;
    try {
      if (msg.description) {
        if (msg.description.type === 'offer' && peer.offerer) return; // no debería pasar: el iniciador es fijo
        await pc.setRemoteDescription(msg.description);
        for (const c of peer.pendingIce.splice(0)) pc.addIceCandidate(c).catch(() => {});
        if (msg.description.type === 'offer') {
          // Enchufamos nuestras pistas en los canales que creó el otro
          for (const tr of pc.getTransceivers()) {
            tr.direction = 'sendrecv';
            await tr.sender.replaceTrack(localTrack(tr.receiver.track.kind));
          }
          await pc.setLocalDescription(await pc.createAnswer());
          send(msg.from, { description: pc.localDescription });
        }
      } else if (msg.candidate) {
        if (!pc.remoteDescription) peer.pendingIce.push(msg.candidate);
        else await pc.addIceCandidate(msg.candidate).catch(() => {});
      }
    } catch { /* se ignora: se reintenta si falla la conexión */ }
  }

  /* ---------------- Pantalla de la llamada ---------------- */
  function showUI() {
    if (document.querySelector('.call-overlay.group')) return;
    const el = document.createElement('div');
    el.className = 'call-overlay group';
    el.innerHTML = `<header class="gc-head">${icon('video')}<b class="ugc">${esc(call.w.name)}</b><span class="gc-time">0:00</span></header>
      <div class="gc-grid" id="gc-grid"></div>
      <div class="call-controls">
        <button class="round" data-gc="mic" title="Micrófono">${icon('mic')}</button>
        <button class="round" data-gc="cam" title="Cámara">${icon('video')}</button>
        <button class="round" data-gc="min" title="Volver al chat">${icon('message')}</button>
        <button class="round red" data-gc="leave" title="Salir de la llamada">${icon('phone-off')}</button>
      </div>`;
    document.body.appendChild(el);
    el.onclick = (e) => {
      const a = e.target.closest('[data-gc]')?.dataset.gc;
      if (!a || !call) return;
      if (a === 'leave') leave();
      if (a === 'mic') { call.micOn = !call.micOn; call.stream.getAudioTracks().forEach((tr) => (tr.enabled = call.micOn)); renderControls(); }
      if (a === 'cam') {
        // Con la cámara apagada no se envía vídeo: los demás ven el avatar en lugar de una imagen negra
        call.camOn = !call.camOn;
        const vt = call.stream.getVideoTracks()[0];
        if (vt) vt.enabled = call.camOn;
        call.peers.forEach((p) => p.pc.getTransceivers().filter((tr) => tr.receiver.track.kind === 'video').forEach((tr) => tr.sender.replaceTrack(call.camOn ? vt : null)));
        renderControls(); renderTiles();
      }
      if (a === 'min') { el.classList.add('minimized'); }
    };
    el.querySelector('.gc-head').onclick = () => el.classList.remove('minimized');
    renderTiles();
    renderControls();
  }
  function renderControls() {
    const el = document.querySelector('.call-overlay.group');
    if (!el || !call) return;
    const mic = el.querySelector('[data-gc="mic"]'); mic.innerHTML = icon(call.micOn ? 'mic' : 'mic-off'); mic.classList.toggle('off', !call.micOn);
    const cam = el.querySelector('[data-gc="cam"]'); cam.innerHTML = icon(call.camOn ? 'video' : 'video-off'); cam.classList.toggle('off', !call.camOn);
    cam.disabled = !call.stream.getVideoTracks().length;
  }
  function updateTimer() {
    const el = document.querySelector('.call-overlay.group .gc-time');
    if (el && call) { const s = Math.round((Date.now() - call.startedAt) / 1000); el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} · ${call.peers.size + 1}`; }
    renderTiles();
  }
  function tileHtml(id, nick, me) {
    return `<div class="gc-tile" data-tile="${id}"><video autoplay playsinline muted></video>${me ? '' : '<audio autoplay></audio>'}<div class="gc-av">${avatar(nick)}</div><span class="gc-name"><span class="ugc">${esc(nick)}</span>${me ? ` (${esc(t('tú'))})` : ''}</span><span class="gc-state"></span></div>`;
  }
  function renderTiles() {
    const grid = document.getElementById('gc-grid');
    if (!grid || !call) return;
    const wanted = [['me', state.nick, true, call.stream, call.camOn], ...[...call.peers.values()].map((p) => {
      const person = call.w.people.get(p.cid);
      const vt = p.remote.getVideoTracks()[0];
      return [p.cid, person?.nick || '…', false, p.remote, !!(vt && !vt.muted && vt.readyState === 'live'), p.pc.connectionState];
    })];
    const ids = new Set(wanted.map((x) => x[0]));
    grid.querySelectorAll('[data-tile]').forEach((tile) => { if (!ids.has(tile.dataset.tile)) tile.remove(); });
    for (const [id, nick, me, stream, hasVideo, connState] of wanted) {
      let tile = grid.querySelector(`[data-tile="${CSS.escape(id)}"]`);
      if (!tile) { grid.insertAdjacentHTML('beforeend', tileHtml(id, nick, me)); tile = grid.lastElementChild; }
      const v = tile.querySelector('video');
      if (v.srcObject !== stream) { v.srcObject = stream; v.onresize = v.onplaying = renderTiles; v.play().catch(() => {}); }
      if (v.paused) v.play().catch(() => {});
      const au = tile.querySelector('audio');
      if (au && au.srcObject !== stream) { au.srcObject = stream; au.play().catch(() => {}); } else if (au?.paused) au.play().catch(() => {});
      tile.classList.toggle('has-video', me ? hasVideo : hasVideo || v.videoWidth > 0);
      tile.classList.toggle('me', me);
      tile.querySelector('.gc-state').textContent = me || !connState || connState === 'connected' ? '' : connState === 'failed' ? '⚠️' : '…';
    }
    grid.dataset.n = Math.min(wanted.length, 9);
  }

  window.__gcDebug = () => call && [...call.peers.values()].map((p) => ({ cid: p.cid.slice(0, 6), offerer: p.offerer, pc: p.pc.connectionState, sig: p.pc.signalingState, ice: p.pc.iceConnectionState, tracks: p.remote.getTracks().map((x) => x.kind + (x.muted ? '(muted)' : '')) }));
  return {
    join, leave, onSignal, syncPeers, renderBanner,
    inCall: (w) => isActiveIn(w),
    onLeaveChannel: (w) => { if (isActiveIn(w)) leave(); },
  };
}
