-- =====================================================================
-- 0012 — App de Windows: versión inicial en app_versions
-- (al publicar cada versión nueva, actualizar esta fila)
-- =====================================================================
insert into public.app_versions (platform, latest_version, min_version, download_url, notes)
values ('windows', '1.0.0', '1.0.0',
        'https://github.com/dileal5122847960/chat-irc/releases/download/windows-v1.0.0/ChamuFlac-Setup.exe',
        'Primera versión para Windows: amigos, privados, llamadas y mensajes guardados.')
on conflict (platform) do nothing;
