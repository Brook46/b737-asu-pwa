// metrics.js — turns a bag of GPS fixes into flight dynamics.
//
// Everything the app colours, charts, flags or exports comes from here. Two
// principles keep the numbers honest:
//
//   1. **Time-based windows, never index-based.** Loggers record at 1 s, 2 s,
//      4 s or irregularly when the GPS stutters. A "5-sample" average would
//      silently mean 5 s on one file and 20 s on another.
//   2. **Least-squares slope, not first-difference, for vario.** Barometric
//      altitude is quantised to 1 m, so a raw difference over a 1 s fix
//      interval yields ±1 m/s of pure quantisation noise. A regression over a
//      window is what a real vario's filter approximates.

/** Metres per degree of latitude — good to ~0.1% anywhere. */
const M_PER_DEG = 111320;

const VARIO_WIN = 3.0;    // ± seconds, instantaneous vario
const SMOOTH_WIN = 5.0;   // ± seconds, "sustained" vario (≈10 s span)
const HEADING_GAP = 2.0;  // seconds of separation for a stable bearing
const GLIDE_WIN = 7.5;    // ± seconds for glide ratio

// Flight-state thresholds. Deliberately conservative: a paraglider in still air
// sinks at ~1.1 m/s, so "climbing" means climbing relative to nothing, and
// "turning" starts well above GPS heading jitter.
export const CLIMB_MS = 0.3;      // m/s of sustained climb ⇒ in lift
export const TURN_DPS = 6;        // deg/s ⇒ actually turning, not drifting

/**
 * Fill in vario / heading / turnRate / speed / glide for every fix, choose the
 * altitude channel, and compute the track metrics. Mutates and returns `track`.
 * @param {import('../types').FlightTrack} track
 */
export function analyse(track) {
  const pts = track.points;
  const n = pts.length;
  if (n < 2) { track.metrics = emptyMetrics(); return track; }

  // ── relative clock ────────────────────────────────────────────────────────
  const t0 = pts[0].timestamp;
  const secs = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    secs[i] = (pts[i].timestamp - t0) / 1000;
    pts[i].t = secs[i];
  }

  // ── altitude channel ──────────────────────────────────────────────────────
  // Prefer barometric (immune to GPS vertical wander), but fall back to GPS
  // when the logger left the baro field at 0 or flat-lined it.
  track.altSource = pickAltSource(pts);
  const alt = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    alt[i] = track.altSource === 'pressure' ? pts[i].pressureAlt : pts[i].gpsAlt;
  }

  // ── vario (two timescales) ────────────────────────────────────────────────
  const vario = slopeSeries(secs, alt, VARIO_WIN);
  const varioSm = slopeSeries(secs, alt, SMOOTH_WIN);

  // ── heading, turn rate, speed ─────────────────────────────────────────────
  const heading = new Float64Array(n);
  const speed = new Float64Array(n);
  const cosLat = Math.cos(pts[0].lat * Math.PI / 180);

  for (let i = 0; i < n; i++) {
    // Widen the bearing baseline to ≥HEADING_GAP seconds each way.
    let a = i, b = i;
    while (a > 0 && secs[i] - secs[a] < HEADING_GAP) a--;
    while (b < n - 1 && secs[b] - secs[i] < HEADING_GAP) b++;
    if (a === b) { heading[i] = i > 0 ? heading[i - 1] : 0; speed[i] = 0; continue; }

    const dx = (pts[b].lng - pts[a].lng) * M_PER_DEG * cosLat;
    const dy = (pts[b].lat - pts[a].lat) * M_PER_DEG;
    heading[i] = dx === 0 && dy === 0
      ? (i > 0 ? heading[i - 1] : 0)
      : (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;

    const dt = secs[b] - secs[a];
    speed[i] = dt > 0 ? Math.hypot(dx, dy) / dt : 0;
  }

  // Turn rate from the *unwrapped* heading difference across the same baseline.
  const turnRaw = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let a = i, b = i;
    while (a > 0 && secs[i] - secs[a] < HEADING_GAP) a--;
    while (b < n - 1 && secs[b] - secs[i] < HEADING_GAP) b++;
    const dt = secs[b] - secs[a];
    turnRaw[i] = dt > 0 ? angleDiff(heading[b], heading[a]) / dt : 0;
  }
  const turnRate = boxSmooth(secs, turnRaw, 3.0);

  // ── glide ratio ───────────────────────────────────────────────────────────
  const glide = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let a = i, b = i;
    while (a > 0 && secs[i] - secs[a] < GLIDE_WIN) a--;
    while (b < n - 1 && secs[b] - secs[i] < GLIDE_WIN) b++;
    const drop = alt[a] - alt[b];
    if (drop <= 1) { glide[i] = 0; continue; }   // climbing or level: L/D undefined
    let horiz = 0;
    for (let k = a; k < b; k++) horiz += distance(pts[k], pts[k + 1]);
    glide[i] = clamp(horiz / drop, 0, 60);
  }

  // ── commit to the points ──────────────────────────────────────────────────
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    p.vario = round2(vario[i]);
    p.heading = Math.round(heading[i] * 10) / 10;
    p.turnRate = round2(turnRate[i]);
    p.speed = round2(speed[i]);
    p.glide = Math.round(glide[i] * 10) / 10;
  }

  // Keep the smoothed series alongside the track: segmentation, highlights and
  // the charts all want "sustained" values, and recomputing them is wasteful.
  track._derived = { secs, alt, varioSm, speed, turnRate };
  track.metrics = computeMetrics(track);
  return track;
}

