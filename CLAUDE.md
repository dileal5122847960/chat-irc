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

## App de Android (hecha, 26-11-2026)

- **Capacitor 8**: `app/index.html` + `src/app/` (main.js, native.js, app.css) → `npm run build:app` → `dist-app/` →
  `npx cap sync android` → proyecto nativo `android/` (paquete `com.chamuflac.app`). Prueba en navegador: `npm run dev:app` (puerto 5174).
- Solo **amigos y privados**. Bienvenida → `check_app_version('android', …)` → sesión recordada (storageKey `chamuflac-app-auth`).
  Google: navegador del sistema + vuelta `com.chamuflac.app://auth` (Redirect URL añadida en Supabase si el dueño la configuró).
- Reutiliza `src/dm.js` con hooks (`inboxTopic`, `inboxPrivate`, `autoAccept`, `resendRequests`, `onIncoming`, `onCallRing`,
  `acceptExternal`…). Piezas comunes web/app: `src/common.js`, `src/config.js`.
- **Bandeja privada `user:<número>`** (migración 0009, Realtime Authorization con RLS): solo el dueño escucha, solo amigos escriben.
  Entre amigos la conversación se acepta sola. La solicitud se **reenvía cada 4 s** mientras se espera (la repetición de mensajes
  guardados de Realtime no funciona en el plan actual).
- **Avisos push**: Edge Function `push` (JWT desactivado) → FCM HTTP v1 con el secreto `FCM_SERVICE_ACCOUNT` (Supabase).
  `push_targets()` (solo service_role) comprueba amistad; `forget_push_token()` (0010) borra tokens caducados.
  Proyecto Firebase "ChamuFlac" (plan Spark). Canales de aviso: `messages`, `calls`. Avisos locales con la app en segundo plano.
- **Compilación**: `.github/workflows/android.yml` (GitHub Actions). Secretos de GitHub: `ANDROID_KEYSTORE_BASE64`,
  `ANDROID_KEYSTORE_PASSWORD` (clave de firma: la tiene el dueño; **nunca cambiarla**), `GOOGLE_SERVICES_JSON`.
- **Publicar versión de Android**: subir `androidVersion` en `package.json` → Actions → "App Android" → Run workflow (main) → el APK sale en Releases
  (`ChamuFlac.apk`) → actualizar la fila `android` de `app_versions` (`latest_version`, `download_url`, y `min_version` si es obligatoria).
- **App ↔ web**: `dm.js` tiene dos vías por conversación (`w.via`): `'tab'` (web, `inbox:<clientId>`, público) y `'user'`
  (amigos, `user:<número>`, privado). La web registrada escucha también `user:<su número>` (acepta sola a sus amigos) y abre
  privados con amigos desde el panel Amigos («Hablar»). Cada dispositivo/pestaña tiene un `DEV`: con la misma cuenta abierta
  en varios sitios, la conversación se queda en el primero que responde (`peerDev`, señales con `to`) y los demás se retiran.
- **Entre amigos no se pide permiso**: la conversación conecta sola (`autoReconnect` al abrirla) y se puede escribir enseguida.
- **Buzón cifrado** (`src/mailbox.js`, migración 0011): si no hay conexión directa, texto y stickers se cifran en el dispositivo
  (ECDH P-256 + AES-GCM) para cada dispositivo del amigo (`devices.public_key`, clave privada en localStorage `devkey:<uid>`)
  y esperan en `mailbox` (`mail_send`); el dispositivo los recoge y se borran (`mail_fetch`); 30 días máximo. Aviso push
  `kind: 'msg'` (sin el texto) y ping `mail` por la bandeja; acuses ✓✓ por la bandeja (`receipt`). Estado de ventana `offline`.
  Fotos, audios y llamadas siguen necesitando conexión. Apps < 1.0.3 no tienen clave: subir `min_version` de android a 1.0.3.
