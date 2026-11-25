/*
 * Traducción automática de mensajes
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
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(piece)}&langpair=${from}|${to}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.responseStatus !== 200 && data.responseStatus !== '200') {
      if (String(data.responseStatus) === '429' || /QUOTA|LIMIT/i.test(data.responseDetails || '')) myMemoryBlockedUntil = Date.now() + 60 * 60 * 1000;
      throw new Error(data.responseDetails || 'translation failed');
    }
    parts.push(decodeEntities(data.responseData.translatedText || ''));
  }
  return parts.join(' ');
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