/**
 * Barometric altitude is preferred, but only when it's actually populated.
 * A logger that writes 00000 in the baro field, or one whose baro never moves
 * while the GPS climbs 800 m, must fall back to GPS.
 */
function pickAltSource(pts) {
  let nonZero = 0, pMin = Infinity, pMax = -Infinity, gMin = Infinity, gMax = -Infinity;
  for (const p of pts) {
    if (p.pressureAlt !== 0) nonZero++;
    if (p.pressureAlt < pMin) pMin = p.pressureAlt;
    if (p.pressureAlt > pMax) pMax = p.pressureAlt;
    if (p.gpsAlt < gMin) gMin = p.gpsAlt;
    if (p.gpsAlt > gMax) gMax = p.gpsAlt;
  }
  const pRange = pMax - pMin, gRange = gMax - gMin;
  if (nonZero < pts.length * 0.5) return 'gps';
  if (pRange < 20 && gRange > 50) return 'gps';
  return 'pressure';
}

// ── track-level metrics ─────────────────────────────────────────────────────

/** @param {import('../types').FlightTrack} track */
export function computeMetrics(track) {
  const pts = track.points;
  const n = pts.length;
  const { secs, alt, varioSm, speed, turnRate } = track._derived;

  let maxAlt = -Infinity, minAlt = Infinity, maxClimb = -Infinity, maxSink = Infinity;
  let maxSpeed = 0, dist = 0, speedTime = 0, speedSum = 0;
  let leftTime = 0, rightTime = 0;

  for (let i = 0; i < n; i++) {
    if (alt[i] > maxAlt) maxAlt = alt[i];
    if (alt[i] < minAlt) minAlt = alt[i];
    if (varioSm[i] > maxClimb) maxClimb = varioSm[i];
    if (varioSm[i] < maxSink) maxSink = varioSm[i];
    if (speed[i] > maxSpeed) maxSpeed = speed[i];

    if (i < n - 1) {
      dist += distance(pts[i], pts[i + 1]);
      const dt = secs[i + 1] - secs[i];
      // Ignore the gaps where the logger lost signal for minutes.
      if (dt > 0 && dt < 60) {
        speedSum += speed[i] * dt;
        speedTime += dt;
        if (turnRate[i] > TURN_DPS) rightTime += dt;
        else if (turnRate[i] < -TURN_DPS) leftTime += dt;
      }
    }
  }

  const turning = leftTime + rightTime;
  const segs = segmentFlight(track);
  const totalClimb = segs.thermals.reduce((s, th) => s + th.gain, 0);
  const bestGlide = segs.glides.reduce((m, g) => Math.max(m, g.glideRatio), 0);

  const minAgl = track.hasTerrain ? lowestAglInFlight(track) : undefined;

  return {
    // ── spec fields ──
    maxAlt: Math.round(maxAlt),
    maxClimb: round2(Math.max(0, maxClimb)),
    turnBias: {
      leftPercent: turning ? Math.round(leftTime / turning * 100) : 0,
      rightPercent: turning ? Math.round(rightTime / turning * 100) : 0,
    },
    totalDistance: Math.round(dist),
    // ── extras ──
    minAlt: Math.round(minAlt),
    maxSink: round2(Math.min(0, maxSink)),
    duration: Math.round(secs[n - 1]),
    maxSpeed: round2(maxSpeed),
    avgSpeed: speedTime ? round2(speedSum / speedTime) : 0,
    straightDistance: Math.round(distance(pts[0], pts[n - 1])),
    totalClimb: Math.round(totalClimb),
    thermalCount: segs.thermals.length,
    bestGlide: Math.round(bestGlide * 10) / 10,
    minAgl: minAgl === undefined ? undefined : Math.round(minAgl),
    launchAlt: Math.round(alt[launchIndex(track)]),
  };
}

