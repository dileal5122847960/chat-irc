-- =====================================================================
-- 0003 — Chat sin historial
-- Los mensajes y los canales pasan a ser efímeros (Supabase Realtime:
-- Broadcast + Presence), sin escrituras en la base de datos.
-- La base de datos solo guarda las cuentas registradas y su nick reservado.
-- =====================================================================

-- 1) Fuera historial y canales persistentes
drop table if exists public.messages;
drop table if exists public.channels;

-- 2) Los invitados ya no usan usuarios anónimos: se borran los existentes
--    (sus perfiles se borran en cascada)
delete from auth.users where is_anonymous;

-- 3) Perfiles: cada usuario solo ve y modifica el suyo
drop policy if exists "profiles_select" on public.profiles;
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles for select to authenticated using (id = auth.uid());
drop policy if exists "profiles_insert_own" on public.profiles; -- ahora los crea el trigger
revoke insert on public.profiles from authenticated;

-- 4) Al registrarse, el perfil se crea automáticamente con el nick elegido
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if new.is_anonymous then
    return new;
  end if;
  insert into public.profiles (id, nick) values (new.id, new.raw_user_meta_data ->> 'nick');
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 5) ¿Está libre este nick? (no revela nada más de los usuarios registrados)
create or replace function public.nick_available(p_nick text)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select not exists (select 1 from public.profiles where lower(nick) = lower(p_nick));
$$;
revoke all on function public.nick_available(text) from public;
grant execute on function public.nick_available(text) to anon, authenticated;
