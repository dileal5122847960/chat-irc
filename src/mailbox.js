/*
 * Buzón entre amigos (mensajes para quien está desconectado)
 * ────────────────────────────────────────────────────────────
 * • Cada dispositivo (app o navegador) tiene su par de claves ECDH P-256. La clave privada no
 *   sale nunca del dispositivo; la pública se guarda en devices.public_key.
 * • Para escribir a un amigo desconectado, el mensaje se cifra AQUÍ (AES-GCM con una clave
 *   acordada por ECDH con una clave efímera) una vez por cada dispositivo del amigo, y se deja
 *   en el buzón (mail_send). El servidor solo ve texto cifrado.
 * • Cada dispositivo recoge lo suyo con mail_fetch(), que lo devuelve y lo BORRA.
 * Solo texto y stickers: fotos, audios y llamadas necesitan que ambos estén conectados.
 */
const ALG = { name: 'ECDH', namedCurve: 'P-256' };
const b64 = (buf) => { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* nada */ } },
};

export function createMailbox({ supabase, platform, version, deviceName }) {
  let uid = null;
  let deviceId = null;
  let keys = null; // { privateKey, publicJwk }

  async function loadKeys() {
    const k = 'devkey:' + uid;
    const saved = store.get(k);
    if (saved) {
      try {
        const jwk = JSON.parse(saved);
        const privateKey = await crypto.subtle.importKey('jwk', jwk, ALG, false, ['deriveKey']);
        return { privateKey, publicJwk: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y } };
      } catch { /* clave dañada: se crea otra */ }
    }
    const pair = await crypto.subtle.generateKey(ALG, true, ['deriveKey']);
    const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
    store.set(k, JSON.stringify(jwk));
    return { privateKey: pair.privateKey, publicJwk: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y } };
  }

  /** Registra este dispositivo (versión, token push y clave pública). Devuelve su id. */
  async function register(userId, pushToken = null) {
    if (uid !== userId) { uid = userId; keys = null; deviceId = null; }
    keys ||= await loadKeys();
    const k = 'deviceId:' + uid;
    const { data, error } = await supabase.rpc('register_device', {
      p_device: Number(store.get(k)) || null, p_platform: platform, p_name: deviceName(), p_version: version,
      p_push_token: pushToken, p_public_key: JSON.stringify({ x: keys.publicJwk.x, y: keys.publicJwk.y }),
    });
    if (!error && data) { deviceId = Number(data); store.set(k, String(deviceId)); }
    return deviceId;
  }

  async function encryptFor(publicKey, text) {
    const { x, y } = JSON.parse(publicKey);
    const theirs = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x, y }, ALG, false, []);
    const eph = await crypto.subtle.generateKey(ALG, true, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'ECDH', public: theirs }, eph.privateKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
    const e = await crypto.subtle.exportKey('jwk', eph.publicKey);
    return { v: 1, e: { x: e.x, y: e.y }, i: b64(iv), c: b64(ct) };
  }
  async function decrypt(body) {
    const eph = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: body.e.x, y: body.e.y }, ALG, false, []);
    const key = await crypto.subtle.deriveKey({ name: 'ECDH', public: eph }, keys.privateKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(body.i) }, key, unb64(body.c));
    return JSON.parse(new TextDecoder().decode(pt));
  }

  /**
   * Deja un mensaje para un amigo. msg: objeto pequeño ({ t: 'text', mid, text, … }).
   * Devuelve { ok, reason } — reason 'nodevices' si el amigo no tiene ningún dispositivo que
   * pueda recibir mensajes guardados (p. ej. una versión antigua de la app).
   */
  async function send(toNumber, msg) {
    const { data: devs, error } = await supabase.rpc('friend_devices', { p_number: Number(toNumber) });
    if (error) return { ok: false, reason: error.message };
    if (!devs?.length) return { ok: false, reason: 'nodevices' };
    const text = JSON.stringify(msg);
    const items = [];
    for (const d of devs) {
      try { items.push({ device: d.device, body: await encryptFor(d.public_key, text) }); } catch { /* clave no válida */ }
    }
    if (!items.length) return { ok: false, reason: 'nodevices' };
    // En tandas de 20 copias (el servidor no acepta más por llamada)
    let saved = 0, lastError = '';
    for (let i = 0; i < items.length; i += 20) {
      const r = await supabase.rpc('mail_send', { p_to: Number(toNumber), p_items: items.slice(i, i + 20) });
      if (r.error) lastError = r.error.message; else saved += r.data || 0;
    }
    if (!saved) return { ok: false, reason: lastError || 'full' };
    return { ok: true, reason: '' };
  }

  /** Recoge (y borra del servidor) los mensajes de este dispositivo. */
  let fetching = null;
  function fetch() {
    if (!deviceId || !keys) return Promise.resolve([]);
    fetching ||= (async () => {
      try {
        const { data, error } = await supabase.rpc('mail_fetch', { p_device: deviceId });
        if (error || !data?.length) return [];
        const out = [];
        for (const row of data.sort((a, b) => a.id - b.id)) {
          try { out.push({ from: String(row.from_number), at: row.created_at, msg: await decrypt(row.body) }); }
          catch { out.push({ from: String(row.from_number), at: row.created_at, msg: { t: 'undecryptable' } }); }
        }
        return out;
      } finally { fetching = null; }
    })();
    return fetching;
  }

  return { register, send, fetch, deviceId: () => deviceId };
}
