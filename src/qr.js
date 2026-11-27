/*
 * Códigos QR para agregar amigos (sin servicios externos).
 * • qrSvg(): dibuja el QR (librería qrcode-generator).
 * • scanQR(): abre la cámara y lee un QR (BarcodeDetector si existe; si no, jsQR).
 * El QR contiene https://chat-irc.vercel.app/#amigo=<número>: escaneado con la cámara normal
 * del teléfono abre ChamuFlac con la solicitud de amistad lista para enviar.
 */
import qrcode from 'qrcode-generator';
import jsQR from 'jsqr';

export const friendLink = (number) => `https://chat-irc.vercel.app/#amigo=${number}`;
/** Número de 8 dígitos dentro de un texto leído (enlace de ChamuFlac o el número solo). */
export function numberFromQr(text) {
  const m = String(text || '').match(/amigo=(\d{8})\b/) || String(text || '').match(/^\s*(\d{4})\s?(\d{4})\s*$/);
  return m ? Number(m[2] ? m[1] + m[2] : m[1]) : null;
}

export function qrSvg(text, size = 220) {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  const n = q.getModuleCount(), cell = size / (n + 8);
  let path = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) path += `M${(c + 4) * cell},${(r + 4) * cell}h${cell}v${cell}h-${cell}z`;
  return `<svg class="qr" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="QR"><rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#111"/></svg>`;
}

/** Abre la cámara y devuelve el texto del primer QR que vea (o null si se cancela). */
export function scanQR({ t = (s) => s, esc = (s) => s } = {}) {
  return new Promise(async (resolve) => {
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); }
    catch { resolve(null); return; }
    const wrap = document.createElement('div');
    wrap.className = 'dialog-wrap qr-scan';
    wrap.innerHTML = `<div class="dialog"><h3>${esc(t('Escanear QR'))}</h3><p class="muted small">${esc(t('Apunta la cámara al código QR de tu amigo.'))}</p>
      <div class="qr-video"><video playsinline muted autoplay></video><i class="qr-frame"></i></div>
      <div class="dialog-actions"><button type="button" class="btn" data-x>${esc(t('Cancelar'))}</button></div></div>`;
    document.body.appendChild(wrap);
    const video = wrap.querySelector('video');
    video.srcObject = stream;
    let done = false;
    const finish = (v) => { if (done) return; done = true; stream.getTracks().forEach((x) => x.stop()); wrap.remove(); resolve(v); };
    wrap.querySelector('[data-x]').onclick = () => finish(null);
    const detector = 'BarcodeDetector' in window ? new window.BarcodeDetector({ formats: ['qr_code'] }) : null;
    const canvas = document.createElement('canvas');
    const g = canvas.getContext('2d', { willReadFrequently: true });
    const tick = async () => {
      if (done) return;
      if (video.readyState >= 2 && video.videoWidth) {
        try {
          if (detector) { const r = await detector.detect(video); if (r[0]?.rawValue) return finish(r[0].rawValue); }
          else {
            canvas.width = Math.min(640, video.videoWidth); canvas.height = Math.round(canvas.width * video.videoHeight / video.videoWidth);
            g.drawImage(video, 0, 0, canvas.width, canvas.height);
            const code = jsQR(g.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
            if (code?.data) return finish(code.data);
          }
        } catch { /* seguimos intentando */ }
      }
      setTimeout(tick, 200);
    };
    tick();
  });
}
