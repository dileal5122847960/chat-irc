-- Permisos de tabla para usuarios conectados (incluidos los anónimos).
-- Los proyectos nuevos de Supabase no los conceden por defecto; las políticas RLS
-- de 0001 siguen limitando qué filas puede leer o escribir cada usuario.
grant usage on schema public to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert on public.channels to authenticated;
grant update (topic) on public.channels to authenticated;
grant select, insert on public.messages to authenticated;
grant usage, select on all sequences in schema public to authenticated;
