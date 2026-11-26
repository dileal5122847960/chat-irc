/*
 * Traducción de mensajes (a pedido: botón «Traducir»)
 * ─────────────────────────────────
 * 1) Traductor integrado de Chrome (API "Translator"): gratis, en el propio dispositivo,
 *    el texto no sale del navegador.
 * 2) Respaldo: MyMemory (api.mymemory.translated.net): gratis y sin cuenta, con un
 *    límite diario por persona. En este caso el texto sí se envía a ese servicio.
 * Nada se guarda en nuestra base de datos.
 */

const cache = new Map(); // "de|a|texto" -> traducción
const chromeTranslators = new Map(); // "de|a" -> Promise<Translator>
let myMemoryBlockedUntil = 0;

function decodeEntities(s) {
  const t = document.createElement('textarea');
  t.innerHTML = s;
  return t.value;
}

const withTimeout = (promise, ms) => Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
const chromeBroken = new Set(); // pares de idiomas en los que Chrome no respondió

async function viaChrome(text, from, to) {
  if (!('Translator' in self)) return null;
  const key = from + '|' + to;
  if (chromeBroken.has(key)) return null;
  if (!chromeTranslators.has(key)) {
    chromeTranslators.set(key, (async () => {
      const av = await withTimeout(self.Translator.availability({ sourceLanguage: from, targetLanguage: to }), 2500);
      if (av === 'unavailable') return null;
      const creating = self.Translator.create({ sourceLanguage: from, targetLanguage: to });
      // Si el modelo aún se está descargando, se usa el respaldo ahora y Chrome queda listo para después
      if (av !== 'available') { creating.then((tr) => chromeTranslators.set(key, Promise.resolve(tr))).catch(() => {}); return null; }
      return withTimeout(creating, 4000);
    })().catch(() => { chromeBroken.add(key); return null; }));
  }
  const tr = await chromeTranslators.get(key);
  if (!tr) { if (!chromeBroken.has(key)) chromeTranslators.delete(key); return null; }
  try { return await withTimeout(tr.translate(text), 6000); } catch { chromeBroken.add(key); return null; }
}

/** Divide textos largos en trozos de hasta ~450 caracteres (límite de MyMemory). */
function chunks(text, max = 450) {
  if (text.length <= max) return [text];
  const out = [];
  let cur = '';
  for (const part of text.split(/(?<=[.!?¿¡\n])\s+/)) {
    if ((cur + ' ' + part).length > max && cur) { out.push(cur); cur = ''; }
    if (part.length > max) { for (let i = 0; i < part.length; i += max) out.push(part.slice(i, i + max)); continue; }
    cur = cur ? cur + ' ' + part : part;
  }
  if (cur) out.push(cur);
  return out;
}

async function viaMyMemory(text, from, to) {
  if (Date.now() < myMemoryBlockedUntil) throw new Error('quota');
  const parts = [];
  for (const piece of chunks(text)) {
    // El servicio detecta él mismo el idioma de origen (más fiable que suponerlo)
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(piece)}&langpair=autodetect|${to}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.responseStatus !== 200 && data.responseStatus !== '200') {
      if (String(data.responseStatus) === '429' || /QUOTA|LIMIT/i.test(data.responseDetails || '')) myMemoryBlockedUntil = Date.now() + 60 * 60 * 1000;
      throw new Error(data.responseDetails || 'translation failed');
    }
    if (String(data.responseData.detectedLanguage || '').slice(0, 2) === to) throw new Error('same'); // ya está en tu idioma
    const out = decodeEntities(data.responseData.translatedText || '');
    if (/^MYMEMORY WARNING/i.test(out)) { myMemoryBlockedUntil = Date.now() + 60 * 60 * 1000; throw new Error('quota'); }
    parts.push(out);
  }
  return parts.join(' ');
}

/* ---------------- Detección del idioma real del texto ---------------- */
// Se hace en el dispositivo de quien escribe (sin enviar nada a ningún servicio): palabras muy
// frecuentes de cada idioma y algunas letras propias. Si no está claro (mensajes muy cortos),
// devuelve null y se usa el idioma de la interfaz de quien escribe.
const WORDS = {
  es: 'el la los las de que y en un una es por con para no se lo como pero más está estoy qué muy también hola gracias nos vemos mañana porque cuando donde dónde yo tú mi sí hay este esta eso todo bien al del ya hoy mucho gusta buena bueno ahora entonces nada algo',
  en: 'the and is are you to of in it that this for with on have be was i my what how not do at see tomorrow hello thanks thank good will can your we they me am from today there just really now something',
  pt: 'o a os as de que e em um uma é não com para por você eu está estou muito obrigado obrigada também olá mas isso isto tudo bem nós amanhã vamos onde quando ao do da no na hoje agora nada coisa',
  fr: "le la les de des et est un une je tu il elle nous vous pas que qui en dans pour avec sur ce cette mais bonjour merci oui très aussi demain à au du ne c'est suis j'ai aujourd'hui vraiment beaucoup maintenant rien",
  it: 'il lo la gli le di che e è un una non per con sono sei ci vediamo domani ciao grazie anche molto ma questo questa del della alla nel come perché io tu noi oggi adesso niente cosa',
};
const WORDSETS = Object.fromEntries(Object.entries(WORDS).map(([k, v]) => [k, new Set(v.split(' '))]));
const LETTERS = [[/[ñ¿¡]/g, 'es', 3], [/[ãõ]/g, 'pt', 3], [/ç/g, 'pt', 1], [/ç/g, 'fr', 1], [/[œùûî]/g, 'fr', 2], [/[êâô]/g, 'fr', 1], [/[êâô]/g, 'pt', 1], [/[ìò]/g, 'it', 2]];
export function detectLang(text) {
  const lower = String(text || '').toLowerCase();
  const words = lower.match(/[a-zà-ÿœ']+/g) || [];
  const score = { es: 0, en: 0, pt: 0, fr: 0, it: 0 };
  for (const w of words) for (const k in WORDSETS) if (WORDSETS[k].has(w)) score[k] += 1;
  for (const [re, k, pts] of LETTERS) score[k] += (lower.match(re) || []).length * pts;
  const [[best, a], [, b]] = Object.entries(score).sort((x, y) => y[1] - x[1]);
  return a >= 2 && a >= b * 1.5 ? best : null;
}

/**
 * Traduce un texto. Devuelve { text, engine } o null si no se pudo.
 * engine: 'chrome' | 'mymemory'
 */
export async function translate(text, from, to) {
  if (!text || !text.trim() || !from || !to || from === to) return null;
  const key = `${from}|${to}|${text}`;
  if (cache.has(key)) return cache.get(key);
  let result = null;
  try {
    const t = await viaChrome(text, from, to);
    if (t) result = { text: t, engine: 'chrome' };
  } catch { /* sin traductor de Chrome para este par */ }
  if (!result) {
    try { result = { text: await viaMyMemory(text, from, to), engine: 'mymemory' }; } catch { result = null; }
  }
  if (result && result.text && result.text.trim().toLowerCase() !== text.trim().toLowerCase()) {
    cache.set(key, result);
    if (cache.size > 2000) cache.delete(cache.keys().next().value);
    return result;
  }
  return null;
}
