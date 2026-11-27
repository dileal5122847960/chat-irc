// Emojis por categoría y paquete de stickers propio ("Bolita"), reutilizados del proyecto de mensajería inicial.

const cat = (s) => [...new Intl.Segmenter('es', { granularity: 'grapheme' }).segment(s.replace(/\s+/g, ''))].map((x) => x.segment);

export const EMOJI = [
  ['😀', 'Caras', cat(`😀😃😄😁😆😅🤣😂🙂🙃🫠😉😊😇🥰😍🤩😘😗☺️😚😙🥲😋😛😜🤪😝🤑🤗🤭🫢🫣🤫🤔🫡🤐🤨😐😑😶🫥😏😒🙄😬🤥😌😔😪🤤😴😷🤒🤕🤢🤮🤧🥵🥶🥴😵🤯🤠🥳🥸😎🤓🧐😕🫤😟🙁☹️😮😯😲😳🥺🥹😦😧😨😰😥😢😭😱😖😣😞😓😩😫🥱😤😡😠🤬😈👿💀☠️💩🤡👹👺👻👽👾🤖😺😸😹😻😼😽🙀😿😾`)],
  ['👋', 'Gestos', cat(`👋🤚🖐️✋🖖🫱🫲🫳🫴👌🤌🤏✌️🤞🫰🤟🤘🤙👈👉👆🖕👇☝️🫵👍👎✊👊🤛🤜👏🙌🫶👐🤲🤝🙏✍️💅🤳💪🦾🦵🦶👂🦻👃🧠🫀🫁🦷🦴👀👁️👅👄🫦👶🧒👦👧🧑👱👨🧔👩🧓👴👵🙍🙎🙅🙆💁🙋🧏🙇🤦🤷👮🕵️💂🥷👷🫅🤴👸👳👲🧕🤵👰🤰🫄🤱👼🎅🤶🦸🦹🧙🧚🧛🧜🧝🧞🧟💆💇🚶🧍🧎🏃💃🕺👯🧖🧗🤺🏇⛷️🏂🏌️🏄🚣🏊⛹️🏋️🚴🚵🤸🤼🤽🤾🤹🧘`)],
  ['❤️', 'Corazones', cat(`❤️🧡💛💚💙💜🖤🤍🤎💔❤️‍🔥❤️‍🩹❣️💕💞💓💗💖💘💝💟💌💋💯💢💥💫💦💨🕳️💬👁️‍🗨️🗨️🗯️💭💤✨🌟⭐🔥🎉🎊🎈`)],
  ['🐶', 'Animales', cat(`🐶🐱🐭🐹🐰🦊🐻🐼🐻‍❄️🐨🐯🦁🐮🐷🐽🐸🐵🙈🙉🙊🐒🐔🐧🐦🐤🐣🐥🦆🦅🦉🦇🐺🐗🐴🦄🐝🪱🐛🦋🐌🐞🐜🪰🪲🪳🦟🦗🕷️🦂🐢🐍🦎🦖🦕🐙🦑🦐🦞🦀🐡🐠🐟🐬🐳🐋🦈🦭🐊🐅🐆🦓🦍🦧🦣🐘🦛🦏🐪🐫🦒🦘🦬🐃🐂🐄🐎🐖🐏🐑🦙🐐🦌🐕🐩🦮🐈🐈‍⬛🪶🐓🦃🦤🦚🦜🦢🦩🕊️🐇🦝🦨🦡🦫🦦🦥🐁🐀🐿️🦔🌵🎄🌲🌳🌴🪵🌱🌿☘️🍀🎍🪴🎋🍃🍂🍁🍄🐚🪨🌾💐🌷🌹🥀🌺🌸🌼🌻🌞🌝🌛🌜🌚🌕🌙🌎🪐💫⭐🌟✨⚡☄️💥🔥🌪️🌈☀️🌤️⛅🌥️☁️🌦️🌧️⛈️🌩️🌨️❄️☃️⛄🌬️💨💧💦☔☂️🌊`)],
  ['🍔', 'Comida', cat(`🍏🍎🍐🍊🍋🍌🍉🍇🍓🫐🍈🍒🍑🥭🍍🥥🥝🍅🍆🥑🥦🥬🥒🌶️🫑🌽🥕🫒🧄🧅🥔🍠🥐🥯🍞🥖🥨🧀🥚🍳🧈🥞🧇🥓🥩🍗🍖🦴🌭🍔🍟🍕🫓🥪🥙🧆🌮🌯🫔🥗🥘🫕🥫🍝🍜🍲🍛🍣🍱🥟🦪🍤🍙🍚🍘🍥🥠🥮🍢🍡🍧🍨🍦🥧🧁🍰🎂🍮🍭🍬🍫🍿🍩🍪🌰🥜🍯🥛🍼🫖☕🍵🧃🥤🧋🍶🍺🍻🥂🍷🥃🍸🍹🧉🍾🧊🥄🍴🍽️🥣🥡🥢🧂`)],
  ['⚽', 'Actividades', cat(`⚽🏀🏈⚾🥎🎾🏐🏉🥏🎱🪀🏓🏸🏒🏑🥍🏏🪃🥅⛳🪁🏹🎣🤿🥊🥋🎽🛹🛼🛷⛸️🥌🎿🎯🎮🕹️🎰🎲🧩♟️🎭🎨🧵🪡🧶🎼🎤🎧🎷🪗🎸🎹🎺🎻🪕🥁🪘🎬🏆🥇🥈🥉🏅🎖️🏵️🎗️🎫🎟️🎪🤹`)],
  ['🚗', 'Viajes', cat(`🚗🚕🚙🚌🚎🏎️🚓🚑🚒🚐🛻🚚🚛🚜🦯🦽🦼🛴🚲🛵🏍️🛺🚨🚔🚍🚘🚖🚡🚠🚟🚃🚋🚞🚝🚄🚅🚈🚂🚆🚇🚊🚉✈️🛫🛬🛩️💺🛰️🚀🛸🚁🛶⛵🚤🛥️🛳️⛴️🚢⚓🪝⛽🚧🚦🚥🚏🗺️🗿🗽🗼🏰🏯🏟️🎡🎢🎠⛲⛱️🏖️🏝️🏜️🌋⛰️🏔️🗻🏕️⛺🛖🏠🏡🏘️🏚️🏗️🏭🏢🏬🏣🏤🏥🏦🏨🏪🏫🏩💒🏛️⛪🕌🕍🛕🕋⛩️🛤️🛣️🗾🎑🏞️🌅🌄🌠🎇🎆🌇🌆🏙️🌃🌌🌉🌁`)],
  ['💡', 'Objetos', cat(`⌚📱📲💻⌨️🖥️🖨️🖱️🖲️🕹️🗜️💽💾💿📀📼📷📸📹🎥📽️🎞️📞☎️📟📠📺📻🎙️🎚️🎛️🧭⏱️⏲️⏰🕰️⌛⏳📡🔋🪫🔌💡🔦🕯️🪔🧯🛢️💸💵💴💶💷🪙💰💳💎⚖️🪜🧰🪛🔧🔨⚒️🛠️⛏️🪚🔩⚙️🪤🧱⛓️🧲🔫💣🧨🪓🔪🗡️⚔️🛡️🚬⚰️🪦⚱️🏺🔮📿🧿🪬💈⚗️🔭🔬🕳️🩹🩺🩻💊💉🩸🧬🦠🧫🧪🌡️🧹🪠🧺🧻🚽🚰🚿🛁🛀🧼🪥🪒🧽🪣🧴🛎️🔑🗝️🚪🪑🛋️🛏️🛌🧸🪆🖼️🪞🪟🛍️🛒🎁🎈🎏🎀🪄🪅🎊🎉🎎🏮🎐🧧✉️📩📨📧💌📥📤📦🏷️🪧📪📫📬📭📮📯📜📃📄📑🧾📊📈📉🗒️🗓️📆📅🗑️📇🗃️🗳️🗄️📋📁📂🗂️🗞️📰📓📔📒📕📗📘📙📚📖🔖🧷🔗📎🖇️📐📏🧮📌📍✂️🖊️🖋️✒️🖌️🖍️📝✏️🔍🔎🔏🔐🔒🔓`)],
  ['✅', 'Símbolos', cat(`✅☑️✔️❌❎➕➖➗✖️🟰♾️‼️⁉️❓❔❕❗〰️💱💲⚕️♻️⚜️🔱📛🔰⭕✳️❇️🔆🔅〽️⚠️🚸🔞📵🚭🚯🚱🚳🚷⛔🚫❌⭕🛑🆗🆙🆒🆕🆓🆖🅰️🅱️🆎🆑🅾️🆘🔤🔡🔠🔢#️⃣*️⃣0️⃣1️⃣2️⃣3️⃣4️⃣5️⃣6️⃣7️⃣8️⃣9️⃣🔟▶️⏸️⏯️⏹️⏺️⏭️⏮️⏩⏪⏫⏬◀️🔼🔽➡️⬅️⬆️⬇️↗️↘️↙️↖️↕️↔️↪️↩️⤴️⤵️🔀🔁🔂🔄🔃🎵🎶💲💱™️©️®️🔚🔙🔛🔝🔜🔘⚪⚫🔴🟠🟡🟢🔵🟣🟤🟥🟧🟨🟩🟦🟪🟫⬛⬜🔶🔷🔸🔹🔺🔻💠`)],
  ['🏳️', 'Banderas', cat(`🏁🚩🎌🏴🏳️🏳️‍🌈🏳️‍⚧️🇦🇷🇧🇴🇧🇷🇨🇱🇨🇴🇨🇷🇨🇺🇩🇴🇪🇨🇸🇻🇬🇹🇭🇳🇲🇽🇳🇮🇵🇦🇵🇾🇵🇪🇵🇷🇪🇸🇺🇾🇻🇪🇺🇸🇨🇦🇬🇶🇵🇹🇫🇷🇩🇪🇮🇹🇬🇧🇮🇪🇳🇱🇧🇪🇨🇭🇦🇹🇸🇪🇳🇴🇩🇰🇫🇮🇵🇱🇺🇦🇬🇷🇹🇷🇲🇦🇪🇬🇳🇬🇿🇦🇰🇪🇯🇵🇰🇷🇨🇳🇮🇳🇦🇺🇳🇿🇺🇳🇪🇺`)],
];

