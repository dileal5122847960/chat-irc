/*
 * Idiomas de la interfaz
 * ──────────────────────
 * Los textos de la app están escritos en español en el código. Este módulo:
 *  • ofrece t('texto en español', { variables }) para generar textos ya traducidos;
 *  • observa la pantalla y traduce al idioma elegido cualquier texto o atributo
 *    (title, placeholder, aria-label) que coincida con el diccionario.
 * Lo que escriben las personas (mensajes, nicks, temas) se marca con clases que
 * se excluyen (.ugc, .nick, …) y nunca pasa por este diccionario.
 */

export const LANGS = { es: 'Español', en: 'English', pt: 'Português', fr: 'Français', it: 'Italiano' };
const ORDER = ['en', 'pt', 'fr', 'it'];

// [español, inglés, portugués, francés, italiano]
const ENTRIES = [
  // Pantalla principal
  // Pantalla principal de ChamuFlac
  ['Chatea en tiempo real, sin instalar nada', 'Chat in real time, nothing to install', 'Converse em tempo real, sem instalar nada', 'Discute en temps réel, sans rien installer', 'Chatta in tempo reale, senza installare nulla'],
  ['combina el espíritu de los clásicos canales de chat con todo lo que esperas de una app de mensajería moderna. Entra con un nick y empieza a hablar.', 'blends the spirit of classic chat channels with everything you expect from a modern messaging app. Pick a nickname and start talking.', 'combina o espírito dos clássicos canais de chat com tudo o que você espera de um app de mensagens moderno. Entre com um nick e comece a conversar.', 'associe l’esprit des salons de discussion classiques à tout ce que tu attends d’une messagerie moderne. Choisis un pseudo et commence à parler.', 'unisce lo spirito dei classici canali di chat a tutto ciò che ti aspetti da un’app di messaggistica moderna. Scegli un nick e inizia a parlare.'],
  ['Canales temáticos', 'Topic channels', 'Canais temáticos', 'Salons thématiques', 'Canali tematici'],
  ['Únete a salas abiertas o crea la tuya y modérala con tus propios administradores.', 'Join open rooms or create your own and moderate it with your own administrators.', 'Entre em salas abertas ou crie a sua e modere-a com seus próprios administradores.', 'Rejoins des salons ouverts ou crée le tien et modère-le avec tes propres administrateurs.', 'Entra in stanze aperte o crea la tua e moderala con i tuoi amministratori.'],
  ['Privados cifrados', 'Encrypted private chats', 'Privados criptografados', 'Messages privés chiffrés', 'Chat private cifrate'],
  ['Mensajes, fotos, vídeos, documentos y notas de voz de persona a persona, cifrados de extremo a extremo.', 'Person-to-person messages, photos, videos, documents and voice notes, end-to-end encrypted.', 'Mensagens, fotos, vídeos, documentos e áudios de pessoa para pessoa, com criptografia de ponta a ponta.', 'Messages, photos, vidéos, documents et messages vocaux de personne à personne, chiffrés de bout en bout.', 'Messaggi, foto, video, documenti e note vocali da persona a persona, cifrati end-to-end.'],
  ['Llamadas y videollamadas', 'Voice and video calls', 'Chamadas e videochamadas', 'Appels audio et vidéo', 'Chiamate e videochiamate'],
  ['Habla cara a cara desde el navegador, en el ordenador o en el móvil.', 'Talk face to face from your browser, on your computer or phone.', 'Fale cara a cara pelo navegador, no computador ou no celular.', 'Parle en face à face depuis ton navigateur, sur ordinateur ou mobile.', 'Parla faccia a faccia dal browser, sul computer o sul telefono.'],
  ['Traducción automática', 'Automatic translation', 'Tradução automática', 'Traduction automatique', 'Traduzione automatica'],
  ['Escribe en tu idioma: cada persona lee los mensajes en el suyo.', 'Write in your language: everyone reads messages in theirs.', 'Escreva no seu idioma: cada pessoa lê as mensagens no dela.', 'Écris dans ta langue : chacun lit les messages dans la sienne.', 'Scrivi nella tua lingua: ognuno legge i messaggi nella propria.'],
  ['Sin historial', 'No history', 'Sem histórico', 'Sans historique', 'Nessuna cronologia'],
  ['Nada se guarda en servidores. Si quieres conservar una charla, expórtala a PDF.', 'Nothing is stored on servers. To keep a chat, export it to PDF.', 'Nada fica guardado em servidores. Para guardar uma conversa, exporte-a para PDF.', 'Rien n’est stocké sur des serveurs. Pour garder une discussion, exporte-la en PDF.', 'Niente viene salvato sui server. Per conservare una chat, esportala in PDF.'],
  ['Gratis y sin instalar', 'Free, nothing to install', 'Grátis e sem instalar', 'Gratuit, sans installation', 'Gratis, senza installare'],
  ['Funciona en cualquier navegador moderno, sin descargas ni registros obligatorios.', 'Works in any modern browser, with no downloads or mandatory sign-up.', 'Funciona em qualquer navegador moderno, sem downloads nem cadastro obrigatório.', 'Fonctionne dans tout navigateur moderne, sans téléchargement ni inscription obligatoire.', 'Funziona in qualsiasi browser moderno, senza download né registrazione obbligatoria.'],
  ['Privacidad', 'Privacy', 'Privacidade', 'Confidentialité', 'Privacy'],
  ['Condiciones', 'Terms', 'Termos', 'Conditions', 'Termini'],
  ['Canales, nicks y conversación en tiempo real', 'Channels, nicks and real-time conversation', 'Canais, nicks e conversa em tempo real', 'Salons, pseudos et conversation en temps réel', 'Canali, nick e conversazione in tempo reale'],
  ['Nick', 'Nickname', 'Nick', 'Pseudo', 'Nick'],
  ['tu_nick', 'your_nick', 'seu_nick', 'ton_pseudo', 'tuo_nick'],
  ['Entrar al chat', 'Enter the chat', 'Entrar no chat', 'Entrer dans le chat', 'Entra nella chat'],
  ['o reserva tu nick', 'or reserve your nickname', 'ou reserve seu nick', 'ou réserve ton pseudo', 'oppure riserva il tuo nick'],
  ['Continuar con Google', 'Continue with Google', 'Continuar com o Google', 'Continuer avec Google', 'Continua con Google'],
  ['Iniciar sesión con correo', 'Sign in with email', 'Entrar com e-mail', 'Se connecter avec un e-mail', 'Accedi con email'],
  ['Crear cuenta', 'Create account', 'Criar conta', 'Créer un compte', 'Crea account'],
  ['Iniciar sesión', 'Sign in', 'Entrar', 'Se connecter', 'Accedi'],
  ['← Volver', '← Back', '← Voltar', '← Retour', '← Indietro'],
  ['o con tu correo', 'or with your email', 'ou com seu e-mail', 'ou avec ton e-mail', 'oppure con la tua email'],
  ['Correo', 'Email', 'E-mail', 'E-mail', 'Email'],
  ['tu@correo.com', 'you@email.com', 'voce@email.com', 'toi@email.com', 'tu@email.com'],
  ['Contraseña', 'Password', 'Senha', 'Mot de passe', 'Password'],
  ['Mínimo 8 caracteres', 'At least 8 characters', 'Mínimo de 8 caracteres', '8 caractères minimum', 'Minimo 8 caratteri'],
  ['Tu nick quedará reservado: nadie más podrá usarlo.', 'Your nickname will be reserved: nobody else can use it.', 'Seu nick ficará reservado: ninguém mais poderá usá-lo.', 'Ton pseudo sera réservé : personne d’autre ne pourra l’utiliser.', 'Il tuo nick sarà riservato: nessun altro potrà usarlo.'],
  ['¿No tienes cuenta?', 'Don’t have an account?', 'Não tem conta?', 'Pas de compte ?', 'Non hai un account?'],
  ['¿Ya tienes cuenta?', 'Already have an account?', 'Já tem conta?', 'Déjà un compte ?', 'Hai già un account?'],
  ['Las conversaciones no se guardan: solo ves lo que se dice mientras estás conectado.', 'Conversations are not stored: you only see what is said while you are online.', 'As conversas não são guardadas: você só vê o que é dito enquanto está conectado.', 'Les conversations ne sont pas enregistrées : tu ne vois que ce qui est dit pendant que tu es connecté.', 'Le conversazioni non vengono salvate: vedi solo ciò che si dice mentre sei connesso.'],
  ['Sesión iniciada', 'Signed in', 'Sessão iniciada', 'Connecté', 'Accesso effettuato'],
  ['Elige el nick que quieres reservar. Será solo tuyo.', 'Choose the nickname you want to reserve. It will be yours only.', 'Escolha o nick que deseja reservar. Será só seu.', 'Choisis le pseudo que tu veux réserver. Il sera à toi seul.', 'Scegli il nick che vuoi riservare. Sarà solo tuo.'],
  ['Reservar nick y entrar', 'Reserve nickname and enter', 'Reservar nick e entrar', 'Réserver le pseudo et entrer', 'Riserva il nick ed entra'],
  ['Usar otra cuenta', 'Use another account', 'Usar outra conta', 'Utiliser un autre compte', 'Usa un altro account'],
  ['Cerrar sesión', 'Sign out', 'Sair da conta', 'Se déconnecter', 'Esci dall’account'],
  ['Sesión cerrada.', 'Signed out.', 'Sessão encerrada.', 'Déconnecté.', 'Disconnesso.'],
  ['Comprobando…', 'Checking…', 'Verificando…', 'Vérification…', 'Verifica…'],
  ['Idioma', 'Language', 'Idioma', 'Langue', 'Lingua'],
  ['Correo o contraseña incorrectos.', 'Wrong email or password.', 'E-mail ou senha incorretos.', 'E-mail ou mot de passe incorrect.', 'Email o password errati.'],
  ['Aún no confirmaste tu correo. Revisa tu bandeja de entrada.', 'You haven’t confirmed your email yet. Check your inbox.', 'Você ainda não confirmou seu e-mail. Verifique sua caixa de entrada.', 'Tu n’as pas encore confirmé ton e-mail. Vérifie ta boîte de réception.', 'Non hai ancora confermato la tua email. Controlla la posta in arrivo.'],
  ['Ese correo ya tiene una cuenta. Inicia sesión.', 'That email already has an account. Sign in.', 'Esse e-mail já tem uma conta. Entre.', 'Cet e-mail a déjà un compte. Connecte-toi.', 'Questa email ha già un account. Accedi.'],
  ['Ese nick no es válido.', 'That nickname is not valid.', 'Esse nick não é válido.', 'Ce pseudo n’est pas valide.', 'Questo nick non è valido.'],
  ['Ese nick no es válido: 2–20 caracteres, letras, números y _ - [ ] { } ^ |, sin empezar por número.', 'Invalid nickname: 2–20 characters, letters, numbers and _ - [ ] { } ^ |, not starting with a number.', 'Nick inválido: 2–20 caracteres, letras, números e _ - [ ] { } ^ |, sem começar por número.', 'Pseudo invalide : 2 à 20 caractères, lettres, chiffres et _ - [ ] { } ^ |, sans commencer par un chiffre.', 'Nick non valido: 2–20 caratteri, lettere, numeri e _ - [ ] { } ^ |, senza iniziare con un numero.'],
  ['Cuenta creada, pero ese nick ya se ocupó. Elige otro.', 'Account created, but that nickname was just taken. Choose another.', 'Conta criada, mas esse nick já foi ocupado. Escolha outro.', 'Compte créé, mais ce pseudo vient d’être pris. Choisis-en un autre.', 'Account creato, ma quel nick è già occupato. Scegline un altro.'],
  ['El acceso con Google todavía no está activado.', 'Sign-in with Google is not enabled yet.', 'O acesso com o Google ainda não está ativado.', 'La connexion avec Google n’est pas encore activée.', 'L’accesso con Google non è ancora attivo.'],
  ['¡Cuenta creada! Tu nick', 'Account created! Your nickname', 'Conta criada! Seu nick', 'Compte créé ! Ton pseudo', 'Account creato! Il tuo nick'],
  ['está reservado.', 'is reserved.', 'está reservado.', 'est réservé.', 'è riservato.'],
  ['Te enviamos un correo a', 'We sent an email to', 'Enviamos um e-mail para', 'Nous avons envoyé un e-mail à', 'Abbiamo inviato un’email a'],
  ['. Confírmalo y luego inicia sesión.', '. Confirm it and then sign in.', '. Confirme e depois entre.', '. Confirme-le puis connecte-toi.', '. Confermala e poi accedi.'],

  // Barra lateral y cabecera
  ['Explorar canales', 'Browse channels', 'Explorar canais', 'Explorer les salons', 'Esplora i canali'],
  ['Tus canales', 'Your channels', 'Seus canais', 'Tes salons', 'I tuoi canali'],
  ['Privados', 'Private chats', 'Privados', 'Messages privés', 'Chat private'],
  ['Aún no estás en ningún canal.', 'You are not in any channel yet.', 'Você ainda não está em nenhum canal.', 'Tu n’es encore dans aucun salon.', 'Non sei ancora in nessun canale.'],
  ['Registrado', 'Registered', 'Registrado', 'Inscrit', 'Registrato'],
  ['Invitado', 'Guest', 'Convidado', 'Invité', 'Ospite'],
  ['Opciones de usuario', 'User options', 'Opções de usuário', 'Options utilisateur', 'Opzioni utente'],
  ['Cambiar tema', 'Change theme', 'Mudar tema', 'Changer de thème', 'Cambia tema'],
  ['Salir del chat', 'Leave the chat', 'Sair do chat', 'Quitter le chat', 'Esci dalla chat'],
  ['Canales', 'Channels', 'Canais', 'Salons', 'Canali'],
  ['Usuarios', 'Users', 'Usuários', 'Utilisateurs', 'Utenti'],
  ['Opciones del canal', 'Channel options', 'Opções do canal', 'Options du salon', 'Opzioni del canale'],
  ['Llamada de voz', 'Voice call', 'Chamada de voz', 'Appel vocal', 'Chiamata vocale'],
  ['Videollamada', 'Video call', 'Videochamada', 'Appel vidéo', 'Videochiamata'],
  ['Elige un canal o crea el tuyo', 'Choose a channel or create your own', 'Escolha um canal ou crie o seu', 'Choisis un salon ou crée le tien', 'Scegli un canale o crea il tuo'],
  ['Sin tema', 'No topic', 'Sem tema', 'Pas de sujet', 'Nessun argomento'],
  ['(sin tema)', '(no topic)', '(sem tema)', '(pas de sujet)', '(nessun argomento)'],

  // Compositor
  ['Escribe un mensaje…', 'Type a message…', 'Escreva uma mensagem…', 'Écris un message…', 'Scrivi un messaggio…'],
  ['Elige un canal para hablar', 'Choose a channel to talk', 'Escolha um canal para conversar', 'Choisis un salon pour parler', 'Scegli un canale per parlare'],
  ['Escribir como acción (* tu_nick hace algo)', 'Write as an action (* your_nick does something)', 'Escrever como ação (* seu_nick faz algo)', 'Écrire comme une action (* ton_pseudo fait quelque chose)', 'Scrivi come azione (* tuo_nick fa qualcosa)'],
  ['Emojis y stickers', 'Emojis and stickers', 'Emojis e figurinhas', 'Émojis et stickers', 'Emoji e sticker'],
  ['Enviar foto, vídeo o documento', 'Send photo, video or document', 'Enviar foto, vídeo ou documento', 'Envoyer une photo, une vidéo ou un document', 'Invia foto, video o documento'],
  ['Grabar nota de voz', 'Record voice note', 'Gravar mensagem de voz', 'Enregistrer un message vocal', 'Registra nota vocale'],
  ['Enviar', 'Send', 'Enviar', 'Envoyer', 'Invia'],
  ['Descartar', 'Discard', 'Descartar', 'Supprimer', 'Scarta'],
  ['Enviar nota de voz', 'Send voice note', 'Enviar mensagem de voz', 'Envoyer le message vocal', 'Invia nota vocale'],
  ['Más despacio: espera un momento entre mensajes.', 'Slow down: wait a moment between messages.', 'Mais devagar: espere um pouco entre mensagens.', 'Doucement : attends un peu entre les messages.', 'Più piano: aspetta un attimo tra un messaggio e l’altro.'],
  ['No se pudo enviar el último mensaje (conexión inestable).', 'The last message could not be sent (unstable connection).', 'Não foi possível enviar a última mensagem (conexão instável).', 'Le dernier message n’a pas pu être envoyé (connexion instable).', 'Impossibile inviare l’ultimo messaggio (connessione instabile).'],
  ['Aún no hay mensajes. ¡Rompe el hielo!', 'No messages yet. Break the ice!', 'Ainda não há mensagens. Quebre o gelo!', 'Pas encore de messages. Brise la glace !', 'Ancora nessun messaggio. Rompi il ghiaccio!'],

  // Explorar canales
  ['Elige un canal para entrar.', 'Choose a channel to join.', 'Escolha um canal para entrar.', 'Choisis un salon pour entrer.', 'Scegli un canale in cui entrare.'],
  ['Buscar canales', 'Search channels', 'Buscar canais', 'Rechercher des salons', 'Cerca canali'],
  ['No hay canales que coincidan.', 'No matching channels.', 'Nenhum canal corresponde.', 'Aucun salon ne correspond.', 'Nessun canale corrispondente.'],
  ['Personas conectadas', 'People online', 'Pessoas conectadas', 'Personnes connectées', 'Persone connesse'],
  ['Crear mi canal', 'Create my channel', 'Criar meu canal', 'Créer mon salon', 'Crea il mio canale'],
  ['Para crear tu propio canal,', 'To create your own channel,', 'Para criar seu próprio canal,', 'Pour créer ton propre salon,', 'Per creare il tuo canale,'],
  ['inicia sesión o regístrate', 'sign in or register', 'entre ou cadastre-se', 'connecte-toi ou inscris-toi', 'accedi o registrati'],
  ['Tu canal es', 'Your channel is', 'Seu canal é', 'Ton salon est', 'Il tuo canale è'],
  ['. Cada usuario puede crear un canal.', '. Each user can create one channel.', '. Cada usuário pode criar um canal.', '. Chaque utilisateur peut créer un salon.', '. Ogni utente può creare un canale.'],
  ['Tu canal', 'Your channel', 'Seu canal', 'Ton salon', 'Il tuo canale'],
  ['Serás su creador y administrador. Cada usuario puede crear un canal.', 'You will be its creator and administrator. Each user can create one channel.', 'Você será o criador e administrador. Cada usuário pode criar um canal.', 'Tu en seras le créateur et l’administrateur. Chaque utilisateur peut créer un salon.', 'Ne sarai il creatore e amministratore. Ogni utente può creare un canale.'],
  ['Nombre', 'Name', 'Nome', 'Nom', 'Nome'],
  ['mi-canal', 'my-channel', 'meu-canal', 'mon-salon', 'mio-canale'],
  ['Tema (opcional)', 'Topic (optional)', 'Tema (opcional)', 'Sujet (facultatif)', 'Argomento (facoltativo)'],
  ['¿De qué se habla aquí?', 'What is this place about?', 'Sobre o que se fala aqui?', 'De quoi parle-t-on ici ?', 'Di cosa si parla qui?'],
  ['Crear canal', 'Create channel', 'Criar canal', 'Créer le salon', 'Crea canale'],
  ['El nombre solo puede tener letras, números, - o _ (máx. 30).', 'The name can only contain letters, numbers, - or _ (max. 30).', 'O nome só pode ter letras, números, - ou _ (máx. 30).', 'Le nom ne peut contenir que des lettres, chiffres, - ou _ (30 max.).', 'Il nome può contenere solo lettere, numeri, - o _ (max 30).'],
  ['Ya existe un canal con ese nombre.', 'A channel with that name already exists.', 'Já existe um canal com esse nome.', 'Un salon porte déjà ce nom.', 'Esiste già un canale con quel nome.'],
  ['Ya tienes un canal creado.', 'You already have a channel.', 'Você já tem um canal criado.', 'Tu as déjà un salon.', 'Hai già un canale.'],

  // Canal y administración
  ['Has entrado en', 'You joined', 'Você entrou em', 'Tu as rejoint', 'Sei entrato in'],
  ['Eres el creador de este canal. Toca a un usuario de la lista para nombrarlo administrador.', 'You created this channel. Tap a user in the list to make them an administrator.', 'Você criou este canal. Toque em um usuário da lista para torná-lo administrador.', 'Tu as créé ce salon. Touche un utilisateur de la liste pour le nommer administrateur.', 'Hai creato questo canale. Tocca un utente nella lista per nominarlo amministratore.'],
  ['ha entrado', 'joined', 'entrou', 'est arrivé', 'è entrato'],
  ['ha salido', 'left', 'saiu', 'est parti', 'è uscito'],
  ['Problema de conexión; reintentando…', 'Connection problem; retrying…', 'Problema de conexão; tentando novamente…', 'Problème de connexion ; nouvelle tentative…', 'Problema di connessione; nuovo tentativo…'],
  ['cambió el tema:', 'changed the topic:', 'mudou o tema:', 'a changé le sujet :', 'ha cambiato l’argomento:'],
  ['nombró administrador a', 'made an administrator:', 'nomeou administrador:', 'a nommé administrateur :', 'ha nominato amministratore:'],
  ['nombró administrador temporal a', 'made a temporary administrator:', 'nomeou administrador temporário:', 'a nommé administrateur temporaire :', 'ha nominato amministratore temporaneo:'],
  ['dejó de ser administrador', 'is no longer an administrator', 'deixou de ser administrador', 'n’est plus administrateur', 'non è più amministratore'],
  ['quitó el cargo de administrador a', 'removed administrator role from', 'removeu o cargo de administrador de', 'a retiré le rôle d’administrateur à', 'ha tolto il ruolo di amministratore a'],
  ['expulsó a', 'kicked', 'expulsou', 'a expulsé', 'ha espulso'],
  ['del canal', 'from the channel', 'do canal', 'du salon', 'dal canale'],
  ['te expulsó de', 'kicked you from', 'expulsou você de', 't’a expulsé de', 'ti ha espulso da'],
  ['Eliminaste el canal', 'You deleted the channel', 'Você excluiu o canal', 'Tu as supprimé le salon', 'Hai eliminato il canale'],
  ['eliminó el canal', 'deleted the channel', 'excluiu o canal', 'a supprimé le salon', 'ha eliminato il canale'],
  ['Ahora eres', 'You are now', 'Agora você é', 'Tu es maintenant', 'Ora sei'],
  ['Conectado como', 'Connected as', 'Conectado como', 'Connecté en tant que', 'Connesso come'],
  ['(registrado). Las conversaciones no se guardan. Haz doble clic en un nick para hablar en privado.', '(registered). Conversations are not stored. Double-click a nickname to talk privately.', '(registrado). As conversas não são guardadas. Clique duas vezes em um nick para falar em privado.', '(inscrit). Les conversations ne sont pas enregistrées. Double-clique sur un pseudo pour parler en privé.', '(registrato). Le conversazioni non vengono salvate. Fai doppio clic su un nick per parlare in privato.'],
  ['(invitado). Las conversaciones no se guardan. Haz doble clic en un nick para hablar en privado.', '(guest). Conversations are not stored. Double-click a nickname to talk privately.', '(convidado). As conversas não são guardadas. Clique duas vezes em um nick para falar em privado.', '(invité). Les conversations ne sont pas enregistrées. Double-clique sur un pseudo pour parler en privé.', '(ospite). Le conversazioni non vengono salvate. Fai doppio clic su un nick per parlare in privato.'],
  ['Administradores', 'Administrators', 'Administradores', 'Administrateurs', 'Amministratori'],
  ['tú', 'you', 'você', 'toi', 'tu'],
  ['Mensaje privado', 'Private message', 'Mensagem privada', 'Message privé', 'Messaggio privato'],
  ['También con doble clic en el nick', 'Also by double-clicking the nickname', 'Também com clique duplo no nick', 'Aussi en double-cliquant sur le pseudo', 'Anche con doppio clic sul nick'],
  ['Mencionar', 'Mention', 'Mencionar', 'Mentionner', 'Menziona'],
  ['Hacer administrador', 'Make administrator', 'Tornar administrador', 'Nommer administrateur', 'Nomina amministratore'],
  ['Permanente: lo conserva en su cuenta', 'Permanent: kept on their account', 'Permanente: fica na conta', 'Permanent : conservé sur son compte', 'Permanente: resta nel suo account'],
  ['Temporal: solo un admin registrado puede darlo permanente', 'Temporary: only a registered admin can make it permanent', 'Temporário: só um admin registrado pode torná-lo permanente', 'Temporaire : seul un admin inscrit peut le rendre permanent', 'Temporaneo: solo un admin registrato può renderlo permanente'],
  ['Temporal: hasta que salga del canal', 'Temporary: until they leave the channel', 'Temporário: até sair do canal', 'Temporaire : jusqu’à ce qu’il quitte le salon', 'Temporaneo: finché non esce dal canale'],
  ['Quitar administrador', 'Remove administrator', 'Remover administrador', 'Retirer l’administrateur', 'Rimuovi amministratore'],
  ['Expulsar del canal', 'Kick from channel', 'Expulsar do canal', 'Expulser du salon', 'Espelli dal canale'],
  ['Dejar de ser administrador', 'Stop being administrator', 'Deixar de ser administrador', 'Ne plus être administrateur', 'Smetti di essere amministratore'],
  ['Cambiar mi nick', 'Change my nickname', 'Mudar meu nick', 'Changer mon pseudo', 'Cambia il mio nick'],
  ['Creador del canal', 'Channel creator', 'Criador do canal', 'Créateur du salon', 'Creatore del canale'],
  ['Creador', 'Creator', 'Criador', 'Créateur', 'Creatore'],
  ['Administrador', 'Administrator', 'Administrador', 'Administrateur', 'Amministratore'],
  ['Administrador temporal', 'Temporary administrator', 'Administrador temporário', 'Administrateur temporaire', 'Amministratore temporaneo'],
  ['Usuario registrado', 'Registered user', 'Usuário registrado', 'Utilisateur inscrit', 'Utente registrato'],
  ['Sin acciones disponibles', 'No actions available', 'Nenhuma ação disponível', 'Aucune action disponible', 'Nessuna azione disponibile'],
  ['Editar tema', 'Edit topic', 'Editar tema', 'Modifier le sujet', 'Modifica argomento'],
  ['Ver administradores', 'View administrators', 'Ver administradores', 'Voir les administrateurs', 'Vedi amministratori'],
  ['Copiar enlace del canal', 'Copy channel link', 'Copiar link do canal', 'Copier le lien du salon', 'Copia link del canale'],
  ['Enlace copiado', 'Link copied', 'Link copiado', 'Lien copié', 'Link copiato'],
  ['Limpiar pantalla', 'Clear screen', 'Limpar tela', 'Effacer l’écran', 'Pulisci schermo'],
  ['Exportar a PDF', 'Export to PDF', 'Exportar para PDF', 'Exporter en PDF', 'Esporta in PDF'],
  ['Salir del canal', 'Leave channel', 'Sair do canal', 'Quitter le salon', 'Esci dal canale'],
  ['Eliminar canal', 'Delete channel', 'Excluir canal', 'Supprimer le salon', 'Elimina canale'],
  ['Eres administrador', 'You are an administrator', 'Você é administrador', 'Tu es administrateur', 'Sei amministratore'],
  ['Canal de usuario', 'User channel', 'Canal de usuário', 'Salon d’utilisateur', 'Canale utente'],
  ['Canal del sistema', 'System channel', 'Canal do sistema', 'Salon système', 'Canale di sistema'],
  ['Canal del sistema (sin creador)', 'System channel (no creator)', 'Canal do sistema (sem criador)', 'Salon système (sans créateur)', 'Canale di sistema (senza creatore)'],
  ['Tema', 'Topic', 'Tema', 'Sujet', 'Argomento'],
  ['Guardar', 'Save', 'Salvar', 'Enregistrer', 'Salva'],
  ['No tienes permiso para cambiar el tema.', 'You are not allowed to change the topic.', 'Você não tem permissão para mudar o tema.', 'Tu n’as pas le droit de changer le sujet.', 'Non hai il permesso di cambiare l’argomento.'],
  ['Solo el creador del canal puede quitar administradores permanentes.', 'Only the channel creator can remove permanent administrators.', 'Só o criador do canal pode remover administradores permanentes.', 'Seul le créateur du salon peut retirer des administrateurs permanents.', 'Solo il creatore del canale può rimuovere amministratori permanenti.'],
  ['Se cerrará para todas las personas conectadas y se borrarán sus administradores. Después podrás crear otro canal.', 'It will close for everyone online and its administrators will be removed. You can then create another channel.', 'Será fechado para todos conectados e seus administradores serão removidos. Depois você poderá criar outro canal.', 'Il sera fermé pour toutes les personnes connectées et ses administrateurs seront supprimés. Tu pourras ensuite créer un autre salon.', 'Verrà chiuso per tutti i connessi e i suoi amministratori saranno rimossi. Potrai poi creare un altro canale.'],
  ['No se pudo eliminar el canal.', 'The channel could not be deleted.', 'Não foi possível excluir o canal.', 'Impossible de supprimer le salon.', 'Impossibile eliminare il canale.'],
  ['Cerrar', 'Close', 'Fechar', 'Fermer', 'Chiudi'],
  ['Cancelar', 'Cancel', 'Cancelar', 'Annuler', 'Annulla'],
  ['Aceptar', 'OK', 'OK', 'OK', 'OK'],
  ['Cambiar', 'Change', 'Mudar', 'Changer', 'Cambia'],
  ['Nuevo nick', 'New nickname', 'Novo nick', 'Nouveau pseudo', 'Nuovo nick'],
  ['El nuevo nick quedará reservado en tu cuenta.', 'The new nickname will be reserved on your account.', 'O novo nick ficará reservado na sua conta.', 'Le nouveau pseudo sera réservé sur ton compte.', 'Il nuovo nick sarà riservato nel tuo account.'],
  ['Como invitado, el nick dura mientras estés conectado.', 'As a guest, the nickname lasts while you are online.', 'Como convidado, o nick dura enquanto você estiver conectado.', 'En tant qu’invité, le pseudo dure tant que tu es connecté.', 'Come ospite, il nick dura finché sei connesso.'],
  ['Tema claro', 'Light theme', 'Tema claro', 'Thème clair', 'Tema chiaro'],
  ['Tema oscuro', 'Dark theme', 'Tema escuro', 'Thème sombre', 'Tema scuro'],
  ['en línea', 'online', 'online', 'en ligne', 'online'],

  // Privados
  ['quiere hablar contigo en privado', 'wants to talk to you privately', 'quer falar com você em privado', 'veut te parler en privé', 'vuole parlarti in privato'],
  ['Rechazar', 'Decline', 'Recusar', 'Refuser', 'Rifiuta'],
  ['Esperando a que', 'Waiting for', 'Esperando que', 'En attente que', 'In attesa che'],
  ['acepte la conversación privada…', 'to accept the private chat…', 'aceite a conversa privada…', 'accepte la conversation privée…', 'accetti la chat privata…'],
  ['aceptó. Estableciendo conexión directa…', 'accepted. Setting up a direct connection…', 'aceitou. Estabelecendo conexão direta…', 'a accepté. Établissement de la connexion directe…', 'ha accettato. Connessione diretta in corso…'],
  ['Estableciendo conexión directa…', 'Setting up a direct connection…', 'Estabelecendo conexão direta…', 'Établissement de la connexion directe…', 'Connessione diretta in corso…'],
  ['rechazó la conversación privada.', 'declined the private chat.', 'recusou a conversa privada.', 'a refusé la conversation privée.', 'ha rifiutato la chat privata.'],
  ['no respondió.', 'did not answer.', 'não respondeu.', 'n’a pas répondu.', 'non ha risposto.'],
  ['No se pudo enviar la solicitud.', 'The request could not be sent.', 'Não foi possível enviar a solicitação.', 'Impossible d’envoyer la demande.', 'Impossibile inviare la richiesta.'],
  ['Conexión directa con', 'Direct connection with', 'Conexão direta com', 'Connexion directe avec', 'Connessione diretta con'],
  ['. Los mensajes, archivos y llamadas van cifrados de extremo a extremo y no se guardan en ningún sitio.', '. Messages, files and calls are end-to-end encrypted and stored nowhere.', '. Mensagens, arquivos e chamadas são criptografados de ponta a ponta e não ficam guardados em lugar nenhum.', '. Les messages, fichiers et appels sont chiffrés de bout en bout et ne sont stockés nulle part.', '. Messaggi, file e chiamate sono cifrati end-to-end e non vengono salvati da nessuna parte.'],
  ['cerró la conversación.', 'closed the chat.', 'fechou a conversa.', 'a fermé la conversation.', 'ha chiuso la chat.'],
  ['se desconectó.', 'disconnected.', 'desconectou.', 's’est déconnecté.', 'si è disconnesso.'],
  ['No se pudo establecer la conexión directa. Puede que vuestra red la bloquee.', 'The direct connection could not be established. Your network may be blocking it.', 'Não foi possível estabelecer a conexão direta. Sua rede pode estar bloqueando.', 'Impossible d’établir la connexion directe. Votre réseau la bloque peut-être.', 'Impossibile stabilire la connessione diretta. La vostra rete potrebbe bloccarla.'],
  ['No se pudo establecer la conexión directa. Cierra esta conversación y vuelve a intentarlo con doble clic en el nick.', 'The direct connection could not be established. Close this chat and try again by double-clicking the nickname.', 'Não foi possível estabelecer a conexão direta. Feche esta conversa e tente de novo com clique duplo no nick.', 'Impossible d’établir la connexion directe. Ferme cette conversation et réessaie en double-cliquant sur le pseudo.', 'Impossibile stabilire la connessione diretta. Chiudi questa chat e riprova con un doppio clic sul nick.'],
  ['Esperando respuesta…', 'Waiting for a reply…', 'Aguardando resposta…', 'En attente de réponse…', 'In attesa di risposta…'],
  ['Conectando…', 'Connecting…', 'Conectando…', 'Connexion…', 'Connessione…'],
  ['en línea · cifrado de extremo a extremo', 'online · end-to-end encrypted', 'online · criptografia de ponta a ponta', 'en ligne · chiffré de bout en bout', 'online · cifrato end-to-end'],
  ['Conversación cerrada', 'Chat closed', 'Conversa encerrada', 'Conversation fermée', 'Chat chiusa'],
  ['No disponible', 'Unavailable', 'Indisponível', 'Indisponible', 'Non disponibile'],
  ['Enviar archivo', 'Send file', 'Enviar arquivo', 'Envoyer un fichier', 'Invia file'],
  ['Cerrar conversación', 'Close chat', 'Fechar conversa', 'Fermer la conversation', 'Chiudi chat'],
  ['Descargar', 'Download', 'Baixar', 'Télécharger', 'Scarica'],
  ['Reproducir', 'Play', 'Reproduzir', 'Lire', 'Riproduci'],
  ['Velocidad', 'Speed', 'Velocidade', 'Vitesse', 'Velocità'],
  ['Enviado', 'Sent', 'Enviado', 'Envoyé', 'Inviato'],
  ['Entregado', 'Delivered', 'Entregue', 'Distribué', 'Consegnato'],
  ['Leído', 'Read', 'Lido', 'Lu', 'Letto'],
  ['Stickers', 'Stickers', 'Figurinhas', 'Stickers', 'Sticker'],
  ['😀 Emojis', '😀 Emojis', '😀 Emojis', '😀 Émojis', '😀 Emoji'],
  ['Recientes', 'Recent', 'Recentes', 'Récents', 'Recenti'],
  ['Caras', 'Faces', 'Rostos', 'Visages', 'Facce'],
  ['Gestos', 'Gestures', 'Gestos', 'Gestes', 'Gesti'],
  ['Corazones', 'Hearts', 'Corações', 'Cœurs', 'Cuori'],
  ['Animales', 'Animals', 'Animais', 'Animaux', 'Animali'],
  ['Comida', 'Food', 'Comida', 'Nourriture', 'Cibo'],
  ['Actividades', 'Activities', 'Atividades', 'Activités', 'Attività'],
  ['Viajes', 'Travel', 'Viagens', 'Voyages', 'Viaggi'],
  ['Objetos', 'Objects', 'Objetos', 'Objets', 'Oggetti'],
  ['Símbolos', 'Symbols', 'Símbolos', 'Symboles', 'Simboli'],
  ['Banderas', 'Flags', 'Bandeiras', 'Drapeaux', 'Bandiere'],
  ['La nota de voz es demasiado corta.', 'The voice note is too short.', 'A mensagem de voz é curta demais.', 'Le message vocal est trop court.', 'La nota vocale è troppo corta.'],
  ['Tu navegador no permite grabar audio.', 'Your browser cannot record audio.', 'Seu navegador não permite gravar áudio.', 'Ton navigateur ne permet pas d’enregistrer l’audio.', 'Il tuo browser non può registrare audio.'],
  ['Permite el acceso al micrófono para grabar notas de voz.', 'Allow microphone access to record voice notes.', 'Permita o acesso ao microfone para gravar mensagens de voz.', 'Autorise l’accès au micro pour enregistrer des messages vocaux.', 'Consenti l’accesso al microfono per registrare note vocali.'],
  ['Permite el acceso al micrófono para contestar.', 'Allow microphone access to answer.', 'Permita o acesso ao microfone para atender.', 'Autorise l’accès au micro pour répondre.', 'Consenti l’accesso al microfono per rispondere.'],
  ['Permite el acceso al micrófono para llamar.', 'Allow microphone access to call.', 'Permita o acesso ao microfone para ligar.', 'Autorise l’accès au micro pour appeler.', 'Consenti l’accesso al microfono per chiamare.'],
  ['Permite el acceso al micrófono y a la cámara para llamar.', 'Allow microphone and camera access to call.', 'Permita o acesso ao microfone e à câmera para ligar.', 'Autorise l’accès au micro et à la caméra pour appeler.', 'Consenti l’accesso a microfono e fotocamera per chiamare.'],
  ['No se pudo usar la cámara; la llamada será solo de voz.', 'The camera could not be used; the call will be voice only.', 'Não foi possível usar a câmera; a chamada será só de voz.', 'Impossible d’utiliser la caméra ; l’appel sera uniquement vocal.', 'Impossibile usare la fotocamera; la chiamata sarà solo vocale.'],
  ['No se pudo activar la cámara.', 'The camera could not be turned on.', 'Não foi possível ativar a câmera.', 'Impossible d’activer la caméra.', 'Impossibile attivare la fotocamera.'],
  ['Ya estás en una llamada.', 'You are already on a call.', 'Você já está em uma chamada.', 'Tu es déjà en appel.', 'Sei già in una chiamata.'],
  ['Llamando…', 'Calling…', 'Chamando…', 'Appel en cours…', 'Chiamata in corso…'],
  ['Llamada entrante', 'Incoming call', 'Chamada recebida', 'Appel entrant', 'Chiamata in arrivo'],
  ['Videollamada entrante', 'Incoming video call', 'Videochamada recebida', 'Appel vidéo entrant', 'Videochiamata in arrivo'],
  ['Llamada saliente…', 'Outgoing call…', 'Chamada efetuada…', 'Appel sortant…', 'Chiamata in uscita…'],
  ['Videollamada saliente…', 'Outgoing video call…', 'Videochamada efetuada…', 'Appel vidéo sortant…', 'Videochiamata in uscita…'],
  ['Llamada en curso.', 'Call in progress.', 'Chamada em andamento.', 'Appel en cours.', 'Chiamata in corso.'],
  ['Videollamada en curso.', 'Video call in progress.', 'Videochamada em andamento.', 'Appel vidéo en cours.', 'Videochiamata in corso.'],
  ['Llamada cancelada.', 'Call cancelled.', 'Chamada cancelada.', 'Appel annulé.', 'Chiamata annullata.'],
  ['📞 Llamada cancelada.', '📞 Call cancelled.', '📞 Chamada cancelada.', '📞 Appel annulé.', '📞 Chiamata annullata.'],
  ['Rechazaste la llamada.', 'You declined the call.', 'Você recusou a chamada.', 'Tu as refusé l’appel.', 'Hai rifiutato la chiamata.'],
  ['rechazó la llamada.', 'declined the call.', 'recusou a chamada.', 'a refusé l’appel.', 'ha rifiutato la chiamata.'],
  ['Contestar', 'Answer', 'Atender', 'Répondre', 'Rispondi'],
  ['Colgar', 'Hang up', 'Desligar', 'Raccrocher', 'Riaggancia'],
  ['Micrófono', 'Microphone', 'Microfone', 'Micro', 'Microfono'],
  ['Cámara', 'Camera', 'Câmera', 'Caméra', 'Fotocamera'],
  ['Conexión directa cifrada de extremo a extremo', 'Direct end-to-end encrypted connection', 'Conexão direta com criptografia de ponta a ponta', 'Connexion directe chiffrée de bout en bout', 'Connessione diretta cifrata end-to-end'],
  ['ahora se llama', 'is now called', 'agora se chama', 's’appelle maintenant', 'ora si chiama'],

  // Canales privados y videollamadas grupales
  ['Canal privado', 'Private channel', 'Canal privado', 'Salon privé', 'Canale privato'],
  ['Canal privado: solo entra quien conoce la contraseña.', 'Private channel: only people who know the password can join.', 'Canal privado: só entra quem conhece a senha.', 'Salon privé : seuls ceux qui connaissent le mot de passe peuvent entrer.', 'Canale privato: entra solo chi conosce la password.'],
  ['Este canal es privado. Escribe la contraseña para entrar.', 'This channel is private. Enter the password to join.', 'Este canal é privado. Digite a senha para entrar.', 'Ce salon est privé. Saisis le mot de passe pour entrer.', 'Questo canale è privato. Inserisci la password per entrare.'],
  ['Escribe la contraseña.', 'Enter the password.', 'Digite a senha.', 'Saisis le mot de passe.', 'Inserisci la password.'],
  ['Contraseña incorrecta.', 'Wrong password.', 'Senha incorreta.', 'Mot de passe incorrect.', 'Password errata.'],
  ['Entrar', 'Join', 'Entrar', 'Entrer', 'Entra'],
  ['Contraseña (opcional)', 'Password (optional)', 'Senha (opcional)', 'Mot de passe (facultatif)', 'Password (facoltativa)'],
  ['Déjala vacía para un canal abierto', 'Leave it empty for an open channel', 'Deixe vazio para um canal aberto', 'Laisse vide pour un salon ouvert', 'Lasciala vuota per un canale aperto'],
  ['Con contraseña, el canal es privado: solo entra quien la conozca.', 'With a password the channel is private: only people who know it can join.', 'Com senha, o canal é privado: só entra quem a conhece.', 'Avec un mot de passe, le salon est privé : seuls ceux qui le connaissent entrent.', 'Con una password il canale è privato: entra solo chi la conosce.'],
  ['La contraseña debe tener entre 4 y 72 caracteres.', 'The password must be 4 to 72 characters long.', 'A senha deve ter entre 4 e 72 caracteres.', 'Le mot de passe doit contenir entre 4 et 72 caractères.', 'La password deve avere tra 4 e 72 caratteri.'],
  ['La contraseña debe tener entre 4 y 72 caracteres', 'The password must be 4 to 72 characters long', 'A senha deve ter entre 4 e 72 caracteres', 'Le mot de passe doit contenir entre 4 et 72 caractères', 'La password deve avere tra 4 e 72 caratteri'],
  ['No se pudo poner la contraseña:', 'The password could not be set:', 'Não foi possível definir a senha:', 'Impossible de définir le mot de passe :', 'Impossibile impostare la password:'],
  ['Cambiar contraseña', 'Change password', 'Mudar senha', 'Changer le mot de passe', 'Cambia password'],
  ['Hacer privado (con contraseña)', 'Make private (with password)', 'Tornar privado (com senha)', 'Rendre privé (avec mot de passe)', 'Rendi privato (con password)'],
  ['Quitar contraseña (hacer abierto)', 'Remove password (make open)', 'Remover senha (tornar aberto)', 'Retirer le mot de passe (rendre ouvert)', 'Rimuovi password (rendi aperto)'],
  ['Las personas conectadas (salvo los administradores registrados) tendrán que volver a entrar con la nueva contraseña.', 'People online (except registered administrators) will have to join again with the new password.', 'As pessoas conectadas (exceto administradores registrados) terão de entrar novamente com a nova senha.', 'Les personnes connectées (sauf les administrateurs inscrits) devront entrer à nouveau avec le nouveau mot de passe.', 'Le persone connesse (tranne gli amministratori registrati) dovranno rientrare con la nuova password.'],
  ['Nueva contraseña', 'New password', 'Nova senha', 'Nouveau mot de passe', 'Nuova password'],
  ['Entre 4 y 72 caracteres', '4 to 72 characters', 'Entre 4 e 72 caracteres', 'Entre 4 et 72 caractères', 'Tra 4 e 72 caratteri'],
  ['Contraseña guardada.', 'Password saved.', 'Senha salva.', 'Mot de passe enregistré.', 'Password salvata.'],
  ['El canal ahora es abierto.', 'The channel is now open.', 'O canal agora é aberto.', 'Le salon est maintenant ouvert.', 'Il canale ora è aperto.'],
  ['cambió el acceso a', 'changed access to', 'mudou o acesso a', 'a changé l’accès à', 'ha cambiato l’accesso a'],
  ['Vuelve a entrar para seguir.', 'Join again to continue.', 'Entre novamente para continuar.', 'Rentre pour continuer.', 'Rientra per continuare.'],
  ['cambió el acceso. Vuelve a entrar.', 'access changed. Join again.', 'o acesso mudou. Entre novamente.', 'l’accès a changé. Rentre.', 'l’accesso è cambiato. Rientra.'],
  ['Solo el creador del canal puede cambiar la contraseña', 'Only the channel creator can change the password', 'Só o criador do canal pode mudar a senha', 'Seul le créateur du salon peut changer le mot de passe', 'Solo il creatore del canale può cambiare la password'],
  ['Videollamada en curso', 'Video call in progress', 'Videochamada em andamento', 'Appel vidéo en cours', 'Videochiamata in corso'],
  ['Unirse', 'Join', 'Entrar', 'Rejoindre', 'Partecipa'],
  ['Videollamada grupal', 'Group video call', 'Videochamada em grupo', 'Appel vidéo de groupe', 'Videochiamata di gruppo'],
  ['Iniciar videollamada grupal', 'Start group video call', 'Iniciar videochamada em grupo', 'Lancer un appel vidéo de groupe', 'Avvia videochiamata di gruppo'],
  ['Unirse a la videollamada', 'Join the video call', 'Entrar na videochamada', 'Rejoindre l’appel vidéo', 'Partecipa alla videochiamata'],
  ['En la videollamada', 'In the video call', 'Na videochamada', 'Dans l’appel vidéo', 'Nella videochiamata'],
  ['La videollamada está llena (máximo 8 personas).', 'The video call is full (maximum 8 people).', 'A videochamada está cheia (máximo de 8 pessoas).', 'L’appel vidéo est complet (8 personnes maximum).', 'La videochiamata è piena (massimo 8 persone).'],
  ['Volver al chat', 'Back to chat', 'Voltar ao chat', 'Retour au chat', 'Torna alla chat'],
  ['Salir de la llamada', 'Leave the call', 'Sair da chamada', 'Quitter l’appel', 'Esci dalla chiamata'],
  // Traducción y PDF
  ['Traduciendo…', 'Translating…', 'Traduzindo…', 'Traduction…', 'Traduzione…'],
  ['Ver original', 'Show original', 'Ver original', 'Voir l’original', 'Mostra originale'],
  ['Ver traducción', 'Show translation', 'Ver tradução', 'Voir la traduction', 'Mostra traduzione'],
  ['Participantes', 'Participants', 'Participantes', 'Participants', 'Partecipanti'],
  ['Exportado el', 'Exported on', 'Exportado em', 'Exporté le', 'Esportato il'],
  ['Conversación privada con', 'Private chat with', 'Conversa privada com', 'Conversation privée avec', 'Chat privata con'],
  ['Las conversaciones no se guardan en ningún servidor: este documento es la única copia.', 'Conversations are not stored on any server: this document is the only copy.', 'As conversas não são guardadas em nenhum servidor: este documento é a única cópia.', 'Les conversations ne sont stockées sur aucun serveur : ce document est la seule copie.', 'Le conversazioni non vengono salvate su alcun server: questo documento è l’unica copia.'],
  ['Preparando el PDF… elige "Guardar como PDF" en la ventana de impresión.', 'Preparing the PDF… choose "Save as PDF" in the print window.', 'Preparando o PDF… escolha "Salvar como PDF" na janela de impressão.', 'Préparation du PDF… choisis « Enregistrer au format PDF » dans la fenêtre d’impression.', 'Preparazione del PDF… scegli "Salva come PDF" nella finestra di stampa.'],
  ['No hay nada que exportar.', 'There is nothing to export.', 'Não há nada para exportar.', 'Il n’y a rien à exporter.', 'Non c’è niente da esportare.'],
  ['Los mensajes de otros idiomas se traducirán al', 'Messages in other languages will be translated into', 'As mensagens de outros idiomas serão traduzidas para o', 'Les messages dans d’autres langues seront traduits en', 'I messaggi in altre lingue saranno tradotti in'],
];

