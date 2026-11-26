-- =====================================================================
-- 0011 — Buzón entre amigos: escribir aunque el otro esté desconectado
-- • Cada dispositivo (app o navegador) publica su clave pública (devices.public_key).
-- • Quien escribe cifra el mensaje EN SU DISPOSITIVO para cada dispositivo del amigo
--   (cifrado de extremo a extremo: el servidor solo guarda texto cifrado).
-- • El mensaje espera en "mailbox" hasta que el dispositivo lo recoge; al recogerlo se BORRA
--   (no hay historial). Lo no recogido se borra a los 30 días.
-- • Todo pasa por funciones: la tabla no se puede leer ni escribir directamente.
-- =====================================================================

create table if not exists public.mailbox (
  id          bigint generated always as identity primary key,
  to_device   bigint not null references public.devices (id) on delete cascade,
  from_number bigint not null,
  body        jsonb  not null,            -- mensaje cifrado para ese dispositivo
  created_at  timestamptz not null default now(),
  constraint body_size check (pg_column_size(body) <= 16384)
);
create index if not exists mailbox_device on public.mailbox (to_device, id);
alter table public.mailbox enable row level security; -- sin políticas: solo con las funciones

-- ---------- Registrar dispositivo (ahora también con su clave pública) ----------
create or replace function public.register_device(p_device bigint, p_platform text, p_name text, p_version text,
                                                  p_push_token text default null, p_public_key text default null)
returns bigint
language plpgsql
security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  did bigint;
begin
  if uid is null or not exists (select 1 from public.profiles where id = uid) then
    raise exception 'Necesitas una cuenta registrada' using errcode = '42501';
  end if;
  if p_public_key is not null and char_length(p_public_key) > 600 then
    raise exception 'Clave no válida' using errcode = '22023';
  end if;
  if p_push_token is not null then
    update public.devices set push_token = null
    where push_token = p_push_token and (id is distinct from p_device or user_id <> uid);
  end if;
  if p_device is not null then
    update public.devices
       set platform = p_platform, name = left(p_name, 60), app_version = p_version,
           push_token = coalesce(p_push_token, push_token), public_key = coalesce(p_public_key, public_key), last_seen = now()
     where id = p_device and user_id = uid
    returning id into did;
  end if;
  if did is null then
    insert into public.devices (user_id, platform, name, app_version, push_token, public_key)
    values (uid, p_platform, left(p_name, 60), p_version, p_push_token, p_public_key)
    returning id into did;
  end if;
  return did;
end;
$$;
-- La versión anterior (5 parámetros) se elimina para que no haya dos iguales
drop function if exists public.register_device(bigint, text, text, text, text);

-- ---------- Dispositivos de un amigo (para cifrarle el mensaje) ----------
create or replace function public.friend_devices(p_number bigint)
returns table (device bigint, public_key text)
language sql
stable
security definer set search_path = ''
as $$
  select d.id, d.public_key
  from public.profiles p
  join public.devices d on d.user_id = p.id
  where p.user_number = p_number
    and public.is_friend_number(p_number)
    and d.public_key is not null
    and d.last_seen > now() - interval '60 days';
$$;

-- ---------- Dejar mensajes en el buzón de un amigo ----------
-- p_items: [{ "device": 123, "body": {...cifrado...} }, ...]  (uno por dispositivo del amigo)
create or replace function public.mail_send(p_to bigint, p_items jsonb)
returns int
language plpgsql
security definer set search_path = ''
as $$
declare
  me bigint := public.my_number();
  n int;
begin
  if me is null or not public.is_friend_number(p_to) then
    raise exception 'Solo puedes escribir a tus amigos' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 20 then
    raise exception 'Solicitud no válida' using errcode = '22023';
  end if;
  delete from public.mailbox where created_at < now() - interval '30 days';
  insert into public.mailbox (to_device, from_number, body)
  select (i ->> 'device')::bigint, me, i -> 'body'
  from jsonb_array_elements(p_items) i
  join public.devices d on d.id = (i ->> 'device')::bigint
  join public.profiles p on p.id = d.user_id and p.user_number = p_to
  where (select count(*) from public.mailbox m where m.to_device = d.id) < 1000;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ---------- Recoger (y borrar) los mensajes de este dispositivo ----------
create or replace function public.mail_fetch(p_device bigint)
returns table (id bigint, from_number bigint, body jsonb, created_at timestamptz)
language sql
security definer set search_path = ''
as $$
  delete from public.mailbox m
  using public.devices d
  where m.to_device = p_device and d.id = p_device and d.user_id = auth.uid()
  returning m.id, m.from_number, m.body, m.created_at;
$$;

-- Permisos
revoke all on function public.register_device(bigint, text, text, text, text, text) from public, anon;
grant execute on function public.register_device(bigint, text, text, text, text, text) to authenticated;
revoke all on function public.friend_devices(bigint) from public, anon;
grant execute on function public.friend_devices(bigint) to authenticated;
revoke all on function public.mail_send(bigint, jsonb) from public, anon;
grant execute on function public.mail_send(bigint, jsonb) to authenticated;
revoke all on function public.mail_fetch(bigint) from public, anon;
grant execute on function public.mail_fetch(bigint) to authenticated;
