// xctsk.js — competition tasks from XCTrack / XContest.
//
// The one XContest API that is unambiguously usable: tools.xcontest.org serves
// the XCTSK task store with `access-control-allow-origin: *`, needs no key, and
// has no robots.txt restricting it. So this talks to it directly from the
// browser — no Worker, no proxy, no account.
//
//   GET /api/xctsk/load/<task code>   the task a comp organiser published
//
// XCTSK carries the *course*, never a flight: turnpoint cylinders, start gates,
// ESS and goal. Pairing it with the loaded IGC tracks is what turns "here is my
// flight" into "here is my flight against the task everybody flew".
//
// Format: https://xctrack.org/Competition_Interfaces.html

import { distance, launchIndex } from './metrics.js';

const API = 'https://tools.xcontest.org/api/xctsk';
const TIMEOUT_MS = 15000;

/** Task codes are short alphabetic strings; hashes are hex. */
const CODE_RE = /^[A-Za-z0-9]{3,24}$/;

// ── loading ─────────────────────────────────────────────────────────────────

/**
 * Fetch and normalise a task by its code (or permanent hash).
 * @param {string} code
 * @returns {Promise<object>} normalised task
 */
export async function loadTask(code) {
  const clean = String(code || '').trim().replace(/^#/, '');
  if (!CODE_RE.test(clean)) {
    throw new Error('A task code is 4 letters (or a longer task hash).');
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${API}/load/${encodeURIComponent(clean)}`, {
      headers: { accept: 'application/json' },
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    throw new Error(err.name === 'AbortError'
      ? 'The task server timed out.'
      : `Could not reach the task server: ${err.message}`);
  }
  clearTimeout(timer);

  if (res.status === 404) throw new Error(`No task found for “${clean}”. Codes expire after a month — ask for the task hash instead.`);
  if (!res.ok) throw new Error(`Task server returned ${res.status}.`);

  let json;
  try { json = await res.json(); }
  catch { throw new Error('The task server sent something that is not a task.'); }

  const task = normaliseTask(json);
  task.code = clean;
  // These headers are how you recover a code from a hash, and who published it.
  task.author = res.headers.get('Author') || '';
  task.hash = res.headers.get('Task-Hash') || '';
  return task;
}

/**
 * Flatten the XCTSK document into the shape the rest of the app wants.
 *
 * The spec's structural rules are applied here rather than at every use site:
 * TAKEOFF is not a navigation point, SSS and ESS occur exactly once, and the
 * last turnpoint is always goal — including the case where it is also the ESS.
 */
export function normaliseTask(json) {
  if (!json || typeof json !== 'object') throw new Error('Empty task.');
  const tps = Array.isArray(json.turnpoints) ? json.turnpoints : [];
  if (!tps.length) throw new Error('That task has no turnpoints.');

  const points = tps.map((tp, i) => {
    const w = (tp && tp.waypoint) || {};
    const lat = Number(w.lat), lon = Number(w.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new Error(`Turnpoint ${i + 1} has no usable coordinates.`);
    }
    const type = String(tp.type || '').toUpperCase();
    return {
      index: i,
      name: String(w.name || `TP${i + 1}`).slice(0, 24),
      description: String(w.description || '').slice(0, 80),
      lat,
      lon,
      alt: Number(w.altSmoothed) || 0,
      radius: Math.max(1, Number(tp.radius) || 400),
      type,
      isTakeoff: type === 'TAKEOFF' && i === 0,
      isSSS: type === 'SSS',
      isESS: type === 'ESS',
      // The last turnpoint is goal by definition, whatever its type says.
      isGoal: i === tps.length - 1,
    };
  });

  return {
    taskType: String(json.taskType || 'CLASSIC'),
    version: Number(json.version) || 1,
    earthModel: String(json.earthModel || 'WGS84'),
    points,
    /** Points that count for navigation — TAKEOFF is explicitly excluded. */
    nav: points.filter((p) => !p.isTakeoff),
    sss: json.sss ? {
      type: String(json.sss.type || 'RACE'),
      timeGates: Array.isArray(json.sss.timeGates) ? json.sss.timeGates.slice(0, 12) : [],
    } : null,
    goal: json.goal ? {
      type: String(json.goal.type || 'CYLINDER'),
      deadline: String(json.goal.deadline || ''),
      finishAltitude: Number(json.goal.finishAltitude) || 0,
    } : { type: 'CYLINDER', deadline: '', finishAltitude: 0 },
    takeoffWindow: json.takeoff ? {
      open: String(json.takeoff.timeOpen || ''),
      close: String(json.takeoff.timeClose || ''),
    } : null,
  };
}

// ── flying the task ─────────────────────────────────────────────────────────

/**
 * Work out how one pilot flew a task: which cylinders they tagged, when, and
 * what each leg cost them.
 *
 * Tagging is sequential, which is the rule that matters: a cylinder only counts
 * once the previous one has been tagged, so flying through turnpoint 4 on the
 * way to turnpoint 2 doesn't score it. When a cylinder is never entered the
 * task stops there — everything after it is unreachable in a valid task, and
 * reporting later tags would imply a completion that didn't happen.
 *
 * @param {import('../types').FlightTrack} track
 * @param {object} task normalised task
 */
export function analyseTaskFlight(track, task) {
  if (!track || !track._derived || !task || !task.nav.length) return null;
  const pts = track.points;
  const from = launchIndex(track);

  const tags = [];
  let cursor = from;
  let complete = true;

  for (const tp of task.nav) {
    let hit = -1;
    for (let i = cursor; i < pts.length; i++) {
      if (distance(pts[i], { lat: tp.lat, lng: tp.lon }) <= tp.radius) { hit = i; break; }
    }
    if (hit < 0) {
      tags.push({ tp, tagged: false, index: -1, time: null });
      complete = false;
      break;
    }
    tags.push({ tp, tagged: true, index: hit, time: pts[hit].timestamp });
    cursor = hit;
  }

  // Legs between consecutive tagged cylinders: what the pilot actually flew,
  // not the nominal task line.
  const legs = [];
  for (let k = 1; k < tags.length; k++) {
    const a = tags[k - 1], b = tags[k];
    if (!a.tagged || !b.tagged) break;
    let flown = 0;
    for (let i = a.index; i < b.index; i++) flown += distance(pts[i], pts[i + 1]);
    const secs = (b.time - a.time) / 1000;
    legs.push({
      from: a.tp, to: b.tp,
      startTime: a.time, endTime: b.time,
      duration: secs,
      flown,
      direct: distance(pts[a.index], pts[b.index]),
      speed: secs > 0 ? flown / secs : 0,
      // How much further than the straight line — the cost of the line chosen.
      detour: flown > 0 ? flown / Math.max(1, distance(pts[a.index], pts[b.index])) : 1,
    });
  }

  const sssTag = tags.find((t) => t.tagged && t.tp.isSSS);
  const essTag = tags.find((t) => t.tagged && t.tp.isESS);
  const goalTag = tags.find((t) => t.tagged && t.tp.isGoal);

  // Race time is SSS → ESS. Falling back to goal covers tasks whose last
  // turnpoint is the ESS, where the two are the same cylinder.
  const raceEnd = essTag || goalTag;
  const taskTime = sssTag && raceEnd ? (raceEnd.time - sssTag.time) / 1000 : null;

  let taskFlown = 0;
  if (sssTag && raceEnd) {
    for (let i = sssTag.index; i < raceEnd.index; i++) taskFlown += distance(pts[i], pts[i + 1]);
  }

  return {
    tags,
    legs,
    complete,
    tagged: tags.filter((t) => t.tagged).length,
    total: task.nav.length,
    inGoal: !!goalTag,
    startTime: sssTag ? sssTag.time : null,
    endTime: raceEnd ? raceEnd.time : null,
    taskTime,
    taskFlown,
    /** Ground covered per hour between start and ESS — the comp speed. */
    taskSpeed: taskTime && taskTime > 0 ? taskFlown / taskTime : 0,
  };
}

/**
 * Nominal task distance: centre to centre, less both radii, along the course.
 *
 * Labelled "nominal" wherever it is shown because it is NOT the optimised
 * distance a scoring server computes — real optimisation picks the best point
 * on each cylinder, which is a route-optimisation problem over the whole task.
 * This is the standard quick approximation and runs a little long on tasks with
 * big cylinders.
 */
export function nominalDistance(task) {
  const nav = task.nav;
  let sum = 0;
  for (let i = 1; i < nav.length; i++) {
    const a = nav[i - 1], b = nav[i];
    const d = distance({ lat: a.lat, lng: a.lon }, { lat: b.lat, lng: b.lon });
    sum += Math.max(0, d - a.radius - b.radius);
  }
  return sum;
}

/** A ring of [lng, lat, alt] points approximating a cylinder's circle. */
export function cylinderRing(tp, altitude, segments = 64) {
  const ring = [];
  const latM = 111132.92;
  const lngM = 111412.84 * Math.cos(tp.lat * Math.PI / 180);
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    ring.push([
      tp.lon + (tp.radius * Math.sin(a)) / lngM,
      tp.lat + (tp.radius * Math.cos(a)) / latM,
      altitude,
    ]);
  }
  return ring;
}

/** Colour per turnpoint role, matching the map and the tables. */
export function roleOf(tp) {
  if (tp.isSSS) return { label: 'Start', rgb: [110, 205, 120] };
  if (tp.isGoal) return { label: 'Goal', rgb: [255, 196, 61] };
  if (tp.isESS) return { label: 'ESS', rgb: [232, 78, 68] };
  if (tp.isTakeoff) return { label: 'Takeoff', rgb: [140, 148, 160] };
  return { label: 'Turnpoint', rgb: [94, 194, 255] };
}
