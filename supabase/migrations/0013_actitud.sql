-- =====================================================================
-- 0013 — Actitud: una frase que cada persona muestra a sus amigos
-- • Se guarda junto al nombre (user_private): solo la ven tus amigos.
-- • set_my_attitude() la cambia; list_friends() y my_account() la devuelven.
-- =====================================================================
alter table public.user_private add column if not exists attitude text;
alter table public.user_private add column if not exists attitude_at timestamptz;
alter table public.user_private drop constraint if exists attitude_len;
alter table public.user_private add constraint attitude_len check (attitude is null or char_length(attitude) <= 140);

-- Cambiar (o borrar, con texto vacío) mi actitud
create or replace function public.set_my_attitude(p_text text)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare v text := nullif(btrim(coalesce(p_text, '')), '');
begin
  if v is not null and char_length(v) > 140 then
    raise exception 'La actitud admite hasta 140 caracteres' using errcode = '22023';
  end if;
  update public.user_private set attitude = v, attitude_at = now() where user_id = auth.uid();
  if not found then raise exception 'Completa primero tu nombre y apellido' using errcode = 'P0002'; end if;
end;
$$;

-- Mis datos (ahora con la actitud)
drop function if exists public.my_account();
create function public.my_account()
returns table (user_number bigint, nick text, first_name text, last_name text, email text, attitude text)
language sql
stable
security definer set search_path = ''
as $$
  select p.user_number, p.nick, u.first_name, u.last_name, a.email::text, u.attitude
  from public.profiles p
  left join public.user_private u on u.user_id = p.id
  left join auth.users a on a.id = p.id
  where p.id = auth.uid();
$$;

-- Mis amigos y solicitudes (ahora con la actitud de los amigos)
drop function if exists public.list_friends();
create function public.list_friends()
returns table (user_number bigint, nick text, first_name text, last_name text, status text, requested_by_me boolean, since timestamptz, attitude text)
language sql
stable
security definer set search_path = ''
as $$
  with me as (select public.my_number() as n)
  select p.user_number, p.nick,
         case when f.status = 'accepted' then u.first_name end,
         case when f.status = 'accepted' then u.last_name end,
         f.status, f.requested_by = (select n from me), f.updated_at,
         case when f.status = 'accepted' then u.attitude end
  from public.friendships f
  join public.profiles p on p.user_number = case when f.user_low = (select n from me) then f.user_high else f.user_low end
  left join public.user_private u on u.user_id = p.id
  where (select n from me) in (f.user_low, f.user_high)
    and not (f.status = 'blocked' and f.blocked_by <> (select n from me))
  order by f.status, p.nick;
$$;

-- Permisos: solo usuarios con sesión
revoke all on function public.set_my_attitude(text) from public, anon;
grant execute on function public.set_my_attitude(text) to authenticated;
revoke all on function public.my_account() from public, anon;
grant execute on function public.my_account() to authenticated;
revoke all on function public.list_friends() from public, anon;
grant execute on function public.list_friends() to authenticated;
