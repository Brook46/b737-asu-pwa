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

const QRCODE_CDN = 'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js';
const JSQR_CDN   = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';

let qrcodeP = null;
function loadQrcode() {
  if (qrcodeP) return qrcodeP;
  qrcodeP = new Promise((resolve, reject) => {
    if (window.QRCode) return resolve(window.QRCode);
    const s = document.createElement('script');
    s.src = QRCODE_CDN; s.async = true;
    s.onload  = () => resolve(window.QRCode);
    s.onerror = () => reject(new Error('Failed to load QRCode'));
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
    s.onload  = () => resolve(window.jsQR);
    s.onerror = () => reject(new Error('Failed to load jsQR'));
    document.head.appendChild(s);
  });
  return jsqrP;
}

// Render `text` as a QR code into `<canvas>` element `canvas`. Picks a
// version + error-correction level automatically. Returns a Promise.
export async function renderToCanvas(canvas, text, opts = {}) {
  const QR = await loadQrcode();
  return new Promise((resolve, reject) => {
    QR.toCanvas(canvas, text, {
      errorCorrectionLevel: 'M',
      margin: 1,
      scale: opts.scale || 5,
      color: {
        // Pure black-on-white scans most reliably across cameras and
        // lighting conditions in a cockpit.
        dark:  '#000000',
        light: '#ffffff',
      },
    }, (err) => err ? reject(err) : resolve());
  });
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
