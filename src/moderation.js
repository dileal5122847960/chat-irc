/*
 * Moderación de canales (migración 0015)
 * ───────────────────────────────────────
 * • Bloquear (creador y administradores registrados): queda guardado en el servidor, con
 *   duración y motivo. Quien está bloqueado no puede volver a entrar hasta que termine.
 * • Denunciar (usuarios registrados): la denuncia la ven el creador y los administradores del
 *   canal («Denuncias» en el menú del canal).
 * • Ignorar (cualquiera, solo en este dispositivo): se dejan de ver los mensajes de esa persona.
 * • Anti-inundación (en cada dispositivo): quien envía demasiados mensajes seguidos queda oculto
 *   un rato automáticamente.
 */
export const REPORT_REASONS = { spam: 'Spam o publicidad', acoso: 'Acoso o insultos', odio: 'Discurso de odio', sexual: 'Contenido sexual', violencia: 'Violencia o amenazas', estafa: 'Estafa o engaño', otro: 'Otro motivo' };
export const BAN_TIMES = [[60, '1 hora'], [1440, '1 día'], [10080, '7 días'], [null, 'Para siempre']];
const FLOOD_MAX = 8; // mensajes…
const FLOOD_WINDOW = 10000; // …en 10 s
const FLOOD_MUTE = 60000; // se ocultan durante 1 min

