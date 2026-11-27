/*
 * Momentos (24 h, solo amigos, cifrados de extremo a extremo) — migración 0016
 * ──────────────────────────────────────────────────────────────────────────────
 * • Al publicar: clave AES-GCM nueva → se cifran el texto/estilo (tabla moments) y la foto
 *   (almacenamiento "moments", privado). La clave se cifra para cada dispositivo de cada amigo y
 *   para los propios (mailbox.seal) → moment_keys. El servidor no ve el contenido.
 * • Al ver: list_moments(mi dispositivo) trae la clave cifrada para mí → se descifra aquí.
 * • A las 24 h dejan de listarse; los archivos caducados los borra la app de su dueño.
 * Lo usan la web y las apps (cada una pone la lista donde quiera: renderList / openViewer / compose).
 */
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (buf) => { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const MOMENT_BGS = ['#e11d48', '#7c3aed', '#2563eb', '#0d9488', '#ea580c', '#111827'];
const DURATION = 6000; // ms por momento en el visor

export function createMoments(ctx) {
  const { supabase, mailbox, t, esc, icon, toast } = ctx;
  let list = []; // [{ id, owner, nick, mine, created, expires, seen, views, data:{text,bg}, photo_path, key }]
  let loadedAt = 0, loading = null, timer = null;
  const urls = new Map(); // id → blob URL de la foto descifrada

  /* ---------- Cifrado ---------- */
  const importKey = (raw) => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  async function seal(key, bytes) { const iv = crypto.getRandomValues(new Uint8Array(12)); return { iv, c: new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes)) }; }
  const open = (key, iv, c) => crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, c);

  /* ---------- Lista ---------- */
  function start() { load(); clearInterval(timer); timer = setInterval(load, 5 * 60 * 1000); cleanup(); }
  function stop() { clearInterval(timer); list = []; urls.forEach((u) => URL.revokeObjectURL(u)); urls.clear(); }
  function load(force = false) {
    if (!force && Date.now() - loadedAt < 20000) return Promise.resolve(list);
    loading ||= (async () => {
      try {
        const dev = mailbox.deviceId();
        if (!dev) return list;
        const { data, error } = await supabase.rpc('list_moments', { p_device: dev });
        if (error) return list;
        const out = [];
        for (const r of data || []) {
          const old = list.find((x) => x.id === r.id);
          if (old) { Object.assign(old, { seen: old.seen || r.seen, views: r.views }); out.push(old); continue; }
          try {
            const { k } = await mailbox.open(r.key_body);
            const key = await importKey(unb64(k));
            const data = JSON.parse(dec.decode(await open(key, unb64(r.content.i), unb64(r.content.c))));
            out.push({ id: r.id, owner: String(r.owner), nick: r.nick, mine: r.mine, created: Date.parse(r.created_at), expires: Date.parse(r.expires_at), seen: r.seen, views: r.views, data, photo_path: r.photo_path, key });
          } catch { /* no se pudo descifrar (otro dispositivo, datos borrados) */ }
        }
        list = out;
        loadedAt = Date.now();
        ctx.onChange?.();
        return list;
      } finally { loading = null; }
    })();
    return loading;
  }
  /** Agrupados por persona: yo primero, después los no vistos, después los vistos. */
  function byPerson() {
    const map = new Map();
    for (const m of list) {
      if (m.expires < Date.now()) continue;
      (map.get(m.owner) || map.set(m.owner, { owner: m.owner, nick: m.nick, mine: m.mine, items: [] }).get(m.owner)).items.push(m);
    }
    const people = [...map.values()];
    people.forEach((p) => { p.unseen = !p.mine && p.items.some((m) => !m.seen); p.last = Math.max(...p.items.map((m) => m.created)); });
    return people.sort((a, b) => (b.mine - a.mine) || (b.unseen - a.unseen) || (b.last - a.last));
  }
  const unseenCount = () => byPerson().filter((p) => p.unseen).length;

  /** Archivos de mis momentos caducados: se borran del almacenamiento. */
  async function cleanup() {
    try {
      const { data } = await supabase.rpc('my_expired_moments');
      const paths = (data || []).filter(Boolean);
      if (paths.length) await supabase.storage.from('moments').remove(paths);
    } catch { /* se intentará otra vez */ }
  }

  /* ---------- Publicar ---------- */
  async function publish({ text, bg, photo }) {
    const id = crypto.randomUUID();
    const raw = crypto.getRandomValues(new Uint8Array(32));
    const key = await importKey(raw);
    let photo_path = null;
    if (photo) {
      const { iv, c } = await seal(key, new Uint8Array(await photo.arrayBuffer()));
      const file = new Uint8Array(12 + c.length); file.set(iv); file.set(c, 12);
      photo_path = `${ctx.myNumber()}/${id}.bin`;
      const up = await supabase.storage.from('moments').upload(photo_path, new Blob([file], { type: 'application/octet-stream' }), { upsert: false, contentType: 'application/octet-stream' });
      if (up.error) throw new Error(up.error.message);
    }
    const body = await seal(key, enc.encode(JSON.stringify({ text: String(text || '').slice(0, 250), bg: MOMENT_BGS.includes(bg) ? bg : MOMENT_BGS[0] })));
    const { data: devs, error: e1 } = await supabase.rpc('moment_devices');
    if (e1) throw new Error(e1.message);
    const keys = [];
    for (const d of devs || []) { try { keys.push({ device: d.device, body: await mailbox.seal(d.public_key, { k: b64(raw) }) }); } catch { /* clave no válida */ } }
    const { error } = await supabase.rpc('post_moment', { p_id: id, p_content: { i: b64(body.iv), c: b64(body.c) }, p_photo: photo_path, p_keys: keys });
    if (error) { if (photo_path) supabase.storage.from('moments').remove([photo_path]); throw new Error(error.message); }
    await load(true);
  }
  async function remove(m) {
    const { data } = await supabase.rpc('delete_moment', { p_id: m.id });
    if (data) await supabase.storage.from('moments').remove([data]);
    list = list.filter((x) => x.id !== m.id);
    ctx.onChange?.();
  }
  async function photoUrl(m) {
    if (!m.photo_path) return null;
    if (urls.has(m.id)) return urls.get(m.id);
    const { data, error } = await supabase.storage.from('moments').download(m.photo_path);
    if (error || !data) return null;
    const buf = new Uint8Array(await data.arrayBuffer());
    const plain = await open(m.key, buf.slice(0, 12), buf.slice(12));
    const url = URL.createObjectURL(new Blob([plain], { type: 'image/jpeg' }));
    urls.set(m.id, url);
    return url;
  }

  /* ---------- Fila de momentos (círculos) ---------- */
  const ago = (ts) => { const m = Math.max(1, Math.round((Date.now() - ts) / 60000)); return m < 60 ? t('hace {n} min', { n: m }) : t('hace {n} h', { n: Math.round(m / 60) }); };
  function stripHtml() {
    const people = byPerson();
    const mine = people.find((p) => p.mine);
    const me = `<button type="button" class="mo-item" data-mo-mine><span class="mo-ring ${mine ? 'seen' : 'add'}">${ctx.avatar({ number: ctx.myNumber(), nick: ctx.myNick(), me: true })}${mine ? '' : `<i class="mo-plus">${icon('plus')}</i>`}</span><small>${esc(t(mine ? 'Mis momentos' : 'Tu momento'))}</small></button>`;
    return `<div class="mo-strip">${me}${people.filter((p) => !p.mine).map((p) => `<button type="button" class="mo-item" data-mo-owner="${esc(p.owner)}"><span class="mo-ring ${p.unseen ? '' : 'seen'}">${ctx.avatar({ number: p.owner, nick: p.nick })}</span><small class="ugc">${esc(p.nick)}</small></button>`).join('')}</div>`;
  }
  /** Click en la fila: abre el visor o el editor. Devuelve true si lo manejó. */
  function onStripClick(e) {
    const b = e.target.closest('.mo-item');
    if (!b) return false;
    if ('moMine' in b.dataset) {
      const mine = byPerson().find((p) => p.mine);
      if (mine) ctx.menu(b, [
        { label: t('Ver mis momentos'), icon: 'play', act: () => openViewer(mine.owner) },
        { label: t('Nuevo momento'), icon: 'plus', act: compose },
      ]);
      else compose();
      return true;
    }
    openViewer(b.dataset.moOwner);
    return true;
  }

  /* ---------- Visor ---------- */
  function openViewer(owner) {
    const people = byPerson();
    let pi = people.findIndex((p) => p.owner === owner);
    if (pi < 0) return;
    let mi = people[pi].mine ? 0 : Math.max(0, people[pi].items.findIndex((m) => !m.seen));
    const el = document.createElement('div');
    el.className = 'mo-viewer';
    document.body.appendChild(el);
    let timerId = null, started = 0, paused = false, left = DURATION;
    const close = () => { clearTimeout(timerId); el.remove(); document.removeEventListener('keydown', onKey); ctx.onChange?.(); };
    const next = () => { const p = people[pi]; if (mi < p.items.length - 1) mi++; else if (pi < people.length - 1) { pi++; mi = 0; } else return close(); show(); };
    const prev = () => { if (mi > 0) mi--; else if (pi > 0) { pi--; mi = people[pi].items.length - 1; } show(); };
    const onKey = (e) => { if (e.key === 'Escape') close(); if (e.key === 'ArrowRight') next(); if (e.key === 'ArrowLeft') prev(); };
    document.addEventListener('keydown', onKey);
    async function show() {
      clearTimeout(timerId);
      const p = people[pi], m = p.items[mi];
      el.innerHTML = `<div class="mo-stage" style="--mo-bg:${esc(m.data.bg)}">
        <div class="mo-bars">${p.items.map((_, i) => `<i class="${i < mi ? 'done' : i === mi ? 'now' : ''}"><b></b></i>`).join('')}</div>
        <div class="mo-top">${ctx.avatar({ number: p.owner, nick: p.nick, me: p.mine })}<span><b class="ugc">${esc(p.mine ? t('Tú') : p.nick)}</b><small>${esc(ago(m.created))}</small></span>
          ${p.mine ? `<button type="button" class="icon-btn" data-mo-del title="${esc(t('Borrar'))}">${icon('trash')}</button>` : ''}<button type="button" class="icon-btn" data-mo-x title="${esc(t('Cerrar'))}">${icon('x')}</button></div>
        <div class="mo-body">${m.photo_path ? '<div class="mo-photo"><span class="mo-spin"></span></div>' : ''}${m.data.text ? `<p class="mo-text ugc ${m.photo_path ? 'over' : ''}">${esc(m.data.text)}</p>` : ''}</div>
        ${p.mine ? `<button type="button" class="mo-views" data-mo-views>${icon('users')} ${esc(t('Visto por {n}', { n: m.views || 0 }))}</button>` : ''}
        <button type="button" class="mo-nav prev" aria-label="Anterior"></button><button type="button" class="mo-nav next" aria-label="Siguiente"></button></div>`;
      el.querySelector('[data-mo-x]').onclick = close;
      el.querySelector('.mo-nav.prev').onclick = prev;
      el.querySelector('.mo-nav.next').onclick = next;
      el.querySelector('[data-mo-del]')?.addEventListener('click', async () => {
        paused = true; clearTimeout(timerId);
        if (!(await ctx.confirm(t('¿Borrar este momento?')))) { paused = false; return show(); }
        await remove(m); close();
      });
      el.querySelector('[data-mo-views]')?.addEventListener('click', async () => {
        paused = true; clearTimeout(timerId);
        const { data } = await supabase.rpc('moment_viewers', { p_id: m.id });
        await ctx.info(t('Visto por'), data?.length ? data.map((v) => `<b class="ugc">${esc(v.nick)}</b> <small class="muted">${esc(ago(Date.parse(v.at)))}</small>`).join('<br>') : esc(t('Todavía nadie lo vio.')));
        paused = false; show();
      });
      if (!p.mine && !m.seen) { m.seen = true; supabase.rpc('mark_moment_seen', { p_id: m.id }); }
      if (m.photo_path) {
        const url = await photoUrl(m).catch(() => null);
        const box = el.querySelector('.mo-photo');
        if (box) box.innerHTML = url ? `<img src="${url}" alt="">` : `<small>${esc(t('No se pudo cargar la foto.'))}</small>`;
      }
      // Avance automático (mantener apretado = pausa)
      left = DURATION; started = Date.now();
      el.querySelector('.mo-bars .now b')?.style.setProperty('animation-duration', DURATION + 'ms');
      timerId = setTimeout(next, DURATION);
    }
    const stage = () => el.querySelector('.mo-stage');
    el.addEventListener('pointerdown', (e) => { if (e.target.closest('button:not(.mo-nav)')) return; paused = true; clearTimeout(timerId); left -= Date.now() - started; stage()?.classList.add('paused'); });
    el.addEventListener('pointerup', () => { if (!paused) return; paused = false; started = Date.now(); stage()?.classList.remove('paused'); timerId = setTimeout(next, Math.max(300, left)); });
    show();
  }

  /* ---------- Crear ---------- */
  function compose() {
    let bg = MOMENT_BGS[0], photo = null, photoUrlLocal = null;
    const wrap = document.createElement('div');
    wrap.className = 'dialog-wrap';
    wrap.innerHTML = `<div class="dialog mo-compose" role="dialog" aria-modal="true">
      <h3>${esc(t('Nuevo momento'))}</h3>
      <p class="muted small">${esc(t('Lo verán solo tus amigos durante 24 horas. Va cifrado de extremo a extremo.'))}</p>
      <div class="mo-preview"><textarea maxlength="250" placeholder="${esc(t('Escribe algo…'))}"></textarea></div>
      <div class="mo-tools"><span class="mo-bgs">${MOMENT_BGS.map((c, i) => `<button type="button" data-bg="${c}" class="${i ? '' : 'on'}" style="background:${c}" aria-label="${c}"></button>`).join('')}</span>
        <button type="button" class="btn small" data-photo>${icon('image')} ${esc(t('Foto'))}</button></div>
      <p class="error" role="alert"></p>
      <div class="dialog-actions"><button type="button" class="btn" data-x>${esc(t('Cancelar'))}</button><button type="button" class="btn primary" data-ok>${esc(t('Publicar'))}</button></div></div>`;
    document.body.appendChild(wrap);
    const prev = wrap.querySelector('.mo-preview'), ta = wrap.querySelector('textarea'), err = wrap.querySelector('.error');
    const paint = () => { prev.style.setProperty('--mo-bg', bg); prev.style.backgroundImage = photoUrlLocal ? `url("${photoUrlLocal}")` : ''; prev.classList.toggle('has-photo', !!photo); };
    paint();
    setTimeout(() => ta.focus(), 30);
    const done = () => { if (photoUrlLocal) URL.revokeObjectURL(photoUrlLocal); wrap.remove(); };
    wrap.querySelector('.mo-bgs').onclick = (e) => { const b = e.target.closest('[data-bg]'); if (!b) return; bg = b.dataset.bg; wrap.querySelectorAll('[data-bg]').forEach((x) => x.classList.toggle('on', x === b)); paint(); };
    wrap.querySelector('[data-photo]').onclick = async () => {
      const blob = await pickPhoto();
      if (!blob) return;
      photo = blob; if (photoUrlLocal) URL.revokeObjectURL(photoUrlLocal); photoUrlLocal = URL.createObjectURL(blob); paint();
    };
    wrap.querySelector('[data-x]').onclick = done;
    wrap.querySelector('[data-ok]').onclick = async (e) => {
      if (!ta.value.trim() && !photo) { err.textContent = t('Escribe algo o elige una foto.'); return; }
      e.currentTarget.disabled = true; e.currentTarget.textContent = t('Publicando…');
      try { await publish({ text: ta.value.trim(), bg, photo }); done(); toast(t('Momento publicado. Lo verán tus amigos durante 24 horas.')); }
      catch (x) { err.textContent = t(x.message || 'No se pudo publicar.'); e.currentTarget.disabled = false; e.currentTarget.textContent = t('Publicar'); }
    };
  }
  /** Elige una foto y la reduce (máx. 1080 px, JPEG). */
  function pickPhoto() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/*';
      input.onchange = async () => {
        const f = input.files?.[0];
        if (!f) return resolve(null);
        try {
          const bmp = await createImageBitmap(f);
          const s = Math.min(1, 1080 / Math.max(bmp.width, bmp.height));
          const c = document.createElement('canvas');
          c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
          c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
          c.toBlob((b) => resolve(b), 'image/jpeg', 0.82);
        } catch { resolve(null); }
      };
      input.click();
    });
  }

  return { start, stop, load, stripHtml, onStripClick, openViewer, compose, unseenCount, byPerson };
}
