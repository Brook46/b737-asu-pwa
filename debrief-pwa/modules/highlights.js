// highlights.js — automatic flight-highlight extraction.
//
// The debrief question is "what were the four moments that decided this flight?"
// This module answers it from the segmentation in metrics.js, emitting the four
// event types in the data model:
//
//   BEST_CLIMB  the thermal that actually gained you the day
//   LOW_SAVE    the save — low, scratchy, then away (needs terrain for AGL)
//   FAST_GLIDE  the longest glide line, and the peak-speed moment
//   HEAVY_SINK  the steepest sustained sink, and the roughest air
//
// Every highlight carries a span (startTime/endTime) as well as a peak instant,
// because the export engine cuts video clips from these and a single timestamp
// isn't a clip.

import { segmentFlight, launchIndex, distance } from './metrics.js';
import { fmtAlt, fmtDist, fmtDuration, fmtGlide, fmtSpeed, fmtAgl } from './format.js';

/** A save is only a save if it started this low, in metres AGL. */
export const LOW_SAVE_AGL = 150;
/** …and only if the pilot then climbed back out by at least this much. */
const LOW_SAVE_GAIN = 100;
/**
 * …and only if they had been genuinely high beforehand. Without this, the fixes
 * just after launch qualify as a "save" on any site where the DEM sits above the
 * logger's barometric altitude — you haven't saved anything, you've taken off.
 */
const LOW_SAVE_PRIOR_HEIGHT = 250;
/** Ignore the first two minutes: still on the hill, not yet a flight to save. */
const LOW_SAVE_MIN_AFTER_LAUNCH = 120;
/** Below this the AGL figure is DEM/baro disagreement, not a reading. */
const LOW_SAVE_FLOOR = 10;
/** Cap on how far a sink episode may be expanded when describing it, seconds. */
const SINK_EPISODE_MAX = 90;
/** Vario standard deviation (m/s) over 20 s that counts as genuinely rough air. */
const TURBULENCE_SD = 1.4;
/** Clip padding either side of an instantaneous peak, seconds. */
const CLIP_PAD = 12;

/**
 * @param {import('../types').FlightTrack} track  already run through analyse()
 * @returns {import('../types').FlightHighlight[]} chronological
 */
export function detectHighlights(track) {
  const pts = track.points;
  if (!pts || pts.length < 10 || !track._derived) return [];

  const { thermals, glides } = segmentFlight(track);
  /** @type {import('../types').FlightHighlight[]} */
  const out = [];

  bestClimb(track, thermals, out);
  lowSave(track, thermals, out);
  fastGlide(track, glides, out);
  heavySink(track, out);
  turbulence(track, out);

  out.sort((a, b) => a.timestamp - b.timestamp);
  return out;
}

// ── BEST_CLIMB ──────────────────────────────────────────────────────────────

/**
 * The best thermal by *average* climb, not peak — a 6 m/s surge for three
 * seconds is a gust, whereas 3 m/s held for four minutes is what wins a day.
 * A 30 s floor keeps a brief bump from beating a real climb.
 */
function bestClimb(track, thermals, out) {
  const real = thermals.filter((th) => th.duration >= 30);
  const pool = real.length ? real : thermals;
  if (!pool.length) return;

  const best = pool.reduce((a, b) => (b.avgClimb > a.avgClimb ? b : a));
  const p = track.points[best.peakIdx];
  out.push({
    timestamp: p.timestamp,
    type: 'BEST_CLIMB',
    description: `Best climb — ${best.avgClimb.toFixed(1)} m/s average for ` +
      `${fmtDuration(best.duration)}, ${fmtAlt(best.gain)} gained ` +
      `(peak ${best.maxClimb.toFixed(1)} m/s, ${best.turnDir}-hand)`,
    value: Math.round(best.avgClimb * 10) / 10,
    index: best.peakIdx,
    startTime: best.startTime,
    endTime: best.endTime,
  });
}

// ── LOW_SAVE ────────────────────────────────────────────────────────────────

/**
 * A thermal entered below LOW_SAVE_AGL that produced a real climb. Needs
 * terrain: without ground elevation there is no AGL, and MSL altitude says
 * nothing about how close you were to landing. Reports the lowest one.
 *
 * The three guards below are what separate a save from a take-off. A save means
 * the pilot *was* high, came down to nearly landing, and climbed back out — so
 * we require prior height, a minimum time since launch, and an AGL reading above
 * the noise floor of DEM-vs-barometer disagreement.
 */
