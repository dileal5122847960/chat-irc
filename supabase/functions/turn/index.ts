// Edge Function "turn": entrega credenciales TURN temporales de Cloudflare.
// La clave de Cloudflare nunca llega al navegador: vive solo como secreto de la función.
// Secretos necesarios (Supabase → Edge Functions → Secrets):
//   CF_TURN_KEY_ID     → "Turn Token ID" de Cloudflare
//   CF_TURN_API_TOKEN  → "API Token" de esa clave TURN
const KEY_ID = Deno.env.get('CF_TURN_KEY_ID') ?? '';
const TOKEN = Deno.env.get('CF_TURN_API_TOKEN') ?? '';
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
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (!ALLOWED.includes(origin)) return new Response('forbidden', { status: 403, headers: cors });
  if (!KEY_ID || !TOKEN) return new Response(JSON.stringify({ error: 'TURN no configurado' }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });

  const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${KEY_ID}/credentials/generate-ice-servers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttl: 86400 }), // credenciales válidas 24 h
  });
  const body = await res.text();
  return new Response(body, { status: res.ok ? 200 : 502, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
});
