// charts.js — the altitude/vario profile under the map.
//
// Pure canvas, no charting library — same as the rest of the suite. Recharts or
// Chart.js would both need a bundler, and neither can colour a 20 000-point
// polyline per segment without falling over.
//
// Two canvases stacked in the DOM, which is the whole performance trick:
//
//   profile  the expensive part (terrain fill, per-segment coloured altitude
//            traces, axes, highlight flags). Redrawn only when the data,
//            colour mode or size changes.
//   overlay  the playhead, the per-pilot dots and the readout. Redrawn on every
//            timeline tick, which is ~60 Hz — so it must stay cheap.
//
// The x axis is the timeline's clock, so the chart is correct in both sync modes
// without knowing which one is active: the caller passes a `toClock` mapper.

import { colorFor, rgbCss, hexToRgb } from './colors.js';
import { HIGHLIGHT_META } from './highlights.js';
import { fmtClockShort, fmtDuration } from './format.js';

const PAD = { left: 44, right: 10, top: 12, bottom: 18 };
/** Height of the vario ribbon strip along the bottom of the plot, px. */
const RIBBON_H = 14;

/**
 * Set up a retina-correct 2D context and return it with the CSS-pixel size.
 *
 * Both dimensions are measured from the *parent* box, never from the canvas.
 * This function writes `canvas.style.height`, so measuring the canvas would
 * latch: one draw while the panel was still `display:none` falls back to the
 * default, writes it inline, and every later measurement then reads that stale
 * value back instead of the real layout.
 */
function surface(canvas, height) {
  const box = canvas.parentElement;
  const cssW = Math.max(120, (box ? box.clientWidth : 0) || canvas.clientWidth);
  const cssH = height || (box ? box.clientHeight : 0) || 160;
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const needW = Math.round(cssW * dpr), needH = Math.round(cssH * dpr);
  if (canvas.width !== needW || canvas.height !== needH) {
    canvas.width = needW; canvas.height = needH;
  }
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: cssW, h: cssH };
}

