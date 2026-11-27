-- =====================================================================
-- 0014 — Grupos de amigos (cifrados de extremo a extremo)
-- • groups / group_members: quién está en cada grupo (solo con funciones).
-- • El contenido NO pasa por la base de datos: cada mensaje se cifra en el dispositivo para
--   cada dispositivo de cada miembro y viaja por el canal privado "group:<id>" (Realtime con
--   RLS: solo los miembros escuchan y escriben). A quien no está conectado se le deja en el
--   buzón cifrado (mail_send_group) y se borra al entregarse.
-- =====================================================================

create table if not exists public.groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 60),
  created_by  bigint not null,
  created_at  timestamptz not null default now()
);
create table if not exists public.group_members (
  group_id    uuid not null references public.groups (id) on delete cascade,
  user_number bigint not null references public.profiles (user_number) on delete cascade on update cascade,
  role        text not null default 'member' check (role in ('admin', 'member')),
  added_at    timestamptz not null default now(),
  primary key (group_id, user_number)
);
create index if not exists group_members_user on public.group_members (user_number);
alter table public.groups enable row level security;        -- sin políticas: solo con funciones
alter table public.group_members enable row level security;

-- ¿Soy miembro de este grupo?
create or replace function public.is_group_member(p_group uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.group_members where group_id = p_group and user_number = public.my_number());
$$;
create or replace function public.is_group_admin(p_group uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.group_members where group_id = p_group and user_number = public.my_number() and role = 'admin');
$$;
-- Grupo de un nombre de canal "group:<uuid>" (null si no lo es)
create or replace function public.group_of_topic(p_topic text)
returns uuid language sql immutable set search_path = '' as $$
  select case when p_topic ~ '^group:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then substr(p_topic, 7)::uuid end;
$$;

-- Canal privado del grupo: solo los miembros (mensajes y quién está conectado)
drop policy if exists "group_read" on realtime.messages;
create policy "group_read" on realtime.messages for select to authenticated
  using (realtime.messages.extension in ('broadcast', 'presence') and public.is_group_member(public.group_of_topic(realtime.topic())));
drop policy if exists "group_write" on realtime.messages;
create policy "group_write" on realtime.messages for insert to authenticated
  with check (realtime.messages.extension in ('broadcast', 'presence') and public.is_group_member(public.group_of_topic(realtime.topic())));

