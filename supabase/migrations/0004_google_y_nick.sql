-- =====================================================================
-- 0004 — Inicio de sesión con Google (y cualquier cuenta sin nick)
-- Las cuentas de Google llegan sin nick: el perfil se crea cuando el
-- usuario elige uno con claim_nick().
-- =====================================================================

-- El trigger solo crea el perfil si el registro trae un nick válido y libre;
-- si no, el usuario lo elegirá al entrar (en vez de fallar el registro).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if new.is_anonymous or coalesce(new.raw_user_meta_data ->> 'nick', '') = '' then
    return new;
  end if;
  begin
    insert into public.profiles (id, nick) values (new.id, new.raw_user_meta_data ->> 'nick');
  exception when unique_violation or check_violation then
    null; -- nick ocupado o no válido: se pedirá otro al entrar
  end;
  return new;
end;
$$;

-- Reserva un nick para el usuario conectado (solo si aún no tiene uno).
create or replace function public.claim_nick(p_nick text)
returns text
language plpgsql
security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'No autenticado';
  end if;
  insert into public.profiles (id, nick) values (uid, p_nick)
  on conflict (id) do nothing;
  return (select nick from public.profiles where id = uid);
end;
$$;
revoke all on function public.claim_nick(text) from public;
grant execute on function public.claim_nick(text) to authenticated;
