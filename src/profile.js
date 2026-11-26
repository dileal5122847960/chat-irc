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
  setMine(data) { store.set('myphoto:' + owner, data); listeners.forEach((f) => f('me')); },
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

export const display = {
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
  const wall = display.wall();
  const img = wall === 'foto' ? store.get('wallImg') : null;
  const css = img ? `url("${img}") center / cover` : WALLPAPERS[wall]?.css || '';
  if (css) { root.dataset.wall = wall; root.style.setProperty('--wall', css); } else { delete root.dataset.wall; root.style.removeProperty('--wall'); }
}

/** Muestra de un fondo (para el menú). */
export const wallSwatch = (k) => `<i class="wall-swatch" style="background:${k === 'foto' ? 'var(--elev)' : WALLPAPERS[k].css || 'var(--dm-bg)'}"></i>`;
