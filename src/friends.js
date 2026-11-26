/*
 * Amigos en la web (para cuentas registradas)
 * ────────────────────────────────────────────
 * Las mismas funciones de la base de datos que usa la app de Android: agregar por número,
 * aceptar o rechazar solicitudes, cancelar las enviadas, eliminar y bloquear.
 * La lista se consulta al entrar, cada 2 minutos y al volver a la pestaña (no hay tiempo
 * real para esto: así se gasta lo mínimo). Al enviar una solicitud se avisa al móvil del
 * otro con la función "push".
 */
export function createFriends(ctx) {
  const { supabase, esc, icon, avatar, t, toast, openDialog, closeOverlays, SUPABASE_URL, SUPABASE_KEY } = ctx;
  let friends = [];
  let timer = null;
  let knownIncoming = null; // para avisar de solicitudes nuevas
  const fmtNumber = (n) => String(n || '').replace(/(\d{4})(\d{4})/, '$1 $2');
  const incoming = () => friends.filter((f) => f.status === 'pending' && !f.requested_by_me);

  async function refresh() {
    const { data, error } = await supabase.rpc('list_friends');
    if (error) return;
    friends = data || [];
    const inc = incoming();
    if (knownIncoming) {
      const nuevos = inc.filter((f) => !knownIncoming.has(f.user_number));
      if (nuevos.length) { toast(t('{nick} te envió una solicitud de amistad.', { nick: nuevos[0].nick })); ctx.beep?.(); }
    }
    knownIncoming = new Set(inc.map((f) => f.user_number));
    ctx.onCount?.(inc.length);
    if (document.querySelector('.friends-dialog')) render();
  }
  function start() {
    stop();
    refresh();
    timer = setInterval(refresh, 2 * 60 * 1000);
    document.addEventListener('visibilitychange', onVisible);
  }
  function stop() {
    clearInterval(timer); timer = null; knownIncoming = null; friends = [];
    document.removeEventListener('visibilitychange', onVisible);
  }
  function onVisible() { if (!document.hidden) refresh(); }

  /* ---------- Panel ---------- */
  function open() {
    closeOverlays();
    const wrap = document.createElement('div');
    wrap.className = 'dialog-wrap';
    wrap.innerHTML = `<div class="dialog friends-dialog" role="dialog" aria-modal="true"></div>`;
    document.body.appendChild(wrap);
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) wrap.remove(); });
    wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape') wrap.remove(); });
    wrap.addEventListener('click', onClick);
    render();
    refresh();
  }
  function render() {
    const box = document.querySelector('.friends-dialog');
    if (!box) return;
    const inc = incoming();
    const acc = friends.filter((f) => f.status === 'accepted');
    const sent = friends.filter((f) => f.status === 'pending' && f.requested_by_me);
    const blocked = friends.filter((f) => f.status === 'blocked');
    const row = (f, sub, actions) => `<li>${avatar(f.nick)}<span class="fr-main"><b class="ugc">${esc(f.nick)}</b><small class="${sub.ugc ? 'ugc' : ''}">${esc(sub.text)}</small></span>${actions}</li>`;
    const name = (f) => [f.first_name, f.last_name].filter(Boolean).join(' ');
    box.innerHTML = `
      <div class="fr-head"><h3>Amigos</h3><button type="button" class="icon-btn" data-fr-close title="Cerrar">${icon('x')}</button></div>
      <div class="fr-mine"><span>Tu número</span><button type="button" class="chip-number" data-fr-copy>${esc(fmtNumber(ctx.myNumber()))} ${icon('link')}</button>
        <button type="button" class="btn small primary" data-fr-add>${icon('plus')} Agregar amigo</button></div>
      ${inc.length ? `<h4 class="fr-sec">Solicitudes recibidas</h4><ul class="fr-list">${inc.map((f) => row(f, { text: fmtNumber(f.user_number) },
        `<button class="btn small" data-fr-reject="${f.user_number}">Rechazar</button><button class="btn small primary" data-fr-accept="${f.user_number}">Aceptar</button>`)).join('')}</ul>` : ''}
      <h4 class="fr-sec">Tus amigos</h4>
      ${acc.length ? `<ul class="fr-list">${acc.map((f) => row(f, { text: name(f), ugc: true },
        `<button class="btn small primary" data-fr-chat="${f.user_number}">${icon('message')} Hablar</button><button class="icon-btn" data-fr-remove="${f.user_number}" title="Eliminar amigo">${icon('trash')}</button><button class="icon-btn" data-fr-block="${f.user_number}" title="Bloquear">${icon('shield-off')}</button>`)).join('')}</ul>`
        : `<p class="muted small">Aún no tienes amigos. Pulsa «Agregar amigo» y escribe el número de la otra persona: lo ve en la app o en su menú de usuario.</p>`}
      ${sent.length ? `<h4 class="fr-sec">Solicitudes enviadas</h4><ul class="fr-list">${sent.map((f) => row(f, { text: t('Esperando respuesta…') },
        `<button class="btn small" data-fr-cancel="${f.user_number}">Cancelar</button>`)).join('')}</ul>` : ''}
      ${blocked.length ? `<h4 class="fr-sec">Bloqueados</h4><ul class="fr-list">${blocked.map((f) => row(f, { text: fmtNumber(f.user_number) },
        `<button class="btn small" data-fr-unblock="${f.user_number}">Desbloquear</button>`)).join('')}</ul>` : ''}
      <p class="hint">Con «Hablar» abres un privado con tu amigo, esté en la web o en la app de Android (si tiene la app cerrada, le llega un aviso).</p>`;
  }
  async function onClick(e) {
    const b = e.target.closest('button');
    if (!b) return;
    const d = b.dataset;
    if ('frClose' in d) return b.closest('.dialog-wrap').remove();
    if ('frCopy' in d) return navigator.clipboard?.writeText(String(ctx.myNumber())).then(() => toast(t('Número copiado')));
    if ('frAdd' in d) return addDialog();
    const f = friends.find((x) => String(x.user_number) === (d.frAccept || d.frReject || d.frCancel || d.frRemove || d.frBlock || d.frUnblock || d.frChat));
    if (!f) return;
    if (d.frChat) { b.closest('.dialog-wrap').remove(); return ctx.openChat(f); }
    const run = async (fn, args, ok) => {
      b.disabled = true;
      const { error } = await supabase.rpc(fn, args);
      if (error) toast(t(error.message)); else if (ok) toast(t(ok, { nick: f.nick }));
      await refresh(); render();
    };
    if (d.frAccept) return run('respond_friend_request', { p_number: f.user_number, p_accept: true }, 'Ahora sois amigos.');
    if (d.frReject) return run('respond_friend_request', { p_number: f.user_number, p_accept: false });
    if (d.frCancel) return run('remove_friend', { p_number: f.user_number });
    if (d.frRemove || d.frBlock) {
      const ok = await openDialog(d.frRemove
        ? { title: t('Eliminar amigo'), text: esc(t('{nick} dejará de estar en tu lista. Podéis volver a agregaros.', { nick: f.nick })), confirm: t('Eliminar'), danger: true }
        : { title: t('Bloquear'), text: esc(t('{nick} no podrá escribirte, llamarte ni encontrarte por tu número.', { nick: f.nick })), confirm: t('Bloquear'), danger: true });
      if (ok) await supabase.rpc(d.frRemove ? 'remove_friend' : 'block_user', d.frRemove ? { p_number: f.user_number } : { p_number: f.user_number, p_block: true });
      await refresh();
      return open();
    }
    if (d.frUnblock) return run('block_user', { p_number: f.user_number, p_block: false });
  }

  async function addDialog() {
    let found = null;
    const v = await openDialog({
      title: t('Agregar amigo'),
      text: esc(t('Escribe el número de 8 dígitos de la otra persona. Lo ve en la app, en Amigos.')),
      fields: [{ name: 'number', label: t('Número'), max: 12, placeholder: '1234 5678' }],
      confirm: t('Enviar solicitud'),
      validate: async ({ number }) => {
        const n = Number(String(number).replace(/\D/g, ''));
        if (!(n >= 10000000 && n <= 99999999)) return t('El número tiene 8 dígitos.');
        if (n === Number(ctx.myNumber())) return t('Ese es tu propio número.');
        const { data } = await supabase.rpc('find_user', { p_number: n });
        found = Array.isArray(data) ? data[0] : data;
        if (!found) return t('No existe ningún usuario con ese número.');
        if (found.relation === 'accepted') return t('{nick} ya es tu amigo.', { nick: found.nick });
        if (found.relation === 'blocked') return t('Tienes bloqueado a {nick}.', { nick: found.nick });
        return '';
      },
    });
    if (!v || !found) return open();
    const { data, error } = await supabase.rpc('send_friend_request', { p_number: found.user_number });
    if (error) toast(t(error.message));
    else if (data === 'accepted') toast(t('{nick} ya te había invitado: ahora sois amigos.', { nick: found.nick }));
    else { toast(t('Solicitud enviada a {nick}.', { nick: found.nick })); notifyFriendRequest(found.user_number); }
    await refresh();
    open();
  }
  const notifyFriendRequest = (number) => notify(number, 'friend', 'friend');
  /** Aviso push al móvil del otro (si tiene la app): solicitud de amistad, privado o llamada. */
  async function notify(number, kind, id, video = false) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      await fetch(`${SUPABASE_URL}/functions/v1/push`, {
        method: 'POST',
        headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: Number(number), kind, id, video }),
      });
    } catch { /* sin aviso */ }
  }
  const isFriend = (number) => friends.some((f) => String(f.user_number) === String(number) && f.status === 'accepted');

  return { start, stop, open, refresh, notify, isFriend };
}
