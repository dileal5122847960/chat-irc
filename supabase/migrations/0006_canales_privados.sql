-- =====================================================================
-- 0006 — Canales privados con contraseña
-- • La contraseña se guarda con hash bcrypt y se comprueba en el servidor.
-- • Si es correcta, se entrega el "secreto" del canal: el nombre del canal de
--   tiempo real donde se habla. Sin él no se pueden escuchar los mensajes.
-- • Ni el hash ni el secreto son legibles desde la app (permisos por columna).
-- =====================================================================
create extension if not exists pgcrypto with schema extensions;

alter table public.channels
  add column if not exists is_private boolean not null default false,
  add column if not exists password_hash text,
  add column if not exists secret text;

-- Solo estas columnas son visibles; password_hash y secret quedan ocultas
revoke select on public.channels from anon, authenticated;
grant select (id, name, topic, owner_id, created_at, is_private) on public.channels to anon, authenticated;

-- Poner, cambiar o quitar la contraseña (solo el creador). Cada cambio genera un secreto nuevo.
create or replace function public.set_channel_password(p_channel bigint, p_password text)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.channels where id = p_channel and owner_id = auth.uid()) then
    raise exception 'Solo el creador del canal puede cambiar la contraseña' using errcode = '42501';
  end if;
  if p_password is null or length(p_password) = 0 then
    update public.channels set is_private = false, password_hash = null, secret = null where id = p_channel;
  else
    if length(p_password) < 4 or length(p_password) > 72 then
      raise exception 'La contraseña debe tener entre 4 y 72 caracteres' using errcode = '22023';
    end if;
    update public.channels
      set is_private = true,
          password_hash = extensions.crypt(p_password, extensions.gen_salt('bf', 8)),
          secret = encode(extensions.gen_random_bytes(18), 'hex')
      where id = p_channel;
  end if;
end;
$$;
revoke all on function public.set_channel_password(bigint, text) from public;
grant execute on function public.set_channel_password(bigint, text) to authenticated;

-- Acceso a un canal privado: devuelve el secreto si la contraseña es correcta
-- (o si quien llama es su creador o un administrador registrado).
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
  if p_password is not null and c.password_hash = extensions.crypt(p_password, c.password_hash) then
    return c.secret;
  end if;
  if p_password is not null then
    perform pg_sleep(0.6); -- frena los intentos de adivinar la contraseña
  end if;
  raise exception 'Contraseña incorrecta' using errcode = '28P01';
end;
$$;
revoke all on function public.channel_access(bigint, text) from public;
grant execute on function public.channel_access(bigint, text) to anon, authenticated;