export function createModeration(ctx) {
  const { supabase, t, esc, toast, openDialog } = ctx;
  const store = {
    get: () => { try { return new Set(JSON.parse(localStorage.getItem('ignored') || '[]')); } catch { return new Set(); } },
    save: (s) => { try { localStorage.setItem('ignored', JSON.stringify([...s].slice(-500))); } catch { /* nada */ } },
  };
  let ignored = store.get();
  const keyOf = (p) => (p.uid ? 'u:' + p.uid : 'n:' + String(p.nick || '').toLowerCase());
  const isIgnored = (p) => !!p && ignored.has(keyOf(p));
  function toggleIgnore(w, p) {
    const k = keyOf(p);
    if (ignored.has(k)) { ignored.delete(k); toast(t('Vuelves a ver los mensajes de {nick}.', { nick: p.nick })); }
    else { ignored.add(k); toast(t('Ya no verás los mensajes de {nick} (solo en este dispositivo).', { nick: p.nick })); }
    store.save(ignored);
    ctx.onIgnoreChange?.(w);
  }

  /* ---------- Filtro de mensajes entrantes ---------- */
  const flood = new Map(); // cid → { times: [], until }
  /** true = no mostrar este mensaje (ignorado o inundando). */
  function drop(w, m) {
    const p = w.people.get(m.from) || { nick: m.nick };
    if (isIgnored(p) || ignored.has('n:' + String(m.nick).toLowerCase())) return true;
    const now = Date.now();
    const f = flood.get(m.from) || { times: [], until: 0 };
    flood.set(m.from, f);
    if (f.until > now) return true;
    f.times = f.times.filter((x) => now - x < FLOOD_WINDOW);
    f.times.push(now);
    if (f.times.length > FLOOD_MAX) {
      f.until = now + FLOOD_MUTE; f.times = [];
      ctx.sys(w.key, `🛡 ${esc(t('{nick} está enviando demasiados mensajes seguidos: se ocultan durante un minuto.', { nick: m.nick }))}`, 'err');
      return true;
    }
    return false;
  }

  /* ---------- Bloqueos ---------- */
  /** ¿Estoy bloqueado en este canal? Devuelve un texto para mostrar, o '' si puedo entrar. */
  async function banStatus(ch, nick) {
    const { data, error } = await supabase.rpc('channel_ban_status', { p_channel: ch.id, p_nick: nick });
    if (error || !data) return '';
    const until = new Date(data);
    return !isFinite(until) || until.getFullYear() > 9000
      ? t('Estás bloqueado en {canal}.', { canal: ch.name })
      : t('Estás bloqueado en {canal} hasta el {fecha}.', { canal: ch.name, fecha: until.toLocaleString() });
  }
  async function banDialog(w, p) {
    lastBanTime = '1440';
    const v = await openDialog({
      title: t('Bloquear a {nick}', { nick: p.nick }),
      text: esc(t('Saldrá del canal y no podrá volver a entrar durante el tiempo que elijas.')) +
        `<span class="ban-times">${BAN_TIMES.map(([m, l], i) => `<label><input type="radio" name="ban-time" value="${m ?? ''}" ${i === 1 ? 'checked' : ''}> ${esc(t(l))}</label>`).join('')}</span>` +
        (p.uid ? '' : `<small class="muted">${esc(t('Es un invitado: se bloquea su nick.'))}</small>`),
      fields: [{ name: 'reason', label: t('Motivo (opcional)'), max: 200, placeholder: t('Ej.: insultos, spam…') }],
      confirm: t('Bloquear'), danger: true,
    });
    if (!v) return;
    const raw = document.querySelector('input[name=ban-time]:checked')?.value ?? lastBanTime;
    const minutes = raw === '' ? null : Number(raw);
    const { error } = await supabase.rpc('ban_from_channel', { p_channel: w.ch.id, p_user: p.uid || null, p_nick: p.nick, p_minutes: minutes, p_reason: v.reason.trim() });
    if (error) return toast(t(error.message));
    ctx.kick(w, p, { ban: true, label: BAN_TIMES.find(([m]) => m === minutes)?.[1] || '' });
  }
  // El diálogo se cierra antes de leer la opción: se recuerda la última elegida
  let lastBanTime = '1440';
  document.addEventListener('change', (e) => { if (e.target.name === 'ban-time') lastBanTime = e.target.value; });

  async function bansDialog(w) {
    const { data, error } = await supabase.rpc('list_channel_bans', { p_channel: w.ch.id });
    if (error) return toast(t(error.message));
    const when = (b) => (b.until ? t('hasta el {fecha}', { fecha: new Date(b.until).toLocaleString() }) : t('para siempre'));
    const html = data?.length
      ? `<ul class="mod-list">${data.map((b) => `<li><span><b class="ugc">${esc(b.nick)}</b>${b.registered ? '' : ` <small class="muted">(${esc(t('invitado'))})</small>`}<small>${esc(when(b))}${b.reason ? ' · <span class="ugc">' + esc(b.reason) + '</span>' : ''}</small></span><button type="button" class="btn small" data-unban="${b.id}">${esc(t('Desbloquear'))}</button></li>`).join('')}</ul>`
      : `<p class="muted">${esc(t('No hay nadie bloqueado en este canal.'))}</p>`;
    openDialog({ title: t('Bloqueados en {canal}', { canal: w.name }), text: html, confirm: t('Cerrar') });
    document.querySelector('.dialog [data-cancel]')?.remove();
    document.querySelector('.dialog .mod-list')?.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-unban]');
      if (!b) return;
      b.disabled = true;
      const r = await supabase.rpc('unban_from_channel', { p_ban: Number(b.dataset.unban) });
      if (r.error) { b.disabled = false; return toast(t(r.error.message)); }
      b.closest('li').remove();
      toast(t('Desbloqueado.'));
    });
  }

  /* ---------- Denuncias ---------- */
  async function reportDialog(w, p) {
    if (!ctx.registered()) return toast(t('Para denunciar necesitas una cuenta registrada.'));
    lastReason = 'spam';
    const v = await openDialog({
      title: t('Denunciar a {nick}', { nick: p.nick }),
      text: esc(t('La denuncia la verán el creador y los administradores de {canal}. Se adjuntan sus últimos mensajes.', { canal: w.name })) +
        `<span class="ban-times rep-reasons">${Object.entries(REPORT_REASONS).map(([k, l], i) => `<label><input type="radio" name="rep-reason" value="${k}" ${i === 0 ? 'checked' : ''}> ${esc(t(l))}</label>`).join('')}</span>`,
      fields: [{ name: 'details', label: t('Detalles (opcional)'), max: 300, multiline: true }],
      confirm: t('Enviar denuncia'), danger: true,
    });
    if (!v) return;
    const excerpt = (w.raw || []).filter((m) => m.nick === p.nick).slice(-5).map((m) => m.body).join('\n').slice(0, 500);
    const { error } = await supabase.rpc('report_user', { p_channel: w.ch.id, p_target_nick: p.nick, p_target_user: p.uid || null, p_reason: lastReason, p_details: v.details.trim(), p_excerpt: excerpt });
    if (error) return toast(t(error.message));
    toast(t('Denuncia enviada. Gracias por ayudar a cuidar el canal.'));
  }
  let lastReason = 'spam';
  document.addEventListener('change', (e) => { if (e.target.name === 'rep-reason') lastReason = e.target.value; });

  async function reportsDialog(w) {
    const { data, error } = await supabase.rpc('list_channel_reports', { p_channel: w.ch.id });
    if (error) return toast(t(error.message));
    const html = data?.length
      ? `<ul class="mod-list">${data.map((r) => `<li class="${r.status === 'done' ? 'done' : ''}"><span><b class="ugc">${esc(r.target_nick)}</b> · ${esc(t(REPORT_REASONS[r.reason] || r.reason))}<small>${esc(t('Denunció'))} <span class="ugc">${esc(r.reporter_nick)}</span> · ${esc(new Date(r.created_at).toLocaleString())}</small>${r.details ? `<small class="ugc">${esc(r.details)}</small>` : ''}${r.excerpt ? `<q class="ugc">${esc(r.excerpt)}</q>` : ''}</span>${r.status === 'open' ? `<button type="button" class="btn small" data-done="${r.id}">${esc(t('Resuelta'))}</button>` : `<small class="muted">${esc(t('Resuelta'))}</small>`}</li>`).join('')}</ul>`
      : `<p class="muted">${esc(t('No hay denuncias en este canal.'))}</p>`;
    openDialog({ title: t('Denuncias de {canal}', { canal: w.name }), text: html, confirm: t('Cerrar') });
    document.querySelector('.dialog [data-cancel]')?.remove();
    document.querySelector('.dialog .mod-list')?.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-done]');
      if (!b) return;
      b.disabled = true;
      const r = await supabase.rpc('resolve_report', { p_id: Number(b.dataset.done) });
      if (r.error) { b.disabled = false; return toast(t(r.error.message)); }
      b.closest('li').classList.add('done'); b.outerHTML = `<small class="muted">${esc(t('Resuelta'))}</small>`;
    });
  }

  return { drop, isIgnored, toggleIgnore, banStatus, banDialog, bansDialog, reportDialog, reportsDialog };
}