/* ---------------- Stickers "Bolita" (SVG original) ---------------- */
const eyes = {
  happy: '<path d="M70 92q10-12 20 0M110 92q10-12 20 0" stroke="#222" stroke-width="6" fill="none" stroke-linecap="round"/>',
  open: '<circle cx="80" cy="90" r="8" fill="#222"/><circle cx="120" cy="90" r="8" fill="#222"/><circle cx="83" cy="87" r="2.5" fill="#fff"/><circle cx="123" cy="87" r="2.5" fill="#fff"/>',
  hearts: '<path d="M80 98l-12-11a7 7 0 0 1 12-7 7 7 0 0 1 12 7z" fill="#e8365d"/><path d="M120 98l-12-11a7 7 0 0 1 12-7 7 7 0 0 1 12 7z" fill="#e8365d"/>',
  sad: '<path d="M70 86q10 8 20 4M110 90q10 4 20-4" stroke="#222" stroke-width="6" fill="none" stroke-linecap="round"/>',
  wink: '<circle cx="80" cy="90" r="8" fill="#222"/><path d="M110 92q10-10 20 0" stroke="#222" stroke-width="6" fill="none" stroke-linecap="round"/>',
  angry: '<path d="M66 78l24 10M134 78l-24 10" stroke="#222" stroke-width="6" stroke-linecap="round"/><circle cx="80" cy="96" r="6" fill="#222"/><circle cx="120" cy="96" r="6" fill="#222"/>',
  shock: '<circle cx="80" cy="88" r="11" fill="#fff" stroke="#222" stroke-width="4"/><circle cx="120" cy="88" r="11" fill="#fff" stroke="#222" stroke-width="4"/><circle cx="80" cy="88" r="4" fill="#222"/><circle cx="120" cy="88" r="4" fill="#222"/>',
  sleepy: '<path d="M70 92h20M110 92h20" stroke="#222" stroke-width="6" stroke-linecap="round"/>',
  cool: '<path d="M62 80h76v8q-2 18-18 18t-18-14h-4q-2 14-18 14t-18-18z" fill="#222"/>',
};
const mouths = {
  smile: '<path d="M80 118q20 22 40 0" stroke="#222" stroke-width="6" fill="none" stroke-linecap="round"/>',
  grin: '<path d="M74 114h52q-4 30-26 30t-26-30z" fill="#7a2230"/><path d="M80 114h40v8H80z" fill="#fff"/>',
  frown: '<path d="M82 132q18-18 36 0" stroke="#222" stroke-width="6" fill="none" stroke-linecap="round"/>',
  o: '<ellipse cx="100" cy="126" rx="11" ry="14" fill="#7a2230"/>',
  flat: '<path d="M84 126h32" stroke="#222" stroke-width="6" stroke-linecap="round"/>',
  tongue: '<path d="M80 116q20 20 40 0" stroke="#222" stroke-width="6" fill="none" stroke-linecap="round"/><path d="M104 124q6 16 14 4" fill="#ef6f8a"/>',
  kiss: '<path d="M96 116q12 6 0 10 12 4 0 10" stroke="#222" stroke-width="5" fill="none" stroke-linecap="round"/>',
};
const extras = {
  tear: '<path d="M134 100q8 14 0 20-8-6 0-20z" fill="#5bb6f0"/>',
  blush: '<ellipse cx="66" cy="112" rx="10" ry="6" fill="#f59ab0" opacity=".7"/><ellipse cx="134" cy="112" rx="10" ry="6" fill="#f59ab0" opacity=".7"/>',
  zzz: '<text x="140" y="56" font-size="28" font-weight="800" fill="#6b7bd6" font-family="system-ui">z</text><text x="160" y="36" font-size="20" font-weight="800" fill="#6b7bd6" font-family="system-ui">z</text>',
  sweat: '<path d="M142 62q8 12 0 18-8-6 0-18z" fill="#5bb6f0"/>',
  steam: '<path d="M44 52q-8-8 0-16M156 52q8-8 0-16" stroke="#9aa" stroke-width="5" fill="none" stroke-linecap="round"/>',
  sparkle: '<path d="M160 40l4 10 10 4-10 4-4 10-4-10-10-4 10-4z" fill="#ffd34d"/><path d="M40 150l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" fill="#ffd34d"/>',
  heart: '<path d="M164 60l-14-13a8 8 0 0 1 14-8 8 8 0 0 1 14 8z" fill="#e8365d"/>',
  thumb: '<g transform="translate(140 118) rotate(-10)"><rect x="0" y="16" width="34" height="30" rx="8" fill="#f4c27a" stroke="#222" stroke-width="4"/><path d="M8 18V2q10-2 12 10v6" fill="#f4c27a" stroke="#222" stroke-width="4" stroke-linejoin="round"/></g>',
  wave: '<g transform="translate(146 96) rotate(18)"><rect x="0" y="0" width="28" height="36" rx="12" fill="#f4c27a" stroke="#222" stroke-width="4"/></g>',
};
const STICKER_DEFS = [
  ['hola', '#ffd166', 'open', 'smile', 'wave', '¡Hola!'],
  ['jaja', '#ffcf5c', 'happy', 'grin', 'tear', 'JAJAJA'],
  ['amor', '#ff8fab', 'hearts', 'smile', 'heart', 'Te quiero'],
  ['ok', '#8ad5a7', 'wink', 'smile', 'thumb', '¡Vale!'],
  ['triste', '#9bc4f5', 'sad', 'frown', 'tear', 'Snif…'],
  ['enfado', '#ff7b6b', 'angry', 'flat', 'steam', 'Grrr'],
  ['wow', '#c3a6ff', 'shock', 'o', 'sparkle', '¡Wow!'],
  ['sueno', '#b8c0ff', 'sleepy', 'flat', 'zzz', 'Buenas noches'],
  ['cool', '#7fd8e8', 'cool', 'smile', 'sparkle', 'Tranqui'],
  ['beso', '#ffb3c6', 'wink', 'kiss', 'blush', 'Muak'],
  ['uff', '#ffd6a5', 'sleepy', 'frown', 'sweat', 'Uff…'],
  ['gracias', '#a0e7b0', 'happy', 'tongue', 'blush', '¡Gracias!'],
];
export const STICKERS = STICKER_DEFS.map(([id]) => id);
export function stickerSvg(id) {
  if (String(id).startsWith('cf-')) return chamuSticker(id); // stickers animados de ChamuFlac
  const d = STICKER_DEFS.find((s) => s[0] === id);
  if (!d) return '';
  const [, color, e, m, x, label] = d;
  return `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" class="sticker-svg sticker-${id}" role="img" aria-label="${label}">
    <ellipse cx="100" cy="186" rx="56" ry="8" fill="#000" opacity=".12"/>
    <path d="M100 26c46 0 74 30 74 72 0 46-30 74-74 74s-74-28-74-74c0-42 28-72 74-72z" fill="${color}" stroke="#222" stroke-width="6"/>
    <ellipse cx="74" cy="56" rx="18" ry="9" fill="#fff" opacity=".45" transform="rotate(-20 74 56)"/>
    ${eyes[e]}${mouths[m]}${extras[x] || ''}
    <g font-family="system-ui,sans-serif" font-weight="900" text-anchor="middle"><text x="100" y="196" font-size="26" stroke="#fff" stroke-width="8" stroke-linejoin="round" paint-order="stroke" fill="#222">${label}</text></g>
  </svg>`;
}