function emptyMetrics() {
  return {
    maxAlt: 0, maxClimb: 0, turnBias: { leftPercent: 0, rightPercent: 0 }, totalDistance: 0,
    minAlt: 0, maxSink: 0, duration: 0, maxSpeed: 0, avgSpeed: 0, straightDistance: 0,
    totalClimb: 0, thermalCount: 0, bestGlide: 0, launchAlt: 0,
  };
}

/**
 * Height above ground that counts as "off the hill and not yet landing".
 *
 * The DEM is 90 m data: while ridge soaring, the cell you are beside contains
 * the ridge itself, so a pilot happily working the lift 40 m out from the face
 * reads as 0 m AGL. And every completed flight ends at 0 m AGL by definition —
 * that's what landing is. Reporting either as "lowest AGL" is noise, so the
 * statistic is measured only between the first and last time the pilot was
 * genuinely clear of the ground.
 */
const AGL_CLEAR_M = 200;

/**
 * Lowest height above ground during free flight — the number that says how
 * close the pilot came to walking home. Returns undefined for a sled ride that
 * never got clear of the hill, because there's nothing meaningful to report.
 */
export function lowestAglInFlight(track) {
  const pts = track.points;
  const n = pts.length;
  const from = launchIndex(track);

  let start = -1, end = -1;
  for (let i = from; i < n; i++) {
    if ((pts[i].agl ?? 0) > AGL_CLEAR_M) { start = i; break; }
  }
  for (let i = n - 1; i > start; i--) {
    if ((pts[i].agl ?? 0) > AGL_CLEAR_M) { end = i; break; }
  }
  if (start < 0 || end <= start) return undefined;

  let min = Infinity;
  for (let i = start; i <= end; i++) {
    const a = pts[i].agl;
    if (typeof a === 'number' && a < min) min = a;
  }
  return Number.isFinite(min) ? min : undefined;
}

/**
 * First fix that is plausibly airborne: ground speed over 2.5 m/s sustained for
 * 10 s. Loggers are often switched on minutes before launch while the pilot
 * lays out the wing, and that ground time would otherwise dominate "lowest AGL".
 */
export function launchIndex(track) {
  if (track._launchIdx !== undefined) return track._launchIdx;
  const { secs, speed } = track._derived;
  const n = speed.length;
  let runStart = -1;
  for (let i = 0; i < n; i++) {
    if (speed[i] > 2.5) {
      if (runStart < 0) runStart = i;
      if (secs[i] - secs[runStart] >= 10) { track._launchIdx = runStart; return runStart; }
    } else {
      runStart = -1;
    }
  }
  track._launchIdx = 0;
  return 0;
}

