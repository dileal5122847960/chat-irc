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
