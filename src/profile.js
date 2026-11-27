/*
 * Foto de perfil (solo en privados) y preferencias de pantalla (tamaño de letra y fondo)
 * ──────────────────────────────────────────────────────────────────────────────────────
 * • La foto NO se guarda en ningún servidor: vive en el dispositivo de su dueño y viaja
 *   directamente al amigo por la conexión cifrada del privado (dm.js, mensaje 'photo').
 *   El dispositivo del amigo la recuerda (solo amigos, por número) para verla aunque no
 *   estés conectado. En los canales generales no se muestra: allí siguen las iniciales.
 * • Letra y fondo son preferencias de este dispositivo (localStorage).
 */
import { esc, avatar } from './common.js';

const PHOTO_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
const MAX_PHOTO = 120 * 1024; // caracteres del dataURL (~90 KB)
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* lleno o bloqueado */ } },
};

/* ---------------- Fotos ---------------- */
const session = new Map(); // fotos de privados ocasionales (no amigos): solo mientras dure la sesión
const listeners = new Set();
let owner = 'guest';
export const photos = {
  /** Cuenta actual (para guardar «mi foto» por cuenta en este dispositivo). */
  setOwner(id) { owner = id || 'guest'; },
  mine: () => store.get('myphoto:' + owner),
  /** Imagen original (sin recortar) para poder volver a ajustarla. */
  mineSource: () => store.get('myphoto-src:' + owner),
  setMine(data, source) {
    store.set('myphoto:' + owner, data);
    if (source !== undefined || !data) store.set('myphoto-src:' + owner, data ? source : null);
    listeners.forEach((f) => f('me'));
  },
  /** key: 'u:<número>' (amigo, se recuerda) o 't:<id>' (privado ocasional, solo esta sesión). */
  get: (key) => (key.startsWith('u:') ? store.get('photo:' + key) : session.get(key)) || null,
  set(key, data) {
    if (data && (!PHOTO_RE.test(data) || data.length > MAX_PHOTO)) return false;
    if (key.startsWith('u:')) store.set('photo:' + key, data || null); else if (data) session.set(key, data); else session.delete(key);
    listeners.forEach((f) => f(key));
    return true;
  },
  valid: (data) => !data || (PHOTO_RE.test(data) && data.length <= MAX_PHOTO),
  onChange: (fn) => listeners.add(fn),
  /** Avatar con foto (si la hay) o las iniciales de siempre. */
  avatar(key, nick) {
    const src = key === 'me' ? photos.mine() : photos.get(key);
    return src ? `<span class="avatar photo"><img src="${esc(src)}" alt=""></span>` : avatar(nick);
  },
};

/** Elige una imagen del dispositivo y la reduce. square: recorte cuadrado (foto de perfil). */
export function pickImage({ max = 256, square = true, quality = 0.8 } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      try {
        const bmp = await createImageBitmap(file);
        let sx = 0, sy = 0, sw = bmp.width, sh = bmp.height;
        if (square) { const s = Math.min(sw, sh); sx = (sw - s) / 2; sy = (sh - s) / 2; sw = sh = s; }
        const scale = Math.min(1, max / Math.max(sw, sh));
        const c = document.createElement('canvas');
        c.width = Math.round(sw * scale); c.height = Math.round(sh * scale);
        c.getContext('2d').drawImage(bmp, sx, sy, sw, sh, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', quality));
      } catch { resolve(null); }
    };
    input.click();
  });
}

