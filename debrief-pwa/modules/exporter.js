// exporter.js — get the debrief out of the browser.
//
// Two products:
//
//   1. A replay clip of a highlight, recorded straight off the live WebGL
//      canvas with MediaRecorder + canvas.captureStream(). No server, no
//      ffmpeg.wasm, no re-rendering pass — what you saw is what gets encoded.
//      MP4 is preferred where the browser can encode it (shareable everywhere),
//      falling back to WebM/VP9.
//
//   2. A summary card PNG: side-by-side stats for up to four pilots over a
//      still of the 3D view. This is the thing that actually gets posted in the
//      club group after a good day.
//
// On iOS a blob download is unreliable inside a standalone PWA, so anything we
// produce goes through the native share sheet when one is available.

import { fmtAlt, fmtDist, fmtDuration, fmtGlide, fmtSpeed, fmtDate, fmtClock } from './format.js';
import { colorFor, rgbCss, hexToRgb } from './colors.js';
import { HIGHLIGHT_META } from './highlights.js';

/** Tried in order — the first the browser can encode wins. */
const MIME_CANDIDATES = [
  { mime: 'video/mp4;codecs=avc1.42E01E', ext: 'mp4' },
  { mime: 'video/mp4', ext: 'mp4' },
  { mime: 'video/webm;codecs=vp9', ext: 'webm' },
  { mime: 'video/webm;codecs=vp8', ext: 'webm' },
  { mime: 'video/webm', ext: 'webm' },
];

const FPS = 30;
const BITRATE = 8_000_000;

/**
 * What this browser can actually do, so the UI can disable the button with a
 * reason instead of failing halfway through a recording.
 * @returns {{supported:boolean, mime?:string, ext?:string, reason?:string}}
 */
export function videoSupport() {
  if (typeof MediaRecorder === 'undefined') {
    return { supported: false, reason: 'This browser has no MediaRecorder — try Chrome, or export a PNG card instead.' };
  }
  const el = document.createElement('canvas');
  if (typeof el.captureStream !== 'function') {
    return { supported: false, reason: 'This browser cannot capture a canvas stream — export a PNG card instead.' };
  }
  for (const c of MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(c.mime)) return { supported: true, ...c };
    } catch { /* keep trying */ }
  }
  return { supported: false, reason: 'No supported video codec found — export a PNG card instead.' };
}

/**
 * Record the replay between two clock values.
 *
 * @param {{canvas:HTMLCanvasElement, timeline:any, from:number, to:number,
 *          speed?:number, map?:any, onProgress?:(f:number)=>void}} opts
 * @returns {Promise<{blob:Blob, ext:string, seconds:number}>}
 */
export function recordClip(opts) {
  const { canvas, timeline, from, to, speed = 2, map, onProgress } = opts;
  const support = videoSupport();
  if (!support.supported) return Promise.reject(new Error(support.reason));
  if (!canvas) return Promise.reject(new Error('The 3D canvas is not ready yet.'));
  if (!(to > from)) return Promise.reject(new Error('That highlight has no duration to record.'));

  return new Promise((resolve, reject) => {
    let stream;
    try { stream = canvas.captureStream(FPS); }
    catch (err) { return reject(new Error(`Could not capture the canvas: ${err.message}`)); }

    let recorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType: support.mime, videoBitsPerSecond: BITRATE });
    } catch (err) {
      return reject(new Error(`Recorder refused to start: ${err.message}`));
    }

    /** @type {Blob[]} */
    const chunks = [];
    let settled = false;
    const t0 = performance.now();

    // MapLibre only redraws when something changes. During a recording we force
    // a repaint every frame: a stalled canvas produces a video of frozen frames
    // even though the clock is advancing.
    let raf = 0;
    const pump = () => {
      if (map && typeof map.triggerRepaint === 'function') map.triggerRepaint();
      if (onProgress) {
        const f = (timeline.time - from) / (to - from);
        onProgress(Math.max(0, Math.min(1, f)));
      }
      raf = requestAnimationFrame(pump);
    };

    const cleanup = () => {
      cancelAnimationFrame(raf);
      for (const t of stream.getTracks()) t.stop();
    };

    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.onerror = (e) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`Recording failed: ${(e.error && e.error.name) || 'unknown error'}`));
    };
    recorder.onstop = () => {
      if (settled) return;
      settled = true;
      cleanup();
      const blob = new Blob(chunks, { type: support.mime.split(';')[0] });
      if (!blob.size) return reject(new Error('The recording came out empty.'));
      resolve({ blob, ext: support.ext, seconds: (performance.now() - t0) / 1000 });
    };

    const prevSpeed = timeline.speed;
    timeline.setSpeed(speed);
    recorder.start(250);   // timeslice: flush chunks as we go, not all at the end
    raf = requestAnimationFrame(pump);

    timeline.playRange(from, to, () => {
      timeline.setSpeed(prevSpeed);
      // A short tail so the last frames are definitely in the muxer.
      setTimeout(() => { if (recorder.state !== 'inactive') recorder.stop(); }, 220);
    });
  });
}