-- Crear un grupo con amigos (solo se agregan amigos aceptados; quien lo crea es administrador)
create or replace function public.create_group(p_name text, p_members bigint[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare me bigint := public.my_number(); g uuid;
begin
  if me is null then raise exception 'Necesitas una cuenta registrada' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 60 then raise exception 'El nombre del grupo debe tener entre 1 y 60 caracteres' using errcode = '22023'; end if;
  insert into public.groups (name, created_by) values (btrim(p_name), me) returning id into g;
  insert into public.group_members (group_id, user_number, role) values (g, me, 'admin');
  insert into public.group_members (group_id, user_number)
    select g, m from unnest(coalesce(p_members, '{}')) m
    where m <> me and public.is_friend_number(m)
    limit 49
  on conflict do nothing;
  return g;
end;
$$;

-- Mis grupos con sus miembros
create or replace function public.list_groups()
returns table (id uuid, name text, role text, members jsonb)
language sql stable security definer set search_path = '' as $$
  select g.id, g.name, mine.role,
         (select coalesce(jsonb_agg(jsonb_build_object('number', p.user_number, 'nick', p.nick, 'role', gm.role) order by gm.added_at), '[]')
            from public.group_members gm join public.profiles p on p.user_number = gm.user_number where gm.group_id = g.id)
  from public.group_members mine
  join public.groups g on g.id = mine.group_id
  where mine.user_number = public.my_number()
  order by g.created_at;
$$;

-- Agregar amigos al grupo (administradores; solo amigos de quien agrega)
create or replace function public.add_group_members(p_group uuid, p_members bigint[])
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not public.is_group_admin(p_group) then raise exception 'Solo los administradores pueden agregar personas' using errcode = '42501'; end if;
  if (select count(*) from public.group_members where group_id = p_group) >= 50 then raise exception 'El grupo ya tiene 50 personas' using errcode = '22023'; end if;
  insert into public.group_members (group_id, user_number)
    select p_group, m from unnest(coalesce(p_members, '{}')) m where public.is_friend_number(m)
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Quitar a alguien (administradores) o salir uno mismo
create or replace function public.remove_group_member(p_group uuid, p_number bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare me bigint := public.my_number();
begin
  if p_number <> me and not public.is_group_admin(p_group) then raise exception 'Solo los administradores pueden quitar personas' using errcode = '42501'; end if;
  delete from public.group_members where group_id = p_group and user_number = p_number;
  if not exists (select 1 from public.group_members where group_id = p_group) then
    delete from public.groups where id = p_group;               -- grupo vacío: se borra
  elsif not exists (select 1 from public.group_members where group_id = p_group and role = 'admin') then
    update public.group_members set role = 'admin'              -- sin administradores: el más antiguo pasa a serlo
     where group_id = p_group and user_number = (select user_number from public.group_members where group_id = p_group order by added_at limit 1);
  end if;
end;
$$;

-- Cambiar el nombre (administradores) y nombrar administradores
create or replace function public.rename_group(p_group uuid, p_name text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_group_admin(p_group) then raise exception 'Solo los administradores pueden cambiar el nombre' using errcode = '42501'; end if;
  update public.groups set name = btrim(p_name) where id = p_group;
end;
$$;
create or replace function public.set_group_admin(p_group uuid, p_number bigint, p_admin boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_group_admin(p_group) then raise exception 'Solo los administradores pueden hacerlo' using errcode = '42501'; end if;
  update public.group_members set role = case when p_admin then 'admin' else 'member' end where group_id = p_group and user_number = p_number;
end;
$$;

-- Dispositivos de los miembros (para cifrar cada mensaje para cada uno)
create or replace function public.group_devices(p_group uuid)
returns table (device bigint, public_key text, user_number bigint)
language sql stable security definer set search_path = '' as $$
  select d.id, d.public_key, p.user_number
  from public.group_members gm
  join public.profiles p on p.user_number = gm.user_number
  join public.devices d on d.user_id = p.id
  where gm.group_id = p_group and public.is_group_member(p_group)
    and d.public_key is not null and d.last_seen > now() - interval '60 days';
$$;

-- Buzón para miembros del grupo que no están conectados
create or replace function public.mail_send_group(p_group uuid, p_items jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare me bigint := public.my_number(); n int;
begin
  if me is null or not public.is_group_member(p_group) then raise exception 'No eres parte de este grupo' using errcode = '42501'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 60 then raise exception 'Solicitud no válida' using errcode = '22023'; end if;
  insert into public.mailbox (to_device, from_number, body)
  select (i ->> 'device')::bigint, me, i -> 'body'
  from jsonb_array_elements(p_items) i
  join public.devices d on d.id = (i ->> 'device')::bigint
  join public.profiles p on p.id = d.user_id
  join public.group_members gm on gm.group_id = p_group and gm.user_number = p.user_number
  where (select count(*) from public.mailbox m where m.to_device = d.id) < 1000;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Avisos push: ahora también a miembros de un grupo en común (kind 'group')
create or replace function public.push_targets(p_sender uuid, p_to bigint, p_kind text default 'dm')
returns table (token text, platform text, sender_nick text, sender_number bigint)
language sql stable security definer set search_path = '' as $$
  select d.push_token, d.platform, s.nick, s.user_number
  from public.profiles s
  join public.profiles r on r.user_number = p_to
  join public.devices d on d.user_id = r.id and d.push_token is not null
  where s.id = p_sender and (
    (p_kind = 'friend' and exists (select 1 from public.friendships f
       where f.user_low = least(s.user_number, r.user_number) and f.user_high = greatest(s.user_number, r.user_number)
         and f.status = 'pending' and f.requested_by = s.user_number))
    or (p_kind = 'group' and exists (select 1 from public.group_members a join public.group_members b on a.group_id = b.group_id
       where a.user_number = s.user_number and b.user_number = r.user_number))
    or (p_kind not in ('friend', 'group') and exists (select 1 from public.friendships f
       where f.user_low = least(s.user_number, r.user_number) and f.user_high = greatest(s.user_number, r.user_number)
         and f.status = 'accepted'))
  );
$$;

-- Permisos
do $$
declare f text;
begin
  foreach f in array array[
    'public.is_group_member(uuid)', 'public.is_group_admin(uuid)', 'public.create_group(text, bigint[])', 'public.list_groups()',
    'public.add_group_members(uuid, bigint[])', 'public.remove_group_member(uuid, bigint)', 'public.rename_group(uuid, text)',
    'public.set_group_admin(uuid, bigint, boolean)', 'public.group_devices(uuid)', 'public.mail_send_group(uuid, jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke all on function public.push_targets(uuid, bigint, text) from public, anon, authenticated;
grant execute on function public.push_targets(uuid, bigint, text) to service_role;