// Textos con partes variables: [expresión regular sobre el español, inglés, portugués, francés, italiano]
const PATTERNS = [
  [/^El nick (.+) está en uso ahora mismo\. Prueba otro\.$/, 'The nickname $1 is in use right now. Try another.', 'O nick $1 está em uso agora. Tente outro.', 'Le pseudo $1 est utilisé en ce moment. Essaie-en un autre.', 'Il nick $1 è in uso in questo momento. Provane un altro.'],
  [/^El nick (.+) pertenece a un usuario registrado\. Si es tuyo, inicia sesión\.$/, 'The nickname $1 belongs to a registered user. If it is yours, sign in.', 'O nick $1 pertence a um usuário registrado. Se for seu, entre.', 'Le pseudo $1 appartient à un utilisateur inscrit. Si c’est le tien, connecte-toi.', 'Il nick $1 appartiene a un utente registrato. Se è tuo, accedi.'],
  [/^El nick (.+) acaba de ser reservado por otra persona\.$/, 'The nickname $1 was just reserved by someone else.', 'O nick $1 acabou de ser reservado por outra pessoa.', 'Le pseudo $1 vient d’être réservé par quelqu’un d’autre.', 'Il nick $1 è appena stato riservato da un’altra persona.'],
  [/^El nick (.+) ya está reservado\.$/, 'The nickname $1 is already reserved.', 'O nick $1 já está reservado.', 'Le pseudo $1 est déjà réservé.', 'Il nick $1 è già riservato.'],
  [/^No se pudo comprobar el nick: (.+)$/, 'The nickname could not be checked: $1', 'Não foi possível verificar o nick: $1', 'Impossible de vérifier le pseudo : $1', 'Impossibile verificare il nick: $1'],
  [/^No se pudo cargar la lista de canales: (.+)$/, 'The channel list could not be loaded: $1', 'Não foi possível carregar a lista de canais: $1', 'Impossible de charger la liste des salons : $1', 'Impossibile caricare l’elenco dei canali: $1'],
  [/^No se pudo crear el canal: (.+)$/, 'The channel could not be created: $1', 'Não foi possível criar o canal: $1', 'Impossible de créer le salon : $1', 'Impossibile creare il canale: $1'],
  [/^No se pudo nombrar administrador: (.+)$/, 'Could not make administrator: $1', 'Não foi possível nomear administrador: $1', 'Impossible de nommer administrateur : $1', 'Impossibile nominare amministratore: $1'],
  [/^Error al enviar el archivo: (.+)$/, 'Error sending the file: $1', 'Erro ao enviar o arquivo: $1', 'Erreur lors de l’envoi du fichier : $1', 'Errore nell’invio del file: $1'],
  [/^Mensaje en (.+)$/, 'Message $1', 'Mensagem em $1', 'Message dans $1', 'Messaggio in $1'],
  [/^Mensaje privado para (.+)$/, 'Private message to $1', 'Mensagem privada para $1', 'Message privé pour $1', 'Messaggio privato per $1'],
  [/^Describe una acción: \* (.+) …$/, 'Describe an action: * $1 …', 'Descreva uma ação: * $1 …', 'Décris une action : * $1 …', 'Descrivi un’azione: * $1 …'],
  [/^Ahora eres administrador de (.+)$/, 'You are now an administrator of $1', 'Agora você é administrador de $1', 'Tu es maintenant administrateur de $1', 'Ora sei amministratore di $1'],
  [/^Ahora eres administrador temporal de (.+)$/, 'You are now a temporary administrator of $1', 'Agora você é administrador temporário de $1', 'Tu es maintenant administrateur temporaire de $1', 'Ora sei amministratore temporaneo di $1'],
  [/^Te expulsaron de (.+)$/, 'You were kicked from $1', 'Você foi expulso de $1', 'Tu as été expulsé de $1', 'Sei stato espulso da $1'],
  [/^El canal (.+) no existe\.$/, 'The channel $1 does not exist.', 'O canal $1 não existe.', 'Le salon $1 n’existe pas.', 'Il canale $1 non esiste.'],
  [/^"(.+)" supera el límite de 100 MB\.$/, '"$1" exceeds the 100 MB limit.', '"$1" excede o limite de 100 MB.', '« $1 » dépasse la limite de 100 Mo.', '"$1" supera il limite di 100 MB.'],
  [/^En línea — (\d+)$/, 'Online — $1', 'Online — $1', 'En ligne — $1', 'Online — $1'],
  [/^Administradores — (\d+)$/, 'Administrators — $1', 'Administradores — $1', 'Administrateurs — $1', 'Amministratori — $1'],
  [/^Tema de (.+)$/, 'Topic of $1', 'Tema de $1', 'Sujet de $1', 'Argomento di $1'],
  [/^Eliminar (#.+)$/, 'Delete $1', 'Excluir $1', 'Supprimer $1', 'Elimina $1'],
  [/^Administradores de (.+)$/, 'Administrators of $1', 'Administradores de $1', 'Administrateurs de $1', 'Amministratori di $1'],
  [/^Opciones para (.+)$/, 'Options for $1', 'Opções para $1', 'Options pour $1', 'Opzioni per $1'],
  [/^Hola, (.+)$/, 'Hi, $1', 'Olá, $1', 'Salut, $1', 'Ciao, $1'],
  [/^(Creador|Administrador|Administrador temporal) · en línea$/, null, null, null, null], // se resuelve por partes
  [/^📞 Llamada finalizada \((.+)\)\.$/, '📞 Call ended ($1).', '📞 Chamada encerrada ($1).', '📞 Appel terminé ($1).', '📞 Chiamata terminata ($1).'],
  [/^Llamada finalizada \((.+)\)\.$/, 'Call ended ($1).', 'Chamada encerrada ($1).', 'Appel terminé ($1).', 'Chiamata terminata ($1).'],
  [/^Traducido del (.+) · Ver original$/, null, null, null, null], // lo genera t() directamente
];

let lang = 'es';
const maps = {};
for (const [i, code] of ORDER.entries()) {
  maps[code] = new Map(ENTRIES.map((e) => [e[0], e[i + 1]]));
}

export function getLang() { return lang; }
export function setLang(l) {
  lang = LANGS[l] ? l : 'es';
  document.documentElement.lang = lang;
  try { localStorage.setItem('lang', lang); } catch { /* sin almacenamiento */ }
}
export function initialLang() {
  let saved = '';
  try { saved = localStorage.getItem('lang') || ''; } catch { /* nada */ }
  if (LANGS[saved]) return saved;
  const nav = (navigator.languages || [navigator.language || 'es']).map((x) => x.slice(0, 2).toLowerCase());
  return nav.find((x) => LANGS[x]) || 'es';
}

/** Traduce un texto exacto (en español) al idioma actual. Devuelve null si no hay traducción. */
function lookup(es) {
  if (lang === 'es') return null;
  const hit = maps[lang].get(es);
  if (hit) return hit;
  const idx = ORDER.indexOf(lang) + 1;
  for (const p of PATTERNS) {
    const m = es.match(p[0]);
    if (!m) continue;
    if (p[idx]) return es.replace(p[0], p[idx]);
    // " · en línea" y similares: se traduce cada parte
    const parts = es.split(' · ').map((x) => maps[lang].get(x) || x);
    return parts.join(' · ');
  }
  return null;
}

/** t('texto', {var}) → texto en el idioma actual, con {var} sustituidas. */
export function t(es, vars) {
  let out = lookup(es) || es;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, v);
  return out;
}

/** Nombre del idioma en el idioma actual (para "Traducido del inglés"). */
const LANG_NAMES = {
  es: { es: 'español', en: 'inglés', pt: 'portugués', fr: 'francés', it: 'italiano' },
  en: { es: 'Spanish', en: 'English', pt: 'Portuguese', fr: 'French', it: 'Italian' },
  pt: { es: 'espanhol', en: 'inglês', pt: 'português', fr: 'francês', it: 'italiano' },
  fr: { es: 'espagnol', en: 'anglais', pt: 'portugais', fr: 'français', it: 'italien' },
  it: { es: 'spagnolo', en: 'inglese', pt: 'portoghese', fr: 'francese', it: 'italiano' },
};
const TRANSLATED_FROM = { es: 'Traducido del {lang}', en: 'Translated from {lang}', pt: 'Traduzido do {lang}', fr: 'Traduit de l’{lang}', it: 'Tradotto dall’{lang}' };
export function translatedFrom(src) {
  const name = LANG_NAMES[lang]?.[src] || src;
  let label = TRANSLATED_FROM[lang].replace('{lang}', name);
  if (lang === 'fr' && !/^[aeiouy]/i.test(name)) label = label.replace('de l’', 'du ');
  if (lang === 'it' && !/^[aeiou]/i.test(name)) label = label.replace('dall’', 'dal ');
  if (lang === 'es' && src === 'it') label = 'Traducido del italiano';
  return label;
}

/* ---------------- Traductor de pantalla ---------------- */
// Contenido de las personas: nunca se traduce con el diccionario
const SKIP = '.ugc, .nick, .member-nick, .chan-name:not(.ui), .dm-title-nick, #me-nick, .sys b, .menu-title b, .room-info b, .dm-req-text b, .admin-list b, .call-peer h2, .doc-info b, .att-info b, .emoji-grid, .emoji-cats, .sticker, .sticker-grid, code, .logo, .avatar, .chip, .link[data-join], #win-name .ugc, script, style';
const ATTRS = ['title', 'placeholder', 'aria-label'];

// Se recuerda el texto original (español) de cada nodo para poder cambiar de idioma
// varias veces, y volver al español, sin perder la referencia.
const origText = new WeakMap(); // nodo de texto -> { es, set }
const origAttr = new WeakMap(); // elemento -> { atributo: { es, set } }

function translateTextNode(n) {
  const raw = n.nodeValue;
  const rec = origText.get(n);
  const source = rec && rec.set === raw ? rec.es : raw; // si nadie lo cambió, partimos del original
  const trimmed = source.trim();
  if (!trimmed || !/[A-Za-zÁÉÍÓÚáéíóúñÑ¿¡]/.test(trimmed)) return;
  const parent = n.parentElement;
  if (!parent || parent.closest(SKIP)) return;
  const out = lang === 'es' ? trimmed : lookup(trimmed);
  const next = out ? source.replace(trimmed, out) : source;
  if (next !== raw) n.nodeValue = next;
  if (out && out !== trimmed) origText.set(n, { es: source, set: next }); else origText.delete(n);
}
function translateAttrs(el) {
  if (!el.getAttribute || el.closest?.('.ugc')) return;
  let recs = origAttr.get(el);
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (!v) continue;
    const rec = recs?.[a];
    const source = rec && rec.set === v ? rec.es : v;
    const out = lang === 'es' ? source : lookup(source.trim());
    const next = out || source;
    if (next !== v) el.setAttribute(a, next);
    if (next !== source) { recs ||= {}; recs[a] = { es: source, set: next }; origAttr.set(el, recs); } else if (recs) delete recs[a];
  }
}
function translateTree(node) {
  if (node.nodeType === Node.TEXT_NODE) return translateTextNode(node);
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  translateAttrs(node);
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let cur;
  while ((cur = walker.nextNode())) {
    if (cur.nodeType === Node.TEXT_NODE) translateTextNode(cur);
    else translateAttrs(cur);
  }
}

let observer;
export function startI18n() {
  const run = (records) => {
    observer.disconnect();
    for (const r of records) {
      if (r.type === 'childList') r.addedNodes.forEach(translateTree);
      else if (r.type === 'characterData') translateTextNode(r.target);
      else if (r.type === 'attributes') translateAttrs(r.target);
    }
    observe();
  };
  observer = new MutationObserver(run);
  const observe = () => observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  translateTree(document.body);
  observe();
}
/** Vuelve a traducir toda la pantalla (tras cambiar de idioma y volver a pintar). */
export function retranslate() { translateTree(document.body); }
