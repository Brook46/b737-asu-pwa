// insights.js — the debrief questions a pilot actually asks.
//
// metrics.js answers "what happened". This answers "was that any good, and
// what should I do differently":
//
//   • what the day was worth      — average climb across everyone who flew it
//   • where the lift was          — climb rate banded by altitude
//   • how the transitions went    — the glide between one thermal and the next
//   • how the time was spent      — climbing vs gliding, left vs right
//   • how the pilots compare      — head-to-head, and a graded scorecard
//
// A word on grading: it is a heuristic, and it says so in the UI. Scores are
// anchored to absolute thresholds drawn from ordinary XC paragliding (so a
// single flight can still be graded), and then, when more than one pilot flew
// the same day, the climb score is re-based against the best climb actually
// achieved that day — because 1.2 m/s is a poor climb in Spain in June and a
// very good one in Wales in October, and only the other pilots know which.

import { segmentFlight, distance, launchIndex, CLIMB_MS } from './metrics.js';

/** Altitude bucket for the climb-by-height analysis, metres. */
const BAND_M = 250;
/** Gaps longer than this are a logger dropout, not flight time. */
const MAX_GAP_S = 60;

/**
 * A glide ratio needs a real height band under it to mean anything. A leg that
 * drifts 1.9 km while losing 16 m computes to 118:1 — which is not glide
 * performance, it's a pilot who found lift on the way. Below this drop the leg
 * is reported as "level" instead, and it can never win "best glide".
 */
const MIN_RATED_DROP_M = 50;
/** Stricter still for the headline best-glide figure: a real transition. */
const BEST_GLIDE_DROP_M = 100;
const BEST_GLIDE_DIST_M = 2000;

// ── per-pilot ───────────────────────────────────────────────────────────────

/**
 * Everything derived for one flight.
 * @param {import('../types').FlightTrack} track
 */
export function pilotInsights(track) {
  if (!track || !track._derived) return null;
  if (track._insights) return track._insights;

  const { thermals } = segmentFlight(track);
  const transitions = findTransitions(track, thermals);

  const out = {
    timeSplit: timeSplit(track, thermals, transitions),
    climbBands: climbByBand(track),
    thermalStats: thermalStats(track, thermals),
    transitionStats: transitionStats(transitions),
    transitions,
    thermals,
    openDistance: openDistance(track),
    kind: flightKind(track),
    xcSpeed: xcSpeedOf(track),
    cloudbase: cloudbaseEstimate(thermals),
  };
  out.bestBand = out.climbBands.reduce(
    (best, b) => (b.climbSec >= 60 && (!best || b.avgClimb > best.avgClimb) ? b : best), null);

  track._insights = out;
  return out;
}

/**
 * A transition is the glide from the top of one thermal to the bottom of the
 * next — the decision that actually costs or wins height. This is deliberately
 * NOT the same as metrics.segmentFlight()'s glides, which split whenever the
 * pilot turns: a transition survives the odd 360 to check a bubble on the way.
 */
function findTransitions(track, thermals) {
  const pts = track.points;
  const { secs, alt, speed } = track._derived;
  const n = pts.length;
  const out = [];

  /** Measure one stretch; returns null if it's too short to be a glide. */
  const leg = (a, b, kind, prevThermal) => {
    if (b <= a) return null;
    const dur = secs[b] - secs[a];
    if (dur < 20) return null;             // back-to-back climbs, not a glide

    let horiz = 0, fastest = 0;
    for (let i = a; i < b; i++) {
      horiz += distance(pts[i], pts[i + 1]);
      if (speed[i] > fastest) fastest = speed[i];
    }
    // The run out from launch and the run in to landing are only interesting
    // once they're an actual glide, not a few hundred metres off the hill.
    if (kind !== 'thermal' && (horiz < 500 || dur < 60)) return null;

    const lost = alt[a] - alt[b];
    return {
      index: out.length + 1,
      kind,
      startIdx: a, endIdx: b,
      startTime: pts[a].timestamp, endTime: pts[b].timestamp,
      duration: dur,
      distance: horiz,
      heightLost: lost,
      // Null means "no meaningful L/D here" — either the leg ended higher than
      // it started, or it barely came down at all. The UI says which.
      glideRatio: lost >= MIN_RATED_DROP_M ? horiz / lost : null,
      level: lost < MIN_RATED_DROP_M && lost > -10,
      avgSpeed: dur > 0 ? horiz / dur : 0,
      maxSpeed: fastest,
      entryAlt: alt[a],
      exitAlt: alt[b],
      // How much of the previous climb this glide gave back.
      gaveBack: prevThermal && prevThermal.gain > 0
        ? Math.min(1, Math.max(0, lost / prevThermal.gain)) : null,
    };
  };

  const push = (t) => { if (t) { t.index = out.length + 1; out.push(t); } };

  if (thermals.length) {
    // Launch → first climb, then every climb-to-climb glide, then the final
    // glide to landing. All three are decisions a pilot wants to review; only
    // counting the middle ones dumps the rest into "unclassified" time.
    push(leg(launchIdxOf(track), thermals[0].startIdx, 'initial', null));
    for (let k = 0; k < thermals.length - 1; k++) {
      push(leg(thermals[k].endIdx, thermals[k + 1].startIdx, 'thermal', thermals[k]));
    }
    push(leg(thermals[thermals.length - 1].endIdx, n - 1, 'final', thermals[thermals.length - 1]));
  } else {
    push(leg(launchIdxOf(track), n - 1, 'final', null));
  }

  return out;
}

