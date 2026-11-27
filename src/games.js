/*
 * Juegos en privados y grupos: Cuatro en línea, Batalla naval, Generala, Basta (Tutti frutti)
 * y Dibujá y adiviná. Sin servidor de juegos: todo viaja cifrado como los mensajes
 * (privados: conexión directa; grupos: cifrado por dispositivo, solo a quien está conectado).
 *
 * • Partidas con anfitrión (quien la crea): las jugadas se le envían, las valida y reparte el
 *   estado a todos ({ op: 'st' }). Así no hay jugadas cruzadas en los grupos.
 * • Generala: los dados salen de una semilla que el anfitrión fija (y publica su huella) al empezar
 *   y revela al terminar: todos comprueban que no los tocó.
 * • Batalla naval: sin anfitrión; cada uno guarda su flota en su dispositivo y responde a los
 *   disparos; al final se muestran las flotas y se comprueba que nadie mintió.
 * • Dibujá y adiviná: la palabra solo la conoce quien dibuja; las respuestas le llegan solo a él.
 *
 * api: { state, send(w, obj, opts), addMessage, rerender, esc, icon, t, toast, me(w), nickOf(w, id), sysLine }
 */
const rnd = (n) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
const uid = () => crypto.randomUUID().slice(0, 12);
const clean = (v, n = 20) => String(v ?? '').replace(/[^\w-]/g, '').slice(0, n);
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha = async (s) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));

export const GAME_LIST = [
  { type: 'c4', emoji: '🔴', name: 'Cuatro en línea', min: 2, max: 2 },
  { type: 'bn', emoji: '🚢', name: 'Batalla naval', min: 2, max: 2, dmOnly: true },
  { type: 'gen', emoji: '🎲', name: 'Generala', min: 1, max: 6 },
  { type: 'basta', emoji: '✍️', name: 'Basta (Tutti frutti)', min: 2, max: 10 },
  { type: 'dg', emoji: '🖍️', name: 'Dibujá y adiviná', min: 2, max: 10 },
];
const META = Object.fromEntries(GAME_LIST.map((g) => [g.type, g]));

