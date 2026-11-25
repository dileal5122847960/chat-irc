// Edge Function "turn": entrega credenciales TURN temporales sin exponer las claves.
// Admite dos proveedores (se usa el que tenga sus secretos configurados):
//   • Metered (gratis, 500 MB/mes, sin tarjeta):
//       METERED_DOMAIN   → p. ej. "chamuflac.metered.live"
//       METERED_API_KEY  → la "API Key" de la app de Metered
//   • Cloudflare (1.000 GB/mes gratis, requiere tarjeta):
//       CF_TURN_KEY_ID, CF_TURN_API_TOKEN
const METERED_DOMAIN = Deno.env.get('METERED_DOMAIN') ?? '';
const METERED_API_KEY = Deno.env.get('METERED_API_KEY') ?? '';
const CF_KEY_ID = Deno.env.get('CF_TURN_KEY_ID') ?? '';
const CF_TOKEN = Deno.env.get('CF_TURN_API_TOKEN') ?? '';
// Solo nuestra web puede pedir credenciales
const ALLOWED = ['https://chat-irc.vercel.app', 'http://localhost:5173'];

Deno.serve(async (req) => {
  const origin = req.headers.get('origin') ?? '';
  const cors = {
    'Access-Control-Allow-Origin': ALLOWED.includes(origin) ? origin : ALLOWED[0],
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    Vary: 'Origin',
  };
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (!ALLOWED.includes(origin)) return json({ error: 'forbidden' }, 403);

  try {
    if (METERED_DOMAIN && METERED_API_KEY) {
      const res = await fetch(`https://${METERED_DOMAIN}/api/v1/turn/credentials?apiKey=${encodeURIComponent(METERED_API_KEY)}`);
      if (!res.ok) return json({ error: 'metered ' + res.status }, 502);
      return json({ iceServers: await res.json() });
    }
    if (CF_KEY_ID && CF_TOKEN) {
      const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${CF_KEY_ID}/credentials/generate-ice-servers`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${CF_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: 86400 }),
      });
      if (!res.ok) return json({ error: 'cloudflare ' + res.status }, 502);
      return json(await res.json());
    }
    return json({ error: 'TURN no configurado' }, 500);
  } catch (e) {
    return json({ error: String(e) }, 502);
  }
});
