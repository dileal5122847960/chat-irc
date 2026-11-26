// Valores PÚBLICOS del proyecto Supabase. La URL y la clave "publishable" están pensadas
// para ir en el navegador: la seguridad la ponen las políticas RLS de la base de datos.
// (Nunca pongas aquí la clave "secret"/"service_role".)
// Las variables VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY, si existen, tienen prioridad.
const DEFAULT_URL = 'https://whvunvvspnbhwddesjqz.supabase.co';
const DEFAULT_KEY = 'sb_publishable_xxXTF0QResGSwV4VdZekfQ_-aq8nXHe';

export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || DEFAULT_URL).trim().replace(/^["']|["']$/g, '').replace(/\/+$/, '');
export const SUPABASE_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY || DEFAULT_KEY).trim().replace(/^["']|["']$/g, '');