/* ---------------- Letra y fondo ---------------- */
export const FONT_SIZES = { normal: 1, grande: 1.15, enorme: 1.3 };
export const FONT_LABELS = { normal: 'Normal', grande: 'Grande', enorme: 'Muy grande' };
export const WALLPAPERS = {
  clasico: { label: 'Clásico', css: '' },
  atardecer: { label: 'Atardecer', css: 'linear-gradient(160deg, #ffb199, #ff0844)' },
  noche: { label: 'Noche', css: 'linear-gradient(160deg, #141e30, #243b55)' },
  bosque: { label: 'Bosque', css: 'linear-gradient(160deg, #134e5e, #71b280)' },
  cielo: { label: 'Cielo', css: 'linear-gradient(160deg, #a1c4fd, #c2e9fb)' },
  lavanda: { label: 'Lavanda', css: 'linear-gradient(160deg, #e0c3fc, #8ec5fc)' },
  arena: { label: 'Arena', css: 'linear-gradient(160deg, #f6d365, #fda085)' },
};

/** Colores de la app (el rojo es el de ChamuFlac). */
export const ACCENTS = {
  rojo: { label: 'Rojo ChamuFlac', a: '', a2: '', g: '' },
  azul: { label: 'Azul', a: '#2563eb', a2: '#60a5fa', g: 'linear-gradient(135deg, #60a5fa, #1d4ed8)' },
  verde: { label: 'Verde', a: '#16a34a', a2: '#4ade80', g: 'linear-gradient(135deg, #4ade80, #15803d)' },
  violeta: { label: 'Violeta', a: '#7c3aed', a2: '#a78bfa', g: 'linear-gradient(135deg, #a78bfa, #6d28d9)' },
  naranja: { label: 'Naranja', a: '#ea580c', a2: '#fb923c', g: 'linear-gradient(135deg, #fdba74, #c2410c)' },
  rosa: { label: 'Rosa', a: '#db2777', a2: '#f472b6', g: 'linear-gradient(135deg, #f9a8d4, #be185d)' },
  turquesa: { label: 'Turquesa', a: '#0d9488', a2: '#2dd4bf', g: 'linear-gradient(135deg, #5eead4, #0f766e)' },
};
export const display = {
  accent: () => (ACCENTS[store.get('accent')] ? store.get('accent') : 'rojo'),
  setAccent(k) { store.set('accent', k); applyDisplay(); },
  font: () => (FONT_SIZES[store.get('fontSize')] ? store.get('fontSize') : 'normal'),
  wall: () => store.get('wall') || 'clasico',
  setFont(k) { store.set('fontSize', k); applyDisplay(); },
  setWall(k, img = null) {
    store.set('wall', k);
    if (k === 'foto') store.set('wallImg', img);
    applyDisplay();
  },
};

/** Aplica letra y fondo guardados (al arrancar y al cambiarlos). */
export function applyDisplay() {
  const root = document.documentElement;
  root.style.setProperty('--fs', String(FONT_SIZES[display.font()]));
  const ac = ACCENTS[display.accent()];
  for (const [v, val] of [['--accent', ac.a], ['--accent-2', ac.a2], ['--dm-accent', ac.a2 && ac.a], ['--brand-grad', ac.g]]) {
    if (val) root.style.setProperty(v, val); else root.style.removeProperty(v);
  }
  if (ac.a) root.style.setProperty('--active', ac.a + '29'); else root.style.removeProperty('--active');
  const wall = display.wall();
  const img = wall === 'foto' ? store.get('wallImg') : null;
  const css = img ? `url("${img}") center / cover` : WALLPAPERS[wall]?.css || '';
  if (css) { root.dataset.wall = wall; root.style.setProperty('--wall', css); } else { delete root.dataset.wall; root.style.removeProperty('--wall'); }
}

/** Muestra de un fondo (para el menú). */
export const accentSwatch = (k) => `<i class="wall-swatch" style="background:${ACCENTS[k].a || '#e11d48'}"></i>`;
export const wallSwatch = (k) => `<i class="wall-swatch" style="background:${k === 'foto' ? 'var(--elev)' : WALLPAPERS[k].css || 'var(--dm-bg)'}"></i>`;

