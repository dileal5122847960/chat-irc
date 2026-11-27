/*
 * Captcha contra bots (Cloudflare Turnstile, gratis) para crear cuenta e ingresar con correo.
 * • Casi siempre es invisible: solo aparece una casilla si Cloudflare duda.
 * • El token va a Supabase (options.captchaToken), que lo comprueba con la clave secreta
 *   (Authentication → Attack Protection → Captcha). Cada token sirve una sola vez.
 * • Si el script no carga (sin conexión, bloqueadores), se sigue sin token: mientras el captcha
 *   no esté activado en Supabase todo funciona igual; con él activado, Supabase lo rechaza.
 * Google no lo necesita (el acceso lo protege Google).
 */
import { TURNSTILE_SITE_KEY } from './config.js';

let loading = null;
function loadScript() {
  loading ||= new Promise((resolve) => {
    if (window.turnstile) return resolve(window.turnstile);
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => resolve(window.turnstile || null);
    s.onerror = () => { loading = null; resolve(null); };
    document.head.appendChild(s);
    setTimeout(() => resolve(window.turnstile || null), 10000);
  });
  return loading;
}

/**
 * Pide un token para este formulario. El recuadro se coloca antes del botón de enviar.
 * Devuelve el token o null (si no se pudo cargar o la persona no lo completó a tiempo).
 */
export async function captchaToken(form, { lang = 'auto', timeout = 60000 } = {}) {
  const ts = await loadScript();
  if (!ts) return null;
  let box = form.querySelector('.captcha-box');
  if (box?.dataset.widget) { try { ts.remove(box.dataset.widget); } catch { /* nada */ } box.remove(); box = null; }
  box = document.createElement('div');
  box.className = 'captcha-box';
  form.querySelector('button[type=submit]')?.before(box);
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; resolve(v); };
    try {
      box.dataset.widget = ts.render(box, {
        sitekey: TURNSTILE_SITE_KEY,
        appearance: 'interaction-only', // solo se ve si hace falta tocarlo
        language: lang,
        callback: (token) => finish(token),
        'error-callback': () => finish(null),
        'expired-callback': () => finish(null),
      });
    } catch { finish(null); }
    setTimeout(() => finish(null), timeout);
  });
}