function lowSave(track, thermals, out) {
  if (!track.hasTerrain) return;
  const pts = track.points;
  const from = launchIndex(track);
  const launchTime = pts[from].timestamp;

  // Running maximum AGL, so "was the pilot ever high before this?" is O(1).
  const priorMax = new Float64Array(pts.length);
  let running = 0;
  for (let i = 0; i < pts.length; i++) {
    const agl = typeof pts[i].agl === 'number' ? pts[i].agl : 0;
    if (agl > running) running = agl;
    priorMax[i] = running;
  }

  let best = null;
  for (const th of thermals) {
    if (th.startIdx <= from) continue;              // still on the hill
    if (th.gain < LOW_SAVE_GAIN) continue;
    if (pts[th.startIdx].timestamp - launchTime < LOW_SAVE_MIN_AFTER_LAUNCH * 1000) continue;

    // Lowest AGL in the run-in to the thermal (30 s before entry) and at entry.
    let low = Infinity, lowIdx = th.startIdx;
    const t0 = pts[th.startIdx].timestamp - 30000;
    for (let i = th.startIdx; i >= from && pts[i].timestamp >= t0; i--) {
      const agl = pts[i].agl;
      if (typeof agl === 'number' && agl < low) { low = agl; lowIdx = i; }
    }
    if (!Number.isFinite(low) || low >= LOW_SAVE_AGL || low < LOW_SAVE_FLOOR) continue;
    // Must have been well above this height earlier in the flight.
    if (priorMax[lowIdx] < low + LOW_SAVE_PRIOR_HEIGHT) continue;
    if (!best || low < best.low) best = { low, lowIdx, th };
  }
  if (!best) return;

  out.push({
    timestamp: pts[best.lowIdx].timestamp,
    type: 'LOW_SAVE',
    description: `Low save — down to ${fmtAgl(best.low)} above ground, ` +
      `then climbed ${fmtAlt(best.th.gain)} back out`,
    value: Math.round(best.low),
    index: best.lowIdx,
    startTime: pts[best.lowIdx].timestamp - CLIP_PAD * 1000,
    endTime: best.th.endTime,
  });
}

// ── FAST_GLIDE ──────────────────────────────────────────────────────────────

/**
 * Two distinct things pilots want to see: the longest glide *line* (the
 * decision), and the fastest moment (the bar-pushing). Emitted separately only
 * when they're more than a minute apart, otherwise they're the same story.
 */
function fastGlide(track, glides, out) {
  const pts = track.points;

  let longest = null;
  if (glides.length) longest = glides.reduce((a, b) => (b.distance > a.distance ? b : a));

  if (longest) {
    out.push({
      timestamp: pts[longest.fastIdx].timestamp,
      type: 'FAST_GLIDE',
      description: `Longest glide — ${fmtDist(longest.distance)} at ` +
        `${fmtGlide(longest.glideRatio)}, averaging ${fmtSpeed(longest.avgSpeed)} ` +
        `for ${fmtDuration(longest.duration)}`,
      value: Math.round(longest.distance),
      index: longest.fastIdx,
      startTime: longest.startTime,
      endTime: longest.endTime,
    });
  }

  // Peak speed over the whole flight.
  const { speed } = track._derived;
  let peak = 0, peakIdx = -1;
  const from = launchIndex(track);
  for (let i = from; i < speed.length; i++) if (speed[i] > peak) { peak = speed[i]; peakIdx = i; }
  if (peakIdx < 0 || peak < 8) return;    // nothing worth calling "fast"

  const tPeak = pts[peakIdx].timestamp;
  if (longest && Math.abs(tPeak - pts[longest.fastIdx].timestamp) < 60000) return;

  out.push({
    timestamp: tPeak,
    type: 'FAST_GLIDE',
    description: `Top speed — ${fmtSpeed(peak)} over the ground`,
    value: Math.round(peak * 3.6),
    index: peakIdx,
    startTime: tPeak - CLIP_PAD * 1000,
    endTime: tPeak + CLIP_PAD * 1000,
  });
}

// ── HEAVY_SINK ──────────────────────────────────────────────────────────────

