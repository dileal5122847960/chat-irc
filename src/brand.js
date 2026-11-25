// Identidad visual de ChamuFlac: logo y banderas (SVG propios, sin archivos externos).

export const APP_NAME = 'ChamuFlac';

/** Logo: dos burbujas de conversación superpuestas con una chispa, en degradado rojo. */
export function logoSvg(size = 40, id = 'lg') {
  return `<svg class="brand-logo" width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true">
    <defs>
      <linearGradient id="${id}a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff5a5f"/><stop offset="1" stop-color="#c81d3a"/></linearGradient>
      <linearGradient id="${id}b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff9a8b"/><stop offset="1" stop-color="#ff4d6d"/></linearGradient>
    </defs>
    <path d="M38 8h12a10 10 0 0 1 10 10v10a10 10 0 0 1-10 10h-1v7l-8-7h-3a10 10 0 0 1-10-10V18A10 10 0 0 1 38 8z" fill="url(#${id}b)" opacity=".9"/>
    <path d="M14 18h22a10 10 0 0 1 10 10v12a10 10 0 0 1-10 10H24l-10 8v-8a10 10 0 0 1-10-10V28a10 10 0 0 1 10-10z" fill="url(#${id}a)"/>
    <path d="M25 26l2.6 6.4L34 35l-6.4 2.6L25 44l-2.6-6.4L16 35l6.4-2.6z" fill="#fff"/>
    <circle cx="36" cy="30" r="2.2" fill="#fff" opacity=".85"/>
  </svg>`;
}

/** Banderas simplificadas (se ven igual en Windows, Mac, Android e iPhone). */
export const FLAGS = {
  es: `<svg viewBox="0 0 30 20"><rect width="30" height="20" fill="#c60b1e"/><rect y="5" width="30" height="10" fill="#ffc400"/></svg>`,
  en: `<svg viewBox="0 0 60 40"><clipPath id="ukc"><rect width="60" height="40"/></clipPath><g clip-path="url(#ukc)"><rect width="60" height="40" fill="#012169"/><path d="M0 0l60 40M60 0L0 40" stroke="#fff" stroke-width="8"/><path d="M0 0l60 40M60 0L0 40" stroke="#c8102e" stroke-width="3"/><path d="M30 0v40M0 20h60" stroke="#fff" stroke-width="12"/><path d="M30 0v40M0 20h60" stroke="#c8102e" stroke-width="7"/></g></svg>`,
  pt: `<svg viewBox="0 0 30 20"><rect width="30" height="20" fill="#009c3b"/><path d="M15 2.5 27.5 10 15 17.5 2.5 10z" fill="#ffdf00"/><circle cx="15" cy="10" r="4.3" fill="#002776"/><path d="M10.9 9.2q4.1-1.3 8.2.8" stroke="#fff" stroke-width=".8" fill="none"/></svg>`,
  fr: `<svg viewBox="0 0 30 20"><rect width="10" height="20" fill="#0055a4"/><rect x="10" width="10" height="20" fill="#fff"/><rect x="20" width="10" height="20" fill="#ef4135"/></svg>`,
  it: `<svg viewBox="0 0 30 20"><rect width="10" height="20" fill="#009246"/><rect x="10" width="10" height="20" fill="#fff"/><rect x="20" width="10" height="20" fill="#ce2b37"/></svg>`,
};
export const flag = (code) => `<span class="flag" aria-hidden="true">${FLAGS[code] || ''}</span>`;