/* ---------------- Stickers animados de ChamuFlac («Flaqui», la burbuja del logo) ---------------- */
// Dibujos propios en SVG con animaciones SMIL (funcionan en navegadores y en las apps).
const flaqui = (inner, face = 'feliz', anim = '') => {
  const faces = {
    feliz: '<circle cx="80" cy="96" r="9" fill="#fff"/><circle cx="122" cy="96" r="9" fill="#fff"/><path d="M80 124q21 18 42 0" stroke="#fff" stroke-width="8" fill="none" stroke-linecap="round"/>',
    risa: '<path d="M70 98q10-12 20 0M112 98q10-12 20 0" stroke="#fff" stroke-width="8" fill="none" stroke-linecap="round"/><path d="M76 118h50q-4 26-25 26t-25-26z" fill="#fff"/>',
    wow: '<circle cx="80" cy="94" r="10" fill="#fff"/><circle cx="122" cy="94" r="10" fill="#fff"/><ellipse cx="101" cy="130" rx="11" ry="14" fill="#fff"/>',
    dormido: '<path d="M70 98q10 8 20 0M112 98q10 8 20 0" stroke="#fff" stroke-width="7" fill="none" stroke-linecap="round"/><path d="M90 128q11 6 22 0" stroke="#fff" stroke-width="7" fill="none" stroke-linecap="round"/>',
    guino: '<circle cx="80" cy="96" r="9" fill="#fff"/><path d="M112 98q10-10 20 0" stroke="#fff" stroke-width="8" fill="none" stroke-linecap="round"/><path d="M80 124q21 18 42 0" stroke="#fff" stroke-width="8" fill="none" stroke-linecap="round"/>',
  };
  return `<g>${anim}<path d="M60 52h80a32 32 0 0 1 32 32v44a32 32 0 0 1-32 32H96l-30 24v-24h-6a32 32 0 0 1-32-32V84a32 32 0 0 1 32-32z" fill="#e11d48" stroke="#7f1023" stroke-width="5"/>
    <path d="M150 30l5 12 12 5-12 5-5 12-5-12-12-5 12-5z" fill="#ffd166"/>${faces[face]}</g>${inner}`;
};
const bounce = '<animateTransform attributeName="transform" type="translate" values="0 0;0 -10;0 0" dur="0.9s" repeatCount="indefinite"/>';
const shake = '<animateTransform attributeName="transform" type="rotate" values="-6 100 120;6 100 120;-6 100 120" dur="0.5s" repeatCount="indefinite"/>';
const pulse = '<animateTransform attributeName="transform" type="scale" values="1;1.06;1" dur="1s" repeatCount="indefinite" additive="sum"/>';
const label = (txt) => `<g font-family="system-ui,sans-serif" font-weight="900" text-anchor="middle"><text x="100" y="194" font-size="24" stroke="#fff" stroke-width="8" stroke-linejoin="round" paint-order="stroke" fill="#222">${txt}</text></g>`;
const floatHeart = (x, d) => `<path d="M${x} 60c-6-8-18-4-14 6l14 14 14-14c4-10-8-14-14-6z" fill="#ff4d6d"><animateTransform attributeName="transform" type="translate" values="0 10;0 -40" dur="1.6s" begin="${d}s" repeatCount="indefinite"/><animate attributeName="opacity" values="0;1;0" dur="1.6s" begin="${d}s" repeatCount="indefinite"/></path>`;
const zz = (x, y, d, s) => `<text x="${x}" y="${y}" font-size="${s}" font-weight="900" fill="#3a6ea5" font-family="system-ui">Z<animateTransform attributeName="transform" type="translate" values="0 0;10 -24" dur="2s" begin="${d}s" repeatCount="indefinite"/><animate attributeName="opacity" values="0;1;0" dur="2s" begin="${d}s" repeatCount="indefinite"/></text>`;
const CF_DEFS = {
  'cf-hola': ['¡Hola!', flaqui('<path d="M168 100q14-20 6-36" stroke="#e11d48" stroke-width="12" stroke-linecap="round" fill="none"><animateTransform attributeName="transform" type="rotate" values="-12 168 100;18 168 100;-12 168 100" dur="0.7s" repeatCount="indefinite"/></path>', 'feliz', bounce)],
  'cf-jaja': ['¡JAJA!', flaqui('', 'risa', shake)],
  'cf-amor': ['Te quiero', flaqui(floatHeart(60, 0) + floatHeart(140, 0.6) + floatHeart(100, 1.1), 'guino', pulse)],
  'cf-wow': ['¡Wow!', flaqui('<g fill="#ffd166"><circle cx="40" cy="60" r="5"><animate attributeName="r" values="2;7;2" dur="0.8s" repeatCount="indefinite"/></circle><circle cx="170" cy="150" r="5"><animate attributeName="r" values="7;2;7" dur="0.8s" repeatCount="indefinite"/></circle></g>', 'wow', pulse)],
  'cf-ok': ['¡Dale!', flaqui('<g transform="translate(150 110)"><circle r="22" fill="#16a34a"/><path d="M-10 0l7 8 14-16" stroke="#fff" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><animateTransform attributeName="transform" type="scale" values="0.8;1.1;0.8" dur="1s" repeatCount="indefinite" additive="sum"/></g>', 'feliz', bounce)],
  'cf-zzz': ['Zzz…', flaqui(zz(140, 60, 0, 26) + zz(158, 40, 0.7, 20) + zz(172, 24, 1.4, 16), 'dormido')],
  'cf-gracias': ['¡Gracias!', flaqui('<g font-size="30">✨<animate attributeName="opacity" values="0.3;1;0.3" dur="1.2s" repeatCount="indefinite"/></g>', 'guino', bounce)],
  'cf-chau': ['¡Chau!', flaqui('<path d="M32 104q-14-20-6-36" stroke="#e11d48" stroke-width="12" stroke-linecap="round" fill="none"><animateTransform attributeName="transform" type="rotate" values="12 32 104;-18 32 104;12 32 104" dur="0.7s" repeatCount="indefinite"/></path>', 'guino')],
};
export const CF_STICKERS = Object.keys(CF_DEFS);
STICKERS.unshift(...CF_STICKERS); // los de ChamuFlac, primero
export function chamuSticker(id) {
  const d = CF_DEFS[id];
  if (!d) return '';
  return `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" class="sticker-svg sticker-${id}" role="img" aria-label="${d[0]}">
    <ellipse cx="100" cy="182" rx="56" ry="8" fill="#000" opacity=".12"/>${d[1]}${label(d[0])}</svg>`;
}
