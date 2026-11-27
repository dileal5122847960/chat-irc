/*
 * Banner de publicidad (carrusel)
 * ────────────────────────────────
 * Por ahora muestra anuncios de la propia ChamuFlac (descargar las apps, invitar amigos,
 * consejos). Para pasar a anuncios reales (propios vendidos o una red de anuncios) basta con
 * cambiar getSlides(): el resto de la app solo llama a mountAds().
 * Cada app oculta el anuncio de sí misma (la de Android no anuncia la de Android).
 */
const ROTATE_MS = 6000;

/** Anuncios disponibles. ctx: { platform, t, links: { android, windows }, number } */
function getSlides(ctx) {
  const { platform, t, links, number } = ctx;
  const all = [
    { id: 'android', hide: platform === 'android', bg: 'linear-gradient(120deg, #ff5a5f, #c81d3a)', icon: '📱',
      title: t('ChamuFlac en tu Android'), text: t('Tus amigos en privado, con avisos aunque la app esté cerrada.'), cta: t('Descargar'), url: links.android },
    { id: 'windows', hide: platform === 'windows', bg: 'linear-gradient(120deg, #1f3b73, #3a6ea5)', icon: '💻',
      title: t('ChamuFlac para Windows'), text: t('Queda junto al reloj y te avisa al instante.'), cta: t('Descargar'), url: links.windows },
    { id: 'invite', hide: !number, bg: 'linear-gradient(120deg, #7b2ff7, #c81d3a)', icon: '🤝',
      title: t('Invita a tus amigos'), text: t('Comparte tu número y hablen cifrado de extremo a extremo.'), cta: t('Invitar'), action: 'invite' },
    { id: 'once', bg: 'linear-gradient(120deg, #0f766e, #14b8a6)', icon: '①',
      title: t('Fotos que se ven una sola vez'), text: t('Toca el «1» antes de enviar una foto, vídeo o audio.') },
    { id: 'translate', bg: 'linear-gradient(120deg, #b45309, #f59e0b)', icon: '🌍',
      title: t('Habla con todo el mundo'), text: t('Los mensajes en otro idioma traen su botón «Traducir».') },
    { id: 'offline', bg: 'linear-gradient(120deg, #334155, #64748b)', icon: '📬',
      title: t('Escribe aunque no esté conectado'), text: t('Tus mensajes esperan cifrados y se borran al entregarse.') },
  ];
  return all.filter((s) => !s.hide && (s.url || s.action || !s.cta));
}

/** Enlaces de descarga vigentes (de app_versions, lectura pública). */
async function loadLinks(supabase) {
  const links = { android: 'https://github.com/dileal5122847960/chat-irc/releases/latest/download/ChamuFlac.apk', windows: '' };
  try {
    const { data } = await supabase.from('app_versions').select('platform, download_url').in('platform', ['android', 'windows']);
    for (const r of data || []) if (r.download_url) links[r.platform] = r.download_url;
  } catch { /* se usan los de por defecto */ }
  return links;
}

/**
 * Monta el carrusel dentro de `el`.
 * opts: { supabase, platform, t, esc, open(url), invite(), number() }
 */
export async function mountAds(el, opts) {
  if (!el) return;
  const links = await loadLinks(opts.supabase);
  const slides = getSlides({ platform: opts.platform, t: opts.t, links, number: opts.number?.() });
  if (!slides.length) return;
  const { esc } = opts;
  el.className = 'ad-carousel';
  el.innerHTML = `<div class="ad-track">${slides.map((s) => `
      <div class="ad-slide" style="background:${s.bg}" data-ad="${s.id}">
        <span class="ad-icon" aria-hidden="true">${s.icon}</span>
        <span class="ad-text"><b>${esc(s.title)}</b><small>${esc(s.text)}</small></span>
        ${s.cta ? `<button type="button" class="ad-cta" data-ad-go="${s.id}">${esc(s.cta)}</button>` : ''}
      </div>`).join('')}</div>
    <div class="ad-dots">${slides.map((s, i) => `<button type="button" data-ad-dot="${i}" aria-label="${i + 1}"></button>`).join('')}</div>
    <span class="ad-label">${esc(opts.t('Publicidad'))}</span>`;
  const track = el.querySelector('.ad-track');
  let i = 0, timer = null;
  const go = (n) => {
    i = (n + slides.length) % slides.length;
    track.style.transform = `translateX(${-i * 100}%)`;
    el.querySelectorAll('[data-ad-dot]').forEach((d, k) => d.classList.toggle('on', k === i));
  };
  const start = () => { clearInterval(timer); timer = setInterval(() => { if (!document.hidden) go(i + 1); }, ROTATE_MS); };
  go(0); start();
  el.addEventListener('mouseenter', () => clearInterval(timer));
  el.addEventListener('mouseleave', start);
  el.addEventListener('click', (e) => {
    const dot = e.target.closest('[data-ad-dot]');
    if (dot) { go(Number(dot.dataset.adDot)); return start(); }
    const b = e.target.closest('[data-ad-go]');
    if (!b) return;
    const s = slides.find((x) => x.id === b.dataset.adGo);
    if (s?.action === 'invite') opts.invite?.();
    else if (s?.url) opts.open(s.url);
  });
  // Deslizar con el dedo o el ratón
  let x0 = null;
  el.addEventListener('pointerdown', (e) => { if (!e.target.closest('button')) x0 = e.clientX; });
  el.addEventListener('pointerup', (e) => {
    if (x0 === null) return;
    const dx = e.clientX - x0; x0 = null;
    if (Math.abs(dx) > 40) { go(i + (dx < 0 ? 1 : -1)); start(); }
  });
}
