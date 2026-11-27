/*
 * Herramientas dentro de un privado: ta-te-ti, pizarra compartida y ubicación.
 * Todo viaja por la conexión directa cifrada (mensajes { t: 'tool', k: … }) y nada se guarda
 * en servidores. Las crea dm.js (createTools) y las muestra como burbujas especiales.
 */
const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const COLORS = ['#e11d48', '#111827', '#2563eb', '#16a34a', '#f59e0b', '#ffffff'];
const LIVE_MS = 15 * 60 * 1000;

export function createTools(api) {
  const { state, sendJSON, addMessage, rerender, sysLine, esc, icon, t, toast } = api;
  const connected = (w) => w?.dc?.readyState === 'open' || (w?.relay && w.rt);
  const send = (w, obj) => sendJSON(w, { t: 'tool', ...obj });

  /* ================= Ta-te-ti ================= */
  function tttStart(w) {
    const id = crypto.randomUUID().slice(0, 12);
    addMessage(w, { mid: id, mine: true, kind: 'tool', tool: 'ttt', ts: Date.now(), g: { board: Array(9).fill(''), turn: 'X', me: 'X', winner: null } });
    send(w, { k: 'ttt', op: 'new', id });
  }
  function tttResult(b) {
    for (const [a, c, d] of LINES) if (b[a] && b[a] === b[c] && b[a] === b[d]) return { winner: b[a], line: [a, c, d] };
    return b.every(Boolean) ? { winner: 'draw' } : null;
  }
  function tttPlay(w, id, i, fromPeer) {
    const m = w.msgs.get(id);
    const g = m?.g;
    if (!g || g.winner || g.board[i]) return;
    const sym = fromPeer ? (g.me === 'X' ? 'O' : 'X') : g.me;
    if (g.turn !== sym) return;
    g.board[i] = sym;
    g.turn = sym === 'X' ? 'O' : 'X';
    const r = tttResult(g.board);
    if (r) { g.winner = r.winner; g.line = r.line || []; }
    rerender(w, id);
    if (!fromPeer) send(w, { k: 'ttt', op: 'move', id, i });
  }
  function tttHtml(w, m) {
    const g = m.g;
    const other = w.peer.nick;
    const status = g.winner === 'draw' ? t('Empate')
      : g.winner ? (g.winner === g.me ? t('¡Ganaste!') : t('Ganó {nick}', { nick: other }))
        : g.turn === g.me ? t('Tu turno') : t('Turno de {nick}', { nick: other });
    const cells = g.board.map((v, i) => `<button type="button" class="ttt-cell ${v ? 'v' + v : ''} ${g.line?.includes(i) ? 'win' : ''}" data-ttt="${m.mid}" data-i="${i}" ${v || g.winner || g.turn !== g.me ? 'disabled' : ''}>${v === 'X' ? '✕' : v === 'O' ? '◯' : ''}</button>`).join('');
    return `<div class="ttt"><b>🎮 ${esc(t('Ta-te-ti'))}</b><small>${esc(t('Juegas con {s}', { s: g.me === 'X' ? '✕' : '◯' }))} · ${esc(status)}</small>
      <div class="ttt-board">${cells}</div>${g.winner ? `<button type="button" class="btn small" data-ttt-again="${m.mid}">${esc(t('Revancha'))}</button>` : ''}</div>`;
  }

  /* ================= Pizarra compartida ================= */
  let wbWin = null; // ventana cuya pizarra está abierta
  let color = COLORS[0];
  function wbOpen(w, announce = true) {
    w.wb ||= [];
    document.querySelector('.wb-wrap')?.remove();
    wbWin = w;
    const wrap = document.createElement('div');
    wrap.className = 'wb-wrap';
    wrap.innerHTML = `<div class="wb">
      <div class="wb-bar"><b>🎨 ${esc(t('Pizarra con {nick}', { nick: w.peer.nick }))}</b>
        <span class="wb-colors">${COLORS.map((c) => `<button type="button" data-wb-color="${c}" style="background:${c}" class="${c === color ? 'on' : ''}"></button>`).join('')}</span>
        <button type="button" class="btn small" data-wb-clear>${esc(t('Borrar todo'))}</button>
        <button type="button" class="icon-btn" data-wb-close title="${esc(t('Cerrar'))}">${icon('x')}</button></div>
      <canvas></canvas></div>`;
    document.body.appendChild(wrap);
    const cv = wrap.querySelector('canvas');
    const fit = () => { const r = cv.getBoundingClientRect(); cv.width = r.width * devicePixelRatio; cv.height = r.height * devicePixelRatio; redraw(); };
    const ctx2 = cv.getContext('2d');
    const drawStroke = (s) => {
      if (!s.p?.length) return;
      ctx2.strokeStyle = s.c; ctx2.lineWidth = (s.w || 4) * devicePixelRatio; ctx2.lineCap = ctx2.lineJoin = 'round';
      ctx2.beginPath();
      s.p.forEach(([x, y], i) => (i ? ctx2.lineTo(x * cv.width, y * cv.height) : ctx2.moveTo(x * cv.width, y * cv.height)));
      if (s.p.length === 1) ctx2.lineTo(s.p[0][0] * cv.width + 0.1, s.p[0][1] * cv.height);
      ctx2.stroke();
    };
    function redraw() { ctx2.clearRect(0, 0, cv.width, cv.height); w.wb.forEach(drawStroke); }
    wrap.__redraw = redraw; wrap.__draw = drawStroke;
    fit(); addEventListener('resize', fit);
    let cur = null, last = 0;
    const pt = (e) => { const r = cv.getBoundingClientRect(); return [Math.round(((e.clientX - r.left) / r.width) * 1000) / 1000, Math.round(((e.clientY - r.top) / r.height) * 1000) / 1000]; };
    const flush = (end) => {
      if (!cur || cur.p.length < 1) return;
      send(w, { k: 'wb', op: 'stroke', s: { c: cur.c, w: cur.w, p: cur.p.slice(cur.sent) }, cont: cur.sent > 0 });
      cur.sent = cur.p.length - 1;
      if (end) cur = null;
    };
    cv.onpointerdown = (e) => { cv.setPointerCapture(e.pointerId); cur = { c: color, w: color === '#ffffff' ? 18 : 4, p: [pt(e)], sent: 0 }; w.wb.push(cur); drawStroke(cur); };
    cv.onpointermove = (e) => {
      if (!cur) return;
      cur.p.push(pt(e)); drawStroke({ ...cur, p: cur.p.slice(-2) });
      if (Date.now() - last > 120) { last = Date.now(); flush(false); }
    };
    cv.onpointerup = cv.onpointercancel = () => flush(true);
    wrap.onclick = (e) => {
      const c = e.target.closest('[data-wb-color]');
      if (c) { color = c.dataset.wbColor; wrap.querySelectorAll('[data-wb-color]').forEach((b) => b.classList.toggle('on', b === c)); }
      if (e.target.closest('[data-wb-clear]')) { w.wb = []; redraw(); send(w, { k: 'wb', op: 'clear' }); }
      if (e.target.closest('[data-wb-close]')) { wrap.remove(); wbWin = null; removeEventListener('resize', fit); }
    };
    if (announce) send(w, { k: 'wb', op: 'open' });
  }
  function wbStroke(w, s, cont) {
    if (!s || !Array.isArray(s.p)) return;
    const stroke = { c: COLORS.includes(s.c) ? s.c : COLORS[0], w: Math.min(30, Number(s.w) || 4), p: s.p.slice(0, 500).map(([x, y]) => [Math.min(1, Math.max(0, +x || 0)), Math.min(1, Math.max(0, +y || 0))]) };
    w.wb ||= [];
    const prev = cont ? w.wb[w.wb.length - 1] : null;
    if (prev && prev.peer) { prev.p.push(...stroke.p.slice(1)); } else { stroke.peer = true; w.wb.push(stroke); }
    const wrap = document.querySelector('.wb-wrap');
    if (wrap && wbWin === w) wrap.__draw(prev && prev.peer ? { ...prev, p: prev.p.slice(-stroke.p.length - 1) } : stroke);
  }

  /* ================= Ubicación ================= */
  const watches = new Map(); // id → watchId (ubicación en vivo que comparto)
  function locShare(w, live) {
    if (!navigator.geolocation) return toast(t('Este dispositivo no permite compartir la ubicación.'));
    const id = crypto.randomUUID().slice(0, 12);
    const until = live ? Date.now() + LIVE_MS : 0;
    let first = true, lastSent = 0;
    const onPos = (p) => {
      const loc = { lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6), acc: Math.round(p.coords.accuracy || 0), live, until };
      if (first) { first = false; addMessage(w, { mid: id, mine: true, kind: 'tool', tool: 'loc', ts: Date.now(), loc }); }
      else { const m = w.msgs.get(id); if (!m) return locStop(id); m.loc = loc; rerender(w, id); }
      if (Date.now() - lastSent > 8000 || !live) { lastSent = Date.now(); send(w, { k: 'loc', id, ...loc }); }
      if (live && Date.now() > until) locStop(id, w);
    };
    const onErr = () => { toast(t('No se pudo obtener tu ubicación. Revisa el permiso de ubicación.')); locStop(id); };
    if (live) watches.set(id, navigator.geolocation.watchPosition(onPos, onErr, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }));
    else navigator.geolocation.getCurrentPosition(onPos, onErr, { enableHighAccuracy: true, timeout: 20000 });
  }
  function locStop(id, w) {
    const wid = watches.get(id);
    if (wid != null) navigator.geolocation.clearWatch(wid);
    watches.delete(id);
    if (w) { const m = w.msgs.get(id); if (m) { m.loc.live = false; rerender(w, id); send(w, { k: 'loc', id, ...m.loc, live: false }); } }
  }
  function locIn(w, d) {
    const lat = Number(d.lat), lng = Number(d.lng);
    if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) return;
    const loc = { lat, lng, acc: Math.round(Number(d.acc) || 0), live: !!d.live, until: Number(d.until) || 0 };
    const id = String(d.id || '').replace(/[^\w-]/g, '').slice(0, 20);
    const m = w.msgs.get(id);
    if (m?.tool === 'loc') { m.loc = loc; rerender(w, id); return; }
    addMessage(w, { mid: id, mine: false, kind: 'tool', tool: 'loc', ts: Date.now(), loc });
  }
  /** Mapa de OpenStreetMap (gratis) con 3×3 baldosas alrededor del punto. */
  function mapHtml(lat, lng) {
    const z = 16, n = 2 ** z;
    const xf = ((lng + 180) / 360) * n;
    const yf = ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n;
    const tx = Math.floor(xf), ty = Math.floor(yf);
    const px = (xf - tx) * 256, py = (yf - ty) * 256;
    const W = 240, H = 150;
    const tiles = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) tiles.push(`<img alt="" loading="lazy" src="https://tile.openstreetmap.org/${z}/${tx + dx}/${ty + dy}.png" style="left:${(dx + 1) * 256}px;top:${(dy + 1) * 256}px">`);
    return `<div class="map" style="width:${W}px;height:${H}px"><div class="map-tiles" style="left:${W / 2 - (256 + px)}px;top:${H / 2 - (256 + py)}px">${tiles.join('')}</div><i class="map-pin">📍</i><small class="map-attr">© OpenStreetMap</small></div>`;
  }
  function locHtml(w, m) {
    const { lat, lng, acc, live, until } = m.loc;
    const left = live ? Math.max(0, Math.round((until - Date.now()) / 60000)) : 0;
    const url = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
    return `<div class="loc">${mapHtml(lat, lng)}
      <div class="loc-info"><b>📍 ${esc(t(live ? 'Ubicación en vivo' : 'Ubicación'))}</b><small>${live ? esc(t('Se actualiza · quedan {n} min', { n: left })) : esc(t('Precisión: {n} m', { n: acc }))}</small></div>
      <div class="loc-actions"><a href="${url}" target="_blank" rel="noopener" class="btn small">${esc(t('Abrir el mapa'))}</a>${m.mine && live ? `<button type="button" class="btn small danger" data-loc-stop="${m.mid}">${esc(t('Dejar de compartir'))}</button>` : ''}</div></div>`;
  }

  /* ================= Mensajes y burbujas ================= */
  function onData(w, m) {
    if (m.k === 'ttt') {
      const id = String(m.id || '').replace(/[^\w-]/g, '').slice(0, 20);
      if (m.op === 'new' && id && !w.msgs.has(id)) addMessage(w, { mid: id, mine: false, kind: 'tool', tool: 'ttt', ts: Date.now(), g: { board: Array(9).fill(''), turn: 'X', me: 'O', winner: null } });
      if (m.op === 'move') tttPlay(w, id, Math.max(0, Math.min(8, Number(m.i) || 0)), true);
    }
    if (m.k === 'wb') {
      if (m.op === 'open' && wbWin !== w) sysLine(w, `🎨 <b>${esc(w.peer.nick)}</b> ${esc(t('abrió una pizarra para dibujar juntos.'))} <button type="button" class="link" data-wb-open="${esc(w.key)}">${esc(t('Abrir pizarra'))}</button>`);
      if (m.op === 'stroke') wbStroke(w, m.s, !!m.cont);
      if (m.op === 'clear') { w.wb = []; if (wbWin === w) document.querySelector('.wb-wrap')?.__redraw(); }
    }
    if (m.k === 'loc') locIn(w, m);
  }
  function bubble(w, m) { return m.tool === 'ttt' ? tttHtml(w, m) : m.tool === 'loc' ? locHtml(w, m) : ''; }

  document.addEventListener('click', (e) => {
    const w = state.windows.get(state.active);
    const cell = e.target.closest('[data-ttt]');
    if (cell && w) return tttPlay(w, cell.dataset.ttt, Number(cell.dataset.i), false);
    if (e.target.closest('[data-ttt-again]') && w) return connected(w) ? tttStart(w) : toast(t('Para jugar tienen que estar conectados.'));
    const wb = e.target.closest('[data-wb-open]');
    if (wb) { const ww = state.windows.get(wb.dataset.wbOpen); if (ww) wbOpen(ww, false); return; }
    const stop = e.target.closest('[data-loc-stop]');
    if (stop && w) return locStop(stop.dataset.locStop, w);
  });

  /** Menú «+» del privado. */
  function openMenu(w, anchor) {
    document.querySelector('.dm-tools')?.remove();
    if (!connected(w)) return toast(t('Estas herramientas necesitan que estén conectados.'));
    const box = document.createElement('div');
    box.className = 'dm-tools';
    box.innerHTML = [
      ['ttt', '🎮', 'Ta-te-ti'], ['wb', '🎨', 'Pizarra'], ['loc', '📍', 'Mi ubicación'], ['live', '📡', 'Ubicación en vivo (15 min)'], ['buzz', '📳', 'Zumbido'],
    ].map(([k, e, l]) => `<button type="button" data-tool="${k}"><span>${e}</span>${esc(t(l))}</button>`).join('');
    (anchor?.closest('form') || document.body).appendChild(box);
    const close = (ev) => { if (!box.contains(ev.target) && ev.target !== anchor) { box.remove(); document.removeEventListener('pointerdown', close, true); } };
    setTimeout(() => document.addEventListener('pointerdown', close, true), 0);
    box.onclick = (ev) => {
      const b = ev.target.closest('[data-tool]');
      if (!b) return;
      box.remove();
      const k = b.dataset.tool;
      if (k === 'ttt') tttStart(w);
      if (k === 'wb') wbOpen(w);
      if (k === 'loc') locShare(w, false);
      if (k === 'live') locShare(w, true);
      if (k === 'buzz') api.sendBuzz(w);
    };
  }

  return { onData, bubble, openMenu };
}