- **Amigos en la web** (`src/friends.js`): botón "Amigos" (con contador) junto al nick para cuentas registradas: agregar por
  número, aceptar/rechazar, cancelar, eliminar, bloquear. Se consulta al entrar, cada 2 min y al volver a la pestaña.
- Márgenes del sistema en la app: usar `var(--sat)` / `var(--sab)` (Capacitor 8 inyecta `--safe-area-inset-*`), no `env()` solo.
- Limitaciones conocidas: fotos/audios/llamadas requieren que ambos estén conectados; descargar archivos recibidos en el WebView puede
  no funcionar (pendiente: guardar con Filesystem/Share); llamada con pantalla completa sobre el bloqueo (ConnectionService) pendiente.

## Apps para iPhone (iOS) y Windows — decisión del dueño (26-11-2026)

Habrá también versión **iOS (iPhone)** y **Windows**, con lo mismo que la de Android (amigos, privados, buzón, avisos,
actualización). Para no rehacer nada:
- **Todo lo común va en `src/`** (`dm.js`, `mailbox.js`, `friends.js`, `common.js`, `config.js`, `src/app/main.js`); lo propio
  de cada sistema, solo en `src/app/native.js` (avisos, enlaces, navegador, segundo plano). `platform` sale de ahí
  (`android` / `ios` / `windows`) y se usa en `check_app_version` y `register_device` (la BD ya admite esas plataformas).
- **iOS:** Capacitor (`npx cap add ios`) reutilizando `src/app/`. Requiere Mac/Xcode → compilar en GitHub Actions con
  `macos-latest`; cuenta **Apple Developer (99 USD/año)**; distribución por **TestFlight/App Store** (no hay APK: las
  actualizaciones las hace la tienda; `download_url` = enlace de la App Store). Avisos: FCM con APNs (clave .p8 de Apple
  subida a Firebase); llamadas con la app cerrada → PushKit/CallKit (nativo, pendiente). Revisión de Apple: hace falta
  política de privacidad y la opción de **borrar la cuenta** desde la app.
- **Windows (hecha, 26-11-2026): Electron** (`desktop/main.cjs`, `desktop/preload.cjs`, `electron-builder.yml`). Misma app
  (`src/app/`) compilada con `npm run build:desktop` (versión `windowsVersion` de package.json) en `desktop/web`, servida como
  `https://localhost` (protocolo interceptado: `turn` y `push` ya la aceptan). Puente `window.chamuflacDesktop` → `native.js`
  (`platform: 'windows'`). Al cerrar la ventana sigue en la **bandeja** (recibe mensajes/llamadas con avisos de Windows);
  arranca con Windows (opción en el menú de la bandeja); protocolo `com.chamuflac.app` para volver de Google.
  **Auto-actualización**: `installUpdate(url)` descarga el `.exe` (solo de Releases `windows-v*` del repo) y lo ejecuta con
  `/S --force-run`. Compilación: Actions → "App Windows" → Run workflow (main) → Release `windows-vX.Y.Z` con
  `ChamuFlac-Setup.exe` (no es la "latest", que queda para Android) → actualizar fila `windows` de `app_versions` (0012).
  Sin certificado de firma de código: SmartScreen avisa ("Más información → Ejecutar de todas formas"); un certificado
  (~100–300 USD/año) lo quita.
- El **buzón cifrado** y la bandeja `user:<número>` ya sirven para todas: cada dispositivo nuevo registra su clave.

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
  MyMemory). Cada mensaje viaja con su `lang`. **No se traduce sola** (decisión del dueño): se muestra el original y,
  si está en otro idioma, un botón «Traducir» (siempre al idioma elegido al entrar); mismo idioma → sin botón.
  El `lang` de cada mensaje es el **idioma real del texto** (`detectLang()` en el dispositivo de quien escribe; si no está
  claro, el de su interfaz). MyMemory traduce con `autodetect` como origen. Su cupo gratuito es por conexión (diario).
