// qr.js — QR code generate + scan for cockpit-to-cockpit flight share.
//
// Both libraries are lazy-loaded from a CDN on first use and then the
// service worker caches them, so subsequent shares work offline.
//
// Why not roll our own QR encoder? A spec-compliant encoder with proper
// version selection and error correction is ~30KB of bit-fiddling. Same
// for the Reed–Solomon-based decoder. Both libraries are tiny, stable,
// and already used widely (qrcode + jsQR), so we pull them in instead of
// inventing our own bugs.

// We use qrcode-generator (Kazuhiko Arase) for encoding because, unlike
// the `qrcode` npm package, it ships a browser-globals build at a stable
// CDN path and exposes itself as `window.qrcode` — no bundler needed.
// jsQR handles the scan side.
const QRCODE_CDN = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js';
const JSQR_CDN   = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';

let qrcodeP = null;
function loadQrcode() {
  if (qrcodeP) return qrcodeP;
  qrcodeP = new Promise((resolve, reject) => {
    if (window.qrcode) return resolve(window.qrcode);
    const s = document.createElement('script');
    s.src = QRCODE_CDN; s.async = true;
    s.onload  = () => window.qrcode ? resolve(window.qrcode) : reject(new Error('qrcode global missing after load'));
    s.onerror = () => reject(new Error('Failed to load QR generator from CDN'));
    document.head.appendChild(s);
  });
  return qrcodeP;
}

let jsqrP = null;
function loadJsqr() {
  if (jsqrP) return jsqrP;
  jsqrP = new Promise((resolve, reject) => {
    if (window.jsQR) return resolve(window.jsQR);
    const s = document.createElement('script');
    s.src = JSQR_CDN; s.async = true;
    s.onload  = () => window.jsQR ? resolve(window.jsQR) : reject(new Error('jsQR global missing after load'));
    s.onerror = () => reject(new Error('Failed to load QR scanner from CDN'));
    document.head.appendChild(s);
  });
  return jsqrP;
}

// Render `text` as a QR code into `<canvas>` element `canvas`. qrcode-
// generator hands us a module grid (isDark(r,c)); we draw it onto a 2D
// context ourselves so the output is crisp at any cockpit-display size.
//
// Tries the lowest version that fits — qrcode-generator throws if the
// payload doesn't fit at the chosen version, so we step the version up
// until it does, capped at 40 (the QR-spec maximum).
export async function renderToCanvas(canvas, text, opts = {}) {
  const qrcode = await loadQrcode();
  const ecLevel = opts.errorCorrectionLevel || 'M';
  let qr = null;
  let lastErr = null;
  // Auto-pick the smallest QR version that fits the payload.
  for (let typeNumber = 0; typeNumber <= 40; typeNumber++) {
    try {
      qr = qrcode(typeNumber, ecLevel);
      qr.addData(text);
      qr.make();
      break;
    } catch (err) {
      lastErr = err;
      qr = null;
      // 0 = auto, but on some builds 0 means "you pick" and throws if it
      // can't decide. Walk up explicit versions until one fits.
      if (typeNumber === 0) continue;
    }
  }
  if (!qr) throw lastErr || new Error('Payload too large for QR');
  const count = qr.getModuleCount();
  const moduleSize = opts.scale || 6;
  const margin = (opts.margin ?? 1) * moduleSize;
  const dim = count * moduleSize + margin * 2;
  canvas.width = dim;
  canvas.height = dim;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, dim, dim);
  ctx.fillStyle = '#000000';
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) {
        ctx.fillRect(margin + c * moduleSize, margin + r * moduleSize, moduleSize, moduleSize);
      }
    }
  }
}

// Start the rear camera, draw frames into an offscreen canvas, scan with
// jsQR, fire `onDecoded(text)` on the first valid decode. Returns a stop
// function the caller MUST call when the scanner closes — it tears down
// the camera stream and the rAF loop.
export async function startScanner(videoEl, onDecoded) {
  const jsQR = await loadJsqr();
  let stream = null;
  let raf = null;
  let stopped = false;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  function stop() {
    stopped = true;
    if (raf) cancelAnimationFrame(raf);
    if (stream) stream.getTracks().forEach(t => t.stop());
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false,
    });
  } catch (err) {
    throw new Error('Camera access denied');
  }
  if (stopped) { stream.getTracks().forEach(t => t.stop()); return stop; }
  videoEl.srcObject = stream;
  videoEl.setAttribute('playsinline', 'true'); // iOS Safari needs this
  await videoEl.play().catch(() => {});

  const tick = () => {
    if (stopped) return;
    if (videoEl.readyState >= 2) {
      const w = videoEl.videoWidth, h = videoEl.videoHeight;
      if (w && h) {
        canvas.width = w; canvas.height = h;
        ctx.drawImage(videoEl, 0, 0, w, h);
        const img = ctx.getImageData(0, 0, w, h);
        const code = jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' });
        if (code && code.data) {
          stop();
          onDecoded(code.data);
          return;
        }
      }
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return stop;
}