function css(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/**
 * Plot geometry shared by both canvases so the playhead lands exactly on the
 * trace. Altitude range is padded to a round number and never collapses.
 */
function geometry(w, h, tracks, domain, altMode) {
  const plotL = PAD.left, plotR = w - PAD.right;
  const plotT = PAD.top, plotB = h - PAD.bottom - RIBBON_H;
  const plotW = Math.max(1, plotR - plotL), plotH = Math.max(1, plotB - plotT);

  let lo = Infinity, hi = -Infinity;
  for (const t of tracks) {
    if (t.visible === false) continue;
    const key = altKey(t);
    for (const p of t.points) {
      const v = altMode === 'agl' ? (p.agl ?? 0) : p[key];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (altMode === 'msl' && t.hasTerrain) {
      for (const p of t.points) if ((p.groundAlt ?? Infinity) < lo) lo = p.groundAlt;
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) { lo = 0; hi = 1000; }
  if (hi - lo < 100) { hi = lo + 100; }

  const pad = (hi - lo) * 0.08;
  lo = altMode === 'agl' ? Math.max(0, lo - pad) : lo - pad;
  hi += pad;

  const span = Math.max(1, domain.span);
  return {
    plotL, plotR, plotT, plotB, plotW, plotH, lo, hi,
    x: (clock) => plotL + ((clock - domain.start) / span) * plotW,
    y: (alt) => plotB - ((alt - lo) / (hi - lo)) * plotH,
    ribbonT: plotB + 2,
  };
}

const altKey = (t) => (t.altSource === 'gps' ? 'gpsAlt' : 'pressureAlt');

// ── static layer ────────────────────────────────────────────────────────────

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{tracks:Array, domain:{start:number,end:number,span:number},
 *          toClock:(t:any, ms:number)=>number, colorMode:string,
 *          altMode?:'msl'|'agl', height?:number, mode?:string}} opts
 * @returns {object} the geometry, so the overlay can reuse it
 */
export function drawProfile(canvas, opts) {
  const { tracks, domain, toClock, colorMode, altMode = 'msl' } = opts;
  const { ctx, w, h } = surface(canvas, opts.height);
  ctx.clearRect(0, 0, w, h);

  const visible = tracks.filter((t) => t.visible !== false && t.points.length > 1);
  const g = geometry(w, h, visible, domain, altMode);
  if (!visible.length || domain.span <= 0) {
    ctx.fillStyle = css('--muted', '#8a93a6');
    ctx.font = '12px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Load a flight to see its altitude profile', w / 2, h / 2);
    return g;
  }

  drawGrid(ctx, g, w, h, domain, opts.mode);
  if (altMode === 'msl') drawTerrain(ctx, g, visible, toClock);
  for (const t of visible) drawTrace(ctx, g, t, toClock, colorMode, altMode);
  drawRibbon(ctx, g, visible, toClock);
  for (const t of visible) drawHighlightFlags(ctx, g, t, toClock);

  return g;
}

function drawGrid(ctx, g, w, h, domain, mode) {
  const line = css('--grid', 'rgba(255,255,255,0.06)');
  const muted = css('--muted', '#8a93a6');
  ctx.font = '10px -apple-system, system-ui, sans-serif';

  // Altitude ticks on a round step that yields 3–6 gridlines.
  const step = niceStep(g.hi - g.lo);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let a = Math.ceil(g.lo / step) * step; a <= g.hi; a += step) {
    const y = g.y(a);
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(g.plotL, Math.round(y) + 0.5);
    ctx.lineTo(g.plotR, Math.round(y) + 0.5);
    ctx.stroke();
    ctx.fillStyle = muted;
    ctx.fillText(String(Math.round(a)), g.plotL - 6, y);
  }

  // Time ticks: wall clock in absolute sync, elapsed in relative.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const ticks = Math.max(2, Math.min(7, Math.floor(g.plotW / 78)));
  for (let i = 0; i <= ticks; i++) {
    const clock = domain.start + (domain.span * i) / ticks;
    const x = g.x(clock);
    ctx.strokeStyle = line;
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, g.plotT);
    ctx.lineTo(Math.round(x) + 0.5, g.plotB);
    ctx.stroke();
    ctx.fillStyle = muted;
    const label = mode === 'relative'
      ? `+${fmtDuration(clock / 1000)}`
      : fmtClockShort(clock);
    ctx.fillText(label, x, g.plotB + RIBBON_H + 4);
  }
}

/**
 * Terrain silhouette. Only the first track with terrain is drawn: two pilots on
 * different lines have different ground beneath them, and overlapping two brown
 * silhouettes reads as neither.
 */
