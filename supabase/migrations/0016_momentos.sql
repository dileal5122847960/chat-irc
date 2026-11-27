-- =====================================================================
-- 0016 — Momentos (24 h, solo amigos, cifrados de extremo a extremo)
-- • Cada momento se cifra EN EL DISPOSITIVO con una clave nueva (AES-GCM). El texto cifrado va
--   en "moments"; la foto cifrada, en el almacenamiento "moments" (privado). El servidor nunca
--   ve el contenido.
-- • La clave del momento se entrega cifrada a cada dispositivo de cada amigo (y a los propios)
--   en "moment_keys" (mismas claves que el buzón). Solo los amigos pueden descargar la foto.
-- • A las 24 h deja de mostrarse y se borra (las filas al publicar/listar; el archivo lo borra
--   la app de su dueño).
-- =====================================================================

create table if not exists public.moments (
  id          uuid primary key,
  owner       bigint not null references public.profiles (user_number) on delete cascade on update cascade,
  content     jsonb not null,                -- { i, c } texto/estilo cifrado
  photo_path  text,                          -- moments/<número>/<id>.bin (cifrado)
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '24 hours',
  constraint content_size check (pg_column_size(content) <= 6000)
);
create index if not exists moments_owner on public.moments (owner, expires_at);
create table if not exists public.moment_keys (
  moment_id   uuid not null references public.moments (id) on delete cascade,
  device      bigint not null references public.devices (id) on delete cascade,
  body        jsonb not null,               -- clave del momento cifrada para ese dispositivo
  primary key (moment_id, device),
  constraint key_size check (pg_column_size(body) <= 1024)
);
create table if not exists public.moment_views (
  moment_id   uuid not null references public.moments (id) on delete cascade,
  viewer      bigint not null,
  at          timestamptz not null default now(),
  primary key (moment_id, viewer)
);
alter table public.moments enable row level security;       -- sin políticas: solo con funciones
alter table public.moment_keys enable row level security;
alter table public.moment_views enable row level security;

-- Dispositivos para los que hay que cifrar la clave: los de mis amigos y los míos
create or replace function public.moment_devices()
returns table (device bigint, public_key text)
language sql stable security definer set search_path = '' as $$
  select d.id, d.public_key
  from public.devices d join public.profiles p on p.id = d.user_id
  where d.public_key is not null and d.last_seen > now() - interval '60 days'
    and (p.id = auth.uid() or public.is_friend_number(p.user_number))
  limit 500;
$$;

