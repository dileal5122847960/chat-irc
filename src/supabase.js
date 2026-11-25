import { createClient } from '@supabase/supabase-js';

// Valores públicos: se configuran en .env.local (desarrollo) y en Vercel (producción).
// La clave "anon" puede ir en el navegador: la seguridad la ponen las políticas RLS.
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const configured = Boolean(url && anonKey);
export const supabase = configured
  ? createClient(url, anonKey, { realtime: { params: { eventsPerSecond: 20 } } })
  : null;