const launchIdxOf = launchIndex;

/** Climbing / gliding / everything else, in seconds and percent. */
function timeSplit(track, thermals, transitions) {
  const { secs } = track._derived;
  const total = secs[secs.length - 1] - secs[0];
  const climbSec = thermals.reduce((s, t) => s + t.duration, 0);
  const glideSec = transitions.reduce((s, t) => s + t.duration, 0);
  const otherSec = Math.max(0, total - climbSec - glideSec);
  const pct = (v) => (total > 0 ? Math.round((v / total) * 100) : 0);

  return {
    totalSec: total,
    climbSec, glideSec, otherSec,
    climbPct: pct(climbSec), glidePct: pct(glideSec), otherPct: pct(otherSec),
  };
}

/**
 * Average climb achieved in each altitude band — the answer to "what height
 * were the good climbs at?". Only time actually spent climbing counts, so a
 * long glide through a band doesn't dilute it.
 */
export function climbByBand(track) {
  const { secs, alt, varioSm } = track._derived;
  const n = alt.length;
  /** @type {Map<number, {climbSec:number, gain:number}>} */
  const bands = new Map();

  for (let i = 0; i < n - 1; i++) {
    if (varioSm[i] <= CLIMB_MS) continue;
    const dt = secs[i + 1] - secs[i];
    if (!(dt > 0) || dt > MAX_GAP_S) continue;
    const key = Math.floor(alt[i] / BAND_M) * BAND_M;
    const rec = bands.get(key) || { climbSec: 0, gain: 0 };
    rec.climbSec += dt;
    rec.gain += Math.max(0, alt[i + 1] - alt[i]);
    bands.set(key, rec);
  }

  return [...bands.entries()]
    .map(([lo, r]) => ({
      lo, hi: lo + BAND_M,
      climbSec: r.climbSec,
      gain: r.gain,
      avgClimb: r.climbSec > 0 ? r.gain / r.climbSec : 0,
    }))
    .sort((a, b) => a.lo - b.lo);
}

function thermalStats(track, thermals) {
  if (!thermals.length) {
    return { count: 0, avgGain: 0, avgClimb: 0, avgDuration: 0, avgEntryAlt: 0, avgExitAlt: 0, consistency: 0, leftCount: 0, rightCount: 0 };
  }
  const mean = (f) => thermals.reduce((s, t) => s + f(t), 0) / thermals.length;
  const climbTime = thermals.reduce((s, t) => s + t.duration, 0);
  const climbGain = thermals.reduce((s, t) => s + t.gain, 0);

  // Consistency: how close the average climb was to the peak. A pilot who
  // centres well converts more of the core into average climb.
  const ratios = thermals.filter((t) => t.maxClimb > 0.2).map((t) => t.avgClimb / t.maxClimb);
  const consistency = ratios.length ? ratios.reduce((s, r) => s + r, 0) / ratios.length : 0;

  return {
    count: thermals.length,
    avgGain: mean((t) => t.gain),
    avgClimb: climbTime > 0 ? climbGain / climbTime : 0,
    avgDuration: mean((t) => t.duration),
    avgEntryAlt: mean((t) => t.entryAlt),
    avgExitAlt: mean((t) => t.exitAlt),
    consistency,
    leftCount: thermals.filter((t) => t.turnDir === 'left').length,
    rightCount: thermals.filter((t) => t.turnDir === 'right').length,
  };
}

