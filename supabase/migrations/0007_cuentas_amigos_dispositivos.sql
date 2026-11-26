-- =====================================================================
-- 0007 — Base para las apps (móvil y Windows): número de usuario, datos
-- privados, dispositivos y amistades.
-- • user_number: número aleatorio de 8 dígitos para buscarse y agregarse.
--   Las relaciones usan este número (bigint, 8 bytes) en lugar del uuid (16).
-- • Nombre y apellido: tabla privada; solo los ven la propia persona y sus amigos.
--   El correo NO se duplica: vive en auth.users (sistema de cuentas).
-- • Dispositivos: token push (para que suene con la app cerrada) y clave pública
--   de identidad (cifrado de extremo a extremo verificable). Sin direcciones IP.
-- • Amistades: pendiente / aceptada / bloqueada, solo modificables con funciones.
-- =====================================================================

-- ---------- Número de usuario ----------
create or replace function public.gen_user_number()
returns bigint
language plpgsql
volatile
security definer set search_path = ''
as $$
declare
  n bigint;
begin
  loop
    n := 10000000 + floor(random() * 90000000)::bigint; -- 8 dígitos
    exit when not exists (select 1 from public.profiles where user_number = n);
  end loop;
  return n;
end;
$$;

alter table public.profiles add column if not exists user_number bigint;
update public.profiles set user_number = public.gen_user_number() where user_number is null;
alter table public.profiles alter column user_number set default public.gen_user_number();
alter table public.profiles alter column user_number set not null;
create unique index if not exists profiles_user_number_unique on public.profiles (user_number);

-- Perfiles: público solo id y nick (el número no se puede listar en bloque)
revoke select, update on public.profiles from anon, authenticated;
grant select (id, nick) on public.profiles to anon, authenticated;
grant update (nick) on public.profiles to authenticated;

-- ---------- Datos privados (nombre y apellido) ----------
create table if not exists public.user_private (
  user_id     uuid primary key references public.profiles (id) on delete cascade,
  first_name  text not null,
  last_name   text not null,
  updated_at  timestamptz not null default now(),
  constraint first_name_len check (char_length(btrim(first_name)) between 1 and 60),
  constraint last_name_len  check (char_length(btrim(last_name))  between 1 and 60)
);
alter table public.user_private enable row level security;
drop policy if exists "private_own" on public.user_private;
create policy "private_own" on public.user_private for select to authenticated using (user_id = auth.uid());
-- Las escrituras se hacen con set_my_name()

-- ---------- Dispositivos ----------
create table if not exists public.devices (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  platform    text not null check (platform in ('web', 'android', 'ios', 'windows', 'macos', 'linux')),
  name        text check (char_length(name) <= 60),
  push_token  text,          -- solo lo ve su dueño; lo usará el servidor para enviar avisos
  public_key  text,          -- clave pública de identidad del dispositivo (para E2E verificable)
  created_at  timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);
create index if not exists devices_user on public.devices (user_id);
create unique index if not exists devices_push_token on public.devices (push_token) where push_token is not null;
alter table public.devices enable row level security;
drop policy if exists "devices_own" on public.devices;
create policy "devices_own" on public.devices for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.devices to authenticated;

-- ---------- Amistades ----------
create table if not exists public.friendships (
  user_low      bigint not null references public.profiles (user_number) on delete cascade on update cascade,
  user_high     bigint not null references public.profiles (user_number) on delete cascade on update cascade,
  requested_by  bigint not null,
  status        text not null default 'pending' check (status in ('pending', 'accepted', 'blocked')),
  blocked_by    bigint,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (user_low, user_high),
  constraint ordered check (user_low < user_high)
);
create index if not exists friendships_high on public.friendships (user_high);
alter table public.friendships enable row level security;
-- Lectura directa no permitida: se consulta con list_friends() / find_user()

-- Número de quien llama
create or replace function public.my_number()
returns bigint
language sql
stable
security definer set search_path = ''
as $$ select user_number from public.profiles where id = auth.uid(); $$;

-- ---------- Funciones de cuenta ----------
-- Mis datos (para el menú de usuario y las apps)
create or replace function public.my_account()
returns table (user_number bigint, nick text, first_name text, last_name text, email text)
language sql
stable
security definer set search_path = ''
as $$
  select p.user_number, p.nick, u.first_name, u.last_name, a.email::text
  from public.profiles p
  left join public.user_private u on u.user_id = p.id
  left join auth.users a on a.id = p.id
  where p.id = auth.uid();
$$;

-- Guardar o cambiar mi nombre y apellido
create or replace function public.set_my_name(p_first text, p_last text)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'Necesitas una cuenta con nick' using errcode = '42501';
  end if;
  insert into public.user_private (user_id, first_name, last_name)
  values (auth.uid(), btrim(p_first), btrim(p_last))
  on conflict (user_id) do update set first_name = excluded.first_name, last_name = excluded.last_name, updated_at = now();
end;
$$;

-- ---------- Funciones de amistad ----------
-- Buscar a alguien por su número: nick siempre; nombre solo si sois amigos
create or replace function public.find_user(p_number bigint)
returns table (user_number bigint, nick text, first_name text, last_name text, relation text, requested_by_me boolean)
language sql
stable
security definer set search_path = ''
as $$
  with me as (select public.my_number() as n)
  select p.user_number, p.nick,
         case when f.status = 'accepted' then u.first_name end,
         case when f.status = 'accepted' then u.last_name end,
         coalesce(f.status, 'none'),
         f.requested_by = (select n from me)
  from public.profiles p
  left join public.user_private u on u.user_id = p.id
  left join public.friendships f
    on f.user_low = least(p.user_number, (select n from me)) and f.user_high = greatest(p.user_number, (select n from me))
  where p.user_number = p_number and auth.uid() is not null
    and not (f.status = 'blocked' and f.blocked_by <> (select n from me));  -- quien te bloqueó no aparece
