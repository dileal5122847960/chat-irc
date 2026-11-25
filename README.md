# ChamuFlac

Chat web en tiempo real, sin instalar nada: canales temáticos, privados cifrados con fotos,
vídeos, documentos y notas de voz, llamadas y videollamadas (también grupales), traducción
automática entre idiomas y **sin historial** (las conversaciones no se guardan; se pueden
exportar a PDF).

**Web:** https://chat-irc.vercel.app

## Tecnología

- **Frontend:** Vite + JavaScript, publicado en **Vercel**.
- **Backend:** **Supabase** — Realtime (Broadcast/Presence) para los mensajes, Auth (correo y
  Google) y una base de datos mínima (nicks reservados, canales y administradores).
- **Privados y llamadas:** WebRTC directo entre navegadores (cifrado de extremo a extremo), con
  TURN de Metered vía la Edge Function `turn` y un plan B por Realtime.
- **Idiomas:** español, inglés, portugués, francés e italiano.

## Desarrollo

```bash
npm install
```

```bash
npm run dev
```

Las migraciones de la base de datos están en `supabase/migrations/` (se ejecutan en orden en el
SQL Editor de Supabase) y la función TURN en `supabase/functions/turn/`.

Más detalles de arquitectura y estado del proyecto en [`CLAUDE.md`](CLAUDE.md).