function transitionStats(transitions) {
  if (!transitions.length) {
    return { count: 0, avgGlide: 0, bestGlide: 0, avgSpeed: 0, totalDistance: 0, avgHeightLost: 0 };
  }
  // Only a proper transition — real height band, real distance — can claim the
  // best-glide headline.
  const rated = transitions.filter((t) => t.glideRatio !== null
    && t.heightLost >= BEST_GLIDE_DROP_M && t.distance >= BEST_GLIDE_DIST_M);
  const totalDist = transitions.reduce((s, t) => s + t.distance, 0);
  const totalLost = transitions.reduce((s, t) => s + Math.max(0, t.heightLost), 0);
  const totalSec = transitions.reduce((s, t) => s + t.duration, 0);

  return {
    count: transitions.length,
    // Aggregate L/D over all transitions, not a mean of ratios — a mean of
    // ratios lets one short 30:1 hop outweigh five long grinding glides.
    avgGlide: totalLost > 10 ? totalDist / totalLost : 0,
    bestGlide: rated.length ? Math.max(...rated.map((t) => t.glideRatio)) : 0,
    avgSpeed: totalSec > 0 ? totalDist / totalSec : 0,
    totalDistance: totalDist,
    avgHeightLost: totalLost / transitions.length,
  };
}

/** Fixes sampled when computing open distance — 500² pairs is instant. */
const OPEN_DIST_SAMPLES = 500;

/**
 * Open distance: the greatest separation between any two fixes, in flight
 * order. This is the honest measure of how far a pilot actually got.
 *
 * Neither obvious alternative works. Ground-track distance counts every 360, so
 * the pilot who circles most would post the highest "cross-country speed" —
 * exactly backwards. Launch-to-landing straight line collapses an out-and-return
 * to nearly zero: two real 150 km flights in this app's own storage score 28 km
 * that way, because the pilots came home.
 *
 * Full FAI free distance needs three optimised turnpoints and is O(n³). This is
 * the no-turnpoint case, computed on a decimated track — accurate to a few
 * hundred metres, which is far below the resolution anyone reads it at.
 */
export function openDistance(track) {
  if (track._openDist !== undefined) return track._openDist;

  const pts = track.points;
  const stride = Math.max(1, Math.ceil(pts.length / OPEN_DIST_SAMPLES));
  const sample = [];
  for (let i = 0; i < pts.length; i += stride) sample.push(pts[i]);
  sample.push(pts[pts.length - 1]);

  let best = 0;
  for (let i = 0; i < sample.length; i++) {
    for (let j = i + 1; j < sample.length; j++) {
      const d = distance(sample[i], sample[j]);
      if (d > best) best = d;
    }
  }
  track._openDist = best;
  return best;
}

/** Open distance per hour airborne — the speed that means "got somewhere". */
function xcSpeedOf(track) {
  return openDistance(track) / (track.metrics.duration || 1);
}

/**
 * Was this a cross-country attempt or a local soaring day?
 *
 * It matters because grading a ridge-soaring session on speed is meaningless —
 * the pilot never intended to go anywhere, and an "E for speed" would be noise
 * rather than feedback. A flight counts as XC once it covers real ground and
 * spends most of its track going somewhere rather than round in circles.
 */
export function flightKind(track) {
  const open = openDistance(track);
  const trackDist = track.metrics.totalDistance || 1;
  return (open >= 15000 && open / trackDist >= 0.2) ? 'xc' : 'local';
}

/** Where the climbs topped out — the median thermal exit, a fair cloudbase proxy. */
function cloudbaseEstimate(thermals) {
  const tops = thermals.filter((t) => t.gain >= 100).map((t) => t.exitAlt).sort((a, b) => a - b);
  if (!tops.length) return null;
  return tops[Math.floor(tops.length / 2)];
}

// ── the day ─────────────────────────────────────────────────────────────────

/**
 * What the conditions were worth, pooled across every loaded flight. With two
 * or more pilots this is the yardstick the grades are re-based against.
 * @param {import('../types').FlightTrack[]} tracks
 */
