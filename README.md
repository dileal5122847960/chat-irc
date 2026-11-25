# Chat IRC

Chat web al estilo del clásico mIRC: canales (`#general`), nicks, lista de usuarios conectados y comandos `/join`, `/me`, `/nick`, `/topic`…

- **Frontend:** Vite + JavaScript, publicado en **Vercel**.
- **Backend:** **Supabase**, con PostgreSQL para guardar el historial y Realtime para los mensajes al instante y la presencia.

## Puesta en marcha

1. En Supabase, abre el **SQL Editor**, pega `supabase/migrations/0001_base.sql` y pulsa **Run**.
2. En Supabase, activa **Authentication → Sign In / Providers → Allow anonymous sign-ins**.
3. Para desarrollar en local:

   ```bash
   cp .env.example .env.local
   ```

   Rellena `.env.local` con tus datos de Supabase y ejecuta:

   ```bash
   npm install
   ```

   ```bash
   npm run dev
   ```

4. En Vercel, importa este repositorio y añade las variables `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`.

## Comandos

`/join #canal`, `/part`, `/me acción`, `/nick nuevo`, `/topic texto`, `/list`, `/clear`, `/help`, `/quit`
