import { createClient } from '@supabase/supabase-js';

// Valores públicos: se configuran en .env.local (desarrollo) y en Vercel (producción).
// La clave "anon"/"publishable" puede ir en el navegador: la seguridad la ponen las políticas RLS.
const url = (import.meta.env.VITE_SUPABASE_URL || '').trim().replace(/^["']|["']$/g, '').replace(/\/+$/, '');
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim().replace(/^["']|["']$/g, '');

export const configured = Boolean(url && anonKey);
export let configError = '';
export let supabase = null;

if (configured) {
  try {
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) throw new Error(`VITE_SUPABASE_URL no parece válida: "${url.slice(0, 80)}"`);
    if (!/^(sb_publishable_|eyJ)/.test(anonKey)) throw new Error('VITE_SUPABASE_ANON_KEY no parece una clave pública (debe empezar por sb_publishable_ o eyJ)');
    supabase = createClient(url, anonKey, { realtime: { params: { eventsPerSecond: 20 } } });
  } catch (e) {
    configError = e.message;
  }
}