- **Exportar a PDF:** imprime el log visible en un iframe ("Guardar como PDF").
- **Marcas de lectura propias** (no ✓✓): una línea **bordó** = aún no le llegó, dos **azules** = le llegó, dos **verdes** =
  leído; reloj = enviando, ✕ roja = no enviado (iconos `line1`/`line2` en `src/common.js`; colores `--tick-sent`,
  `--tick-delivered`, `--read-mark`).
- **Chat con amigos limpio** (decisión del dueño): sin avisos de conexión, reconexión ni errores (`sysLine` los omite si
  `w.via === 'user'`, salvo llamadas 📞/📹). El último mensaje queda siempre a la vista (`stickToBottom`, también con teclado).
- **Foto de perfil, letra y fondo** (`src/profile.js`, decisión del dueño): la foto **solo se ve en privados** y **no pasa
  por el servidor**: se guarda en el dispositivo del dueño (`myphoto:<uid>`) y viaja al amigo por el DataChannel
  (mensaje `photo`, ≤90 KB, 256 px); el amigo la recuerda (`photo:u:<número>`; privados ocasionales solo en memoria).
  En canales, iniciales. Tamaño de letra (`--fs`: Normal/Grande/Muy grande) y fondo del chat (degradados o foto propia,
  `data-wall` / `--wall`) son preferencias del dispositivo.
  **Mi perfil** (app: foto en la cabecera o menú ⋮; web: menú de usuario): ver la foto, cambiarla, **ajustarla** (editor
  `editPhoto`: arrastrar + zoom, máscara circular; se guarda el original `myphoto-src:<uid>`), quitarla, editar nombre/nick.
  Nick y nombre se envían a los amigos conectados al instante (mensaje `profile` por el DataChannel, solo `via 'user'`). Español de Argentina: «son amigos», «pueden» (no «sois/podéis»).
- **Archivos en privados:** pegar (Ctrl+V, p. ej. capturas) y arrastrar, en web y app. Botones **Compartir** (correo, otras apps:
  Android `@capacitor/share` + `@capacitor/filesystem`; navegador `navigator.share` si existe) y **Guardar** (Android:
  Documentos/ChamuFlac; Windows/web: descarga) en fotos, vídeos, audios y documentos (`ctx.shareFile/saveFile/canShareFiles`).
- **Ver una vez** (botón «1» junto al clip): la próxima foto/vídeo/audio se envía con `once`; quien la recibe la abre una sola
  vez en un visor sin guardar ni compartir; al cerrar (o terminar el audio) se borra y se envía `viewed` → «Abierta».
  Quien la envía tampoco conserva la imagen. (No impide capturas de pantalla.)
- El **nick** también se cambia desde Mi perfil en la app (es de la cuenta: cambia en todos los dispositivos).
- **Publicidad** (`src/ads.js`): carrusel en la portada de la app y en la barra lateral de la web. Hoy anuncia ChamuFlac
  (descargas — enlaces de `app_versions` —, invitar amigos, consejos); cada app oculta su propio anuncio. Para anuncios
  reales, cambiar solo `getSlides()`.
- **Actitud** (migración 0013): frase de hasta 140 caracteres en `user_private.attitude`, solo para amigos
  (`set_my_attitude`, `list_friends` y `my_account` la devuelven); también viaja en el mensaje `profile` (al instante).
- **Tonos** (`TONES`/`sounds`/`playTone` en `src/common.js`): tono de mensajes y de llamadas elegibles (generados con
  WebAudio, sin archivos). Con la app de Android cerrada suena el tono de notificación del sistema.
- **Identidad visual:** nombre ChamuFlac, logo y banderas en `src/brand.js`, paleta roja
  (tokens al final de `src/style.css`). Estilo de privados tipo app de mensajería (burbujas, ✓✓).
- **Sin comandos:** todo con botones, menús (`openMenu`) y diálogos propios (`openDialog`).

## Configuración externa (ya hecha)