export function analyseDay(tracks) {
  const list = (tracks || []).filter((t) => t.visible !== false && t._derived);
  if (!list.length) return null;

  let climbSec = 0, climbGain = 0;
  let best = null;
  let bestPilotClimb = 0;
  const bandMap = new Map();
  const tops = [];

  for (const track of list) {
    const ins = pilotInsights(track);
    if (!ins) continue;

    climbSec += ins.timeSplit.climbSec;
    climbGain += ins.thermals.reduce((s, t) => s + t.gain, 0);
    if (ins.cloudbase !== null) tops.push(ins.cloudbase);
    if (ins.thermalStats.avgClimb > bestPilotClimb) bestPilotClimb = ins.thermalStats.avgClimb;

    for (const th of ins.thermals) {
      if (th.duration < 30) continue;
      if (!best || th.avgClimb > best.avgClimb) {
        best = { avgClimb: th.avgClimb, maxClimb: th.maxClimb, track, thermal: th };
      }
    }

    for (const b of ins.climbBands) {
      const rec = bandMap.get(b.lo) || { climbSec: 0, gain: 0 };
      rec.climbSec += b.climbSec;
      rec.gain += b.gain;
      bandMap.set(b.lo, rec);
    }
  }

  const bands = [...bandMap.entries()]
    .map(([lo, r]) => ({ lo, hi: lo + BAND_M, climbSec: r.climbSec, gain: r.gain, avgClimb: r.climbSec > 0 ? r.gain / r.climbSec : 0 }))
    .sort((a, b) => a.lo - b.lo);

  // Only bands with real time in them can win. The floor scales with the day:
  // crowning a band holding 3% of the climbing would send someone to the wrong
  // height tomorrow on the strength of one lucky core.
  const minBandSec = Math.max(120, climbSec * 0.05);
  const bestBand = bands.reduce(
    (b, x) => (x.climbSec >= minBandSec && (!b || x.avgClimb > b.avgClimb) ? x : b), null);

  // The working band: the middle half of the climbing. A 10–90 range spans
  // nearly the whole flight and says nothing about where the day was won.
  const working = percentileBand(bands, 0.25, 0.75);

  return {
    pilots: list.length,
    date: list[0].date,
    avgClimb: climbSec > 0 ? climbGain / climbSec : 0,
    totalClimbSec: climbSec,
    bestClimb: best,
    /** Best *pilot average* climb — the fair ceiling for grading. */
    bestPilotClimb,
    bands,
    bestBand,
    workingBand: working,
    cloudbase: tops.length ? tops.sort((a, b) => a - b)[Math.floor(tops.length / 2)] : null,
  };
}

/** Altitude range containing the given quantiles of climbing time. */
function percentileBand(bands, loQ, hiQ) {
  const total = bands.reduce((s, b) => s + b.climbSec, 0);
  if (!total) return null;
  let acc = 0, lo = null, hi = null;
  for (const b of bands) {
    const before = acc / total;
    acc += b.climbSec;
    const after = acc / total;
    if (lo === null && after >= loQ) lo = b.lo;
    if (hi === null && after >= hiQ && before < hiQ) hi = b.hi;
  }
  return lo === null ? null : { lo, hi: hi ?? bands[bands.length - 1].hi };
}

// ── grading ─────────────────────────────────────────────────────────────────

/**
 * Piecewise-linear score: walk a list of [value, score] anchors.
 * Anchors are ordinary XC paragliding numbers, not competition numbers.
 */
