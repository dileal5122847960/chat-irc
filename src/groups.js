/*
 * Grupos de amigos (cifrados de extremo a extremo)
 * ─────────────────────────────────────────────────
 * • Quién está en cada grupo lo guarda la base de datos (migración 0014); los mensajes NO.
 * • Cada mensaje se cifra en este dispositivo una vez por cada dispositivo de cada miembro
 *   (las mismas claves del buzón: ECDH P-256 + AES-GCM) y viaja por el canal privado
 *   "group:<id>" de Realtime, que solo pueden escuchar y escribir los miembros (RLS).
 * • A los dispositivos que no están conectados se les deja su copia en el buzón cifrado
 *   (mail_send_group) y les llega un aviso push. Al recogerla se borra del servidor.
 * • La ventana (burbujas, reacciones, marcas) la dibuja dm.js; aquí está el transporte,
 *   la lista de grupos y los diálogos para crearlos y administrarlos.
 * Primera versión: texto, emojis y stickers (fotos y llamadas grupales, más adelante).
 */
export function createGroups(ctx) {
  const { supabase, mailbox, t, esc, icon, toast } = ctx;
  const dm = () => ctx.dm();
  const groups = new Map(); // id → { id, name, role, members: [{ number, nick, role }], ch, online: Set<deviceId>, devs, devsAt }
  let loading = null;
  let stopped = true;
  let timer = null;
  const me = () => String(ctx.myNumber() ?? '');
  const isMember = (g, n) => g.members.some((m) => m.number === String(n));
  const isAdmin = (g) => g.role === 'admin';

  /* ---------------- Lista de grupos ---------------- */
  function start() {
    stopped = false;
    load();
    clearInterval(timer);
    timer = setInterval(load, 5 * 60 * 1000);
  }
  function stop() {
    stopped = true;
    clearInterval(timer);
    for (const g of groups.values()) unsubscribe(g);
    groups.clear();
  }
  function load() {
    if (stopped) return Promise.resolve();
    loading ||= (async () => {
      try {
        const { data, error } = await supabase.rpc('list_groups');
        if (error || stopped) return;
        const seen = new Set();
        for (const r of data || []) {
          seen.add(r.id);
          const members = (r.members || []).map((m) => ({ number: String(m.number), nick: String(m.nick || m.number), role: m.role }));
          let g = groups.get(r.id);
          if (!g) {
            g = { id: r.id, name: r.name, role: r.role, members, online: new Set(), devs: null, devsAt: 0, ch: null };
            groups.set(r.id, g);
          } else announceChanges(g, r.name, members);
          Object.assign(g, { name: r.name, role: r.role, members });
          if (!g.ch) subscribe(g);
          dm().groupWindow(g);
        }
        for (const [id, g] of groups) {
          if (seen.has(id)) continue;
          unsubscribe(g); groups.delete(id); dm().dropGroup(id);
        }
        ctx.onChange?.();
      } finally { loading = null; }
    })();
    return loading;
  }
  /** Avisos dentro del grupo cuando cambian el nombre o los miembros. */
  function announceChanges(g, name, members) {
    const before = new Map(g.members.map((m) => [m.number, m.nick]));
    const after = new Map(members.map((m) => [m.number, m.nick]));
    const line = (html) => dm().groupSys(g, `👥 ${html}`);
    for (const [n, nick] of after) if (!before.has(n)) line(esc(t('{nick} se unió al grupo.', { nick })));
    for (const [n, nick] of before) if (!after.has(n)) line(esc(t('{nick} ya no está en el grupo.', { nick })));
    if (name !== g.name) line(esc(t('El grupo ahora se llama «{grupo}».', { grupo: name })));
    if ([...before.keys()].join() !== [...after.keys()].join()) g.devs = null; // hay que volver a pedir los dispositivos
  }

  /* ---------------- Canal privado del grupo ---------------- */
  function subscribe(g) {
    const ch = supabase.channel('group:' + g.id, {
      config: { private: true, broadcast: { self: false }, presence: { key: me() + ':' + (mailbox.deviceId() || 'x') } },
    });
    g.ch = ch;
    ch.on('broadcast', { event: 'm' }, ({ payload }) => onMessage(g, payload))
      .on('broadcast', { event: 'r' }, ({ payload: p }) => { if (p && isMember(g, p.from)) dm().groupReceipt(g, String(p.from), p.t === 'read' ? 'read' : 'ack', p.mids); })
      .on('broadcast', { event: 'ty' }, ({ payload: p }) => { if (p && isMember(g, p.from)) dm().groupTyping(g, String(p.from)); })
      .on('broadcast', { event: 'meta' }, () => setTimeout(load, 2000)) // tras el cambio (quien sale avisa antes de salir)
      .on('presence', { event: 'sync' }, () => { g.online = new Set(Object.keys(ch.presenceState()).map((k) => k.split(':')[1])); })
      .subscribe((status) => { if (status === 'SUBSCRIBED') ch.track({ at: Date.now() }); });
  }
  function unsubscribe(g) {
    if (g.ch) supabase.removeChannel(g.ch);
    g.ch = null;
  }
  async function onMessage(g, p) {
    if (!p || !isMember(g, p.from) || !Array.isArray(p.items)) return;
    const mine = p.items.find((i) => Number(i?.device) === Number(mailbox.deviceId()));
    if (!mine) return;
    try {
      const m = await mailbox.open(mine.body);
      if (m?.g === g.id) dm().groupReceive(g, String(p.from), m);
    } catch { /* no era para esta clave */ }
  }
  /** Copias del buzón con mensajes de grupos (el remitente lo garantiza el servidor). */
  async function receiveMail(items) {
    if (items.some((it) => !groups.has(it.msg?.g))) await load();
    for (const it of items) {
      const g = groups.get(it.msg?.g);
      if (g && isMember(g, it.from)) dm().groupReceive(g, String(it.from), it.msg, it.at);
    }
  }

  /* ---------------- Enviar ---------------- */
  async function devices(g) {
    const known = new Set((g.devs || []).map((d) => String(d.device)));
    const unknownOnline = [...g.online].some((d) => d !== 'x' && !known.has(d));
    if (!g.devs || unknownOnline || Date.now() - g.devsAt > 2 * 60 * 1000) {
      const { data, error } = await supabase.rpc('group_devices', { p_group: g.id });
      if (!error) { g.devs = data || []; g.devsAt = Date.now(); }
    }
    return g.devs || [];
  }
  /**
   * Envía un mensaje (texto, sticker, reacción, borrado) a todos los miembros.
   * Devuelve true si salió hacia alguien (o si estoy solo en el grupo).
   */
  /**
   * opts.live: solo a los dispositivos conectados, sin buzón ni avisos (juegos, dibujos).
   * opts.to: solo a ese miembro (número). Los envíos «live» salen en orden (cola por grupo).
   */
  function send(id, msg, opts = {}) {
    if (!opts.live) return sendNow(id, msg, opts);
    const g = groups.get(id);
    if (!g) return Promise.resolve(false);
    g.queue = (g.queue || Promise.resolve()).then(() => sendNow(id, msg, opts)).catch(() => false);
    return g.queue;
  }
  async function sendNow(id, msg, opts = {}) {
    const g = groups.get(id);
    if (!g?.ch) return false;
    const devs = await devices(g);
    const myDev = Number(mailbox.deviceId());
    const body = { ...msg, g: id, nick: ctx.myNick() };
    const items = [];
    for (const d of devs) {
      if (Number(d.device) === myDev) continue;
      if (opts.to != null && String(d.user_number) !== String(opts.to)) continue;
      if (opts.live && !g.online.has(String(d.device))) continue;
      try { items.push({ device: Number(d.device), number: String(d.user_number), body: await mailbox.seal(d.public_key, body) }); } catch { /* clave no válida */ }
    }
    if (!items.length) return opts.live || g.members.length <= 1 || devs.length > 0;
    const live = items.filter((i) => g.online.has(String(i.device)));
    const away = items.filter((i) => !g.online.has(String(i.device)));
    let ok = false;
    const strip = (list) => list.map(({ device, body: b }) => ({ device, body: b }));
    for (let i = 0; i < live.length; i += 30) {
      const r = await g.ch.send({ type: 'broadcast', event: 'm', payload: { from: me(), items: strip(live.slice(i, i + 30)) } });
      if (r === 'ok') ok = true;
    }
    for (let i = 0; i < away.length; i += 60) {
      const r = await supabase.rpc('mail_send_group', { p_group: id, p_items: strip(away.slice(i, i + 60)) });
      if (!r.error && r.data) ok = true;
    }
    // Aviso push a quien no tiene ningún dispositivo conectado (solo mensajes, no reacciones)
    if (away.length && (msg.t === 'text' || msg.t === 'sticker')) {
      const liveNumbers = new Set(live.map((i) => i.number));
      const notify = new Set(away.map((i) => i.number).filter((n) => n !== me() && !liveNumbers.has(n)));
      for (const n of notify) push(n, g);
    }
    return ok;
  }
  async function push(number, g) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      await fetch(`${ctx.SUPABASE_URL}/functions/v1/push`, {
        method: 'POST',
        headers: { apikey: ctx.SUPABASE_KEY, Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: Number(number), kind: 'group', id: g.id, group: g.name }),
      });
    } catch { /* sin aviso */ }
  }
  function receipt(id, kind, mids) {
    const g = groups.get(id);
    if (!g?.ch || !mids?.length) return;
    g.ch.send({ type: 'broadcast', event: 'r', payload: { from: me(), t: kind, mids: mids.slice(0, 200) } });
  }
  function typing(id) {
    const g = groups.get(id);
    g?.ch?.send({ type: 'broadcast', event: 'ty', payload: { from: me() } });
  }
  /** Los demás vuelven a leer la lista (cambió el nombre o los miembros). */
  function changed(g, touched = []) {
    g.ch?.send({ type: 'broadcast', event: 'meta', payload: { from: me() } });
    for (const n of touched) ping(n);
  }
  /** Aviso por la bandeja privada de un amigo para que vuelva a leer sus grupos (lo agregaron o lo quitaron). */
  async function ping(number) {
    const ch = supabase.channel('user:' + number, { config: { private: true } });
    try { await ch.httpSend('group', { from: me() }); } catch { /* no importa: lo verá al volver */ } finally { supabase.removeChannel(ch); }
  }

  /* ---------------- Diálogos ---------------- */
  function dialog(html, cls = '') {
    ctx.closeOverlays?.();
    const wrap = document.createElement('div');
    wrap.className = 'dialog-wrap';
    wrap.innerHTML = `<div class="dialog grp-dialog ${cls}" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(wrap);
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) wrap.remove(); });
    wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape') wrap.remove(); });
    return wrap;
  }
  const friendRow = (f, checked = false) => `<label class="grp-pick">${ctx.avatar(f)}<span class="ugc">${esc(f.nick)}</span><input type="checkbox" value="${esc(f.number)}" ${checked ? 'checked' : ''}></label>`;
  /** Elegir amigos (con buscador). Devuelve los números elegidos o null. */
  function pickFriends({ title, exclude = [], confirm, withName = false }) {
    const list = ctx.friends().filter((f) => !exclude.includes(String(f.number)));
    return new Promise((resolve) => {
      if (!list.length) { toast(t(exclude.length ? 'Todos tus amigos ya están en el grupo.' : 'Primero agrega amigos: los grupos se hacen con tus amigos.')); return resolve(null); }
      const wrap = dialog(`<h3>${esc(title)}</h3>
        ${withName ? `<label>${esc(t('Nombre del grupo'))}</label><div class="field"><input name="name" maxlength="60" placeholder="${esc(t('Ej.: Familia, Fútbol del jueves'))}" autocomplete="off"></div>` : ''}
        <label>${esc(t('Amigos'))}</label>
        ${list.length > 6 ? `<div class="field search">${icon('search')}<input type="search" data-q placeholder="${esc(t('Buscar'))}"></div>` : ''}
        <div class="grp-list">${list.map((f) => friendRow(f)).join('')}</div>
        <p class="error" role="alert"></p>
        <div class="dialog-actions"><button type="button" class="btn" data-x>${esc(t('Cancelar'))}</button><button type="button" class="btn primary" data-ok>${esc(confirm)}</button></div>`);
      const done = (v) => { wrap.remove(); resolve(v); };
      const q = wrap.querySelector('[data-q]');
      if (q) q.oninput = () => wrap.querySelectorAll('.grp-pick').forEach((el) => { el.hidden = !el.textContent.toLowerCase().includes(q.value.trim().toLowerCase()); });
      wrap.querySelector('[data-x]').onclick = () => done(null);
      wrap.querySelector('[data-ok]').onclick = () => {
        const nums = [...wrap.querySelectorAll('.grp-pick input:checked')].map((i) => Number(i.value));
        const name = wrap.querySelector('input[name=name]')?.value.trim();
        const err = wrap.querySelector('.error');
        if (withName && !name) { err.textContent = t('Ponle un nombre al grupo.'); return; }
        if (!nums.length) { err.textContent = t('Elige al menos un amigo.'); return; }
        done({ name, nums });
      };
      setTimeout(() => wrap.querySelector('input')?.focus(), 30);
    });
  }
  async function createDialog() {
    const v = await pickFriends({ title: t('Nuevo grupo'), confirm: t('Crear grupo'), withName: true });
    if (!v) return;
    const { data: id, error } = await supabase.rpc('create_group', { p_name: v.name, p_members: v.nums });
    if (error) return toast(t(error.message));
    await load();
    const g = groups.get(id);
    if (g) { dm().groupSys(g, `👥 ${esc(t('Creaste el grupo. Los mensajes van cifrados de extremo a extremo.'))}`); changed(g, v.nums); ctx.open?.('g:' + id); }
  }
  async function addDialog(g) {
    const v = await pickFriends({ title: t('Agregar al grupo'), exclude: g.members.map((m) => m.number), confirm: t('Agregar') });
    if (!v) return;
    const { error } = await supabase.rpc('add_group_members', { p_group: g.id, p_members: v.nums });
    if (error) return toast(t(error.message));
    await load(); changed(g, v.nums);
  }
  async function renameDialog(g) {
    const v = await ctx.openDialog({ title: t('Cambiar nombre'), fields: [{ name: 'name', label: t('Nombre del grupo'), value: g.name, max: 60 }], confirm: t('Guardar'),
      validate: ({ name }) => (name.trim() ? '' : t('Ponle un nombre al grupo.')) });
    if (!v) return;
    const { error } = await supabase.rpc('rename_group', { p_group: g.id, p_name: v.name.trim() });
    if (error) return toast(t(error.message));
    await load(); changed(g);
  }
  async function leave(g) {
    const ok = await ctx.openDialog({ title: t('Salir del grupo'), text: esc(t('Dejarás de recibir los mensajes de «{grupo}».', { grupo: g.name })), confirm: t('Salir'), danger: true });
    if (!ok) return;
    changed(g); // antes de salir (después ya no se puede escribir en el canal)
    const { error } = await supabase.rpc('remove_group_member', { p_group: g.id, p_number: Number(me()) });
    if (error) return toast(t(error.message));
    await load();
    toast(t('Saliste del grupo.'));
  }
  function membersDialog(g) {
    const rows = g.members.map((m) => {
      const self = m.number === me();
      const acts = isAdmin(g) && !self
        ? `<button type="button" class="btn small" data-admin="${esc(m.number)}">${esc(t(m.role === 'admin' ? 'Quitar admin' : 'Hacer admin'))}</button><button type="button" class="icon-btn" data-kick="${esc(m.number)}" title="${esc(t('Quitar del grupo'))}">${icon('x')}</button>` : '';
      return `<li>${ctx.avatar({ number: m.number, nick: m.nick })}<span class="fr-main"><b class="ugc">${esc(self ? t('Tú') : m.nick)}</b>${m.role === 'admin' ? `<small>${esc(t('Administrador'))}</small>` : ''}</span>${acts}</li>`;
    }).join('');
    const wrap = dialog(`<div class="fr-head"><h3 class="ugc">${esc(g.name)}</h3><button type="button" class="icon-btn" data-x title="${esc(t('Cerrar'))}">${icon('x')}</button></div>
      <p class="muted small">${esc(t('{n} personas', { n: g.members.length }))} · ${esc(t('Cifrado de extremo a extremo'))}</p>
      <ul class="fr-list">${rows}</ul>
      ${isAdmin(g) ? `<div class="dialog-actions"><button type="button" class="btn primary" data-add>${icon('plus')} ${esc(t('Agregar amigos'))}</button></div>` : ''}`, 'friends-dialog');
    wrap.onclick = async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if ('x' in b.dataset) return wrap.remove();
      if ('add' in b.dataset) { wrap.remove(); return addDialog(g); }
      const m = g.members.find((x) => x.number === (b.dataset.admin || b.dataset.kick));
      if (!m) return;
      b.disabled = true;
      if (b.dataset.admin) {
        const { error } = await supabase.rpc('set_group_admin', { p_group: g.id, p_number: Number(m.number), p_admin: m.role !== 'admin' });
        if (error) toast(t(error.message));
      } else {
        const ok = await ctx.openDialog({ title: t('Quitar del grupo'), text: esc(t('{nick} dejará de recibir los mensajes del grupo.', { nick: m.nick })), confirm: t('Quitar'), danger: true });
        if (!ok) return membersDialog(g);
        const { error } = await supabase.rpc('remove_group_member', { p_group: g.id, p_number: Number(m.number) });
        if (error) toast(t(error.message));
        else changed(g, [m.number]);
      }
      await load(); changed(g);
      membersDialog(g);
    };
  }
  /** Opciones del menú ⋮ de un grupo (cada app las muestra con su propio menú). */
  function menuItems(w) {
    const g = groups.get(w.group?.id);
    if (!g) return [];
    return [
      { label: t('Miembros'), icon: 'users', hint: t('{n} personas', { n: g.members.length }), act: () => membersDialog(g) },
      ...(isAdmin(g) ? [
        { label: t('Agregar amigos'), icon: 'user-plus', act: () => addDialog(g) },
        { label: t('Cambiar nombre'), icon: 'edit', act: () => renameDialog(g) },
      ] : []),
      { label: t('Buscar en la conversación'), icon: 'search', act: () => dm().openSearch() },
      '-',
      { label: t('Salir del grupo'), icon: 'logout', danger: true, act: () => leave(g) },
    ];
  }

  return { start, stop, load, receiveMail, send, receipt, typing, createDialog, menuItems, list: () => [...groups.values()] };
}
