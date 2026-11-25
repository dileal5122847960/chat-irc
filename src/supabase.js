import { createClient } from '@supabase/supabase-js';

// Valores PÚBLICOS del proyecto Supabase. La URL y la clave "publishable" están pensadas
// para ir en el navegador: la seguridad la ponen las políticas RLS de la base de datos.
// (Nunca pongas aquí la clave "secret"/"service_role".)
// Las variables VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY, si existen, tienen prioridad.
const DEFAULT_URL = 'https://whvunvvspnbhwddesjqz.supabase.co';
const DEFAULT_KEY = 'sb_publishable_xxXTF0QResGSwV4VdZekfQ_-aq8nXHe';

const url = (import.meta.env.VITE_SUPABASE_URL || DEFAULT_URL).trim().replace(/^["']|["']$/g, '').replace(/\/+$/, '');
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || DEFAULT_KEY).trim().replace(/^["']|["']$/g, '');

export const configured = Boolean(url && anonKey);
export const SUPABASE_URL = url;
export const SUPABASE_KEY = anonKey;
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
