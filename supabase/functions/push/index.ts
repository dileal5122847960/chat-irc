// Edge Function "push": avisa a un amigo (aviso push de Firebase) de que alguien quiere
// hablar con él o le está llamando, aunque tenga la app cerrada.
//
// Petición (POST, con la sesión del usuario en "Authorization: Bearer <token>"):
//   { "to": 12345678, "kind": "dm" | "call" | "friend" | "msg", "id": "<sala>", "video": false }
// "msg": dejó mensajes en el buzón (el aviso no lleva el texto: va cifrado de extremo a extremo).
// Solo se avisa si quien llama y el destinatario son amigos (o, para "friend", si le envió
// una solicitud de amistad). Lo comprueba push_targets() en la base de datos.
//
// Secretos (Supabase → Edge Functions → Secrets):
//   FCM_SERVICE_ACCOUNT → el JSON completo de la cuenta de servicio de Firebase
//                         (Configuración del proyecto → Cuentas de servicio → Generar nueva clave privada)
// SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY los pone Supabase automáticamente.
//
// Para pasar más adelante a otro proveedor de avisos (o añadir APNs para iOS), solo cambia
// la función sendFcm().
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const FCM_SERVICE_ACCOUNT = Deno.env.get('FCM_SERVICE_ACCOUNT') ?? '';
const ALLOWED = ['https://chat-irc.vercel.app', 'https://localhost', 'http://localhost:5173', 'http://localhost:5174'];

// Límite sencillo por usuario (en memoria de cada instancia): evita ráfagas de avisos
const recent = new Map<string, number[]>();
function tooMany(uid: string) {
  const now = Date.now();
  const list = (recent.get(uid) ?? []).filter((t) => now - t < 60_000);
  list.push(now);
  recent.set(uid, list);
  return list.length > 20;
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin') ?? '';
  const cors = {
    'Access-Control-Allow-Origin': ALLOWED.includes(origin) ? origin : ALLOWED[0],
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);

  try {
    // ¿Quién lo pide? (sesión del usuario)
    const auth = req.headers.get('authorization') ?? '';
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: req.headers.get('apikey') || ANON_KEY, Authorization: auth } });
    if (!userRes.ok) return json({ error: 'unauthorized' }, 401);
    const user = await userRes.json();
    if (!user?.id) return json({ error: 'unauthorized' }, 401);
    if (tooMany(user.id)) return json({ error: 'too_many' }, 429);

    const body = await req.json().catch(() => ({}));
    const to = Number(body.to);
    const kind = ['call', 'friend', 'msg'].includes(body.kind) ? body.kind : 'dm';
    const id = String(body.id || (kind === 'friend' ? 'friend' : kind === 'msg' ? 'msg' : '')).replace(/[^\w-]/g, '').slice(0, 40);
    if (!(to >= 10000000 && to <= 99999999) || !id) return json({ error: 'bad_request' }, 400);
    if (!FCM_SERVICE_ACCOUNT) return json({ sent: 0, error: 'FCM no configurado' });
    if (!SERVICE_KEY) return json({ error: 'falta SUPABASE_SERVICE_ROLE_KEY' }, 500);

    // Dispositivos del amigo (vacío si no sois amigos)
    const tRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/push_targets`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_sender: user.id, p_to: to, p_kind: kind }),
    });
    if (!tRes.ok) return json({ error: 'targets ' + tRes.status }, 502);
    const targets: { token: string; platform: string; sender_nick: string; sender_number: number }[] = await tRes.json();
    if (!targets.length) return json({ sent: 0 });

    const nick = targets[0].sender_nick;
    const video = !!body.video;
    const title = nick;
    const text = kind === 'call' ? (video ? '📹 Videollamada entrante' : '📞 Llamada entrante')
      : kind === 'friend' ? '👋 Te envió una solicitud de amistad' : kind === 'msg' ? '💬 Te envió un mensaje' : '💬 Quiere hablar contigo';
    const data = { kind, id, from: String(targets[0].sender_number), nick, video: video ? '1' : '0', ts: String(Date.now()) };

    let sent = 0;
    const failed: string[] = [];
    for (const t of targets) {
      const r = await sendFcm(t.token, title, text, data, kind);
      if (r === 'ok') { sent++; continue; }
      failed.push(r);
      if (r === 'gone') {
        // Token caducado (app desinstalada…): se borra
        await fetch(`${SUPABASE_URL}/rest/v1/rpc/forget_push_token`, {
          method: 'POST',
          headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ p_token: t.token }),
        });
      }
    }
    return json({ sent, failed });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});

/* ---------------- Firebase Cloud Messaging (HTTP v1) ---------------- */
let cachedToken = { value: '', exp: 0 };

async function sendFcm(token: string, title: string, body: string, data: Record<string, string>, kind: string) {
  const sa = JSON.parse(FCM_SERVICE_ACCOUNT);
  const access = await googleAccessToken(sa);
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        token,
        notification: { title, body },
        data,
        android: {
          priority: 'HIGH',
          ttl: kind === 'call' ? '45s' : kind === 'friend' || kind === 'msg' ? '86400s' : '120s', // si no llega a tiempo, ya no sirve
          notification: {
            channel_id: kind === 'call' ? 'calls' : 'messages',
            tag: 'from-' + data.from, // un aviso por persona (el nuevo reemplaza al anterior)
            default_sound: true,
            notification_priority: kind === 'call' ? 'PRIORITY_MAX' : 'PRIORITY_HIGH',
            visibility: 'PRIVATE',
          },
        },
      },
    }),
  });
  if (res.ok) return 'ok';
  const err = await res.text();
  if (res.status === 404 || /UNREGISTERED|INVALID_ARGUMENT/.test(err)) return 'gone';
  console.error('FCM', res.status, err);
  return `error ${res.status} ${(err.match(/"status":\s*"([A-Z_]+)"/) || [])[1] || ''}`.trim();
}

/** Token de acceso de Google firmando un JWT con la clave de la cuenta de servicio. */
async function googleAccessToken(sa: { client_email: string; private_key: string }) {
  if (cachedToken.value && Date.now() < cachedToken.exp) return cachedToken.value;
  const now = Math.floor(Date.now() / 1000);
  const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })}`;
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const key = await crypto.subtle.importKey(
    'pkcs8',
    Uint8Array.from(atob(pem), (c) => c.charCodeAt(0)),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned)));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${b64url(sig)}` }),
  });
  if (!res.ok) throw new Error('Google OAuth ' + res.status + ' ' + (await res.text()));
  const j = await res.json();
  cachedToken = { value: j.access_token, exp: Date.now() + (j.expires_in - 120) * 1000 };
  return cachedToken.value;
}

function b64url(bytes: Uint8Array) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