/**
 * Wall-clock length of a clip: flight seconds divided by playback rate, plus
 * the pad. Used to warn before a 4-minute recording.
 */
export function clipSeconds(from, to, speed) {
  return Math.max(0, (to - from) / 1000 / Math.max(1, speed));
}

// ── PNG summary card ────────────────────────────────────────────────────────

const CARD_W = 1200;
const CARD_H = 675;

/**
 * Side-by-side summary card. Uses a still of the live 3D canvas as the backdrop
 * when one is available (it needs `preserveDrawingBuffer`, which map3d sets).
 *
 * @param {{tracks:Array, mapCanvas?:HTMLCanvasElement, title?:string,
 *          domain?:object, toClock?:Function}} opts
 * @returns {Promise<Blob>}
 */
export async function buildStatsCard(opts) {
  const tracks = (opts.tracks || []).filter((t) => t.visible !== false).slice(0, 4);
  if (!tracks.length) throw new Error('No visible flights to summarise.');

  const canvas = document.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d');

  drawCardBackdrop(ctx, opts.mapCanvas);
  drawCardHeader(ctx, tracks, opts.title);
  drawCardSparklines(ctx, tracks);
  drawCardTable(ctx, tracks);
  drawCardFooter(ctx, tracks);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the PNG.'))), 'image/png');
  });
}

