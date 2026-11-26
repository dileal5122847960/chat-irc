# ChamuFlac — notas del proyecto

Chat web en tiempo real con el espíritu del clásico mIRC: canales, nicks, privados con
multimedia, llamadas y videollamadas, traducción automática y **sin historial**.
El usuario (dueño del proyecto) habla **español** (Argentina, GMT-3): responder siempre en español.

- **Web publicada:** https://chat-irc.vercel.app (Vercel publica solo cada push a `main`)
- **Repositorio:** `dileal5122847960/chat-irc`
- **Supabase:** proyecto `whvunvvspnbhwddesjqz` (plan Free). URL y clave *publishable* son públicas
  y están en `src/supabase.js`. **Nunca** poner en el código claves `secret`/`service_role`.

## Objetivo y escalabilidad (decisión del dueño)

Fase actual: **todo funcional con planes gratuitos**. Fase siguiente: **migrar a servicios de pago
para soportar gran demanda**. Por eso:
- Cada servicio externo va detrás de su propio módulo/función para poder cambiar de proveedor sin
  rehacer la app (ya: TURN en la función `turn`, traducción en `src/translate.js`; pendiente:
  abstraer el transporte de tiempo real para poder salir de Supabase Realtime).
- Puntos que se quedarán cortos primero y su reemplazo previsto:
  - Realtime Supabase Free (~200 conexiones, 2 M mensajes/mes) → Supabase Pro + ampliaciones, o
    Ably/Pusher/Centrifugo.
  - Videollamada grupal en malla (~6 personas) → SFU (LiveKit Cloud o Cloudflare Realtime SFU).
  - TURN Metered 500 MB/mes → Cloudflare TURN o Metered de pago (solo cambiar secretos de `turn`).
  - Traducción Chrome/MyMemory → Google Translate o DeepL vía Edge Function con caché.
  - Vercel Hobby **no permite uso comercial** → Vercel Pro o Cloudflare Pages.
  - Supabase Free (500 MB, 50k MAU, pausa tras 7 días inactivo) → Supabase Pro.
- Antes de abrir al público: seguridad del tiempo real (canales privados/RLS), límites de envío,
  captcha, bloqueos y moderación.

## Apps futuras (móvil y Windows) — decisión del dueño

Más adelante habrá **app de móvil** y **app de escritorio para Windows**, centradas en los
**privados entre amigos** (conexión punto a punto). La base de datos ya se prepara para ellas
(migración `0007`):
- **`profiles.user_number`**: número **aleatorio de 8 dígitos** para buscarse/agregarse. Las relaciones
  usan este número (bigint) en lugar del uuid. No es listable en bloque (solo `id, nick` son públicos).
- **`user_private`**: nombre y apellido (**obligatorios** al registrarse; visibles **solo para amigos**).
  El correo NO se duplica: vive en `auth.users`. Leer con `my_account()`, escribir con `set_my_name()`.
- **`devices`**: plataforma, token push (para que suene con la app cerrada), clave pública de identidad
  (E2E verificable). Sin IPs: la conexión se negocia en el momento (ICE/STUN/TURN).
- **`friendships`**: pendiente/aceptada/bloqueada, solo vía funciones: `find_user`, `list_friends`,
  `send_friend_request`, `respond_friend_request`, `remove_friend`, `block_user`.
- Plan de señalización para las apps: canal por **número de usuario** (`user:<número>`) en lugar del
  `clientId` de la pestaña → **requiere activar Realtime Authorization** (canales privados con RLS) para
  que solo el dueño escuche su canal. Push nativo: FCM (Android/Windows) / APNs-PushKit (iOS).
- Las apps nativas podrían hacerse con Capacitor o React Native reutilizando `src/dm.js`.

## Versiones y actualizaciones automáticas — decisión del dueño

Saldrán muchas versiones antes de la final: **todas las apps se actualizan solas**.
- Tabla **`app_versions`** (una fila por plataforma: web, android, ios, windows…): `latest_version`,
  `min_version` (por debajo = actualización **obligatoria**), `download_url`, `notes`.
- Cada app, al conectarse, llama a **`check_app_version(plataforma, versión)`** →
  `current` / `available` / `required`. `devices.app_version` guarda qué versión usa cada dispositivo.
- **Web** (`src/version.js`): la versión sale de `package.json` (`__APP_VERSION__`); cada build genera
  `/version.json` con un `build` único → si cambia, aviso "Nueva versión disponible"; si la BD dice
  `required`, se recarga sola (espera a que termine una llamada). Comprueba al entrar, cada 10 min y al
  volver a la pestaña.
- **Al publicar una versión:** subir `version` en `package.json` (semver). Para forzar la
  actualización, actualizar `min_version` de la fila `web` (SQL). Para las apps nativas, actualizar su
  fila al publicar cada build. Apps nativas: auto-actualización de tiendas/instalador y, con Capacitor,
  actualización de la parte web sin pasar por la tienda.

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

- Supabase: migraciones `0001`–`0006` aplicadas (`0007` y `0008` aplicadas; `0008` verificada el 26-11-2026) (ver `supabase/migrations/`). Auth: email activado,
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
