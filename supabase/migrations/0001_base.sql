-- =====================================================================
-- Chat IRC — esquema base
-- Ejecutar en Supabase: Dashboard → SQL Editor → New query → pegar → Run
-- =====================================================================

-- ---------- Perfiles (nick de cada usuario) ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  nick        text not null,
  created_at  timestamptz not null default now(),
  constraint nick_format check (nick ~ '^[A-Za-z\[\]\\`_^{|}][A-Za-z0-9\[\]\\`_^{|}-]{1,19}$')
);
-- Los nicks son únicos sin distinguir mayúsculas (como en IRC)
create unique index if not exists profiles_nick_unique on public.profiles (lower(nick));

-- ---------- Canales ----------
create table if not exists public.channels (
  id          bigint generated always as identity primary key,
  name        text not null,
  topic       text not null default '',
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint channel_format check (name ~ '^#[A-Za-z0-9_\-]{1,30}$')
);
create unique index if not exists channels_name_unique on public.channels (lower(name));

-- ---------- Mensajes ----------
create table if not exists public.messages (
  id          bigint generated always as identity primary key,
  channel_id  bigint not null references public.channels (id) on delete cascade,
  user_id     uuid references public.profiles (id) on delete set null,
  nick        text not null,                        -- nick en el momento de escribir
  kind        text not null default 'msg' check (kind in ('msg', 'action', 'notice')),
  body        text not null check (char_length(body) between 1 and 1000),
  created_at  timestamptz not null default now()
);
create index if not exists messages_channel_time on public.messages (channel_id, created_at desc);

-- ---------- Seguridad (Row Level Security) ----------
alter table public.profiles enable row level security;
alter table public.channels enable row level security;
alter table public.messages enable row level security;

-- Perfiles: todos los usuarios conectados los ven; cada uno gestiona el suyo
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles for select to authenticated using (true);
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles for insert to authenticated with check (id = auth.uid());
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Canales: visibles para todos los conectados; cualquiera puede crear uno (/join #nuevo)
drop policy if exists "channels_select" on public.channels;
create policy "channels_select" on public.channels for select to authenticated using (true);
drop policy if exists "channels_insert" on public.channels;
create policy "channels_insert" on public.channels for insert to authenticated with check (created_by = auth.uid());
drop policy if exists "channels_update_topic" on public.channels;
create policy "channels_update_topic" on public.channels for update to authenticated using (created_by = auth.uid());

-- Mensajes: se leen todos; solo puedes escribir en tu nombre y con tu nick actual
drop policy if exists "messages_select" on public.messages;
create policy "messages_select" on public.messages for select to authenticated using (true);
drop policy if exists "messages_insert_own" on public.messages;
create policy "messages_insert_own" on public.messages for insert to authenticated
  with check (
    user_id = auth.uid()
    and nick = (select p.nick from public.profiles p where p.id = auth.uid())
  );

-- ---------- Tiempo real ----------
-- Publica los mensajes nuevos y los cambios de topic a los clientes suscritos
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'channels') then
    alter publication supabase_realtime add table public.channels;
  end if;
end $$;

-- ---------- Datos iniciales ----------
insert into public.channels (name, topic)
values ('#general', 'Bienvenidos al chat. Escribe /help para ver los comandos.')
on conflict do nothing;