function drawCardBackdrop(ctx, mapCanvas) {
  ctx.fillStyle = '#0a0f1a';
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  if (mapCanvas && mapCanvas.width && mapCanvas.height) {
    try {
      // Cover-fit the map still, anchored high so the horizon stays visible.
      const scale = Math.max(CARD_W / mapCanvas.width, CARD_H / mapCanvas.height);
      const w = mapCanvas.width * scale, h = mapCanvas.height * scale;
      ctx.drawImage(mapCanvas, (CARD_W - w) / 2, (CARD_H - h) * 0.28, w, h);
    } catch { /* tainted or lost context — the gradient below still looks fine */ }
  }

  // Scrim: dark enough for white text over bright snow or sunlit rock.
  const g = ctx.createLinearGradient(0, 0, 0, CARD_H);
  g.addColorStop(0, 'rgba(8,12,20,0.72)');
  g.addColorStop(0.42, 'rgba(8,12,20,0.55)');
  g.addColorStop(1, 'rgba(6,9,16,0.94)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
}

function drawCardHeader(ctx, tracks, title) {
  const face = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
  ctx.textBaseline = 'alphabetic';

  ctx.fillStyle = '#ffffff';
  ctx.font = `700 40px ${face}`;
  ctx.textAlign = 'left';
  ctx.fillText(title || (tracks.length > 1 ? 'Flight comparison' : tracks[0].pilotName), 54, 78);

  const site = tracks.find((t) => t.site)?.site;
  const dates = [...new Set(tracks.map((t) => t.date))];
  const sub = [
    dates.length === 1 ? fmtDate(dates[0]) : `${dates.length} flights`,
    site || '',
    `${tracks.length} ${tracks.length === 1 ? 'pilot' : 'pilots'}`,
  ].filter(Boolean).join('  ·  ');

  ctx.fillStyle = 'rgba(230,238,248,0.72)';
  ctx.font = `500 20px ${face}`;
  ctx.fillText(sub, 54, 110);
}

/** A small altitude trace per pilot, coloured by climb rate. */
function drawCardSparklines(ctx, tracks) {
  const x0 = 54, x1 = CARD_W - 54;
  const yTop = 144, yBot = 262;
  const w = x1 - x0, h = yBot - yTop;

  // The backdrop is a live satellite still, which can be bright and busy. Lay a
  // dark panel under the traces or the thin coloured lines vanish into a field.
  ctx.fillStyle = 'rgba(8,12,20,0.62)';
  ctx.fillRect(x0, yTop, w, h);

  let lo = Infinity, hi = -Infinity, maxDur = 0;
  for (const t of tracks) {
    const key = t.altSource === 'gps' ? 'gpsAlt' : 'pressureAlt';
    for (const p of t.points) {
      if (p[key] < lo) lo = p[key];
      if (p[key] > hi) hi = p[key];
    }
    maxDur = Math.max(maxDur, t.metrics.duration || 1);
  }
  if (!Number.isFinite(lo) || hi - lo < 50) { lo = Math.min(lo, 0); hi = lo + 500; }

  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x0, yTop, w, h);

  // Aligned at T=0 (launch) so line choices are comparable at a glance.
  for (const t of tracks) {
    const key = t.altSource === 'gps' ? 'gpsAlt' : 'pressureAlt';
    const pts = t.points;
    const stride = Math.max(1, Math.floor(pts.length / (w * 1.5)));
    const t0 = pts[0].timestamp;
    ctx.lineWidth = 2.4;
    let px = x0, py = yBot - ((pts[0][key] - lo) / (hi - lo)) * h;
    for (let i = stride; i < pts.length; i += stride) {
      const p = pts[i];
      const f = ((p.timestamp - t0) / 1000) / maxDur;
      const x = x0 + f * w;
      const y = yBot - ((p[key] - lo) / (hi - lo)) * h;
      ctx.strokeStyle = rgbCss(colorFor('vario', p, t), 0.95);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(x, y);
      ctx.stroke();
      px = x; py = y;
    }
  }

  const face = '-apple-system, system-ui, sans-serif';
  ctx.font = `500 13px ${face}`;
  ctx.fillStyle = 'rgba(230,238,248,0.6)';
  ctx.textAlign = 'left';
  ctx.fillText(`${Math.round(hi)} m`, x0 + 8, yTop + 18);
  ctx.fillText(`${Math.round(lo)} m`, x0 + 8, yBot - 8);
  ctx.textAlign = 'right';
  ctx.fillText(`${fmtDuration(maxDur)} from launch`, x1 - 8, yBot - 8);
}

const CARD_ROWS = [
  { label: 'Duration', get: (t) => fmtDuration(t.metrics.duration || 0) },
  { label: 'Free distance', get: (t) => fmtDist(t._insights ? t._insights.freeDistance : t.metrics.straightDistance) },
  { label: 'Max altitude', get: (t) => fmtAlt(t.metrics.maxAlt) },
  { label: 'Best climb', get: (t) => `${(t.metrics.maxClimb || 0).toFixed(1)} m/s` },
  { label: 'Height gained', get: (t) => fmtAlt(t.metrics.totalClimb || 0) },
  { label: 'Thermals', get: (t) => String(t.metrics.thermalCount || 0) },
  { label: 'Best glide', get: (t) => fmtGlide(t.metrics.bestGlide) },
  { label: 'Top speed', get: (t) => fmtSpeed(t.metrics.maxSpeed || 0) },
  { label: 'Turn bias', get: (t) => `${t.metrics.turnBias.leftPercent}% L / ${t.metrics.turnBias.rightPercent}% R` },
];

