-- =====================================================================
-- 0010 — Avisos push: borrar tokens caducados
-- La función "push" llama a forget_push_token() cuando Firebase dice que un
-- token ya no existe (app desinstalada, datos borrados…).
-- =====================================================================
create or replace function public.forget_push_token(p_token text)
returns void
language sql
security definer set search_path = ''
as $$ update public.devices set push_token = null where push_token = p_token; $$;

revoke all on function public.forget_push_token(text) from public, anon, authenticated;
grant execute on function public.forget_push_token(text) to service_role;
