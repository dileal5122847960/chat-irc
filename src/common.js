/* Piezas de interfaz compartidas por la web y la app (iconos, avatares, sonidos…). */
import { getLang } from './i18n.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- Iconos ---------- */
const I = {
  share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.4M8.2 13.2l7.6 4.4"/>',
  line1: '<path d="M5 12h14"/>',
  line2: '<path d="M5 9h14M5 15h14"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l2.5 2"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  'user-plus': '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M19 8v6M16 11h6"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.9-3.5M4 5v4h4M4 13a8 8 0 0 0 14.9 3.5M20 19v-4h-4"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
  hash: '<path d="M5 9h14M5 15h14M10 3 8 21M16 3l-2 18"/>',
  home: '<path d="M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14a5 5 0 0 1 6 5"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  send: '<path d="M4 12 20 4l-6 16-2.5-6.5z"/>',
  logout: '<path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
  dots: '<circle cx="12" cy="5" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="12" cy="19" r="1.3"/>',
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.5 2.5M15.2 15.2l2.5 2.5M6.3 17.7l2.5-2.5M15.2 8.8l2.5-2.5"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
  crown: '<path d="M3 8l4 4 5-7 5 7 4-4-2 11H5z"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>',
  'shield-off': '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6zM4 4l16 16"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/>',
  at: '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>',
  door: '<path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  eraser: '<path d="m7 21-4-4L14 6l6 6-9 9zM9 21h12M10 10l6 6"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z"/>',
  'phone-off': '<path d="M3 14.5c5-5 13-5 18 0l-2 2.5-3.5-1.5v-2.5a10 10 0 0 0-7 0v2.5L5 17z"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3z"/>',
  'video-off': '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3zM2 3l20 18"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  'mic-off': '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M3 3l18 18"/>',
  clip: '<path d="M20 11.5 12.5 19a5 5 0 0 1-7-7l8-8a3.3 3.3 0 0 1 4.7 4.7l-8 8a1.7 1.7 0 0 1-2.4-2.4l7.3-7.3"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  message: '<path d="M4 5h16v11H8l-4 4z"/><path d="M8 9h8M8 12h5"/>',
  smile: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0"/><circle cx="9" cy="10" r=".8"/><circle cx="15" cy="10" r=".8"/>',
  play: '<path d="M7 4v16l13-8z" fill="currentColor"/>',
  pause: '<path d="M7 4h3v16H7zM14 4h3v16h-3z" fill="currentColor"/>',
  check2: '<path d="m2.5 12.5 4 4 10-10M11.5 16.5l1 0L22 6.5"/>',
  'eye-off': '<path d="M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c6 0 10 6 10 6a17 17 0 0 1-3.3 3.9M6.3 7.6A17 17 0 0 0 2 12s4 6 10 6a10 10 0 0 0 4.2-.9M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  unlock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.7-1.5"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  shrink: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  pdf: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 13h6M9 17h4"/>',
  translate: '<path d="M4 5h9M8.5 3v2M6 5c0 4 3 7 6 8M11 5c0 3-3 7-7 9"/><path d="m13 20 4-9 4 9M14.5 17h5"/>',
};
export const icon = (n, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[n]}</svg>`;
export const verified = '<span class="verified" title="Usuario registrado">' + icon('check') + '</span>';

/* ---------- Avatares y colores ---------- */
export function hue(nick) { let h = 0; for (const c of nick.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; }
export const nickStyle = (nick) => `--h:${hue(nick)}`;
/** Avatares en la gama de rojos de ChamuFlac (rojos, rubíes, corales, vinos). */
export function avatar(nick) {
  const h = hue(nick);
  return `<span class="avatar" style="--h:${(340 + (h % 50)) % 360};--l:${42 + (h % 4) * 6}%">${esc(nick.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '?')}</span>`;
}

/* ---------- Mensajes ---------- */
export const time = (d) => new Date(d).toLocaleTimeString(getLang(), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export function linkify(s) {
  return '<span class="ugc">' + linkifyRaw(s) + '</span>';
}
export function linkifyRaw(s) {
  return esc(s)
    .replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\*([^*\n]+)\*/g, '<b>$1</b>')
    .replace(/(^|\s)_([^_\n]+)_(?=\s|$)/g, '$1<i>$2</i>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>');
}

/* ---------- Sonidos (generados, sin archivos) ---------- */
let audioCtx;
export function beep(freqs = [880, 1320], dur = 0.12, vol = 0.08) {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    freqs.forEach((f, i) => {
      const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
      o.frequency.value = f;
      const t = audioCtx.currentTime + i * dur;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(audioCtx.destination); o.start(t); o.stop(t + dur + 0.02);
    });
  } catch { /* sin audio */ }
}
/* ---------- Tonos de mensaje y de llamada (se generan aquí, sin archivos) ---------- */
// notes: [frecuencia, inicio (s), duración (s)]. every: cada cuánto se repite (llamadas).
export const TONES = {
  msg: {
    clasico: { label: 'Clásico', type: 'sine', vol: 0.08, notes: [[880, 0, 0.12], [1320, 0.12, 0.12]] },
    chamuflac: { label: 'ChamuFlac', type: 'triangle', vol: 0.09, notes: [[659, 0, 0.1], [784, 0.1, 0.1], [1047, 0.2, 0.22]] },
    gota: { label: 'Gota', type: 'sine', vol: 0.12, slide: true, notes: [[1400, 0, 0.09], [620, 0.07, 0.14]] },
    campanita: { label: 'Campanita', type: 'triangle', vol: 0.07, notes: [[1568, 0, 0.6], [2093, 0.09, 0.6]] },
    pop: { label: 'Pop', type: 'square', vol: 0.035, notes: [[520, 0, 0.06], [780, 0.07, 0.08]] },
    silencio: { label: 'Silencio', notes: [] },
  },
  call: {
    clasico: { label: 'Clásico', type: 'sine', vol: 0.12, every: 2200, notes: [[660, 0, 0.18], [880, 0.18, 0.18], [660, 0.36, 0.18], [880, 0.54, 0.18]] },
    marimba: { label: 'Marimba', type: 'triangle', vol: 0.15, every: 2000, notes: [[523, 0, 0.28], [659, 0.15, 0.28], [784, 0.3, 0.28], [1047, 0.45, 0.45], [784, 0.75, 0.3]] },
    digital: { label: 'Digital', type: 'square', vol: 0.045, every: 1800, notes: [[1000, 0, 0.08], [1000, 0.12, 0.08], [1000, 0.24, 0.08], [1300, 0.5, 0.08], [1300, 0.62, 0.08], [1300, 0.74, 0.08]] },
    suave: { label: 'Suave', type: 'sine', vol: 0.11, every: 2800, notes: [[440, 0, 0.7], [554, 0.3, 0.7], [659, 0.6, 0.9]] },
    retro: { label: 'Teléfono antiguo', type: 'sine', vol: 0.08, every: 3000, notes: Array.from({ length: 16 }, (_, i) => [i % 2 ? 480 : 440, i * 0.06, 0.06]) },
    silencio: { label: 'Silencio', every: 3000, notes: [] },
  },
};
const tonePref = (kind) => { try { return localStorage.getItem('tone:' + kind) || ''; } catch { return ''; } };
export const sounds = {
  get: (kind) => (TONES[kind][tonePref(kind)] ? tonePref(kind) : kind === 'msg' ? 'chamuflac' : 'clasico'),
  set(kind, id) { try { localStorage.setItem('tone:' + kind, id); } catch { /* nada */ } },
};
function playNotes(tone) {
  if (!tone?.notes?.length) return;
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const now = audioCtx.currentTime;
    tone.notes.forEach(([f, start, dur], i) => {
      const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
      o.type = tone.type || 'sine';
      const t0 = now + start;
      o.frequency.setValueAtTime(f, t0);
      if (tone.slide && tone.notes[i + 1]) o.frequency.exponentialRampToValueAtTime(tone.notes[i + 1][0], t0 + dur);
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(tone.vol, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(audioCtx.destination); o.start(t0); o.stop(t0 + dur + 0.03);
    });
  } catch { /* sin audio */ }
}
/** Suena el tono elegido (o el indicado, para escucharlo antes de elegirlo). */
export function playTone(kind, id) { playNotes(TONES[kind][id || sounds.get(kind)]); }
export function loopTone(kind) {
  // 'ring': llamada entrante (tono elegido) · 'back': quien llama oye que está sonando
  const tone = kind === 'ring' ? TONES.call[sounds.get('call')] : { type: 'sine', vol: 0.05, every: 3000, notes: [[440, 0, 0.6], [480, 0, 0.6]] };
  playNotes(tone);
  const t = setInterval(() => playNotes(tone), tone.every || 3000);
  return () => clearInterval(t);
}