export function createGames(api) {
  const { state, addMessage, rerender, esc, icon, t, toast } = api;
  const send = (w, obj, opts) => api.send(w, { t: 'tool', k: 'game', ...obj }, opts);
  const me = (w) => String(api.me(w));
  const nick = (w, id) => api.nickOf(w, String(id)) || '?';
  const games = new Map(); // id → { w, s (estado), local (solo mío) }
  const isHost = (gm) => gm.s.host === me(gm.w);
  const pidx = (s, id) => s.players.findIndex((p) => p.id === String(id));

  /* ================= Crear / sincronizar ================= */
  async function create(w, type) {
    const m = META[type];
    if (!m) return;
    const id = uid();
    if (type === 'bn') return bnCreate(w, id);
    const s = { type, host: me(w), phase: 'lobby', players: [{ id: me(w) }], v: 0 };
    if (w.via !== 'group') s.max = 2; // en un privado juegan los dos
    const gm = { w, s, local: {} };
    games.set(id, gm);
    addMessage(w, { mid: id, mine: true, kind: 'tool', tool: 'game', ts: Date.now() });
    broadcast(gm, id);
  }
  function broadcast(gm, id) {
    gm.s.v++;
    if (gm.s.type === 'dg') { gm.s.left = gm.s.endsAt ? Math.max(0, gm.s.endsAt - Date.now()) : 0; gm.local.deadline = gm.s.endsAt || 0; }
    send(gm.w, { op: 'st', id, s: stripSecret(gm.s) }, { live: true });
    paint(gm, id);
  }
  /** La semilla de la Generala no sale del anfitrión hasta el final. */
  function stripSecret(s) { if (!('_seed' in s)) return s; const { _seed, ...rest } = s; return rest; }
  function paint(gm, id) {
    rerender(gm.w, id);
    restoreDrafts(gm, id);
    if (gm.s.type === 'dg') dgSync(gm, id);
    afterState(gm, id);
  }
  /** Cuando alguien dice «¡Basta!», cada jugador envía lo que tenga escrito. */
  function afterState(gm, id) {
    const s = gm.s, myId = me(gm.w);
    if (s.type === 'basta' && s.phase === 'collect' && pidx(s, myId) >= 0 && s.stopBy !== myId && gm.local.sent !== s.round) {
      gm.local.sent = s.round;
      act(id, { do: 'answers', ans: myAnswers(gm) });
    }
  }
  /** Una jugada mía: si soy anfitrión la aplico; si no, se la mando. */
  function act(id, a) {
    const gm = games.get(id);
    if (!gm) return;
    if (isHost(gm)) return apply(gm, id, a, me(gm.w));
    send(gm.w, { op: 'act', id, a }, { live: true, to: gm.w.via === 'group' ? gm.s.host : undefined });
  }
  async function apply(gm, id, a, by) {
    const s = gm.s;
    by = String(by);
    // Sala de espera (común a todos)
    if (a.do === 'join' && s.phase === 'lobby' && pidx(s, by) < 0 && s.players.length < (s.max || META[s.type].max)) s.players.push({ id: by });
    else if (a.do === 'leave' && s.phase === 'lobby' && by !== s.host) s.players = s.players.filter((p) => p.id !== by);
    else if (a.do === 'start' && by === s.host && s.phase === 'lobby' && s.players.length >= META[s.type].min) await START[s.type](s);
    else if (pidx(s, by) >= 0 && s.phase !== 'lobby') { if ((await REDUCE[s.type](s, a, by, gm, id)) === false) return; }
    else return;
    broadcast(gm, id);
  }
  /** Mensajes de juego que llegan (from: quien lo envía, ya comprobado por dm.js/groups.js). */
  function onData(w, m, from) {
    from = String(from);
    const id = clean(m.id);
    if (!id) return;
    if (m.op && m.op.startsWith('bn-')) return bnIn(w, id, m, from);
    if (m.op === 'dg-stroke' || m.op === 'dg-clear') return dgStrokeIn(id, m, from);
    if (m.op === 'dg-guess') return dgGuessIn(id, m, from);
    const gm = games.get(id);
    if (m.op === 'st' && m.s && typeof m.s === 'object' && META[m.s.type]) {
      if (String(m.s.host) !== from) return; // solo el anfitrión reparte el estado
      if (gm && gm.s.v >= m.s.v) return;
      const s = sanitize(m.s);
      if (gm) { gm.s = s; if (s.type === 'dg') gm.local.deadline = Date.now() + (Number(s.left) || 0); paint(gm, id); return; }
      const ngm = { w, s, local: {} };
      if (s.type === 'dg') ngm.local.deadline = Date.now() + (Number(s.left) || 0);
      games.set(id, ngm);
      addMessage(w, { mid: id, mine: false, kind: 'tool', tool: 'game', ts: Date.now() });
      if (s.type === 'dg') dgSync(ngm, id);
      return;
    }
    if (m.op === 'act' && gm && isHost(gm) && m.a && typeof m.a === 'object') apply(gm, id, m.a, from);
  }
  /** Límites básicos al estado que llega (es de otra persona). */
  function sanitize(s) {
    s.players = (Array.isArray(s.players) ? s.players : []).slice(0, 10).map((p) => ({ ...p, id: clean(p.id, 40) }));
    s.v = Number(s.v) || 0;
    s.host = clean(s.host, 40);
    return s;
  }

  /* ================= Comienzo y jugadas de cada juego ================= */
  const START = {
    async c4(s) { s.phase = 'play'; s.board = Array(42).fill(-1); s.turn = 0; s.winner = null; },
    async gen(s) {
      s.phase = 'play';
      s.seedSecret = null;
      const seed = hex(crypto.getRandomValues(new Uint8Array(16)));
      s.commit = await sha(seed);
      s._seed = seed; // solo en el anfitrión (se quita al repartir)
      s.turn = 0; s.round = 1; s.dice = [0, 0, 0, 0, 0]; s.rolls = 0; s.rollNo = 0; s.log = [];
      s.sheet = Object.fromEntries(s.players.map((p) => [p.id, {}]));
    },
    async basta(s) { s.phase = 'write'; s.round = (s.round || 0) + 1; s.letter = LETTERS[rnd(LETTERS.length)]; s.answers = {}; s.scores ||= {}; s.stopBy = null; s.cats ||= CATS; },
    async dg(s) {
      s.phase = 'choose'; s.order = s.players.map((p) => p.id); s.drawer = 0; s.turns = s.players.length <= 3 ? 2 : 1;
      s.turnNo = 0; s.scores = Object.fromEntries(s.order.map((id) => [id, 0])); s.guessed = []; s.word = ''; s.hint = ''; s.endsAt = 0;
    },
  };
  const REDUCE = {
    async c4(s, a, by) {
      if (s.phase !== 'play' || a.do !== 'drop') return false;
      const p = pidx(s, by);
      if (p !== s.turn) return false;
      const col = Math.max(0, Math.min(6, Number(a.col) || 0));
      let row = -1;
      for (let r = 5; r >= 0; r--) if (s.board[r * 7 + col] < 0) { row = r; break; }
      if (row < 0) return false;
      s.board[row * 7 + col] = p;
      const line = c4Win(s.board, row, col, p);
      if (line) { s.phase = 'end'; s.winner = p; s.line = line; }
      else if (s.board.every((v) => v >= 0)) { s.phase = 'end'; s.winner = -1; }
      else s.turn = 1 - s.turn;
    },
    async gen(s, a, by) {
      if (s.phase !== 'play' || s.players[s.turn]?.id !== by) return false;
      if (a.do === 'roll') {
        if (s.rolls >= 3) return false;
        const held = s.rolls ? (Array.isArray(a.held) ? a.held.slice(0, 5).map(Boolean) : []) : [];
        const fresh = await genDice(s._seed, s.rollNo++);
        s.dice = s.dice.map((d, i) => (held[i] ? d : fresh[i]));
        s.rolls++;
        s.log.push(s.dice.join(''));
        return;
      }
      if (a.do === 'score') {
        const cat = String(a.cat);
        const sheet = s.sheet[by];
        if (!s.rolls || !GEN_CATS.includes(cat) || sheet[cat] != null) return false;
        if (cat === 'D' && sheet.G !== 50 && !genIsGenerala(s.dice)) return false;
        const pts = genScore(s.dice, cat, s.rolls === 1, sheet);
        sheet[cat] = pts;
        if (cat === 'G' && pts && s.rolls === 1) { s.phase = 'end'; s.winner = by; s.servida = true; return genReveal(s); } // generala servida: gana
        // siguiente jugador
        s.rolls = 0; s.dice = [0, 0, 0, 0, 0];
        s.turn = (s.turn + 1) % s.players.length;
        if (s.turn === 0) s.round++;
        if (s.players.every((p) => GEN_CATS.every((c) => s.sheet[p.id][c] != null))) {
          s.phase = 'end';
          const tot = s.players.map((p) => [p.id, genTotal(s.sheet[p.id])]).sort((x, y) => y[1] - x[1]);
          s.winner = tot[0][0];
          return genReveal(s);
        }
      }
    },
    async basta(s, a, by, gm, id) {
      if (a.do === 'basta' && s.phase === 'write') {
        s.phase = 'collect'; s.stopBy = by;
        if (a.ans) s.answers[by] = cleanAnswers(a.ans, s.cats);
        setTimeout(() => { const g = games.get(id); if (g?.s.phase === 'collect') { bastaScore(g.s); broadcast(g, id); } }, 6000);
        return;
      }
      if (a.do === 'answers' && (s.phase === 'collect' || s.phase === 'write')) {
        s.answers[by] = cleanAnswers(a.ans, s.cats);
        if (s.phase === 'collect' && s.players.every((p) => s.answers[p.id])) bastaScore(s);
        return;
      }
      if (a.do === 'veto' && s.phase === 'score' && by === s.host) { // el anfitrión anula una respuesta
        const key = clean(a.p, 40) + '|' + Math.max(0, Math.min(20, Number(a.c) || 0));
        s.veto ||= {};
        s.veto[key] = !s.veto[key];
        bastaScore(s);
        return;
      }
      if (a.do === 'next' && s.phase === 'score' && by === s.host) {
        for (const [p, pts] of Object.entries(s.roundPts || {})) s.scores[p] = (s.scores[p] || 0) + pts;
        s.roundPts = {}; s.veto = {};
        await START.basta(s);
        return;
      }
      return false;
    },
    async dg(s, a, by, gm, id) {
      const drawer = s.order[s.drawer];
      if (a.do === 'chosen' && s.phase === 'choose' && by === drawer) {
        s.phase = 'draw'; s.hint = String(a.hint || '').slice(0, 60); s.guessed = []; s.endsAt = Date.now() + DG_TIME;
        clearTimeout(gm.local.timer);
        gm.local.timer = setTimeout(() => { const g = games.get(id); if (g?.s.phase === 'draw') { g.s.phase = 'reveal'; g.s.endsAt = 0; broadcast(g, id); } }, DG_TIME);
        return;
      }
      if (a.do === 'hit' && s.phase === 'draw' && by === drawer) { // quien dibuja confirma un acierto
        const who = clean(a.who, 40);
        if (!s.order.includes(who) || who === drawer || s.guessed.includes(who)) return false;
        s.guessed.push(who);
        s.scores[who] += Math.max(2, 10 - 2 * (s.guessed.length - 1));
        s.scores[drawer] += 3;
        if (s.guessed.length >= s.order.length - 1) { s.phase = 'reveal'; s.endsAt = 0; clearTimeout(gm.local.timer); }
        return;
      }
      if (a.do === 'word' && s.phase === 'reveal' && by === drawer) {
        s.word = String(a.word || '').slice(0, 40);
        clearTimeout(gm.local.timer);
        gm.local.timer = setTimeout(() => { const g = games.get(id); if (g?.s.phase === 'reveal') { dgNext(g.s); broadcast(g, id); } }, 4000);
        return;
      }
      if (a.do === 'skip' && by === s.host && (s.phase === 'reveal' || s.phase === 'choose')) { clearTimeout(gm.local.timer); dgNext(s); return; }
      return false;
    },
  };

  /* ================= Cuatro en línea ================= */
  function c4Win(b, r, c, p) {
    for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
      const cells = [[r, c]];
      for (const k of [1, -1]) {
        let rr = r + dr * k, cc = c + dc * k;
        while (rr >= 0 && rr < 6 && cc >= 0 && cc < 7 && b[rr * 7 + cc] === p) { cells.push([rr, cc]); rr += dr * k; cc += dc * k; }
      }
      if (cells.length >= 4) return cells.map(([x, y]) => x * 7 + y);
    }
    return null;
  }
  function c4Html(w, id, s) {
    const mine = pidx(s, me(w));
    const name = (i) => (s.players[i]?.id === me(w) ? t('Tú') : nick(w, s.players[i]?.id));
    const status = s.phase === 'end' ? (s.winner < 0 ? t('Empate') : s.winner === mine ? t('¡Ganaste!') : t('Ganó {nick}', { nick: name(s.winner) }))
      : s.turn === mine ? t('Tu turno') : t('Turno de {nick}', { nick: name(s.turn) });
    const can = s.phase === 'play' && s.turn === mine;
    const cells = s.board.map((v, i) => `<i class="c4-cell ${v === 0 ? 'p0' : v === 1 ? 'p1' : ''} ${s.line?.includes(i) ? 'win' : ''}"></i>`).join('');
    const cols = can ? `<div class="c4-cols">${Array.from({ length: 7 }, (_, c) => `<button type="button" data-g-act="${id}" data-a='{"do":"drop","col":${c}}' aria-label="${c + 1}"></button>`).join('')}</div>` : '';
    return `<div class="c4-head"><span class="c4-chip p0"></span><span class="ugc">${esc(name(0))}</span> vs <span class="c4-chip p1"></span><span class="ugc">${esc(name(1))}</span></div>
      <small class="g-status">${esc(status)}</small><div class="c4-board">${cells}${cols}</div>`;
  }

  /* ================= Generala ================= */
  const GEN_CATS = ['1', '2', '3', '4', '5', '6', 'E', 'F', 'P', 'G', 'D'];
  const GEN_NAMES = { 1: '1', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', E: 'Escalera', F: 'Full', P: 'Póker', G: 'Generala', D: 'Doble generala' };
  async function genDice(seed, n) {
    const out = [];
    let k = 0;
    while (out.length < 5) {
      const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${seed}:${n}:${k++}`)));
      for (const b of bytes) { if (b < 252 && out.length < 5) out.push((b % 6) + 1); }
    }
    return out;
  }
  const counts = (d) => d.reduce((a, x) => ((a[x] = (a[x] || 0) + 1), a), {});
  const genIsGenerala = (d) => d[0] && d.every((x) => x === d[0]);
  function genScore(d, cat, servida, sheet) {
    const c = counts(d), vals = Object.values(c).sort((a, b) => b - a);
    const sorted = [...new Set(d)].sort().join('');
    if ('123456'.includes(cat)) return Number(cat) * (c[cat] || 0);
    if (cat === 'E') return ['12345', '23456', '13456'].includes(sorted) && d.length === 5 && new Set(d).size === 5 ? 20 + (servida ? 5 : 0) : 0;
    if (cat === 'F') return vals[0] === 3 && vals[1] === 2 ? 30 + (servida ? 5 : 0) : 0;
    if (cat === 'P') return vals[0] >= 4 ? 40 + (servida ? 5 : 0) : 0;
    if (cat === 'G') return vals[0] === 5 ? 50 : 0;
    if (cat === 'D') return vals[0] === 5 && sheet.G === 50 ? 100 : 0;
    return 0;
  }
  const genTotal = (sh) => GEN_CATS.reduce((a, c) => a + (sh[c] || 0), 0);
  async function genReveal(s) { s.seed = s._seed; }
  const DIE = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
  function genHtml(w, id, s, gm) {
    const myId = me(w), cur = s.players[s.turn];
    const myTurn = s.phase === 'play' && cur?.id === myId;
    gm.local.held ||= [false, false, false, false, false];
    if (!myTurn || !s.rolls) gm.local.held = [false, false, false, false, false];
    const name = (p) => (p.id === myId ? t('Tú') : nick(w, p.id));
    const status = s.phase === 'end'
      ? (s.servida ? t('¡Generala servida! Ganó {nick}', { nick: name(s.players[pidx(s, s.winner)]) }) : t('Ganó {nick}', { nick: name(s.players[pidx(s, s.winner)]) }))
      : myTurn ? t('Tu turno · tirada {n} de 3', { n: s.rolls }) : t('Turno de {nick}', { nick: name(cur) });
    const dice = s.dice.map((d, i) => `<button type="button" class="die ${gm.local.held[i] ? 'held' : ''}" data-g-hold="${id}" data-i="${i}" ${myTurn && s.rolls && s.rolls < 3 ? '' : 'disabled'}>${d ? DIE[d] : '·'}</button>`).join('');
    const head = s.players.map((p) => `<th class="ugc ${p.id === cur?.id && s.phase === 'play' ? 'cur' : ''}">${esc(name(p).slice(0, 8))}</th>`).join('');
    const rows = GEN_CATS.map((c) => `<tr><td>${esc(t(GEN_NAMES[c]))}</td>${s.players.map((p) => {
      const v = s.sheet[p.id]?.[c];
      if (v != null) return `<td class="${v ? '' : 'zero'}">${v || '✕'}</td>`;
      if (myTurn && p.id === myId && s.rolls && !(c === 'D' && s.sheet[p.id].G !== 50)) {
        const pts = genScore(s.dice, c, s.rolls === 1, s.sheet[p.id]);
        return `<td><button type="button" class="gen-pick ${pts ? '' : 'zero'}" data-g-act="${id}" data-a='{"do":"score","cat":"${c}"}'>${pts || '✕'}</button></td>`;
      }
      return '<td></td>';
    }).join('')}</tr>`).join('');
    const totals = `<tr class="tot"><td>${esc(t('Total'))}</td>${s.players.map((p) => `<td>${genTotal(s.sheet[p.id] || {})}</td>`).join('')}</tr>`;
    let verify = '';
    if (s.phase === 'end' && s.seed) verify = `<small class="g-verify" data-g-verify="${id}">${esc(t('Comprobando los dados…'))}</small>`;
    return `<small class="g-status">${esc(status)}</small>
      <div class="gen-dice">${dice}</div>
      ${myTurn && s.rolls < 3 ? `<button type="button" class="btn small primary" data-g-roll="${id}">🎲 ${esc(t(s.rolls ? 'Volver a tirar' : 'Tirar'))}</button>` : ''}
      ${myTurn && s.rolls ? `<small class="muted">${esc(t('Tocá los dados que querés guardar y elegí dónde anotar.'))}</small>` : ''}
      <table class="gen-sheet"><tr><th></th>${head}</tr>${rows}${totals}</table>${verify}`;
  }
  /** Al terminar: todos comprueban que los dados salieron de la semilla anunciada. */
  async function genVerify(id) {
    const gm = games.get(id);
    const el = document.querySelector(`[data-g-verify="${id}"]`);
    if (!gm || !el || gm.local.verified !== undefined) { if (el && gm?.local.verified !== undefined) el.textContent = gm.local.verified; return; }
    const s = gm.s;
    let ok = (await sha(s.seed)) === s.commit;
    // Se rehacen las tiradas: cada dado nuevo tiene que coincidir con la semilla
    if (ok) {
      let prev = [0, 0, 0, 0, 0];
      for (let n = 0; n < s.log.length && ok; n++) {
        const fresh = await genDice(s.seed, n), now = s.log[n].split('').map(Number);
        ok = now.every((d, i) => d === prev[i] || d === fresh[i]);
        prev = now;
      }
    }
    gm.local.verified = ok ? '✓ ' + t('Dados verificados: nadie los tocó.') : '⚠ ' + t('Los dados no coinciden con la semilla.');
    el.textContent = gm.local.verified;
  }

  /* ================= Basta (Tutti frutti) ================= */
  const LETTERS = 'ABCDEFGHIJLMNOPRSTUV'.split('');
  const CATS = ['Nombre', 'Apellido', 'País o ciudad', 'Animal', 'Color', 'Fruta o verdura', 'Cosa'];
  const cleanAnswers = (ans, cats) => (Array.isArray(ans) ? ans : []).slice(0, cats.length).map((x) => String(x || '').slice(0, 40));
  function bastaScore(s) {
    s.phase = 'score';
    const L = norm(s.letter);
    s.roundPts = {}; s.cellPts = {};
    s.cats.forEach((_, c) => {
      const valid = s.players.map((p) => {
        const a = norm(s.answers[p.id]?.[c]);
        const ok = a && a.startsWith(L) && a.length > 1 && !s.veto?.[p.id + '|' + c];
        return [p.id, ok ? a : null];
      });
      const good = valid.filter(([, a]) => a);
      for (const [pid, a] of valid) {
        let pts = 0;
        if (a) pts = good.length === 1 ? 20 : good.filter(([, b]) => b === a).length > 1 ? 5 : 10;
        s.cellPts[pid + '|' + c] = pts;
        s.roundPts[pid] = (s.roundPts[pid] || 0) + pts;
      }
    });
  }
  function bastaHtml(w, id, s, gm) {
    const myId = me(w);
    const name = (pid) => (pid === myId ? t('Tú') : nick(w, pid));
    const scores = s.players.map((p) => ({ p, total: (s.scores?.[p.id] || 0) + (s.phase === 'score' ? s.roundPts?.[p.id] || 0 : 0) })).sort((a, b) => b.total - a.total);
    const board = `<div class="g-scores">${scores.map((x) => `<span><b class="ugc">${esc(name(x.p.id))}</b> ${x.total}</span>`).join('')}</div>`;
    if (s.phase === 'write' || s.phase === 'collect') {
      const draft = gm.local.drafts?.[s.round] || [];
      const done = s.phase === 'collect';
      return `<div class="basta-letter">${esc(s.letter)}</div><small class="g-status">${esc(done ? t('¡{nick} dijo Basta! Juntando respuestas…', { nick: name(s.stopBy) }) : t('Ronda {n} · completá con la letra {l}', { n: s.round, l: s.letter }))}</small>
        <div class="basta-form">${s.cats.map((c, i) => `<label><span>${esc(t(c))}</span><input data-basta="${id}" data-i="${i}" maxlength="40" autocomplete="off" value="${esc(draft[i] || '')}" ${done ? 'disabled' : ''}></label>`).join('')}</div>
        ${done ? '' : `<button type="button" class="btn small danger" data-g-basta="${id}">✋ ${esc(t('¡Basta!'))}</button>`}${board}`;
    }
    // Puntuación de la ronda
    const head = s.players.map((p) => `<th class="ugc">${esc(name(p.id).slice(0, 8))}</th>`).join('');
    const rows = s.cats.map((c, i) => `<tr><td>${esc(t(c))}</td>${s.players.map((p) => {
      const a = s.answers[p.id]?.[i] || '', pts = s.cellPts?.[p.id + '|' + i] || 0, vetoed = s.veto?.[p.id + '|' + i];
      const inner = `<span class="ugc">${esc(a) || '—'}</span><b>${pts}</b>`;
      return `<td class="${vetoed ? 'veto' : pts ? '' : 'zero'}">${isHost(gm) && a ? `<button type="button" data-g-act="${id}" data-a='${JSON.stringify({ do: 'veto', p: p.id, c: i })}' title="${esc(t('Anular o aceptar'))}">${inner}</button>` : inner}</td>`;
    }).join('')}</tr>`).join('');
    return `<small class="g-status">${esc(t('Letra {l} · puntos de la ronda', { l: s.letter }))}</small>
      <div class="g-scroll"><table class="basta-table"><tr><th></th>${head}</tr>${rows}<tr class="tot"><td>${esc(t('Ronda'))}</td>${s.players.map((p) => `<td>${s.roundPts?.[p.id] || 0}</td>`).join('')}</tr></table></div>
      <small class="muted">${esc(t('Repetida 5 · única 10 · si nadie más la tiene, 20.'))}${isHost(gm) ? ' ' + esc(t('Tocá una respuesta para anularla.')) : ''}</small>
      ${isHost(gm) ? `<button type="button" class="btn small primary" data-g-act="${id}" data-a='{"do":"next"}'>${esc(t('Otra ronda'))}</button>` : ''}${board}`;
  }
  /** Los textos que estoy escribiendo no se pierden cuando se vuelve a pintar la partida. */
  function restoreDrafts(gm, id) {
    if (gm.s.type !== 'basta' || gm.local.focus == null) return;
    const el = document.querySelector(`[data-basta="${id}"][data-i="${gm.local.focus}"]`);
    if (el && !el.disabled) { el.focus(); try { el.setSelectionRange(el.value.length, el.value.length); } catch { /* nada */ } }
  }
  const myAnswers = (gm) => gm.s.cats.map((_, i) => gm.local.drafts?.[gm.s.round]?.[i] || '');

  /* ================= Dibujá y adiviná ================= */
  const DG_TIME = 80000;
  function dgNext(s) {
    s.turnNo++;
    s.word = ''; s.hint = ''; s.guessed = []; s.endsAt = 0;
    if (s.turnNo >= s.order.length * s.turns) { s.phase = 'end'; return; }
    s.drawer = s.turnNo % s.order.length;
    s.phase = 'choose';
  }
  function dgHtml(w, id, s) {
    const myId = me(w);
    const name = (pid) => (pid === myId ? t('Tú') : nick(w, pid));
    const drawer = s.order?.[s.drawer];
    const board = `<div class="g-scores">${[...(s.order || [])].sort((a, b) => s.scores[b] - s.scores[a]).map((pid) => `<span><b class="ugc">${esc(name(pid))}</b> ${s.scores[pid]}</span>`).join('')}</div>`;
    const status = s.phase === 'end' ? t('Terminó. Ganó {nick}', { nick: name([...s.order].sort((a, b) => s.scores[b] - s.scores[a])[0]) })
      : s.phase === 'choose' ? (drawer === myId ? t('Te toca dibujar: elegí una palabra') : t('{nick} está eligiendo una palabra…', { nick: name(drawer) }))
        : s.phase === 'draw' ? (drawer === myId ? t('Estás dibujando') : t('Dibuja {nick} · ¡adiviná!', { nick: name(drawer) }))
          : t('La palabra era: {w}', { w: s.word || '…' });
    return `<small class="g-status">${esc(status)}</small>${s.phase !== 'end' ? `<button type="button" class="btn small primary" data-dg-open="${id}">🖍️ ${esc(t('Abrir el juego'))}</button>` : ''}${board}`;
  }
  /** Abre o actualiza el panel de dibujo cuando cambia la partida. */
  function dgSync(gm, id) {
    const s = gm.s, myId = me(gm.w);
    if (!s.order?.includes(myId) || s.phase === 'lobby') return;
    if (s.phase === 'end') { document.querySelector(`.dg-wrap[data-id="${id}"]`)?.remove(); return; }
    if (s.phase === 'choose' && gm.local.lastTurn !== s.turnNo) { gm.local.lastTurn = s.turnNo; gm.local.strokes = []; gm.local.word = null; gm.local.myGuesses = []; gm.local.closed = false; }
    const isDrawer = s.order[s.drawer] === myId;
    if (s.phase === 'reveal' && isDrawer && gm.local.word && gm.local.sentWord !== s.turnNo) { gm.local.sentWord = s.turnNo; act(id, { do: 'word', word: gm.local.word }); }
    if (!gm.local.closed) dgPanel(gm, id);
  }
  function dgPanel(gm, id) {
    const s = gm.s, w = gm.w, myId = me(w);
    const isDrawer = s.order[s.drawer] === myId;
    let wrap = document.querySelector(`.dg-wrap[data-id="${id}"]`);
    if (!wrap) {
      document.querySelector('.dg-wrap')?.remove();
      wrap = document.createElement('div');
      wrap.className = 'dg-wrap wb-wrap';
      wrap.dataset.id = id;
      wrap.innerHTML = `<div class="wb dg"><div class="wb-bar"><b class="dg-title"></b><span class="dg-timer"></span>
        <span class="wb-colors dg-tools"></span><button type="button" class="icon-btn" data-dg-close title="${esc(t('Cerrar'))}">${icon('x')}</button></div>
        <div class="dg-main"><canvas></canvas><div class="dg-choose hidden"></div></div>
        <div class="dg-side"><div class="dg-feed"></div><form class="dg-guess"><input maxlength="40" autocomplete="off" placeholder="${esc(t('Escribí tu respuesta'))}"><button class="btn small primary">${esc(t('Enviar'))}</button></form></div></div>`;
      document.body.appendChild(wrap);
      const cv = wrap.querySelector('canvas'), g2 = cv.getContext('2d');
      const fit = () => { const r = cv.getBoundingClientRect(); cv.width = r.width * devicePixelRatio; cv.height = r.height * devicePixelRatio; redraw(); };
      const drawStroke = (st) => {
        if (!st.p?.length) return;
        g2.strokeStyle = st.c; g2.lineWidth = (st.w || 4) * devicePixelRatio; g2.lineCap = g2.lineJoin = 'round';
        g2.beginPath();
        st.p.forEach(([x, y], i) => (i ? g2.lineTo(x * cv.width, y * cv.height) : g2.moveTo(x * cv.width, y * cv.height)));
        if (st.p.length === 1) g2.lineTo(st.p[0][0] * cv.width + 0.1, st.p[0][1] * cv.height);
        g2.stroke();
      };
      const redraw = () => { g2.clearRect(0, 0, cv.width, cv.height); (gm.local.strokes || []).forEach(drawStroke); };
      wrap.__draw = drawStroke; wrap.__redraw = redraw;
      requestAnimationFrame(fit);
      const ro = new ResizeObserver(fit); ro.observe(cv);
      let cur = null, last = 0, color = '#111827';
      const pt = (e) => { const r = cv.getBoundingClientRect(); return [Math.round(((e.clientX - r.left) / r.width) * 1000) / 1000, Math.round(((e.clientY - r.top) / r.height) * 1000) / 1000]; };
      const flush = (end) => {
        if (!cur) return;
        send(w, { op: 'dg-stroke', id, s: { c: cur.c, w: cur.w, p: cur.p.slice(cur.sent) }, cont: cur.sent > 0 }, { live: true });
        cur.sent = cur.p.length - 1;
        if (end) cur = null;
      };
      cv.onpointerdown = (e) => {
        if (!wrap.__canDraw) return;
        cv.setPointerCapture(e.pointerId);
        cur = { c: color, w: color === '#ffffff' ? 18 : 4, p: [pt(e)], sent: 0 };
        (gm.local.strokes ||= []).push(cur); drawStroke(cur);
      };
      cv.onpointermove = (e) => { if (!cur) return; cur.p.push(pt(e)); drawStroke({ ...cur, p: cur.p.slice(-2) }); if (Date.now() - last > 150) { last = Date.now(); flush(false); } };
      cv.onpointerup = cv.onpointercancel = () => flush(true);
      wrap.onclick = (e) => {
        const c = e.target.closest('[data-wb-color]');
        if (c) { color = c.dataset.wbColor; wrap.querySelectorAll('[data-wb-color]').forEach((b) => b.classList.toggle('on', b === c)); }
        if (e.target.closest('[data-dg-clear]')) { gm.local.strokes = []; redraw(); send(w, { op: 'dg-clear', id }, { live: true }); }
        if (e.target.closest('[data-dg-close]')) { gm.local.closed = true; ro.disconnect(); wrap.remove(); clearInterval(wrap.__tick); }
        const pick = e.target.closest('[data-dg-word]');
        if (pick) {
          gm.local.word = pick.dataset.dgWord;
          act(id, { do: 'chosen', hint: gm.local.word.replace(/\S/g, '_').split('').join(' ') });
        }
      };
      wrap.querySelector('.dg-guess').onsubmit = (e) => {
        e.preventDefault();
        const input = e.target.querySelector('input'), txt = input.value.trim();
        if (!txt) return;
        input.value = '';
        (gm.local.myGuesses ||= []).push(txt);
        send(w, { op: 'dg-guess', id, text: txt.slice(0, 40) }, { live: true, to: gm.w.via === 'group' ? gm.s.order[gm.s.drawer] : undefined });
        dgFeed(gm, id);
      };
      wrap.__tick = setInterval(() => dgTimer(gm, id), 500);
    }
    // Contenido según la fase
    wrap.__canDraw = isDrawer && s.phase === 'draw';
    const name = (pid) => (pid === myId ? t('Tú') : nick(w, pid));
    wrap.querySelector('.dg-title').textContent = isDrawer
      ? (gm.local.word ? `✏️ ${gm.local.word}` : t('Te toca dibujar'))
      : s.phase === 'reveal' ? t('Era: {w}', { w: s.word || '…' }) : `${t('Dibuja {nick}', { nick: name(s.order[s.drawer]) })} · ${s.hint || ''}`;
    wrap.querySelector('.dg-tools').innerHTML = wrap.__canDraw
      ? `${['#111827', '#e11d48', '#2563eb', '#16a34a', '#f59e0b', '#ffffff'].map((c, i) => `<button type="button" data-wb-color="${c}" style="background:${c}" class="${i ? '' : 'on'}"></button>`).join('')}<button type="button" class="btn small" data-dg-clear>${esc(t('Borrar todo'))}</button>` : '';
    const choose = wrap.querySelector('.dg-choose');
    if (isDrawer && s.phase === 'choose' && !gm.local.word) {
      gm.local.options ||= {};
      gm.local.options[s.turnNo] ||= pickWords(3);
      choose.innerHTML = `<b>${esc(t('Elegí qué vas a dibujar'))}</b>${gm.local.options[s.turnNo].map((x) => `<button type="button" class="btn" data-dg-word="${esc(x)}">${esc(x)}</button>`).join('')}`;
      choose.classList.remove('hidden');
    } else if (s.phase === 'choose') { choose.innerHTML = `<b>${esc(t('{nick} está eligiendo una palabra…', { nick: name(s.order[s.drawer]) }))}</b>`; choose.classList.remove('hidden'); }
    else choose.classList.add('hidden');
    if (s.phase === 'choose') { gm.local.strokes = []; wrap.__redraw(); }
    wrap.querySelector('.dg-guess').classList.toggle('hidden', isDrawer || s.phase !== 'draw' || s.guessed.includes(myId));
    dgFeed(gm, id);
    dgTimer(gm, id);
  }
  function dgFeed(gm, id) {
    const wrap = document.querySelector(`.dg-wrap[data-id="${id}"]`);
    if (!wrap) return;
    const s = gm.s, myId = me(gm.w);
    const name = (pid) => (pid === myId ? t('Tú') : nick(gm.w, pid));
    const lines = [
      ...s.guessed.map((pid) => `<p class="ok">✓ ${esc(t('{nick} adivinó', { nick: name(pid) }))}</p>`),
      ...(gm.local.myGuesses || []).slice(-6).map((g) => `<p class="ugc">${esc(g)}</p>`),
      ...(s.order[s.drawer] === myId ? (gm.local.incoming || []).slice(-8).map(([pid, g]) => `<p><b class="ugc">${esc(name(pid))}:</b> <span class="ugc">${esc(g)}</span></p>`) : []),
    ];
    wrap.querySelector('.dg-feed').innerHTML = lines.join('') || `<p class="muted">${esc(t(s.order[s.drawer] === myId ? 'Aquí verás las respuestas.' : 'Escribí qué creés que es.'))}</p>`;
  }
  function dgTimer(gm, id) {
    const el = document.querySelector(`.dg-wrap[data-id="${id}"] .dg-timer`);
    if (!el) return;
    const left = gm.s.phase === 'draw' ? Math.max(0, Math.round(((gm.local.deadline || 0) - Date.now()) / 1000)) : null;
    el.textContent = left == null ? '' : `⏱ ${left}s`;
  }
  function dgStrokeIn(id, m, from) {
    const gm = games.get(id);
    if (!gm || gm.s.order?.[gm.s.drawer] !== from) return;
    if (m.op === 'dg-clear') { gm.local.strokes = []; document.querySelector(`.dg-wrap[data-id="${id}"]`)?.__redraw(); return; }
    const st = m.s;
    if (!st || !Array.isArray(st.p)) return;
    const stroke = { c: /^#[0-9a-f]{6}$/i.test(st.c) ? st.c : '#111827', w: Math.min(30, Number(st.w) || 4), p: st.p.slice(0, 500).map(([x, y]) => [Math.min(1, Math.max(0, +x || 0)), Math.min(1, Math.max(0, +y || 0))]) };
    gm.local.strokes ||= [];
    const prev = m.cont ? gm.local.strokes[gm.local.strokes.length - 1] : null;
    if (prev) prev.p.push(...stroke.p.slice(1)); else gm.local.strokes.push(stroke);
    const wrap = document.querySelector(`.dg-wrap[data-id="${id}"]`);
    if (wrap) wrap.__draw(prev ? { ...prev, p: prev.p.slice(-stroke.p.length - 1) } : stroke);
  }
  /** Una respuesta (solo le llega a quien dibuja): si acierta, se lo confirma al anfitrión. */
  function dgGuessIn(id, m, from) {
    const gm = games.get(id);
    if (!gm || gm.s.phase !== 'draw' || gm.s.order[gm.s.drawer] !== me(gm.w) || !gm.local.word) return;
    const text = String(m.text || '').slice(0, 40);
    if (norm(text) === norm(gm.local.word)) act(id, { do: 'hit', who: from });
    else { (gm.local.incoming ||= []).push([from, text]); dgFeed(gm, id); }
  }
  function pickWords(n) {
    const list = WORDS[(document.documentElement.lang || 'es').slice(0, 2)] || WORDS.es;
    const out = new Set();
    while (out.size < n) out.add(list[rnd(list.length)]);
    return [...out];
  }

  /* ================= Batalla naval (privados, sin anfitrión) ================= */
  const FLEET = [5, 4, 3, 3, 2];
  function bnRandom() {
    const taken = new Set(), ships = [];
    for (const len of FLEET) {
      for (let tries = 0; tries < 500; tries++) {
        const hor = rnd(2) === 0, r = rnd(hor ? 10 : 11 - len), c = rnd(hor ? 11 - len : 10);
        const cells = Array.from({ length: len }, (_, k) => (hor ? r * 10 + c + k : (r + k) * 10 + c));
        // sin tocarse (ni en diagonal)
        const near = (i) => [-11, -10, -9, -1, 0, 1, 9, 10, 11].some((d) => { const j = i + d; return j >= 0 && j < 100 && Math.abs((j % 10) - (i % 10)) <= 1 && taken.has(j); });
        if (cells.some(near)) continue;
        cells.forEach((x) => taken.add(x)); ships.push(cells); break;
      }
    }
    return ships;
  }
  function bnCreate(w, id) {
    const gm = { w, s: { type: 'bn', host: me(w), phase: 'place', players: [{ id: me(w) }, { id: String(w.peer.cid) }] }, local: { ships: bnRandom(), mine: {}, theirs: {}, ready: false, peerReady: false, first: me(w) } };
    gm.local.turn = gm.local.first;
    games.set(id, gm);
    addMessage(w, { mid: id, mine: true, kind: 'tool', tool: 'game', ts: Date.now() });
    send(w, { op: 'bn-new', id });
  }
  async function bnIn(w, id, m, from) {
    let gm = games.get(id);
    if (m.op === 'bn-new' && !gm) {
      gm = { w, s: { type: 'bn', host: from, phase: 'place', players: [{ id: from }, { id: me(w) }] }, local: { ships: bnRandom(), mine: {}, theirs: {}, ready: false, peerReady: false, first: from } };
      gm.local.turn = from;
      games.set(id, gm);
      addMessage(w, { mid: id, mine: false, kind: 'tool', tool: 'game', ts: Date.now() });
      return;
    }
    if (!gm || gm.s.type !== 'bn') return;
    const L = gm.local;
    if (m.op === 'bn-ready') { L.peerReady = true; L.peerCommit = String(m.commit || ''); bnPhase(gm); }
    if (m.op === 'bn-shot' && gm.s.phase === 'play' && L.turn === from) {
      const i = Math.max(0, Math.min(99, Number(m.i) || 0));
      if (L.theirs[i]) return;
      const ship = L.ships.find((sh) => sh.includes(i));
      L.theirs[i] = ship ? 'h' : 'm';
      const sunk = ship && ship.every((x) => L.theirs[x]) ? ship : null;
      const over = L.ships.every((sh) => sh.every((x) => L.theirs[x]));
      if (!ship) L.turn = me(w); // al agua: me toca
      if (over) { gm.s.phase = 'end'; L.winner = from; }
      send(w, { op: 'bn-res', id, i, r: L.theirs[i], sunk, over });
      if (over) bnReveal(gm, id);
    }
    if (m.op === 'bn-res' && L.pending === Number(m.i)) {
      const i = L.pending; L.pending = null;
      L.mine[i] = m.r === 'h' ? 'h' : 'm';
      if (Array.isArray(m.sunk)) m.sunk.slice(0, 5).forEach((x) => { L.mine[Number(x)] = 's'; });
      if (L.mine[i] === 'm') L.turn = from;
      if (m.over) { gm.s.phase = 'end'; L.winner = me(w); bnReveal(gm, id); }
    }
    if (m.op === 'bn-reveal' && Array.isArray(m.ships)) {
      L.peerShips = m.ships.slice(0, 5).map((sh) => (Array.isArray(sh) ? sh.slice(0, 5).map(Number) : []));
      const ok = (await sha(JSON.stringify(L.peerShips) + ':' + String(m.salt || ''))) === L.peerCommit;
      // ¿coinciden sus respuestas con su flota?
      const cells = new Set(L.peerShips.flat());
      const honest = ok && Object.entries(L.mine).every(([i, r]) => (r === 'm') === !cells.has(Number(i)));
      L.verified = honest ? '✓ ' + t('Partida verificada: nadie hizo trampa.') : '⚠ ' + t('Las respuestas del otro no coinciden con su flota.');
    }
    rerender(w, id);
  }
  function bnPhase(gm) { if (gm.local.ready && gm.local.peerReady && gm.s.phase === 'place') gm.s.phase = 'play'; }
  async function bnReady(id) {
    const gm = games.get(id);
    if (!gm || gm.local.ready) return;
    gm.local.salt = hex(crypto.getRandomValues(new Uint8Array(12)));
    const commit = await sha(JSON.stringify(gm.local.ships) + ':' + gm.local.salt);
    gm.local.ready = true;
    send(gm.w, { op: 'bn-ready', id, commit });
    bnPhase(gm);
    rerender(gm.w, id);
  }
  function bnShoot(id, i) {
    const gm = games.get(id), L = gm?.local;
    if (!gm || gm.s.phase !== 'play' || L.turn !== me(gm.w) || L.mine[i] || L.pending != null) return;
    L.pending = i;
    send(gm.w, { op: 'bn-shot', id, i });
    rerender(gm.w, id);
  }
  function bnReveal(gm, id) { send(gm.w, { op: 'bn-reveal', id, ships: gm.local.ships, salt: gm.local.salt }); }
  function bnHtml(w, id, s, gm) {
    const L = gm.local, myId = me(w), other = nick(w, s.players.find((p) => p.id !== myId)?.id);
    const shipSet = new Set(L.ships.flat());
    const status = s.phase === 'place' ? (L.ready ? t('Esperando a {nick}…', { nick: other }) : t('Ubicá tu flota y tocá «Listo»'))
      : s.phase === 'end' ? (L.winner === myId ? t('¡Ganaste! Hundiste toda su flota.') : t('Ganó {nick}', { nick: other }))
        : L.turn === myId ? (L.pending != null ? t('Disparando…') : t('Tu turno: tocá una casilla de su mar')) : t('Turno de {nick}', { nick: other });
    const peerCells = new Set((L.peerShips || []).flat());
    const myGrid = Array.from({ length: 100 }, (_, i) => `<i class="bn-c ${shipSet.has(i) ? 'ship' : ''} ${L.theirs[i] === 'h' ? 'hit' : L.theirs[i] === 'm' ? 'miss' : ''}"></i>`).join('');
    const canShoot = s.phase === 'play' && L.turn === myId && L.pending == null;
    const theirGrid = Array.from({ length: 100 }, (_, i) => {
      const r = L.mine[i];
      const cls = r === 's' ? 'sunk' : r === 'h' ? 'hit' : r === 'm' ? 'miss' : s.phase === 'end' && peerCells.has(i) ? 'ship' : '';
      return canShoot && !r ? `<button type="button" class="bn-c" data-bn-shot="${id}" data-i="${i}"></button>` : `<i class="bn-c ${cls}"></i>`;
    }).join('');
    return `<small class="g-status">${esc(status)}</small>
      ${s.phase !== 'place' ? `<b class="bn-label">${esc(t('Mar de {nick}', { nick: other }))}</b><div class="bn-grid">${theirGrid}</div>` : ''}
      <b class="bn-label">${esc(t('Tu flota'))}</b><div class="bn-grid">${myGrid}</div>
      ${s.phase === 'place' && !L.ready ? `<span class="g-row"><button type="button" class="btn small" data-bn-shuffle="${id}">🔀 ${esc(t('Ubicar al azar'))}</button><button type="button" class="btn small primary" data-bn-ready="${id}">${esc(t('¡Listo!'))}</button></span>` : ''}
      ${L.verified ? `<small class="g-verify">${esc(L.verified)}</small>` : ''}`;
  }

  /* ================= Burbuja ================= */
  function bubble(w, m) {
    const gm = games.get(m.mid);
    if (!gm) return `<div class="game"><small class="muted">${esc(t('Partida terminada'))}</small></div>`;
    const s = gm.s, meta = META[s.type], myId = me(w);
    const name = (pid) => (pid === myId ? t('Tú') : nick(w, pid));
    let body = '';
    if (s.phase === 'lobby') {
      const inGame = pidx(s, myId) >= 0, full = s.players.length >= (s.max || meta.max);
      body = `<small class="g-status">${esc(t('Sala de espera · {n} de {max}', { n: s.players.length, max: s.max || meta.max }))}</small>
        <div class="g-players">${s.players.map((p) => `<span class="ugc">${esc(name(p.id))}${p.id === s.host ? ' ★' : ''}</span>`).join('')}</div>
        <span class="g-row">${!inGame && !full ? `<button type="button" class="btn small primary" data-g-act="${m.mid}" data-a='{"do":"join"}'>${esc(t('Unirme'))}</button>` : ''}
        ${inGame && myId !== s.host ? `<button type="button" class="btn small" data-g-act="${m.mid}" data-a='{"do":"leave"}'>${esc(t('Salir'))}</button>` : ''}
        ${myId === s.host ? `<button type="button" class="btn small primary" data-g-act="${m.mid}" data-a='{"do":"start"}' ${s.players.length >= meta.min ? '' : 'disabled'}>${esc(t('Empezar'))}</button>` : ''}</span>
        ${myId === s.host && s.players.length < meta.min ? `<small class="muted">${esc(t('Esperando jugadores…'))}</small>` : ''}`;
    } else if (s.type === 'c4') body = c4Html(w, m.mid, s);
    else if (s.type === 'gen') body = genHtml(w, m.mid, s, gm);
    else if (s.type === 'basta') body = bastaHtml(w, m.mid, s, gm);
    else if (s.type === 'dg') body = dgHtml(w, m.mid, s);
    else if (s.type === 'bn') body = bnHtml(w, m.mid, s, gm);
    const again = s.phase === 'end' && s.type !== 'bn' ? `<button type="button" class="btn small" data-g-new="${s.type}">${esc(t('Revancha'))}</button>`
      : s.phase === 'end' ? `<button type="button" class="btn small" data-g-new="bn">${esc(t('Revancha'))}</button>` : '';
    if (s.type === 'gen' && s.phase === 'end') setTimeout(() => genVerify(m.mid), 0);
    return `<div class="game g-${s.type}"><b>${meta.emoji} ${esc(t(meta.name))}</b>${body}${again}</div>`;
  }

  /* ================= Clics ================= */
  document.addEventListener('click', (e) => {
    const w = state.windows.get(state.active);
    if (!w) return;
    const a = e.target.closest('[data-g-act]');
    if (a) { try { act(a.dataset.gAct, JSON.parse(a.dataset.a)); } catch { /* nada */ } return; }
    const hold = e.target.closest('[data-g-hold]');
    if (hold) { const gm = games.get(hold.dataset.gHold); if (gm) { gm.local.held[Number(hold.dataset.i)] = !gm.local.held[Number(hold.dataset.i)]; rerender(gm.w, hold.dataset.gHold); } return; }
    const roll = e.target.closest('[data-g-roll]');
    if (roll) { const gm = games.get(roll.dataset.gRoll); if (gm) act(roll.dataset.gRoll, { do: 'roll', held: gm.local.held }); return; }
    const basta = e.target.closest('[data-g-basta]');
    if (basta) { const gm = games.get(basta.dataset.gBasta); if (gm) act(basta.dataset.gBasta, { do: 'basta', ans: myAnswers(gm) }); return; }
    const nw = e.target.closest('[data-g-new]');
    if (nw) { create(w, nw.dataset.gNew); return; }
    const dg = e.target.closest('[data-dg-open]');
    if (dg) { const gm = games.get(dg.dataset.dgOpen); if (gm) { gm.local.closed = false; dgPanel(gm, dg.dataset.dgOpen); } return; }
    const shot = e.target.closest('[data-bn-shot]');
    if (shot) return bnShoot(shot.dataset.bnShot, Number(shot.dataset.i));
    const sh = e.target.closest('[data-bn-shuffle]');
    if (sh) { const gm = games.get(sh.dataset.bnShuffle); if (gm && !gm.local.ready) { gm.local.ships = bnRandom(); rerender(gm.w, sh.dataset.bnShuffle); } return; }
    const rd = e.target.closest('[data-bn-ready]');
    if (rd) bnReady(rd.dataset.bnReady);
  });
  // Lo que escribo en Basta se guarda (y, si alguien dijo «¡Basta!», se envía lo que tengo)
  document.addEventListener('input', (e) => {
    const el = e.target.closest?.('[data-basta]');
    if (!el) return;
    const gm = games.get(el.dataset.basta);
    if (!gm) return;
    gm.local.drafts ||= {};
    (gm.local.drafts[gm.s.round] ||= [])[Number(el.dataset.i)] = el.value;
    gm.local.focus = Number(el.dataset.i);
  });
  document.addEventListener('focusin', (e) => { const el = e.target.closest?.('[data-basta]'); if (el) { const gm = games.get(el.dataset.basta); if (gm) gm.local.focus = Number(el.dataset.i); } });

  return { create, onData, bubble };
}

/* ---------- Palabras para «Dibujá y adiviná» ---------- */
const WORDS = {
  es: ['casa', 'perro', 'gato', 'árbol', 'sol', 'luna', 'auto', 'bicicleta', 'avión', 'barco', 'pelota', 'flor', 'pez', 'pájaro', 'montaña', 'playa', 'reloj', 'teléfono', 'guitarra', 'paraguas',
    'sombrero', 'zapato', 'anteojos', 'llave', 'puerta', 'ventana', 'cama', 'silla', 'mesa', 'lámpara', 'helado', 'pizza', 'empanada', 'mate', 'torta', 'manzana', 'banana', 'uva', 'sandía', 'zanahoria',
    'corazón', 'estrella', 'nube', 'lluvia', 'rayo', 'arcoíris', 'fuego', 'nieve', 'muñeco de nieve', 'castillo', 'cohete', 'robot', 'fantasma', 'dragón', 'sirena', 'pirata', 'corona', 'espada', 'tren', 'colectivo',
    'semáforo', 'puente', 'faro', 'volcán', 'isla', 'tortuga', 'serpiente', 'elefante', 'jirafa', 'león', 'mono', 'conejo', 'caracol', 'araña', 'mariposa', 'abeja', 'vaca', 'caballo', 'pingüino', 'ballena',
    'libro', 'lápiz', 'tijera', 'computadora', 'cámara', 'televisor', 'micrófono', 'auriculares', 'globo', 'regalo', 'vela', 'campana', 'escalera', 'martillo', 'ancla', 'mochila', 'carpa', 'fútbol', 'tenis', 'ojo'],
  en: ['house', 'dog', 'cat', 'tree', 'sun', 'moon', 'car', 'bicycle', 'plane', 'boat', 'ball', 'flower', 'fish', 'bird', 'mountain', 'beach', 'clock', 'phone', 'guitar', 'umbrella',
    'hat', 'shoe', 'glasses', 'key', 'door', 'window', 'bed', 'chair', 'table', 'lamp', 'ice cream', 'pizza', 'cake', 'apple', 'banana', 'grapes', 'watermelon', 'carrot', 'heart', 'star',
    'cloud', 'rain', 'lightning', 'rainbow', 'fire', 'snow', 'snowman', 'castle', 'rocket', 'robot', 'ghost', 'dragon', 'pirate', 'crown', 'sword', 'train', 'bus', 'bridge', 'lighthouse', 'volcano',
    'island', 'turtle', 'snake', 'elephant', 'giraffe', 'lion', 'monkey', 'rabbit', 'snail', 'spider', 'butterfly', 'bee', 'cow', 'horse', 'penguin', 'whale', 'book', 'pencil', 'scissors', 'computer',
    'camera', 'television', 'microphone', 'headphones', 'balloon', 'gift', 'candle', 'bell', 'ladder', 'hammer', 'anchor', 'backpack', 'tent', 'soccer', 'eye'],
};