function drawCardTable(ctx, tracks) {
  const face = '-apple-system, BlinkMacSystemFont, system-ui, sans-serif';
  const x0 = 54;
  const labelW = 190;
  const colW = (CARD_W - 108 - labelW) / tracks.length;
  const yHead = 308;
  const rowH = 31;

  // Pilot headers with their track colour.
  tracks.forEach((t, i) => {
    const cx = x0 + labelW + colW * i;
    ctx.fillStyle = t.color;
    ctx.fillRect(cx, yHead - 20, 26, 5);
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 21px ${face}`;
    ctx.textAlign = 'left';
    ctx.fillText(clip(ctx, t.pilotName, colW - 16), cx, yHead + 6);
    if (tracks.length > 1 || t.gliderType) {
      ctx.fillStyle = 'rgba(230,238,248,0.58)';
      ctx.font = `500 14px ${face}`;
      ctx.fillText(clip(ctx, t.gliderType || fmtDate(t.date), colW - 16), cx, yHead + 26);
    }
  });

  CARD_ROWS.forEach((row, r) => {
    const y = yHead + 54 + r * rowH;
    if (r % 2 === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.035)';
      ctx.fillRect(x0 - 10, y - 21, CARD_W - 88, rowH - 3);
    }
    ctx.fillStyle = 'rgba(230,238,248,0.66)';
    ctx.font = `500 17px ${face}`;
    ctx.textAlign = 'left';
    ctx.fillText(row.label, x0, y);

    // Best-in-class values are highlighted; ties and non-numeric rows are not.
    const values = tracks.map((t) => row.get(t));
    const best = bestIndex(row.label, tracks);
    tracks.forEach((t, i) => {
      const cx = x0 + labelW + colW * i;
      const isBest = best === i && tracks.length > 1;
      ctx.fillStyle = isBest ? '#ffffff' : 'rgba(240,246,252,0.86)';
      ctx.font = `${isBest ? 700 : 500} 18px ${face}`;
      ctx.fillText(values[i], cx, y);
    });
  });
}

/** Which column wins a given row, or -1 when the row isn't a contest. */
function bestIndex(label, tracks) {
  const pick = {
    'Duration': (t) => t.metrics.duration,
    'Free distance': (t) => (t._insights ? t._insights.freeDistance : t.metrics.straightDistance),
    'Max altitude': (t) => t.metrics.maxAlt,
    'Best climb': (t) => t.metrics.maxClimb,
    'Height gained': (t) => t.metrics.totalClimb,
    'Best glide': (t) => t.metrics.bestGlide,
    'Top speed': (t) => t.metrics.maxSpeed,
  }[label];
  if (!pick) return -1;
  let best = -1, bestV = -Infinity;
  tracks.forEach((t, i) => {
    const v = pick(t) || 0;
    if (v > bestV) { bestV = v; best = i; }
  });
  return best;
}

function drawCardFooter(ctx, tracks) {
  const face = '-apple-system, system-ui, sans-serif';
  const y = CARD_H - 24;

  // Headline highlight, if any track has one.
  const hl = tracks.flatMap((t) => (t.highlights || []).map((h) => ({ t, h })))
    .find(({ h }) => h.type === 'BEST_CLIMB');

  ctx.textAlign = 'left';
  ctx.font = `500 15px ${face}`;
  ctx.fillStyle = 'rgba(230,238,248,0.55)';
  if (hl) {
    const meta = HIGHLIGHT_META[hl.h.type];
    ctx.fillStyle = rgbCss(meta.rgb, 0.95);
    ctx.fillText(`${meta.icon}  ${hl.h.description}`, 54, y);
  }

  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(230,238,248,0.45)';
  ctx.font = `600 15px ${face}`;
  ctx.fillText('Thermal Debrief', CARD_W - 54, y);
}

function clip(ctx, text, maxW) {
  let s = String(text || '');
  if (ctx.measureText(s).width <= maxW) return s;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
  return `${s}…`;
}

// ── delivery ────────────────────────────────────────────────────────────────

/**
 * Hand a blob to the user. Prefers the native share sheet, because in a
 * standalone iOS PWA an <a download> either does nothing or strands the file in
 * a tab the pilot can't get back from.
 *
 * @returns {Promise<'shared'|'downloaded'>}
 */
export async function saveOrShare(blob, filename, shareTitle) {
  const file = new File([blob], filename, { type: blob.type });

  if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
    try {
      await navigator.share({ files: [file], title: shareTitle || filename });
      return 'shared';
    } catch (err) {
      // A user-cancelled share is not an error worth reporting as one.
      if (err && err.name === 'AbortError') return 'shared';
      // Anything else: fall through to a download.
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 20000);
  return 'downloaded';
}

/** "debrief-alon-2026-07-14-best-climb.mp4" */
export function clipFilename(track, highlight, ext) {
  const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const parts = ['debrief', slug(track.pilotName), track.date];
  if (highlight) parts.push(slug(highlight.type));
  return `${parts.filter(Boolean).join('-')}.${ext}`;
}

export function cardFilename(tracks) {
  const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (tracks.length === 1) return `debrief-${slug(tracks[0].pilotName)}-${tracks[0].date}.png`;
  return `debrief-comparison-${tracks[0].date}.png`;
}