$$;

-- Mis amigos y solicitudes
create or replace function public.list_friends()
returns table (user_number bigint, nick text, first_name text, last_name text, status text, requested_by_me boolean, since timestamptz)
language sql
stable
security definer set search_path = ''
as $$
  with me as (select public.my_number() as n)
  select p.user_number, p.nick,
         case when f.status = 'accepted' then u.first_name end,
         case when f.status = 'accepted' then u.last_name end,
         f.status, f.requested_by = (select n from me), f.updated_at
  from public.friendships f
  join public.profiles p on p.user_number = case when f.user_low = (select n from me) then f.user_high else f.user_low end
  left join public.user_private u on u.user_id = p.id
  where (select n from me) in (f.user_low, f.user_high)
    and not (f.status = 'blocked' and f.blocked_by <> (select n from me))
  order by f.status, p.nick;
$$;

-- Enviar solicitud (si el otro ya me la había enviado, queda aceptada)
create or replace function public.send_friend_request(p_number bigint)
returns text
language plpgsql
security definer set search_path = ''
as $$
declare
  me bigint := public.my_number();
  f public.friendships;
begin
  if me is null then raise exception 'Necesitas una cuenta registrada' using errcode = '42501'; end if;
  if p_number = me then raise exception 'No puedes agregarte a ti mismo' using errcode = '22023'; end if;
  if not exists (select 1 from public.profiles where user_number = p_number) then
    raise exception 'No existe ningún usuario con ese número' using errcode = 'P0002';
  end if;
  select * into f from public.friendships where user_low = least(me, p_number) and user_high = greatest(me, p_number);
  if found then
    if f.status = 'blocked' then raise exception 'No es posible enviar la solicitud' using errcode = '42501'; end if;
    if f.status = 'pending' and f.requested_by <> me then
      update public.friendships set status = 'accepted', updated_at = now() where user_low = f.user_low and user_high = f.user_high;
      return 'accepted';
    end if;
    return f.status;
  end if;
  insert into public.friendships (user_low, user_high, requested_by) values (least(me, p_number), greatest(me, p_number), me);
  return 'pending';
end;
$$;

-- Aceptar o rechazar una solicitud recibida
create or replace function public.respond_friend_request(p_number bigint, p_accept boolean)
returns text
language plpgsql
security definer set search_path = ''
as $$
declare
  me bigint := public.my_number();
begin
  if p_accept then
    update public.friendships set status = 'accepted', updated_at = now()
      where user_low = least(me, p_number) and user_high = greatest(me, p_number) and status = 'pending' and requested_by = p_number;
    if not found then raise exception 'No hay ninguna solicitud de ese usuario' using errcode = 'P0002'; end if;
    return 'accepted';
  end if;
  delete from public.friendships
    where user_low = least(me, p_number) and user_high = greatest(me, p_number) and status = 'pending';
  return 'none';
end;
$$;

-- Eliminar amistad o cancelar solicitud
create or replace function public.remove_friend(p_number bigint)
returns void
language sql
security definer set search_path = ''
as $$
  delete from public.friendships
  where user_low = least(public.my_number(), p_number) and user_high = greatest(public.my_number(), p_number)
    and not (status = 'blocked' and blocked_by <> public.my_number());
$$;

-- Bloquear (o desbloquear) a alguien
create or replace function public.block_user(p_number bigint, p_block boolean default true)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  me bigint := public.my_number();
begin
  if me is null or p_number = me then raise exception 'Operación no válida' using errcode = '22023'; end if;
  if p_block then
    insert into public.friendships (user_low, user_high, requested_by, status, blocked_by)
    values (least(me, p_number), greatest(me, p_number), me, 'blocked', me)
    on conflict (user_low, user_high) do update set status = 'blocked', blocked_by = me, updated_at = now();
  else
    delete from public.friendships where user_low = least(me, p_number) and user_high = greatest(me, p_number) and blocked_by = me;
  end if;
end;
$$;

-- Permisos de ejecución: solo usuarios con sesión
do $$
declare f text;
begin
  foreach f in array array[
    'public.my_number()', 'public.my_account()', 'public.set_my_name(text, text)',
    'public.find_user(bigint)', 'public.list_friends()', 'public.send_friend_request(bigint)',
    'public.respond_friend_request(bigint, boolean)', 'public.remove_friend(bigint)', 'public.block_user(bigint, boolean)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  execute 'revoke all on function public.gen_user_number() from public, anon, authenticated';
end $$;

-- ---------- Registro: guardar nombre y apellido que vienen del formulario ----------
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
    if coalesce(new.raw_user_meta_data ->> 'first_name', '') <> '' and coalesce(new.raw_user_meta_data ->> 'last_name', '') <> '' then
      insert into public.user_private (user_id, first_name, last_name)
      values (new.id, btrim(new.raw_user_meta_data ->> 'first_name'), btrim(new.raw_user_meta_data ->> 'last_name'));
    end if;
  exception when unique_violation or check_violation then
    null; -- nick ocupado o datos no válidos: se completarán al entrar
  end;
  return new;
end;
$$;