function scoreFrom(anchors, v) {
  if (!Number.isFinite(v)) return 0;
  if (v <= anchors[0][0]) return anchors[0][1];
  for (let i = 1; i < anchors.length; i++) {
    if (v <= anchors[i][0]) {
      const [x0, y0] = anchors[i - 1], [x1, y1] = anchors[i];
      return y0 + ((v - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return anchors[anchors.length - 1][1];
}

const LETTERS = [
  [93, 'A+'], [87, 'A'], [82, 'B+'], [75, 'B'],
  [68, 'C+'], [60, 'C'], [50, 'D'], [0, 'E'],
];

export function letterFor(score) {
  for (const [min, letter] of LETTERS) if (score >= min) return letter;
  return 'E';
}

/**
 * Grade one flight across five categories.
 *
 * @param {import('../types').FlightTrack} track
 * @param {ReturnType<analyseDay>} [day] pooled day stats; when present and more
 *        than one pilot flew, the climb score is re-based against the best
 *        climb of the day rather than an absolute scale.
 */
export function gradeFlight(track, day) {
  const ins = pilotInsights(track);
  if (!ins) return null;
  const m = track.metrics;

  // 1. Climb — how well the pilot converted the day's lift.
  const avgClimb = ins.thermalStats.avgClimb;
  let climbScore = scoreFrom([[0.4, 30], [1.0, 55], [1.6, 70], [2.4, 84], [3.2, 93], [4.5, 99]], avgClimb);
  let climbBasis = 'absolute';
  if (day && day.pilots > 1 && day.bestPilotClimb > 0.3) {
    // Re-based against the best *pilot average* of the day, not the best single
    // thermal anyone found — nobody averages their best climb, so that yardstick
    // marks down the whole field on a genuinely weak day.
    const share = avgClimb / day.bestPilotClimb;
    climbScore = scoreFrom([[0.55, 35], [0.7, 55], [0.82, 70], [0.92, 84], [1.0, 94]], share);
    climbBasis = 'vs the day';
  }

  // 2. Centring — how much of each core the pilot actually converted.
  const centring = ins.thermalStats.consistency;
  const centringScore = scoreFrom([[0.25, 35], [0.4, 58], [0.52, 74], [0.65, 88], [0.8, 97]], centring);

  // 3. Glide — achieved L/D across all transitions.
  const glide = ins.transitionStats.avgGlide;
  const glideScore = ins.transitionStats.count
    ? scoreFrom([[4, 32], [6, 55], [8, 72], [10, 86], [12, 95]], glide)
    : null;

  // 4. Height management — how much of the flight was spent low. Penalises
  //    scratching near the deck, which is where flights end.
  const heightScore = heightManagement(track, ins, day);

  // 5. Speed — open distance per hour airborne. Only graded on a flight that
  //    was actually going somewhere: marking a ridge-soaring session down for
  //    being slow is noise, not feedback.
  const speedKmh = ins.xcSpeed * 3.6;
  const speedScore = ins.kind === 'xc'
    ? scoreFrom([[4, 30], [8, 52], [13, 68], [19, 84], [27, 95]], speedKmh)
    : NaN;

  const categories = [
    { id: 'climb', label: 'Climb', score: climbScore, basis: climbBasis,
      detail: `${avgClimb.toFixed(1)} m/s average in ${ins.thermalStats.count} thermals` },
    { id: 'centring', label: 'Centring', score: centringScore, basis: 'absolute',
      detail: `${Math.round(centring * 100)}% of peak climb converted` },
    { id: 'glide', label: 'Glide', score: glideScore, basis: 'absolute',
      detail: ins.transitionStats.count
        ? `${glide.toFixed(1)}:1 over ${ins.transitionStats.count} transitions`
        : 'no transitions to judge' },
    { id: 'height', label: 'Height', score: heightScore.score, basis: heightScore.basis,
      detail: heightScore.detail },
    { id: 'speed', label: 'Speed', score: speedScore, basis: 'absolute',
      detail: ins.kind === 'xc'
        ? `${speedKmh.toFixed(1)} km/h over ${(ins.openDistance / 1000).toFixed(0)} km open distance`
        : `local flight — ${(ins.openDistance / 1000).toFixed(0)} km open distance off ${(m.totalDistance / 1000).toFixed(0)} km flown, so speed isn't graded` },
  ];

  const rated = categories.filter((c) => Number.isFinite(c.score));
  const overall = rated.length
    ? rated.reduce((s, c) => s + c.score, 0) / rated.length
    : 0;

  for (const c of categories) c.letter = Number.isFinite(c.score) ? letterFor(c.score) : '—';

  return {
    overall: Math.round(overall),
    letter: letterFor(overall),
    categories,
    // The single most useful sentence: what to work on next.
    advice: adviceFor(categories, ins, day),
  };
}

/**
 * Time spent in the bottom third of the day's working band is the risk that
 * ends flights. Needs the working band, which needs at least one real climb.
 */
function heightManagement(track, ins, day) {
  const { secs, alt } = track._derived;
  const band = (day && day.workingBand) || bandFromTrack(ins);
  if (!band || band.hi <= band.lo) {
    return { score: NaN, basis: 'absolute', detail: 'not enough climbing to judge' };
  }

  // Below the bottom of the working band is "low": that's beneath where the
  // useful climbing was happening, which is where flights get expensive.
  const lowLine = band.lo;
  let lowSec = 0, total = 0;
  for (let i = 0; i < alt.length - 1; i++) {
    const dt = secs[i + 1] - secs[i];
    if (!(dt > 0) || dt > MAX_GAP_S) continue;
    total += dt;
    if (alt[i] < lowLine) lowSec += dt;
  }
  const lowPct = total > 0 ? lowSec / total : 0;
  const score = scoreFrom([[0.05, 96], [0.15, 86], [0.3, 72], [0.45, 56], [0.65, 36], [0.85, 20]], lowPct);

  const aglNote = track.hasTerrain && Number.isFinite(track.metrics.minAgl)
    ? `, lowest ${Math.round(track.metrics.minAgl)} m AGL`
    : '';
  return {
    score,
    basis: day && day.pilots > 1 ? 'vs the day' : 'absolute',
    detail: `${Math.round(lowPct * 100)}% of the flight below ${Math.round(lowLine)} m${aglNote}`,
  };
}

function bandFromTrack(ins) {
  const bands = ins.climbBands.filter((b) => b.climbSec >= 60);
  if (!bands.length) return null;
  return { lo: bands[0].lo, hi: bands[bands.length - 1].hi };
}

const fmtMin = (sec) => `${Math.round(sec / 60)} min`;

/** One actionable sentence, aimed at the weakest rated category. */
function adviceFor(categories, ins, day) {
  const rated = categories.filter((c) => Number.isFinite(c.score));
  if (!rated.length) return '';
  const worst = rated.reduce((a, b) => (b.score < a.score ? b : a));

  switch (worst.id) {
    case 'climb':
      return day && day.bestBand
        ? `Climbs were best between ${day.bestBand.lo} and ${day.bestBand.hi} m — you spent less time working that band than the day allowed.`
        : 'Your average climb was the weak point — be quicker to leave the sub-1 m/s bubbles.';
    case 'centring':
      return `You converted ${Math.round(ins.thermalStats.consistency * 100)}% of each core's peak. Tighten up when the vario drops on one side of the 360.`;
    case 'glide':
      return `Transitions averaged ${ins.transitionStats.avgGlide.toFixed(1)}:1. Check bar use and whether you were pushing into sink instead of tracking the energy lines.`;
    case 'height':
      return `${worst.detail}. Getting low costs far more time than a slow climb does — leave earlier and stay in the top of the band.`;
    case 'speed':
      return `${(ins.openDistance / 1000).toFixed(0)} km open distance in ${fmtMin(ins.timeSplit.totalSec)} — a lot of the day went into circling rather than moving. Take fewer, better climbs and push on.`;
    default:
      return '';
  }
}

// ── competition-style score ─────────────────────────────────────────────────

/**
 * A single 0–100 number weighted the way a league table weights a flight:
 * distance first, then speed, with climb and glide as the craft behind them.
 *
 * This is deliberately a *different question* from the scorecard. The scorecard
 * asks "how well did you fly the day you were given" — a beautifully flown
 * 20 km day can score an A. This asks "how big was the flight", which is what
 * XContest ranks, so the same flight scores low. Both are useful; neither
 * replaces the other.
 *
 * Not the real XContest formula: that is free distance over up to three
 * optimised turnpoints, multiplied by 1.4 for a flat triangle and 1.6 for an
 * FAI triangle. Turnpoint optimisation is O(n³) and triangle classification
 * needs closure rules, so this uses open distance with no multiplier — which
 * understates a triangle, and says so in the UI.
 */
export function xcScore(track) {
  const ins = pilotInsights(track);
  if (!ins) return null;

  const openKm = ins.openDistance / 1000;
  const speedKmh = ins.xcSpeed * 3.6;
  const climb = ins.thermalStats.avgClimb;
  const glide = ins.transitionStats.avgGlide;

  const components = [
    {
      id: 'distance', label: 'Distance', weight: 0.45,
      score: scoreFrom([[3, 8], [10, 26], [30, 50], [60, 72], [100, 88], [150, 96], [250, 100]], openKm),
      detail: `${openKm.toFixed(1)} km open distance`,
    },
    {
      id: 'speed', label: 'Speed', weight: 0.30,
      score: scoreFrom([[2, 8], [6, 30], [11, 52], [17, 72], [24, 88], [34, 98]], speedKmh),
      detail: `${speedKmh.toFixed(1)} km/h over the day`,
    },
    {
      id: 'climb', label: 'Climb', weight: 0.15,
      score: scoreFrom([[0.4, 18], [1.0, 44], [1.6, 62], [2.4, 80], [3.2, 92], [4.5, 99]], climb),
      detail: `${climb.toFixed(1)} m/s average climb`,
    },
    {
      id: 'glide', label: 'Glide', weight: 0.10,
      score: glide > 0
        ? scoreFrom([[4, 18], [6, 44], [8, 62], [10, 80], [12, 92], [14, 98]], glide)
        : 40,
      detail: glide > 0 ? `${glide.toFixed(1)}:1 on transitions` : 'no rated transitions',
    },
  ];

  const total = components.reduce((s, c) => s + c.score * c.weight, 0);

  return {
    score: Math.round(total),
    components,
    openKm,
    /** XContest free-flight points equivalent: km × 1.0, no triangle bonus. */
    freeDistancePoints: Math.round(openKm * 100) / 100,
  };
}

// ── head-to-head ────────────────────────────────────────────────────────────

/** Comparison rows: one metric, every pilot's value, and who won. */
export const COMPARE_ROWS = [
  { id: 'avgClimb', label: 'Average climb', unit: 'm/s', better: 'high',
    get: (t) => pilotInsights(t).thermalStats.avgClimb, fmt: (v) => `${v.toFixed(1)} m/s` },
  { id: 'centring', label: 'Core conversion', unit: '%', better: 'high',
    get: (t) => pilotInsights(t).thermalStats.consistency * 100, fmt: (v) => `${Math.round(v)}%` },
  { id: 'thermalGain', label: 'Avg gain per climb', unit: 'm', better: 'high',
    get: (t) => pilotInsights(t).thermalStats.avgGain, fmt: (v) => `${Math.round(v)} m` },
  { id: 'glide', label: 'Transition glide', unit: ':1', better: 'high',
    get: (t) => pilotInsights(t).transitionStats.avgGlide, fmt: (v) => (v > 0 ? `${v.toFixed(1)}:1` : '—') },
  { id: 'transDist', label: 'Distance on glide', unit: 'km', better: 'high',
    get: (t) => pilotInsights(t).transitionStats.totalDistance / 1000, fmt: (v) => `${v.toFixed(1)} km` },
  { id: 'xcScore', label: 'XC score', unit: '', better: 'high',
    get: (t) => xcScore(t).score, fmt: (v) => `${Math.round(v)}/100` },
  { id: 'openDist', label: 'Open distance', unit: 'km', better: 'high',
    get: (t) => pilotInsights(t).openDistance / 1000, fmt: (v) => `${v.toFixed(1)} km` },
  { id: 'xcSpeed', label: 'XC speed', unit: 'km/h', better: 'high',
    get: (t) => pilotInsights(t).xcSpeed * 3.6, fmt: (v) => `${v.toFixed(1)} km/h` },
  // No winner: circling less is only better if you kept the height. A pilot who
  // sank out early would otherwise "win" this row.
  { id: 'climbPct', label: 'Time climbing', unit: '%', better: 'none',
    get: (t) => pilotInsights(t).timeSplit.climbPct, fmt: (v) => `${Math.round(v)}%` },
  { id: 'cloudbase', label: 'Climbs topped at', unit: 'm', better: 'high',
    get: (t) => pilotInsights(t).cloudbase ?? NaN, fmt: (v) => (Number.isFinite(v) ? `${Math.round(v)} m` : '—') },
];

/**
 * @returns {{row:object, values:number[], display:string[], bestIdx:number}[]}
 */
export function compareTracks(tracks) {
  const list = tracks.filter((t) => t.visible !== false && t._derived);
  return COMPARE_ROWS.map((row) => {
    const values = list.map((t) => {
      try { return row.get(t); } catch { return NaN; }
    });
    let bestIdx = -1, bestV = row.better === 'high' ? -Infinity : Infinity;
    if (row.better !== 'none') {
      values.forEach((v, i) => {
        if (!Number.isFinite(v) || v === 0) return;
        if (row.better === 'high' ? v > bestV : v < bestV) { bestV = v; bestIdx = i; }
      });
    }
    return {
      row,
      values,
      display: values.map((v) => (Number.isFinite(v) ? row.fmt(v) : '—')),
      bestIdx: list.length > 1 ? bestIdx : -1,
    };
  });
}

/** Drop memoised insights when the underlying analysis changes. */
export function invalidate(track) {
  delete track._insights;
  delete track._openDist;
}