// ── flight-phase segmentation ───────────────────────────────────────────────

/**
 * Split the flight into thermals and glides. Shared by highlights.js and the
 * stats card, and cached on the track because it walks the whole series.
 *
 * A thermal is a run of sustained climb, allowing short interruptions (you lose
 * the core for a few seconds without leaving the thermal). A glide is a run of
 * not-turning, not-climbing flight.
 *
 * @returns {{thermals:Array, glides:Array}}
 */
export function segmentFlight(track) {
  if (track._segs) return track._segs;

  const pts = track.points;
  const { secs, alt, varioSm, speed, turnRate } = track._derived;
  const n = pts.length;

  const thermals = [];
  const glides = [];

  // — thermals: climbing runs, bridged across ≤8 s of lost core —
  let s = -1, lastGood = -1;
  const closeThermal = (end) => {
    if (s < 0) return;
    const dur = secs[end] - secs[s];
    const gain = alt[end] - alt[s];
    if (dur >= 20 && gain >= 30) {
      let best = -Infinity, bestIdx = s;
      for (let i = s; i <= end; i++) if (varioSm[i] > best) { best = varioSm[i]; bestIdx = i; }
      thermals.push({
        startIdx: s, endIdx: end, peakIdx: bestIdx,
        startTime: pts[s].timestamp, endTime: pts[end].timestamp,
        duration: dur, gain,
        avgClimb: dur > 0 ? gain / dur : 0,
        maxClimb: best,
        entryAlt: alt[s], exitAlt: alt[end],
        turnDir: meanTurn(turnRate, s, end) >= 0 ? 'right' : 'left',
      });
    }
    s = -1; lastGood = -1;
  };

  for (let i = 0; i < n; i++) {
    if (varioSm[i] > CLIMB_MS) {
      if (s < 0) s = i;
      lastGood = i;
    } else if (s >= 0 && secs[i] - secs[lastGood] > 8) {
      closeThermal(lastGood);
    }
  }
  if (s >= 0) closeThermal(lastGood >= 0 ? lastGood : n - 1);

  // — glides: straight, non-climbing runs —
  s = -1;
  const closeGlide = (end) => {
    if (s < 0) return;
    const dur = secs[end] - secs[s];
    let horiz = 0;
    for (let k = s; k < end; k++) horiz += distance(pts[k], pts[k + 1]);
    const drop = alt[s] - alt[end];
    if (dur >= 30 && horiz >= 500) {
      let fastest = 0, fastIdx = s;
      for (let i = s; i <= end; i++) if (speed[i] > fastest) { fastest = speed[i]; fastIdx = i; }
      glides.push({
        startIdx: s, endIdx: end, fastIdx,
        startTime: pts[s].timestamp, endTime: pts[end].timestamp,
        duration: dur, distance: horiz, drop,
        glideRatio: drop > 5 ? clamp(horiz / drop, 0, 60) : 0,
        avgSpeed: dur > 0 ? horiz / dur : 0,
        maxSpeed: fastest,
      });
    }
    s = -1;
  };

  for (let i = 0; i < n; i++) {
    const straight = Math.abs(turnRate[i]) < TURN_DPS && varioSm[i] < CLIMB_MS;
    if (straight) { if (s < 0) s = i; }
    else if (s >= 0) closeGlide(i - 1 > s ? i - 1 : s);
  }
  if (s >= 0 && s < n - 1) closeGlide(n - 1);

  track._segs = { thermals, glides };
  return track._segs;
}

function meanTurn(turnRate, a, b) {
  let sum = 0;
  for (let i = a; i <= b; i++) sum += turnRate[i];
  return sum / Math.max(1, b - a + 1);
}

// ── numeric helpers ─────────────────────────────────────────────────────────

/**
 * Least-squares slope of `y` against `x` over a ±`win`-second window at every
 * index. Two-pointer window walk keeps it linear in practice.
 */
