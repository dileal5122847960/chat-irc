/*
 * Encuestas en los canales (sin base de datos: viajan por el canal, como los mensajes).
 * Las ve quien está en el canal en ese momento; cada persona tiene un voto y puede cambiarlo.
 */
export function createPolls({ state, esc, t, addHtml, emit, openDialog, toast }) {
  const replaceLine = (w, id, html) => {
    const marker = `id="poll-${id}"`;
    const i = w.lines.findIndex((l) => l.includes(marker));
    if (i >= 0) w.lines[i] = html;
    const el = document.getElementById('poll-' + id);
    if (el && state.active === w.key) el.outerHTML = html;
  };
  function html(w, p) {
    const total = p.votes.size;
    const mine = p.votes.get(state.clientId);
    const counts = p.opts.map((_, i) => [...p.votes.values()].filter((v) => v === i).length);
    return `<div class="poll-row" id="poll-${p.id}"><div class="poll">
      <div class="poll-head">📊 <b class="ugc">${esc(p.q)}</b><small>${esc(t('Encuesta de {nick}', { nick: p.by }))} · ${esc(t(total === 1 ? '1 voto' : '{n} votos', { n: total }))}</small></div>
      ${p.opts.map((o, i) => {
        const pct = total ? Math.round((counts[i] / total) * 100) : 0;
        return `<button type="button" class="poll-opt ${mine === i ? 'mine' : ''}" data-poll="${p.id}" data-opt="${i}"><span class="poll-bar" style="width:${pct}%"></span><span class="poll-txt ugc">${esc(o)}</span><span class="poll-pct">${pct}%</span></button>`;
      }).join('')}</div></div>`;
  }
  function onPoll(w, p) {
    if (typeof p.q !== 'string' || !Array.isArray(p.opts)) return;
    const poll = { id: String(p.id || '').replace(/[^\w-]/g, '').slice(0, 16), q: p.q.slice(0, 200), opts: p.opts.slice(0, 6).map((o) => String(o).slice(0, 80)), by: String(p.by || '').slice(0, 20), votes: new Map() };
    if (!poll.id || poll.opts.length < 2) return;
    (w.polls ||= new Map()).set(poll.id, poll);
    w.last = null;
    addHtml(w.key, html(w, poll), { count: p.byCid !== state.clientId });
  }
  function onVote(w, v) {
    const p = w.polls?.get(v.id);
    if (!p || !v.byCid) return;
    const opt = Number(v.opt);
    if (opt >= 0 && opt < p.opts.length) p.votes.set(v.byCid, opt); else p.votes.delete(v.byCid);
    replaceLine(w, p.id, html(w, p));
  }
  async function create(w) {
    const v = await openDialog({
      title: t('Crear encuesta'),
      text: esc(t('La verán quienes estén ahora en el canal. Escribe de 2 a 6 opciones, una por línea.')),
      fields: [{ name: 'q', label: t('Pregunta'), max: 200, placeholder: t('¿Qué prefieren?') }, { name: 'opts', label: t('Opciones (una por línea)'), max: 500, multiline: true, placeholder: 'Pizza\nEmpanadas' }],
      confirm: t('Publicar encuesta'),
      validate: ({ q, opts }) => (!q.trim() ? t('Escribe la pregunta.') : opts.split('\n').map((o) => o.trim()).filter(Boolean).length < 2 ? t('Escribe al menos dos opciones.') : ''),
    });
    if (!v) return;
    const opts = v.opts.split('\n').map((o) => o.trim()).filter(Boolean).slice(0, 6);
    emit(w, 'poll', { id: crypto.randomUUID().slice(0, 12), q: v.q.trim(), opts }, onPoll);
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-poll]');
    if (!b) return;
    const w = state.windows.get(state.active);
    const p = w?.polls?.get(b.dataset.poll);
    if (!p) return;
    const opt = Number(b.dataset.opt);
    const next = p.votes.get(state.clientId) === opt ? -1 : opt; // tocar de nuevo quita el voto
    emit(w, 'vote', { id: p.id, opt: next }, onVote);
  });
  return { create, onPoll, onVote };
}
