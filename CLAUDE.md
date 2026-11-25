# ChamuFlac — notas del proyecto

Chat web en tiempo real con el espíritu del clásico mIRC: canales, nicks, privados con
multimedia, llamadas y videollamadas, traducción automática y **sin historial**.
El usuario (dueño del proyecto) habla **español** (Argentina, GMT-3): responder siempre en español.

- **Web publicada:** https://chat-irc.vercel.app (Vercel publica solo cada push a `main`)
- **Repositorio:** `dileal5122847960/chat-irc`
- **Supabase:** proyecto `whvunvvspnbhwddesjqz` (plan Free). URL y clave *publishable* son públicas
  y están en `src/supabase.js`. **Nunca** poner en el código claves `secret`/`service_role`.

## Arquitectura

- **Frontend:** Vite + JavaScript sin framework (`src/`). `npm run dev` / `npm run build`.
- **Mensajes de canal:** Supabase Realtime *Broadcast* (no se guardan). Usuarios conectados: *Presence*.
  Lobby global `irc-lobby` (presence) para nicks en uso y canales activos.
- **Base de datos (mínima):** solo `profiles` (nick reservado de cuentas registradas), `channels`
  (uno por usuario registrado; `#general` es del sistema, sin dueño) y `channel_admins`
  (admins permanentes). La lista de canales se lee al entrar y se recarga solo cuando alguien
  crea/borra uno (aviso por broadcast en el lobby).
- **Canales privados:** contraseña con bcrypt en el servidor (`channel_access()` devuelve el
  *secreto*; el canal realtime es `irc:p:<secreto>`). `password_hash` y `secret` no son legibles
  (permisos por columna). Creador y admins registrados entran sin contraseña.
- **Privados (doble clic en un nick):** `src/dm.js`. Solicitud/aceptación por la bandeja
  `inbox:<clientId>` (enviada con `httpSend`). WebRTC directo: DataChannel para texto,
  archivos (≤100 MB), notas de voz, stickers; llamadas con audio/vídeo pre-negociados.
  **Plan B:** si no hay conexión directa en 15 s, sigue por Realtime (`event: 'relay'`, archivos
  ≤5 MB, sin E2E, sin llamadas) y se avisa en naranja.
- **Videollamadas grupales:** `src/groupcall.js`, malla WebRTC (máx. 8). En cada pareja inicia
  siempre el de `clientId` menor (sin ofertas cruzadas). Señalización por el canal (`event: 'gc'`).
- **TURN:** Edge Function `turn` (`supabase/functions/turn/index.ts`) entrega credenciales de
  **Metered** (gratis, 500 MB/mes) con los secretos `TURN_USERNAME` y `TURN_PASSWORD`.
  También admite Metered por API Key o Cloudflare. Solo responde a `chat-irc.vercel.app` y
  `localhost:5173`. "Enforce JWT Verification" está **desactivado** (necesario con claves `sb_publishable_`).
- **Idiomas:** `src/i18n.js` (es, en, pt, fr, it). Los textos están en español en el código; un
  MutationObserver los traduce en pantalla con el diccionario `ENTRIES`/`PATTERNS`. Lo que escriben
  las personas va marcado con `.ugc` (u otros selectores de `SKIP`) para no traducirlo.
  **Al añadir textos de interfaz, añadir su traducción a `ENTRIES` en los 5 idiomas.**
- **Traducción de mensajes:** `src/translate.js` (traductor integrado de Chrome con timeout; respaldo
  MyMemory). Cada mensaje viaja con su `lang`.
- **Exportar a PDF:** imprime el log visible en un iframe ("Guardar como PDF").
- **Identidad visual:** nombre ChamuFlac, logo y banderas en `src/brand.js`, paleta roja
  (tokens al final de `src/style.css`). Estilo de privados tipo app de mensajería (burbujas, ✓✓).
- **Sin comandos:** todo con botones, menús (`openMenu`) y diálogos propios (`openDialog`).

## Configuración externa (ya hecha)

- Supabase: migraciones `0001`–`0006` aplicadas (ver `supabase/migrations/`). Auth: email activado,
  "Confirm email" desactivado, anónimos desactivados, Google activado. Site URL = la de Vercel.
- Google Cloud: cliente OAuth "Chat IRC" (proyecto "My First Project"), app publicada.
- Vercel: proyecto `chat-irc` conectado a GitHub (despliegue automático desde `main`).
- Metered: credencial TURN "chamuflac" (workspace chamuflac).

## Forma de trabajar

- Probar con Playwright (Chromium preinstalado) contra el Supabase real antes de publicar:
  varios contextos de navegador, `--use-fake-device-for-media-stream` para llamadas.
- Si un cambio necesita migración SQL, **no** publicar en `main` hasta que el usuario la ejecute
  (subir a una rama aparte). El usuario ejecuta el SQL en Supabase → SQL Editor.
- Commits con autor `Claude <noreply@anthropic.com>` (lo exige un hook del repositorio).
- El entorno de pruebas solo permite salir a `whvunvvspnbhwddesjqz.supabase.co` y
  `api.mymemory.translated.net`; el tráfico TURN no se puede probar desde aquí.

## Pendiente (al 25-11-2026)

1. **Probar privado y videollamada entre dos redes distintas** (Wi-Fi vs datos móviles): ver si
   sale "cifrado de extremo a extremo" (directo/TURN) o "vía servidor" (plan B). Revisar consumo en
   Metered → Usage analytics.
2. Rotar el **secreto de cliente de Google** (quedó visible en una captura del chat).
3. Borrar **cuentas de prueba** en Supabase → Authentication → Users (`@chatirc-prueba.dev`,
   `testreg8569`).
4. Preguntar si se cambia el **correo de contacto** de `public/privacidad.html` y `public/terminos.html`.
5. Recomendar **2FA** en GitHub, Vercel, Supabase, Google, Metered, Cloudflare.
6. Opcional: renombrar el dominio a `chamuflac.vercel.app` (actualizar Site URL de Supabase, el cliente
   OAuth de Google y la lista `ALLOWED` de la función `turn`).

## Ideas propuestas (no hechas)

Blindar Realtime con canales privados/RLS (hoy los mensajes, cargos temporales y expulsiones no los
verifica el servidor), bloqueos (ban), captcha contra bots, notificaciones del navegador, traducir el
tema de los canales y las páginas legales.
