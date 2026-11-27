-- =====================================================================
-- 0015 — Moderación de canales: bloqueos y denuncias
-- • channel_bans: el creador y los administradores registrados pueden bloquear a alguien de su
--   canal (1 hora, 1 día, 7 días o para siempre). Cuentas registradas: por cuenta. Invitados:
--   por nick. En canales con contraseña lo impide el servidor (channel_access); en los abiertos,
--   la app lo comprueba al entrar (channel_ban_status).
-- • reports: denuncias de usuarios registrados (máx. 10 por hora). Las ven el creador y los
--   administradores del canal, y el dueño del proyecto en la tabla.
-- Todo por funciones: las tablas no se leen ni escriben directamente.
-- =====================================================================

create table if not exists public.channel_bans (
  id          bigint generated always as identity primary key,
  channel_id  bigint not null references public.channels (id) on delete cascade,
  user_id     uuid references public.profiles (id) on delete cascade,   -- cuenta registrada
  nick        text not null,                                            -- nick al bloquear (invitados: se bloquea el nick)
  banned_by   uuid references public.profiles (id) on delete set null,
  reason      text not null default '' check (char_length(reason) <= 200),
  until       timestamptz,                                              -- null = para siempre
  created_at  timestamptz not null default now()
);
create unique index if not exists channel_bans_user on public.channel_bans (channel_id, user_id) where user_id is not null;
create unique index if not exists channel_bans_nick on public.channel_bans (channel_id, lower(nick)) where user_id is null;
alter table public.channel_bans enable row level security;

create table if not exists public.reports (
  id           bigint generated always as identity primary key,
  reporter     uuid references public.profiles (id) on delete set null,
  channel_id   bigint references public.channels (id) on delete set null,
  channel_name text not null default '',
  target_nick  text not null,
  target_user  uuid references public.profiles (id) on delete set null,
  reason       text not null check (reason in ('spam', 'acoso', 'odio', 'sexual', 'violencia', 'estafa', 'otro')),
  details      text not null default '' check (char_length(details) <= 300),
  excerpt      text not null default '' check (char_length(excerpt) <= 500),
  status       text not null default 'open' check (status in ('open', 'done')),
  created_at   timestamptz not null default now()
);
create index if not exists reports_channel on public.reports (channel_id, created_at desc);
create index if not exists reports_reporter on public.reports (reporter, created_at desc);
alter table public.reports enable row level security;

-- ¿Está bloqueado quien llama? Devuelve hasta cuándo ('infinity' = para siempre) o null.
create or replace function public.channel_ban_status(p_channel bigint, p_nick text default null)
returns timestamptz language sql stable security definer set search_path = '' as $$
  select coalesce(b.until, 'infinity'::timestamptz)
  from public.channel_bans b
  where b.channel_id = p_channel
    and (b.until is null or b.until > now())
    and ((auth.uid() is not null and b.user_id = auth.uid())
      or (auth.uid() is null and b.user_id is null and lower(b.nick) = lower(coalesce(p_nick, ''))))
  order by b.until desc nulls first
  limit 1;
$$;

