-- =====================================================================
-- 0008 — Versiones de las apps (actualización automática) + corrección
-- • app_versions: última versión y versión mínima por plataforma.
-- • check_app_version(): cada app pregunta al conectarse si debe actualizar.
-- • devices.app_version: qué versión usa cada dispositivo.
-- • Corrige find_user(): no devolvía a quien todavía no era tu amigo.
-- =====================================================================

-- ---------- Versiones publicadas por plataforma ----------
create table if not exists public.app_versions (
  platform        text primary key check (platform in ('web', 'android', 'ios', 'windows', 'macos', 'linux')),
  latest_version  text not null check (latest_version ~ '^\d+\.\d+\.\d+$'),
  min_version     text not null check (min_version ~ '^\d+\.\d+\.\d+$'),  -- por debajo: actualización obligatoria
  download_url    text,           -- tienda o instalador
  notes           text,           -- novedades de la versión
  released_at     timestamptz not null default now()
);
alter table public.app_versions enable row level security;
drop policy if exists "versions_read" on public.app_versions;
create policy "versions_read" on public.app_versions for select to anon, authenticated using (true);
grant select on public.app_versions to anon, authenticated;

-- Compara versiones "1.10.2" vs "1.9.0" (-1, 0, 1)
create or replace function public.semver_cmp(a text, b text)
returns int
language sql
immutable
set search_path = ''
as $$
  select case when x < y then -1 when x > y then 1 else 0 end
  from (select string_to_array(split_part(a, '-', 1), '.')::int[] as x,
               string_to_array(split_part(b, '-', 1), '.')::int[] as y) v;
$$;

-- ¿Debe actualizarse esta app? status: 'current' | 'available' | 'required' | 'unknown'
create or replace function public.check_app_version(p_platform text, p_version text)
returns table (status text, latest_version text, min_version text, download_url text, notes text)
language sql
stable
security definer set search_path = ''
as $$
  select case
           when p_version !~ '^\d+\.\d+\.\d+$' then 'required'
           when public.semver_cmp(p_version, v.min_version) < 0 then 'required'
           when public.semver_cmp(p_version, v.latest_version) < 0 then 'available'
           else 'current'
         end,
         v.latest_version, v.min_version, v.download_url, v.notes
  from public.app_versions v
  where v.platform = p_platform;
$$;
grant execute on function public.check_app_version(text, text) to anon, authenticated;

-- Versión inicial de la web
insert into public.app_versions (platform, latest_version, min_version, notes)
values ('web', '1.0.0', '1.0.0', 'Primera versión con número de usuario, amigos y actualizaciones automáticas.')
on conflict (platform) do nothing;

-- ---------- Qué versión usa cada dispositivo ----------
alter table public.devices add column if not exists app_version text;

-- ---------- Corrección: buscar por número a quien aún no es tu amigo ----------
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
         coalesce(f.requested_by = (select n from me), false)
  from public.profiles p
  left join public.user_private u on u.user_id = p.id
  left join public.friendships f
    on f.user_low = least(p.user_number, (select n from me)) and f.user_high = greatest(p.user_number, (select n from me))
  where p.user_number = p_number and auth.uid() is not null
    and p.user_number <> (select n from me)
    and (f.status is distinct from 'blocked' or f.blocked_by = (select n from me));  -- quien te bloqueó no aparece
$$;