-- Publicar (máx. 30 momentos activos)
create or replace function public.post_moment(p_id uuid, p_content jsonb, p_photo text, p_keys jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare me bigint := public.my_number();
begin
  if me is null then raise exception 'Necesitas una cuenta registrada' using errcode = '42501'; end if;
  if jsonb_typeof(p_keys) <> 'array' or jsonb_array_length(p_keys) > 500 then raise exception 'Solicitud no válida' using errcode = '22023'; end if;
  if p_photo is not null and p_photo <> me::text || '/' || p_id::text || '.bin' then raise exception 'Archivo no válido' using errcode = '22023'; end if;
  delete from public.moments where expires_at < now() - interval '1 hour';
  if (select count(*) from public.moments where owner = me and expires_at > now()) >= 30 then
    raise exception 'Ya tienes 30 momentos activos. Espera a que caduquen o borra alguno.' using errcode = '54000';
  end if;
  insert into public.moments (id, owner, content, photo_path) values (p_id, me, p_content, p_photo);
  insert into public.moment_keys (moment_id, device, body)
  select p_id, (k ->> 'device')::bigint, k -> 'body'
  from jsonb_array_elements(p_keys) k
  join public.devices d on d.id = (k ->> 'device')::bigint
  join public.profiles p on p.id = d.user_id
  where p.id = auth.uid() or public.is_friend_number(p.user_number)
  on conflict do nothing;
end;
$$;

-- Momentos vigentes (de mis amigos y míos) con la clave para este dispositivo
create or replace function public.list_moments(p_device bigint)
returns table (id uuid, owner bigint, nick text, mine boolean, content jsonb, photo_path text, key_body jsonb,
               created_at timestamptz, expires_at timestamptz, seen boolean, views int)
language sql stable security definer set search_path = '' as $$
  select m.id, m.owner, p.nick, m.owner = public.my_number(), m.content, m.photo_path, k.body, m.created_at, m.expires_at,
         exists (select 1 from public.moment_views v where v.moment_id = m.id and v.viewer = public.my_number()),
         case when m.owner = public.my_number() then (select count(*)::int from public.moment_views v where v.moment_id = m.id) else 0 end
  from public.moments m
  join public.profiles p on p.user_number = m.owner
  join public.moment_keys k on k.moment_id = m.id and k.device = p_device
  join public.devices d on d.id = p_device and d.user_id = auth.uid()
  where m.expires_at > now() and (m.owner = public.my_number() or public.is_friend_number(m.owner))
  order by m.created_at;
$$;

create or replace function public.mark_moment_seen(p_id uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.moment_views (moment_id, viewer)
  select m.id, public.my_number() from public.moments m
  where m.id = p_id and m.owner <> public.my_number() and public.is_friend_number(m.owner)
  on conflict do nothing;
$$;

-- Quién vio mi momento
create or replace function public.moment_viewers(p_id uuid)
returns table (nick text, at timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.nick, v.at from public.moment_views v
  join public.moments m on m.id = v.moment_id and m.owner = public.my_number()
  join public.profiles p on p.user_number = v.viewer
  where v.moment_id = p_id order by v.at desc;
$$;

-- Borrar uno mío (devuelve el archivo para que la app lo borre del almacenamiento)
create or replace function public.delete_moment(p_id uuid)
returns text language sql security definer set search_path = '' as $$
  delete from public.moments where id = p_id and owner = public.my_number() returning photo_path;
$$;

-- Mis momentos caducados: se borran y se devuelven sus archivos (la app los borra del almacenamiento)
create or replace function public.my_expired_moments()
returns setof text language sql security definer set search_path = '' as $$
  delete from public.moments where owner = public.my_number() and expires_at < now() returning photo_path;
$$;

-- Almacenamiento privado de fotos cifradas: carpeta = número del dueño; solo él sube y borra,
-- solo él y sus amigos descargan. Máx. 3 MB por archivo.
insert into storage.buckets (id, name, public, file_size_limit)
values ('moments', 'moments', false, 3145728)
on conflict (id) do nothing;

create or replace function public.moment_folder_owner(p_name text)
returns bigint language sql immutable set search_path = '' as $$
  select case when split_part(p_name, '/', 1) ~ '^\d{8}$' then split_part(p_name, '/', 1)::bigint end;
$$;
drop policy if exists "moments_upload" on storage.objects;
create policy "moments_upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'moments' and public.moment_folder_owner(name) = public.my_number());
drop policy if exists "moments_read" on storage.objects;
create policy "moments_read" on storage.objects for select to authenticated
  using (bucket_id = 'moments' and (public.moment_folder_owner(name) = public.my_number() or public.is_friend_number(public.moment_folder_owner(name))));
drop policy if exists "moments_delete" on storage.objects;
create policy "moments_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'moments' and public.moment_folder_owner(name) = public.my_number());

-- Permisos
do $$
declare f text;
begin
  foreach f in array array[
    'public.moment_devices()', 'public.post_moment(uuid, jsonb, text, jsonb)', 'public.list_moments(bigint)',
    'public.mark_moment_seen(uuid)', 'public.moment_viewers(uuid)', 'public.delete_moment(uuid)', 'public.my_expired_moments()'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
grant execute on function public.moment_folder_owner(text) to authenticated;
