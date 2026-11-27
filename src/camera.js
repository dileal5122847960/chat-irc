/*
 * Cámara para los privados: sacar una foto o grabar un video y enviarlo.
 * • Android (app): se abre la cámara del teléfono con <input capture> (Capacitor la lanza).
 * • Windows, web y donde no haya cámara nativa: cámara dentro de la app (getUserMedia),
 *   con cambio de cámara, foto, video (hasta 3 min) y vista previa antes de enviar.
 * Devuelve un File (o null si se cancela).
 */
const MAX_VIDEO_MS = 3 * 60 * 1000;

/** Cámara del sistema (Android): kind 'photo' | 'video'. */
export function nativeCapture(kind) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = kind === 'video' ? 'video/*' : 'image/*';
    input.setAttribute('capture', 'environment');
    input.onchange = () => resolve(input.files?.[0] || null);
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

/** Cámara dentro de la app. mode: 'photo' | 'video' (se puede cambiar dentro). */
export function cameraDialog({ t = (s) => s, esc, icon, mode = 'photo' }) {
  return new Promise((resolve) => {
    if (!navigator.mediaDevices?.getUserMedia) return resolve(null);
    const el = document.createElement('div');
    el.className = 'cam-wrap';
    el.innerHTML = `<div class="cam">
      <video class="cam-live" autoplay playsinline muted></video>
      <div class="cam-preview hidden"></div>
      <div class="cam-top"><button type="button" class="icon-btn" data-x title="${esc(t('Cerrar'))}">${icon('x')}</button><span class="cam-timer hidden">0:00</span><button type="button" class="icon-btn" data-flip title="${esc(t('Cambiar cámara'))}">${icon('refresh')}</button></div>
      <div class="cam-bottom">
        <div class="cam-modes"><button type="button" data-mode="photo">${esc(t('Foto'))}</button><button type="button" data-mode="video">${esc(t('Video'))}</button></div>
        <button type="button" class="cam-shutter" data-shoot aria-label="${esc(t('Sacar'))}"><i></i></button>
        <div class="cam-review hidden"><button type="button" class="btn" data-retry>${esc(t('Repetir'))}</button><button type="button" class="btn primary" data-send>${esc(t('Enviar'))}</button></div>
      </div></div>`;
    document.body.appendChild(el);
    const live = el.querySelector('.cam-live'), prev = el.querySelector('.cam-preview'), timer = el.querySelector('.cam-timer');
    let stream = null, facing = 'environment', rec = null, chunks = [], recStart = 0, tick = null, file = null, url = null;

    async function startStream() {
      stream?.getTracks().forEach((tr) => tr.stop());
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: mode === 'video' });
      } catch {
        try { stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: mode === 'video' }); } catch { close(null); return; }
      }
      live.srcObject = stream;
      live.classList.toggle('mirror', facing === 'user');
    }
    function setMode(m) {
      if (rec) return;
      const changed = m !== mode;
      mode = m;
      el.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
      el.querySelector('.cam-shutter').classList.toggle('video', mode === 'video');
      if (changed) startStream(); // el video necesita también el micrófono
    }
    function close(v) {
      clearInterval(tick);
      try { rec?.state === 'recording' && rec.stop(); } catch { /* nada */ }
      stream?.getTracks().forEach((tr) => tr.stop());
      if (!v && url) URL.revokeObjectURL(url);
      document.removeEventListener('keydown', onKey);
      el.remove();
      resolve(v);
    }
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    document.addEventListener('keydown', onKey);
    function review(f) {
      file = f;
      url = URL.createObjectURL(f);
      prev.innerHTML = f.type.startsWith('video') ? `<video src="${url}" controls playsinline autoplay loop></video>` : `<img src="${url}" alt="">`;
      prev.classList.remove('hidden'); live.classList.add('hidden');
      el.querySelector('.cam-review').classList.remove('hidden');
      el.querySelector('.cam-shutter').classList.add('hidden'); el.querySelector('.cam-modes').classList.add('hidden');
    }
    function retry() {
      if (url) URL.revokeObjectURL(url);
      file = url = null; prev.innerHTML = ''; prev.classList.add('hidden'); live.classList.remove('hidden');
      el.querySelector('.cam-review').classList.add('hidden');
      el.querySelector('.cam-shutter').classList.remove('hidden'); el.querySelector('.cam-modes').classList.remove('hidden');
    }
    function shoot() {
      if (!stream) return;
      if (mode === 'photo') {
        const c = document.createElement('canvas');
        c.width = live.videoWidth; c.height = live.videoHeight;
        const g = c.getContext('2d');
        if (facing === 'user') { g.translate(c.width, 0); g.scale(-1, 1); }
        g.drawImage(live, 0, 0);
        c.toBlob((b) => b && review(new File([b], `foto-${Date.now()}.jpg`, { type: 'image/jpeg' })), 'image/jpeg', 0.88);
        return;
      }
      if (rec) { rec.stop(); return; }
      const type = ['video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'].find((x) => window.MediaRecorder?.isTypeSupported?.(x)) || '';
      try { rec = new MediaRecorder(stream, type ? { mimeType: type } : {}); } catch { return; }
      chunks = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        clearInterval(tick); timer.classList.add('hidden');
        el.querySelector('.cam-shutter').classList.remove('rec');
        const mime = (rec.mimeType || 'video/webm').split(';')[0];
        rec = null;
        if (chunks.length) review(new File(chunks, `video-${Date.now()}.${mime.includes('mp4') ? 'mp4' : 'webm'}`, { type: mime }));
      };
      rec.start(1000);
      recStart = Date.now();
      el.querySelector('.cam-shutter').classList.add('rec');
      timer.classList.remove('hidden');
      tick = setInterval(() => {
        const s = Math.floor((Date.now() - recStart) / 1000);
        timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
        if (Date.now() - recStart > MAX_VIDEO_MS) rec?.stop();
      }, 250);
    }
    el.querySelector('[data-x]').onclick = () => close(null);
    el.querySelector('[data-flip]').onclick = () => { if (rec) return; facing = facing === 'user' ? 'environment' : 'user'; startStream(); };
    el.querySelector('[data-shoot]').onclick = shoot;
    el.querySelector('[data-retry]').onclick = retry;
    el.querySelector('[data-send]').onclick = () => close(file);
    el.querySelector('.cam-modes').onclick = (e) => { const b = e.target.closest('[data-mode]'); if (b) setMode(b.dataset.mode); };
    el.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    el.querySelector('.cam-shutter').classList.toggle('video', mode === 'video');
    startStream();
  });
}