-- Bloquear (creador o administradores registrados). p_minutes null = para siempre.
create or replace function public.ban_from_channel(p_channel bigint, p_user uuid, p_nick text, p_minutes int, p_reason text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare c public.channels; me uuid := auth.uid(); target_admin boolean;
begin
  if not public.is_channel_admin(p_channel) then raise exception 'Solo el creador y los administradores pueden bloquear' using errcode = '42501'; end if;
  select * into c from public.channels where id = p_channel;
  if p_user is not null and p_user = c.owner_id then raise exception 'No se puede bloquear al creador del canal' using errcode = '42501'; end if;
  if p_user = me then raise exception 'No puedes bloquearte a ti mismo' using errcode = '22023'; end if;
  target_admin := p_user is not null and exists (select 1 from public.channel_admins where channel_id = p_channel and user_id = p_user);
  if target_admin and c.owner_id is distinct from me then raise exception 'Solo el creador puede bloquear a un administrador' using errcode = '42501'; end if;
  if target_admin then delete from public.channel_admins where channel_id = p_channel and user_id = p_user; end if;
  if char_length(btrim(coalesce(p_nick, ''))) = 0 then raise exception 'Falta el nick' using errcode = '22023'; end if;
  if p_user is not null then
    delete from public.channel_bans where channel_id = p_channel and user_id = p_user;
  else
    delete from public.channel_bans where channel_id = p_channel and user_id is null and lower(nick) = lower(btrim(p_nick));
  end if;
  insert into public.channel_bans (channel_id, user_id, nick, banned_by, reason, until)
  values (p_channel, p_user, left(btrim(p_nick), 30), me, left(coalesce(p_reason, ''), 200),
          case when p_minutes is null then null else now() + make_interval(mins => greatest(1, least(p_minutes, 525600))) end);
end;
$$;

create or replace function public.unban_from_channel(p_ban bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare ch bigint;
begin
  select channel_id into ch from public.channel_bans where id = p_ban;
  if ch is null or not public.is_channel_admin(ch) then raise exception 'No permitido' using errcode = '42501'; end if;
  delete from public.channel_bans where id = p_ban;
end;
$$;

create or replace function public.list_channel_bans(p_channel bigint)
returns table (id bigint, nick text, registered boolean, until timestamptz, reason text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select b.id, coalesce(p.nick, b.nick), b.user_id is not null, b.until, b.reason, b.created_at
  from public.channel_bans b left join public.profiles p on p.id = b.user_id
  where b.channel_id = p_channel and public.is_channel_admin(p_channel) and (b.until is null or b.until > now())
  order by b.created_at desc;
$$;

-- Denunciar (usuarios registrados, máx. 10 por hora)
create or replace function public.report_user(p_channel bigint, p_target_nick text, p_target_user uuid, p_reason text, p_details text default '', p_excerpt text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'Necesitas una cuenta registrada para denunciar' using errcode = '42501'; end if;
  if (select count(*) from public.reports where reporter = me and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Enviaste muchas denuncias. Espera un rato.' using errcode = '54000';
  end if;
  insert into public.reports (reporter, channel_id, channel_name, target_nick, target_user, reason, details, excerpt)
  values (me, p_channel, coalesce((select name from public.channels where id = p_channel), ''), left(coalesce(p_target_nick, '?'), 30),
          p_target_user, p_reason, left(coalesce(p_details, ''), 300), left(coalesce(p_excerpt, ''), 500));
end;
$$;

create or replace function public.list_channel_reports(p_channel bigint)
returns table (id bigint, target_nick text, reason text, details text, excerpt text, reporter_nick text, status text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select r.id, r.target_nick, r.reason, r.details, r.excerpt, coalesce(p.nick, '?'), r.status, r.created_at
  from public.reports r left join public.profiles p on p.id = r.reporter
  where r.channel_id = p_channel and public.is_channel_admin(p_channel)
  order by r.status = 'done', r.created_at desc
  limit 100;
$$;

create or replace function public.resolve_report(p_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare ch bigint;
begin
  select channel_id into ch from public.reports where id = p_id;
  if ch is null or not public.is_channel_admin(ch) then raise exception 'No permitido' using errcode = '42501'; end if;
  update public.reports set status = 'done' where id = p_id;
end;
$$;

-- Canales con contraseña: quien está bloqueado no recibe el secreto (lo impide el servidor)
create or replace function public.channel_access(p_channel bigint, p_password text default null)
returns text
language plpgsql
security definer set search_path = ''
as $$
declare
  c public.channels;
begin
  select * into c from public.channels where id = p_channel;
  if not found then
    raise exception 'El canal no existe' using errcode = 'P0002';
  end if;
  if not c.is_private then
    return null;
  end if;
  if auth.uid() is not null and (
    c.owner_id = auth.uid()
    or exists (select 1 from public.channel_admins a where a.channel_id = c.id and a.user_id = auth.uid())
  ) then
    return c.secret;
  end if;
  if auth.uid() is not null and exists (select 1 from public.channel_bans b where b.channel_id = c.id and b.user_id = auth.uid() and (b.until is null or b.until > now())) then
    raise exception 'Estás bloqueado en este canal' using errcode = '42501';
  end if;
  if p_password is not null and c.password_hash = extensions.crypt(p_password, c.password_hash) then
    return c.secret;
  end if;
  if p_password is not null then
    perform pg_sleep(0.6); -- frena los intentos de adivinar la contraseña
  end if;
  raise exception 'Contraseña incorrecta' using errcode = '28P01';
end;
$$;

-- Permisos
revoke all on function public.channel_ban_status(bigint, text) from public;
grant execute on function public.channel_ban_status(bigint, text) to anon, authenticated;
revoke all on function public.channel_access(bigint, text) from public;
grant execute on function public.channel_access(bigint, text) to anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'public.ban_from_channel(bigint, uuid, text, int, text)', 'public.unban_from_channel(bigint)', 'public.list_channel_bans(bigint)',
    'public.report_user(bigint, text, uuid, text, text, text)', 'public.list_channel_reports(bigint)', 'public.resolve_report(bigint)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
