// session.js — a measuring session: the plan, both sides, what's measured, the cursor.

import { walkOrder, mainsFor, keyFor, lineOf, sideOf, parseLineId, isBrakeRiser } from './linemodel.js?v=13';
import { uid } from './store.js?v=13';

/**
 * Where the tape starts. Manufacturer check lengths here are "lines + risers"
 * (riser bottom → canopy). Measuring from the maillons instead removes the riser.
 * Best source: the sheet's own lines-only table (Ozone publishes both, and its
 * risers differ in length — A 529.6, A' 525, B 520 — so one subtraction would be
 * wrong). Otherwise subtract the single stated riser length from A–E lines;
 * brakes run through a pulley, not the riser branches, and are unchanged.
 */
export function canMeasureFromMaillon(size) {
  return !!(size?.linesOnly && Object.keys(size.linesOnly).length)
    || (Number.isFinite(size?.riserMm) && size.riserMm > 0);
}

export function adjustedNominal(published, size, measureFrom) {
  if (measureFrom !== 'maillon' || !canMeasureFromMaillon(size)) return { ...published };
  const out = {};
  for (const [id, mm] of Object.entries(published)) {
    if (size.linesOnly?.[id] != null) out[id] = size.linesOnly[id];
    else out[id] = isBrakeRiser(parseLineId(id).riser) ? mm : mm - size.riserMm;
  }
  return out;
}

export function createSession(wing, sizeKey, opts = {}) {
  const size = wing.sizes[sizeKey];
  const published = { ...size.lines };
  const measureFrom = opts.measureFrom === 'maillon' && canMeasureFromMaillon(size) ? 'maillon' : 'riser';
  const nominal = adjustedNominal(published, size, measureFrom);
  const lineIds = Object.keys(nominal);
  const mains = mainsFor(lineIds, size.mains);
  const orderMode = opts.orderMode || 'rows';
  return {
    v: 3,
    id: uid('sess'),
    createdAt: Date.now(),
    savedAt: null,
    completedAt: null,
    editedAfterComplete: false,
    gliderId: wing.id,
    brand: wing.brand,
    model: wing.model,
    wingClass: wing.wingClass || '',
    sizeKey,
    custom: !!wing.custom,
    source: wing.source?.publisher || wing.source || '',
    tensionKg: wing.method?.tensionKg ?? 5,
    tolIndMm: opts.tolIndMm ?? wing.method?.tolIndMm ?? 10,
    tolGlobalMm: wing.method?.tolGlobalMm ?? 50,
    measureFrom,
    riserMm: size.riserMm ?? null,
    refOffsetMm: opts.refOffsetMm || 0,
    orderMode,
    sides: ['L', 'R'],
    mains,
    cascade: size.cascade || null,   // point -> [middle…, main] where the sheet names it
    risers: size.risers || null,
    serial: opts.serial || '',       // the glider's serial number, as on its label
    owner: opts.owner || '',
    ribs: size.ribs || null,
    loops: size.loops || [],
    published,               // manufacturer check lengths, as printed
    nominal,                 // targets for THIS reference point
    order: walkOrder(lineIds, { mains, order: orderMode, sides: ['L', 'R'], ribs: size.ribs }),
    measured: {},            // "L:A1" -> length mm (raw reading + refOffsetMm)
    sources: {},             // "L:A1" -> 'laser' | 'manual'
    rawByLine: {},           // "L:A1" -> raw device distance, for re-calibration
    cursor: 0,
    queue: null,             // a re-check pass: only these keys, in order
    refMode: 'auto',
    customOffsets: {},
    simOffsets: {},
    done: {},                // action checklist ticks: mainKey -> true
  };
}

/** The keys the pilot is currently walking: a re-check queue, or everything. */
export const walkKeys = s => (s.queue && s.queue.length ? s.queue : s.order);
export const currentKey = s => walkKeys(s)[s.cursor] ?? null;
export const nominalOf = (s, key) => s.nominal[lineOf(key)];

export function rawToLength(session, rawMm) {
  return Math.round(rawMm + (session.refOffsetMm || 0));
}

export function record(session, key, lengthMm, { raw = null, source = 'manual' } = {}) {
  if (session.completedAt && session.measured[key] !== Math.round(lengthMm)) {
    session.editedAfterComplete = true;
  }
  session.measured[key] = Math.round(lengthMm);
  session.sources[key] = source;
  if (raw != null) session.rawByLine[key] = Math.round(raw);
  if (progress(session).done === session.order.length && !session.completedAt) {
    session.completedAt = Date.now();
  }
}

export function clearLine(session, key) {
  delete session.measured[key];
  delete session.sources[key];
  delete session.rawByLine[key];
}

/** Set reference offset from a line whose true length you know. */
export function calibrate(session, trueLengthMm, rawMm) {
  session.refOffsetMm = Math.round(trueLengthMm - rawMm);
  for (const [key, raw] of Object.entries(session.rawByLine)) {
    session.measured[key] = rawToLength(session, raw);
  }
  return session.refOffsetMm;
}

export function progress(session, keys = session.order) {
  const total = keys.length;
  const done = keys.filter(k => session.measured[k] != null).length;
  return { done, total, pct: total ? Math.round(done / total * 100) : 0 };
}

export function move(session, delta) {
  const n = walkKeys(session).length;
  session.cursor = Math.max(0, Math.min(n - 1, session.cursor + delta));
  return currentKey(session);
}

export function goto(session, key) {
  let i = walkKeys(session).indexOf(key);
  if (i === -1 && session.queue) { session.queue = null; i = session.order.indexOf(key); }
  if (i !== -1) session.cursor = i;
  return currentKey(session);
}

/** Start a focused re-check of just these keys (after adjusting a main). */
export function startRecheck(session, keys) {
  session.queue = session.order.filter(k => keys.includes(k));
  session.cursor = 0;
}
export function endRecheck(session) {
  const k = currentKey(session);
  session.queue = null;
  const i = session.order.indexOf(k);
  session.cursor = i === -1 ? 0 : i;
}

export { keyFor, lineOf, sideOf };
