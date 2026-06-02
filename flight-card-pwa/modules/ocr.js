// ocr.js — lazy Tesseract.js loader + FMC TAKEOFF REF parser.
//
// Three entry paths feed parseFmcText():
//   1. Screenshot upload (file input, no capture)
//   2. Camera capture (file input with capture=environment)
//   3. Paste from iOS Live Text (textarea)
//
// Path 1 + 2 go through preprocess → tesseract → parseFmcText.
// Path 3 skips OCR entirely.

// CDN with offline fallback once SW has cached it. We lazy-load on first use.
const TESSERACT_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

let tesseractPromise = null;
function loadTesseract() {
  if (tesseractPromise) return tesseractPromise;
  tesseractPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = TESSERACT_CDN;
    s.async = true;
    s.onload = () => resolve(window.Tesseract);
    s.onerror = () => reject(new Error('Failed to load Tesseract.js'));
    document.head.appendChild(s);
  });
  return tesseractPromise;
}

// ---------- Image preprocessing ----------

async function preprocess(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    // Downscale very large images so OCR stays fast on iPad.
    const MAX = 1600;
    let { width: w, height: h } = img;
    const scale = Math.min(1, MAX / Math.max(w, h));
    w = Math.round(w * scale); h = Math.round(h * scale);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    // Grayscale + threshold (FMC text is green-on-black or green-on-white screenshots;
    // either way thresholding boosts OCR a lot).
    const imgData = ctx.getImageData(0, 0, w, h);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      const lum = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
      // Adaptive-ish: invert when background is dark
      const v = lum > 128 ? 0 : 255;
      d[i] = d[i+1] = d[i+2] = v;
    }
    ctx.putImageData(imgData, 0, 0);
    return c.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// ---------- OCR ----------

export async function ocrImage(file, onProgress) {
  onProgress?.('Preparing image…', 0.05);
  const dataUrl = await preprocess(file);
  onProgress?.('Loading OCR engine…', 0.1);
  const Tess = await loadTesseract();
  onProgress?.('Reading text…', 0.25);
  const { data } = await Tess.recognize(dataUrl, 'eng', {
    logger: (m) => {
      if (m.status === 'recognizing text') onProgress?.('Reading text…', 0.25 + m.progress * 0.7);
    },
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789./- ',
  });
  onProgress?.('Parsing…', 0.97);
  return data.text || '';
}

// ---------- FMC parser ----------
//
// Maps recognised TAKEOFF REF tokens to data-card field keys.
// Tolerant of OCR noise (extra spaces, missing decimals, common confusions).

const TOKEN_PATTERNS = [
  // V-speeds
  { key: 'v1',    re: /\bV\s*1\b[^\d]{0,6}(\d{2,3})\b/i },
  { key: 'vr',    re: /\bV\s*R\b[^\d]{0,6}(\d{2,3})\b/i },
  { key: 'v2',    re: /\bV\s*2\b[^\d]{0,6}(\d{2,3})\b/i },

  // Takeoff perf — N1 % target.
  // OPT FULL-thrust mode prints "N1 92.5". OPT ATM/derate mode hides N1
  // behind the derate label "D-TO" / "D-TO-1" / "D-TO-2" with the N1 % value
  // next to it (e.g. "D-TO-2  89.5"). Match both shapes; whichever fires
  // overwrites the other, which is fine because OPT only shows one at a time.
  { key: 'n1',    re: /\bN\s*1\b[^\d]{0,8}(\d{2,3}(?:\.\d{1,2})?)\b/i },
  { key: 'n1',    re: /\bD-?TO(?:-\d)?\b[^\d]{0,8}(\d{2,3}(?:\.\d{1,2})?)\b/i },
  { key: 'flaps', re: /\bFLAPS?\b[^\d]{0,4}(\d{1,2})\b/i },

  // Fuel — trip + block. FMC/OFP usually shows tonnes, scale to kg.
  { key: 'trip_fuel',  re: /\bTRIP\b[^\d]{0,8}(\d{1,3}(?:[.,]\d)?)\b/i, scale: 1000 },
  { key: 'block_fuel', re: /\bBLOCK\b[^\d]{0,8}(\d{1,3}(?:[.,]\d)?)\b/i, scale: 1000 },

  // Souls on board (total)
  { key: 'sob_total',  re: /\b(?:SOB|TTL\s*PAX|PAX)\b[^\d]{0,6}(\d{1,3})\b/i },

  // ATIS letter (info Charlie / ATIS C / INFO C)
  { key: 'atis',  re: /\b(?:ATIS|INFO)\b[^A-Z]{0,4}([A-Z])\b/i, asString: true },

  // Text-ish
  // OPT writes "PROFILE EKZ" with just the 3-letter Israeli-fleet suffix —
  // we capture it as tail and let the apply path normalise EKZ → 4X-EKZ.
  { key: 'flight',re: /\bFLT\b\s*[:#]?\s*([A-Z0-9]{2,7})\b/i, asString: true },
  { key: 'tail',  re: /\b(REG|TAIL|PROFILE)\b\s*[:#]?\s*([A-Z0-9-]{2,8})\b/i, asString: true, group: 2 },
  // OPT writes "ARPT LLBG / TLV" — first ICAO/IATA wins. Same for arr.
  { key: 'dep',   re: /\b(?:ARPT|DEP|FROM|ORIG)\b[^A-Z]{0,4}([A-Z]{3,4})\b/i, asString: true },
  { key: 'arr',   re: /\b(?:ARR|TO|DEST)\b[^A-Z]{0,4}([A-Z]{3,4})\b/i, asString: true },
];

export function parseFmcText(rawText) {
  if (!rawText) return {};
  const text = rawText.replace(/ /g, ' ').replace(/[\t]+/g, ' ');
  const out = {};
  for (const tok of TOKEN_PATTERNS) {
    const m = tok.re.exec(text);
    if (!m) continue;
    let val = (tok.group ? m[tok.group] : m[1]).replace(',', '.');
    if (!tok.asString && tok.scale) {
      const n = parseFloat(val);
      if (Number.isFinite(n)) val = String(Math.round(n * tok.scale));
    }
    out[tok.key] = val;
  }
  // Heuristic: if trip/block fuel looks tiny (<200), keep as-is — already kg.
  for (const k of ['trip_fuel','block_fuel']) {
    if (out[k] && Number(out[k]) < 200) out[k] = String(Number(out[k]));
  }
  return out;
}

// ---------- Field labels for review ----------
import { fieldDef } from './data-card.js';

export function buildReviewFields(parsed, knownKeys) {
  // Always show every known field; parsed values pre-fill.
  return knownKeys.map(k => {
    const def = fieldDef(k);
    return {
      key: k,
      label: def ? def.label : k,
      value: parsed[k] ?? '',
      matched: parsed[k] != null,
    };
  });
}