- Supabase: migraciones `0001`–`0006` aplicadas (`0007`–`0011` aplicadas y verificadas al 26-11-2026) (ver `supabase/migrations/`). Auth: email activado,
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

## Estado al 26-11-2026 (para retomar)

**Publicado y funcionando:** web (main) · **Android 1.0.5** · **Windows 1.0.1** (Releases). `app_versions`: android
latest 1.0.5 / min 1.0.3; windows latest 1.0.1 / min 1.0.0; web 1.0.0. Migraciones 0001–0012 aplicadas (0012 = fila windows).
Funciones `turn` y `push` desplegadas (push con tipo `msg`, `forget_push_token`). Firebase y firma de Android configurados.

**Hecho el 26-11:** app Android (amigos, privados, buzón cifrado, avisos push), amigos en la web, chat app ↔ web, sin pedir
permiso entre amigos, mensajes sin conexión, marcas de lectura con líneas (bordó/azul/verde), traducción a pedido desde
el idioma real, chat limpio sin avisos de conexión, último mensaje siempre visible, app Windows (Electron, bandeja,
auto-actualización), foto de perfil en privados (sin servidor), tamaño de letra y fondo del chat.

**Esperando respuesta del dueño (lo estaba probando):**
- Windows: ¿la **actualización automática** 1.0.0 → 1.0.1 descarga, instala y reabre sola? ¿Bandeja, avisos de Windows,
  inicio con Windows y vuelta de "Continuar con Google" funcionan en su PC? (no se pudo probar desde aquí).
- Android 1.0.5: foto de perfil entre dos teléfonos reales; marcas de lectura; avisos push con la app cerrada; audio en
  llamadas (pendiente desde el principio: "se ve pero no se escucha" en Android Chrome).

**Forma de publicar (recordatorio):** el clasificador exige que el dueño diga explícitamente "sí, publica en main" antes de
cada push a `main` → trabajar en rama, probar, pedir permiso. No puedo crear etiquetas ni lanzar Actions: el dueño pulsa
"Run workflow" (App Android / App Windows) y luego ejecuta el SQL de `app_versions` (dárselo listo, **después** de que el
archivo esté en Releases). Subir `androidVersion` / `windowsVersion` en package.json en cada cambio de app.

**Pendiente / ideas siguientes:**
0. Los dispositivos se acumulan (cada navegador nuevo registra uno): `mail_send` acepta 20 copias por llamada (el cliente
   envía en tandas). Más adelante: borrar dispositivos sin uso o limitar `friend_devices` a los más recientes.
1. Probar privado y videollamada entre redes distintas (Wi-Fi vs datos) y revisar consumo en Metered.
2. App de iPhone (necesita cuenta Apple Developer 99 USD/año; ver sección iOS).
3. Guardar/descargar archivos recibidos en la app (Android WebView no descarga `blob:`): usar Filesystem/Share.
4. Llamadas con la app cerrada a pantalla completa (Android ConnectionService / iOS CallKit).
5. Seguridad antes de abrir al público: canales generales por RLS, límites de envío, captcha, bloqueos/moderación.
6. Rotar el **secreto de cliente de Google**; borrar **cuentas de prueba** (`@chatirc-prueba.dev`: amigo3200 =
   71865043, dueno7488 = 70005962; `testreg8569`) y sus dispositivos; recomendar **2FA** en todas las cuentas.
7. Preguntar si se cambia el correo de contacto de `public/privacidad.html` y `public/terminos.html`.
8. Opcional: dominio `chamuflac.vercel.app`; certificado de firma de código para Windows (quita el aviso SmartScreen);
   traductor de pago cuando haya muchos usuarios (MyMemory tiene cupo diario por conexión).

## Ideas propuestas (no hechas)

Blindar Realtime con canales privados/RLS (hoy los mensajes, cargos temporales y expulsiones no los
verifica el servidor), bloqueos (ban), captcha contra bots, notificaciones del navegador, traducir el
tema de los canales y las páginas legales.