function drawTerrain(ctx, g, tracks, toClock) {
  const t = tracks.find((x) => x.hasTerrain);
  if (!t) return;
  const pts = t.points;
  const stride = Math.max(1, Math.floor(pts.length / (g.plotW * 2)));

  ctx.beginPath();
  ctx.moveTo(g.x(toClock(t, pts[0].timestamp)), g.plotB);
  for (let i = 0; i < pts.length; i += stride) {
    ctx.lineTo(g.x(toClock(t, pts[i].timestamp)), g.y(pts[i].groundAlt || 0));
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(g.x(toClock(t, last.timestamp)), g.y(last.groundAlt || 0));
  ctx.lineTo(g.x(toClock(t, last.timestamp)), g.plotB);
  ctx.closePath();

  const grad = ctx.createLinearGradient(0, g.plotT, 0, g.plotB);
  grad.addColorStop(0, 'rgba(120,96,68,0.55)');
  grad.addColorStop(1, 'rgba(70,54,38,0.85)');
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = 'rgba(190,160,120,0.5)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

/**
 * One track's altitude trace, coloured per segment by the active colour mode —
 * the same ramp the map uses, so the chart and the 3D view always agree.
 *
 * Decimated to ~2 samples per pixel column: beyond that the extra strokes are
 * invisible and just cost frames on an iPad.
 */
function drawTrace(ctx, g, track, toClock, colorMode, altMode) {
  const pts = track.points;
  const key = altKey(track);
  const stride = Math.max(1, Math.floor(pts.length / (g.plotW * 2)));
  const flat = colorMode === 'pilot' ? hexToRgb(track.color) : null;
  const valueOf = (p) => (altMode === 'agl' ? (p.agl ?? 0) : p[key]);

  ctx.lineWidth = 1.9;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  let prevX = g.x(toClock(track, pts[0].timestamp));
  let prevY = g.y(valueOf(pts[0]));

  for (let i = stride; i < pts.length; i += stride) {
    const p = pts[i];
    const x = g.x(toClock(track, p.timestamp));
    const y = g.y(valueOf(p));
    ctx.strokeStyle = rgbCss(flat || colorFor(colorMode, p, track), 0.95);
    ctx.beginPath();
    ctx.moveTo(prevX, prevY);
    ctx.lineTo(x, y);
    ctx.stroke();
    prevX = x; prevY = y;
  }
}

/** The vario strip: a solid colour band, so lift and sink read even where the
 *  altitude traces overlap. Stacked when several tracks are loaded. */
function drawRibbon(ctx, g, tracks, toClock) {
  const bandH = Math.max(3, Math.floor(RIBBON_H / tracks.length) - 1);
  tracks.forEach((track, ti) => {
    const pts = track.points;
    const stride = Math.max(1, Math.floor(pts.length / (g.plotW * 1.5)));
    const yTop = g.ribbonT + ti * (bandH + 1);
    for (let i = 0; i < pts.length; i += stride) {
      const x = g.x(toClock(track, pts[i].timestamp));
      const nextIdx = Math.min(pts.length - 1, i + stride);
      const x2 = g.x(toClock(track, pts[nextIdx].timestamp));
      ctx.fillStyle = rgbCss(colorFor('vario', pts[i], track), 0.92);
      ctx.fillRect(x, yTop, Math.max(1, x2 - x + 0.6), bandH);
    }
  });
}

/** Small flags at the top of the plot marking each detected highlight. */
function drawHighlightFlags(ctx, g, track, toClock) {
  for (const h of track.highlights || []) {
    const meta = HIGHLIGHT_META[h.type];
    if (!meta) continue;
    const x = g.x(toClock(track, h.timestamp));
    if (x < g.plotL - 4 || x > g.plotR + 4) continue;

    ctx.strokeStyle = rgbCss(meta.rgb, 0.45);
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(x, g.plotT);
    ctx.lineTo(x, g.plotB);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = rgbCss(meta.rgb, 0.95);
    ctx.beginPath();
    ctx.moveTo(x, g.plotT - 1);
    ctx.lineTo(x - 4, g.plotT - 8);
    ctx.lineTo(x + 4, g.plotT - 8);
    ctx.closePath();
    ctx.fill();
  }
}

// ── per-frame overlay ───────────────────────────────────────────────────────

/**
 * Playhead + a dot per pilot at the current clock. Must stay cheap: this runs
 * on every animation frame.
 * @param {object} g geometry returned by drawProfile
 */
export function drawOverlay(canvas, g, opts) {
  const { snapshot, altMode = 'msl' } = opts;
  const { ctx, w, h } = surface(canvas, opts.height);
  ctx.clearRect(0, 0, w, h);
  if (!g || !snapshot) return;

  const x = g.x(snapshot.time);
  if (x < g.plotL - 1 || x > g.plotR + 1) return;

  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(Math.round(x) + 0.5, g.plotT - 9);
  ctx.lineTo(Math.round(x) + 0.5, g.plotB + RIBBON_H + 2);
  ctx.stroke();

  for (const { track, sample } of snapshot.tracks) {
    if (!sample) continue;
    const value = altMode === 'agl' ? (sample.agl ?? 0) : sample.alt;
    const y = g.y(value);
    ctx.beginPath();
    ctx.arc(x, y, 4.2, 0, Math.PI * 2);
    ctx.fillStyle = track.color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }
}

// ── climb-by-height ─────────────────────────────────────────────────────────

/**
 * Horizontal bars: altitude band up the side, average climb achieved across the
 * bottom, one bar per pilot per band. This is the "where was the lift?" chart —
 * altitude is on the vertical axis because that is where a pilot expects it.
 *
 * Bands with only a few seconds of climbing are drawn faded: a 12-second
 * 4 m/s surge is noise, and showing it at full strength would send someone to
 * the wrong height tomorrow.
 *
 * @param {{tracks:Array, byTrack:Map<string,Array>, height?:number,
 *          bestBand?:{lo:number,hi:number}}} opts
 */
export function drawClimbBands(canvas, opts) {
  const { tracks, byTrack, bestBand } = opts;
  const { ctx, w, h } = surface(canvas, opts.height);
  ctx.clearRect(0, 0, w, h);

  const muted = css('--muted', '#8a93a6');
  ctx.font = '10px -apple-system, system-ui, sans-serif';

  // Union of every band any pilot climbed in, so rows line up across pilots.
  const los = new Set();
  let maxClimb = 0.8;
  for (const t of tracks) {
    for (const b of byTrack.get(t.id) || []) {
      los.add(b.lo);
      if (b.climbSec >= 60 && b.avgClimb > maxClimb) maxClimb = b.avgClimb;
    }
  }
  const bands = [...los].sort((a, b) => b - a);   // highest band at the top

  if (!bands.length) {
    ctx.fillStyle = muted;
    ctx.textAlign = 'center';
    ctx.fillText('No sustained climbs detected', w / 2, h / 2);
    return;
  }

  const padL = 52, padR = 40, padT = 14, padB = 18;
  const plotW = Math.max(1, w - padL - padR);
  const rowH = Math.max(9, (h - padT - padB) / bands.length);
  const barH = Math.max(3, (rowH - 3) / Math.max(1, tracks.length));
  const x = (climb) => padL + (climb / maxClimb) * plotW;

  // Vertical gridlines every 1 m/s.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let c = 0; c <= maxClimb + 0.001; c += 1) {
    const gx = Math.round(x(c)) + 0.5;
    ctx.strokeStyle = css('--grid', 'rgba(255,255,255,0.07)');
    ctx.beginPath();
    ctx.moveTo(gx, padT);
    ctx.lineTo(gx, h - padB);
    ctx.stroke();
    ctx.fillStyle = muted;
    ctx.fillText(`${c}`, gx, h - padB + 3);
  }
  ctx.fillStyle = muted;
  ctx.fillText('m/s', padL + plotW + 16, h - padB + 3);

  bands.forEach((lo, r) => {
    const yTop = padT + r * rowH;

    if (bestBand && lo >= bestBand.lo && lo < bestBand.hi) {
      ctx.fillStyle = 'rgba(255,196,61,0.10)';
      ctx.fillRect(padL - 2, yTop - 1, plotW + 4, rowH);
    }

    ctx.fillStyle = muted;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${lo}`, padL - 7, yTop + rowH / 2);

    tracks.forEach((track, ti) => {
      const band = (byTrack.get(track.id) || []).find((b) => b.lo === lo);
      if (!band || band.avgClimb <= 0) return;
      const y = yTop + ti * barH;
      const width = Math.max(1, x(band.avgClimb) - padL);
      // Fade the bands the pilot barely spent time in.
      ctx.globalAlpha = band.climbSec >= 60 ? 0.95 : 0.38;
      ctx.fillStyle = track.color;
      ctx.fillRect(padL, y, width, Math.max(2, barH - 1));
      ctx.globalAlpha = 1;

      // Minutes spent climbing here, where there's room to print it.
      if (barH >= 9 && band.climbSec >= 60) {
        ctx.fillStyle = 'rgba(238,242,248,0.75)';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${Math.round(band.climbSec / 60)}m`, padL + width + 4, y + barH / 2);
      }
    });
  });

  ctx.fillStyle = muted;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('m MSL', 4, padT - 10 > 0 ? padT - 10 : 2);
}

// ── interaction ─────────────────────────────────────────────────────────────

/**
 * Convert a pointer x (client coords) to a clock value, for scrub-on-chart.
 * Returns null outside the plot area so a tap on the axis doesn't jump the
 * playhead to the start of the flight.
 */
export function clockAtClientX(canvas, clientX, g, domain) {
  if (!g) return null;
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  if (x < g.plotL - 8 || x > g.plotR + 8) return null;
  const f = (x - g.plotL) / g.plotW;
  return domain.start + Math.min(1, Math.max(0, f)) * domain.span;
}

/** 1, 2, 5, 10, 20, 50… — a round gridline step for the given range. */
function niceStep(range) {
  const target = range / 4.5;
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(1, target))));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (mag * m >= target) return mag * m;
  }
  return mag * 10;
}