/* ---------------- Editor de la foto (encuadre) ---------------- */
/**
 * Muestra la imagen con una máscara circular: se arrastra para moverla y el control
 * deslizante la acerca o aleja. Devuelve la foto final (cuadrada, 256 px) o null.
 * t: función de traducción de la app.
 */
export function editPhoto(src, t = (s) => s) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => open();
    img.onerror = () => resolve(null);
    img.src = src;
    function open() {
      const S = 280; // tamaño del visor
      const base = Math.max(S / img.width, S / img.height); // escala mínima que cubre el círculo
      let zoom = 1, x = 0, y = 0; // desplazamiento en px del visor
      const wrap = document.createElement('div');
      wrap.className = 'dialog-wrap ph-editor-wrap';
      wrap.innerHTML = `<div class="dialog ph-editor" role="dialog" aria-modal="true">
        <h3>${esc(t('Ajustar foto'))}</h3>
        <p class="muted small">${esc(t('Arrastra para moverla y usa el control para acercarla o alejarla.'))}</p>
        <div class="ph-stage" style="width:${S}px;height:${S}px"><img alt="" draggable="false"><i class="ph-mask"></i></div>
        <label class="ph-zoom"><span>−</span><input type="range" min="1" max="4" step="0.01" value="1" aria-label="Zoom"><span>+</span></label>
        <div class="dialog-actions"><button type="button" class="btn" data-x>${esc(t('Cancelar'))}</button><button type="button" class="btn primary" data-ok>${esc(t('Guardar'))}</button></div>
      </div>`;
      document.body.appendChild(wrap);
      const el = wrap.querySelector('.ph-stage img');
      el.src = src;
      const clamp = () => {
        const w = img.width * base * zoom, h = img.height * base * zoom;
        x = Math.min(Math.max(x, S - w), 0); y = Math.min(Math.max(y, S - h), 0);
      };
      const draw = () => { clamp(); el.style.width = img.width * base * zoom + 'px'; el.style.transform = `translate(${x}px, ${y}px)`; };
      // Centrada al empezar
      x = (S - img.width * base) / 2; y = (S - img.height * base) / 2; draw();
      const range = wrap.querySelector('input[type=range]');
      range.oninput = () => {
        const cx = S / 2 - x, cy = S / 2 - y, old = zoom; // mantener el centro
        zoom = Number(range.value);
        x = S / 2 - cx * (zoom / old); y = S / 2 - cy * (zoom / old); draw();
      };
      const stage = wrap.querySelector('.ph-stage');
      let drag = null;
      stage.onpointerdown = (e) => { drag = { px: e.clientX, py: e.clientY, x, y }; stage.setPointerCapture(e.pointerId); };
      stage.onpointermove = (e) => { if (!drag) return; x = drag.x + e.clientX - drag.px; y = drag.y + e.clientY - drag.py; draw(); };
      stage.onpointerup = stage.onpointercancel = () => { drag = null; };
      stage.onwheel = (e) => { e.preventDefault(); range.value = Math.min(4, Math.max(1, zoom - e.deltaY / 500)); range.oninput(); };
      const done = (v) => { wrap.remove(); resolve(v); };
      wrap.querySelector('[data-x]').onclick = () => done(null);
      wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) done(null); });
      wrap.querySelector('[data-ok]').onclick = () => {
        const out = 256, k = 1 / (base * zoom); // px del visor → px de la imagen
        const c = document.createElement('canvas');
        c.width = c.height = out;
        c.getContext('2d').drawImage(img, -x * k, -y * k, S * k, S * k, 0, 0, out, out);
        done(c.toDataURL('image/jpeg', 0.82));
      };
    }
  });
}

/** Elegir una foto nueva y encuadrarla. Devuelve { photo, source } o null. */
export async function chooseAndEditPhoto(t) {
  const source = await pickImage({ max: 1024, square: false, quality: 0.85 });
  if (!source) return null;
  const photo = await editPhoto(source, t);
  return photo ? { photo, source } : null;
}