/** Steepest sustained sink (10 s averaged, so it's air and not a wing input). */
function heavySink(track, out) {
  const pts = track.points;
  const { varioSm, alt } = track._derived;
  const from = launchIndex(track);

  let worst = 0, worstIdx = -1;
  for (let i = from; i < varioSm.length; i++) {
    if (varioSm[i] < worst) { worst = varioSm[i]; worstIdx = i; }
  }
  // A paraglider's own trim sink is ~1.1 m/s; below −2.5 m/s it's the air.
  if (worstIdx < 0 || worst > -2.5) return;

  // How long the pilot stayed in it, and what it cost in height. The episode is
  // capped at SINK_EPISODE_MAX either side: a long glide is one continuous
  // stretch of sink, and expanding across all of it would let the description
  // claim six minutes of "sustained" heavy sink from one bad patch.
  const { secs } = track._derived;
  let a = worstIdx, b = worstIdx;
  while (a > from && varioSm[a - 1] < -1.5 && secs[worstIdx] - secs[a - 1] <= SINK_EPISODE_MAX) a--;
  while (b < varioSm.length - 1 && varioSm[b + 1] < -1.5 && secs[b + 1] - secs[worstIdx] <= SINK_EPISODE_MAX) b++;
  const lost = alt[a] - alt[b];

  out.push({
    timestamp: pts[worstIdx].timestamp,
    type: 'HEAVY_SINK',
    description: `Heavy sink — ${worst.toFixed(1)} m/s sustained, ` +
      `${fmtAlt(Math.max(0, lost))} lost in ${fmtDuration((pts[b].timestamp - pts[a].timestamp) / 1000)}`,
    value: Math.round(worst * 10) / 10,
    index: worstIdx,
    startTime: pts[a].timestamp,
    endTime: pts[b].timestamp,
  });
}

/**
 * Roughest air: the 20 s window with the highest vario standard deviation.
 * High σ means the wing is being thrown around — that's turbulence, and it's a
 * different (and more useful) signal than a steady strong climb or sink, both
 * of which have low σ. Reported as HEAVY_SINK to stay inside the data model's
 * type union, with the wording carrying the distinction.
 */
function turbulence(track, out) {
  const pts = track.points;
  const { secs } = track._derived;
  const from = launchIndex(track);
  const n = pts.length;

  let worstSd = 0, worstIdx = -1;
  let a = from;
  for (let i = from; i < n; i++) {
    while (secs[i] - secs[a] > 20) a++;
    const m = i - a + 1;
    if (m < 6) continue;
    let sum = 0, sumSq = 0;
    for (let k = a; k <= i; k++) { sum += pts[k].vario; sumSq += pts[k].vario * pts[k].vario; }
    const sd = Math.sqrt(Math.max(0, sumSq / m - (sum / m) ** 2));
    if (sd > worstSd) { worstSd = sd; worstIdx = Math.floor((a + i) / 2); }
  }
  if (worstIdx < 0 || worstSd < TURBULENCE_SD) return;

  // Don't double-report if the steepest sink is already inside this window.
  const t = pts[worstIdx].timestamp;
  if (out.some((h) => h.type === 'HEAVY_SINK' && Math.abs(h.timestamp - t) < 30000)) return;

  out.push({
    timestamp: t,
    type: 'HEAVY_SINK',
    description: `Rough air — vario swinging ±${worstSd.toFixed(1)} m/s over 20 s`,
    value: Math.round(worstSd * 10) / 10,
    index: worstIdx,
    startTime: t - 10000,
    endTime: t + 10000,
  });
}

// ── presentation ────────────────────────────────────────────────────────────

/** Icon + label + CSS class per highlight type, for the list and map pins. */
export const HIGHLIGHT_META = {
  BEST_CLIMB: { label: 'Best climb', icon: '▲', cls: 'hl-climb', rgb: [232, 78, 68] },
  LOW_SAVE: { label: 'Low save', icon: '⚑', cls: 'hl-save', rgb: [255, 196, 61] },
  FAST_GLIDE: { label: 'Fast glide', icon: '➤', cls: 'hl-glide', rgb: [94, 194, 255] },
  HEAVY_SINK: { label: 'Heavy sink', icon: '▼', cls: 'hl-sink', rgb: [163, 122, 255] },
};

/**
 * Rank highlights across every loaded track for the "reel" — one flight's best
 * climb next to another's. Sorted by how remarkable the event is, not by time.
 */
export function rankAcrossTracks(tracks) {
  const weight = { BEST_CLIMB: 1.0, LOW_SAVE: 0.95, FAST_GLIDE: 0.7, HEAVY_SINK: 0.6 };
  const all = [];
  for (const t of tracks) {
    for (const h of t.highlights || []) {
      // LOW_SAVE scores higher the lower it was; everything else, higher = better.
      const mag = h.type === 'LOW_SAVE'
        ? (LOW_SAVE_AGL - (h.value || 0)) / LOW_SAVE_AGL
        : Math.min(1, Math.abs(h.value || 0) / (h.type === 'FAST_GLIDE' ? 20000 : 5));
      all.push({ track: t, highlight: h, score: (weight[h.type] || 0.5) * (0.4 + mag) });
    }
  }
  return all.sort((a, b) => b.score - a.score);
}
