-- =====================================================================
-- 0005 — Canales persistentes con creador y administradores
-- • Solo usuarios registrados crean canales, y como máximo uno cada uno.
-- • El creador es administrador; los administradores pueden nombrar a otros.
-- • Los administradores registrados se guardan aquí. Los invitados solo
--   pueden ser administradores temporales (no pasan por la base de datos).
-- =====================================================================

-- Los nicks son públicos (se muestran en el chat): lectura abierta de id y nick.
-- (La tabla profiles no contiene correos ni otros datos personales.)
drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_select_all" on public.profiles;
create policy "profiles_select_all" on public.profiles for select to anon, authenticated using (true);
grant select on public.profiles to anon;

-- ---------- Canales ----------
create table if not exists public.channels (
  id          bigint generated always as identity primary key,
  name        text not null,
  topic       text not null default '',
  owner_id    uuid references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  constraint channel_name_format check (name ~ '^#[A-Za-z0-9_\-]{1,30}$'),
  constraint channel_topic_length check (char_length(topic) <= 300)
);
create unique index if not exists channels_name_unique on public.channels (lower(name));
-- Un canal por usuario (los canales del sistema no tienen creador)
create unique index if not exists channels_one_per_owner on public.channels (owner_id);

-- ---------- Administradores permanentes ----------
create table if not exists public.channel_admins (
  channel_id  bigint not null references public.channels (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  granted_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (channel_id, user_id)
);

-- ¿El usuario conectado es creador o administrador de este canal?
create or replace function public.is_channel_admin(p_channel bigint)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select auth.uid() is not null and (
    exists (select 1 from public.channels c where c.id = p_channel and c.owner_id = auth.uid())
    or exists (select 1 from public.channel_admins a where a.channel_id = p_channel and a.user_id = auth.uid())
  );
$$;
revoke all on function public.is_channel_admin(bigint) from public;
grant execute on function public.is_channel_admin(bigint) to authenticated;

-- ---------- Seguridad ----------
alter table public.channels enable row level security;
alter table public.channel_admins enable row level security;

-- Canales: todos los ven; solo un usuario registrado crea el suyo; admins editan el tema; el creador lo borra
create policy "channels_select" on public.channels for select to anon, authenticated using (true);
create policy "channels_insert_own" on public.channels for insert to authenticated
  with check (owner_id = auth.uid() and exists (select 1 from public.profiles p where p.id = auth.uid()));
create policy "channels_update_admin" on public.channels for update to authenticated
  using (public.is_channel_admin(id)) with check (public.is_channel_admin(id));
create policy "channels_delete_owner" on public.channels for delete to authenticated using (owner_id = auth.uid());

grant select on public.channels to anon, authenticated;
grant insert (name, topic, owner_id) on public.channels to authenticated;
grant update (topic) on public.channels to authenticated;
grant delete on public.channels to authenticated;

-- Administradores: todos los ven; un admin nombra a otros; el creador quita a cualquiera y cada admin puede renunciar
create policy "admins_select" on public.channel_admins for select to anon, authenticated using (true);
create policy "admins_insert" on public.channel_admins for insert to authenticated
  with check (granted_by = auth.uid() and public.is_channel_admin(channel_id));
create policy "admins_delete" on public.channel_admins for delete to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from public.channels c where c.id = channel_id and c.owner_id = auth.uid())
  );

grant select on public.channel_admins to anon, authenticated;
grant insert (channel_id, user_id, granted_by), delete on public.channel_admins to authenticated;

-- ---------- Canal del sistema ----------
insert into public.channels (name, topic)
values ('#general', 'Canal general: bienvenidos a todos')
on conflict do nothing;
