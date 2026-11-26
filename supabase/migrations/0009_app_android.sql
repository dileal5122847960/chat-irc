-- =====================================================================
-- 0009 — App de Android (amigos y privados)
-- • Bandeja privada por número de usuario (canal realtime "user:<número>"):
--   solo su dueño la escucha y solo sus amigos pueden escribir en ella
--   (Realtime Authorization: canales privados con RLS).
-- • register_device(): guarda el dispositivo, su versión y su token push.
-- • push_targets(): a quién avisar (solo la usa la función "push" del servidor).
-- • Versión inicial de la app de Android en app_versions.
-- =====================================================================

-- ¿Es este número amigo mío (amistad aceptada)?
create or replace function public.is_friend_number(p_other bigint)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and f.user_low = least(public.my_number(), p_other)
      and f.user_high = greatest(public.my_number(), p_other)
  );
$$;

-- Número del dueño de una bandeja "user:12345678" (null si el nombre no es de bandeja)
create or replace function public.inbox_owner(p_topic text)
returns bigint
language sql
immutable
set search_path = ''
as $$ select case when p_topic ~ '^user:[0-9]{8}$' then substr(p_topic, 6)::bigint end; $$;

-- ---------- Políticas de los canales privados ----------
-- (Los canales públicos de la web no pasan por estas políticas.)
drop policy if exists "app_inbox_read" on realtime.messages;
create policy "app_inbox_read" on realtime.messages
  for select to authenticated
  using (realtime.messages.extension = 'broadcast'
         and public.inbox_owner(realtime.topic()) = public.my_number());

drop policy if exists "app_inbox_write" on realtime.messages;
create policy "app_inbox_write" on realtime.messages
  for insert to authenticated
  with check (realtime.messages.extension = 'broadcast'
              and public.inbox_owner(realtime.topic()) is not null
              and (public.inbox_owner(realtime.topic()) = public.my_number()
                   or public.is_friend_number(public.inbox_owner(realtime.topic()))));

-- ---------- Registrar este dispositivo (versión y token push) ----------
create or replace function public.register_device(p_device bigint, p_platform text, p_name text, p_version text, p_push_token text default null)
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
  -- Un token push pertenece a un solo dispositivo (p. ej. si en el móvil cambia la cuenta)
  if p_push_token is not null then
    update public.devices set push_token = null
    where push_token = p_push_token and (id is distinct from p_device or user_id <> uid);
  end if;
  if p_device is not null then
    update public.devices
       set platform = p_platform, name = left(p_name, 60), app_version = p_version,
           push_token = coalesce(p_push_token, push_token), last_seen = now()
     where id = p_device and user_id = uid
    returning id into did;
  end if;
  if did is null then
    insert into public.devices (user_id, platform, name, app_version, push_token)
    values (uid, p_platform, left(p_name, 60), p_version, p_push_token)
    returning id into did;
  end if;
  return did;
end;
$$;

-- ---------- A quién avisar: dispositivos del amigo (solo para el servidor) ----------
-- p_kind 'friend' (solicitud de amistad): solo si quien avisa envió una solicitud pendiente.
-- Resto ('dm', 'call'): solo entre amigos.
create or replace function public.push_targets(p_sender uuid, p_to bigint, p_kind text default 'dm')
returns table (token text, platform text, sender_nick text, sender_number bigint)
language sql
stable
security definer set search_path = ''
as $$
  select d.push_token, d.platform, s.nick, s.user_number
  from public.profiles s
  join public.profiles r on r.user_number = p_to
  join public.friendships f
    on f.user_low = least(s.user_number, r.user_number) and f.user_high = greatest(s.user_number, r.user_number)
   and (case when p_kind = 'friend' then f.status = 'pending' and f.requested_by = s.user_number
             else f.status = 'accepted' end)
  join public.devices d on d.user_id = r.id and d.push_token is not null
  where s.id = p_sender;
$$;

-- Permisos
revoke all on function public.is_friend_number(bigint) from public, anon;
grant execute on function public.is_friend_number(bigint) to authenticated;
revoke all on function public.register_device(bigint, text, text, text, text) from public, anon;
grant execute on function public.register_device(bigint, text, text, text, text) to authenticated;
revoke all on function public.push_targets(uuid, bigint, text) from public, anon, authenticated;
grant execute on function public.push_targets(uuid, bigint, text) to service_role;

-- ---------- Versión inicial de la app de Android ----------
insert into public.app_versions (platform, latest_version, min_version, download_url, notes)
values ('android', '1.0.0', '1.0.0',
        'https://github.com/dileal5122847960/chat-irc/releases/download/android-v1.0.0/ChamuFlac.apk',
        'Primera versión: amigos, privados, llamadas y avisos.')
on conflict (platform) do nothing;