function slopeSeries(x, y, win) {
  const n = x.length;
  const out = new Float64Array(n);
  let a = 0, b = 0;
  for (let i = 0; i < n; i++) {
    while (a < i && x[i] - x[a] > win) a++;
    while (b < n - 1 && x[b + 1] - x[i] <= win) b++;
    const m = b - a + 1;
    if (m < 2) { out[i] = 0; continue; }
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let k = a; k <= b; k++) { sx += x[k]; sy += y[k]; sxx += x[k] * x[k]; sxy += x[k] * y[k]; }
    const den = m * sxx - sx * sx;
    out[i] = Math.abs(den) < 1e-9 ? 0 : (m * sxy - sx * sy) / den;
  }
  return out;
}

/** Centred moving average over a ±`win`-second window. */
function boxSmooth(x, y, win) {
  const n = x.length;
  const out = new Float64Array(n);
  let a = 0, b = 0, sum = 0;
  for (let i = 0; i < n; i++) {
    while (b < n && x[b] - x[i] <= win) { sum += y[b]; b++; }
    while (x[i] - x[a] > win) { sum -= y[a]; a++; }
    out[i] = (b - a) > 0 ? sum / (b - a) : y[i];
  }
  return out;
}

/** Shortest signed angular difference b→a, in (−180, 180]. */
export function angleDiff(a, b) {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

/** Great-circle distance in metres (haversine). */
export function distance(p1, p2) {
  const R = 6371008.8;
  const φ1 = p1.lat * Math.PI / 180, φ2 = p2.lat * Math.PI / 180;
  const dφ = φ2 - φ1;
  const dλ = (p2.lng - p1.lng) * Math.PI / 180;
  const s = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const round2 = (v) => Math.round(v * 100) / 100;

/**
 * Interpolate a track position at an arbitrary epoch-ms time. Returns null
 * outside the track's span so the renderer can hide the marker. Used by the
 * playback engine every frame, so it takes a hint index to avoid re-searching.
 */
export function sampleAt(track, timeMs, hint = 0) {
  const pts = track.points;
  const n = pts.length;
  if (!n || timeMs < pts[0].timestamp || timeMs > pts[n - 1].timestamp) return null;

  let i = hint >= 0 && hint < n ? hint : 0;
  // Walk from the hint (playback is monotonic), else binary search.
  if (pts[i].timestamp <= timeMs && (i === n - 1 || pts[i + 1].timestamp >= timeMs)) {
    // hint is already the bracketing index
  } else if (pts[i].timestamp <= timeMs && i + 8 < n && pts[i + 8].timestamp >= timeMs) {
    while (i < n - 1 && pts[i + 1].timestamp < timeMs) i++;
  } else {
    let lo = 0, hi = n - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (pts[mid].timestamp <= timeMs) lo = mid; else hi = mid;
    }
    i = lo;
  }

  const p = pts[i], q = pts[Math.min(i + 1, n - 1)];
  const span = q.timestamp - p.timestamp;
  const f = span > 0 ? (timeMs - p.timestamp) / span : 0;
  const alt = (a) => a === 'pressure' ? 'pressureAlt' : 'gpsAlt';
  const key = alt(track.altSource);

  return {
    index: i,
    lat: p.lat + (q.lat - p.lat) * f,
    lng: p.lng + (q.lng - p.lng) * f,
    alt: p[key] + (q[key] - p[key]) * f,
    vario: p.vario + (q.vario - p.vario) * f,
    speed: (p.speed || 0) + ((q.speed || 0) - (p.speed || 0)) * f,
    glide: p.glide || 0,
    turnRate: p.turnRate,
    // Interpolate the *short way* round the compass, or the avatar spins 359°.
    heading: (p.heading + angleDiff(q.heading, p.heading) * f + 360) % 360,
    agl: typeof p.agl === 'number' ? p.agl + ((q.agl || 0) - p.agl) * f : undefined,
    groundAlt: p.groundAlt,
    timestamp: timeMs,
  };
}
