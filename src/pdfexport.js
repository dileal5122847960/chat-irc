/*
 * Exportar una conversación a PDF dentro de la app (Android, Windows y también navegador).
 * Como no hay historial en ningún servidor, el PDF es la única copia de la conversación.
 * Se «fotografía» lo que se ve en pantalla (emojis, fotos y traducciones incluidas) con
 * html2canvas, en páginas A4 sin cortar burbujas, y se arma el PDF con jsPDF. Todo en el dispositivo.
 * Devuelve un File (application/pdf).
 */
const PAGE_W = 720, PAGE_H = 1018; // px por página (proporción A4)

export async function conversationPdf({ title, subtitle, logEl, appClass = 'app in-dm', footer = '' }) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
  // En papel, siempre con los colores claros (se restaura al terminar)
  const root = document.documentElement, prevTheme = root.dataset.theme, prevWall = root.dataset.wall;
  root.dataset.theme = 'light'; delete root.dataset.wall;
  try { return await build(); } finally { if (prevTheme) root.dataset.theme = prevTheme; else delete root.dataset.theme; if (prevWall) root.dataset.wall = prevWall; }

  async function build() {
  const host = document.createElement('div');
  host.className = 'pdf-host';
  host.style.cssText = `position:fixed;left:-20000px;top:0;width:${PAGE_W}px;`;
  document.body.appendChild(host);
  // Copia de los mensajes (sin botones ni reproductores que no sirven en papel)
  const items = [...logEl.children].map((el) => {
    const c = el.cloneNode(true);
    c.querySelectorAll('video').forEach((v) => { const ph = document.createElement('div'); ph.className = 'pdf-video'; ph.textContent = '🎬 Video'; v.replaceWith(ph); });
    c.querySelectorAll('.fact, .tr-do, .msg-actions, .voice-speed, button.voice-play, .progress-ring').forEach((x) => x.remove());
    c.querySelectorAll('.tr-orig.hidden').forEach((x) => x.classList.remove('hidden'));
    return c;
  });
  const newPage = (first) => {
    const page = document.createElement('div');
    page.className = appClass + ' pdf-page';
    page.style.cssText = `width:${PAGE_W}px;min-height:${PAGE_H}px;background:#f1eee9;padding:28px 26px;box-sizing:border-box;display:block;height:auto;`;
    if (first) {
      const h = document.createElement('header');
      h.className = 'pdf-head';
      h.innerHTML = `<h1></h1><p></p>`;
      h.querySelector('h1').textContent = title;
      h.querySelector('p').textContent = subtitle;
      page.appendChild(h);
    }
    const log = document.createElement('div');
    log.className = 'log pdf-log';
    page.appendChild(log);
    host.appendChild(page);
    return { page, log };
  };
  const pages = [];
  let cur = newPage(true);
  pages.push(cur);
  for (const it of items) {
    cur.log.appendChild(it);
    if (cur.page.scrollHeight > PAGE_H && cur.log.children.length > 1) {
      it.remove();
      cur = newPage(false);
      pages.push(cur);
      cur.log.appendChild(it);
    }
  }
  if (footer) { const f = document.createElement('p'); f.className = 'pdf-foot'; f.textContent = footer; cur.page.appendChild(f); }
  // Esperar a que carguen las fotos
  await Promise.all([...host.querySelectorAll('img')].map((img) => (img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; }))));
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
  const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight();
  for (let i = 0; i < pages.length; i++) {
    const canvas = await html2canvas(pages[i].page, { scale: 2, backgroundColor: '#f1eee9', useCORS: true, logging: false, width: PAGE_W, windowWidth: PAGE_W });
    const hgt = Math.min(ph, (canvas.height / canvas.width) * pw);
    if (i) pdf.addPage();
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, pw, hgt);
  }
  host.remove();
  const name = `chamuflac_${title.replace(/[^\w-]+/g, '_').slice(0, 30)}_${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.pdf`;
  return new File([pdf.output('blob')], name, { type: 'application/pdf' });
  }
}
