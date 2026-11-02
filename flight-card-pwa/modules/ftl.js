// ftl.js — flight time / FDP limits and rest, from OM A chapter 7.2
// (Rev 22, 1 NOV 23), which carries the ANR chapter 13 requirements.
//
// A planning aid: it reads the legs stored on this device, groups them into
// flight duty periods and checks each against the OM A tables. ELP Notify's
// LTT and Crew Assignment stay the authority — the pilot's own deadhead
// sectors aren't stored here, and neither are duties the calendar never sent.
//
// Pure functions, no DOM: app.js renders the sheet from evaluate().

import { legPlanActual } from './dates.js?v=214';
import { PILOT_KEYS } from './crew.js?v=214';

const H = 3600000, MIN = 60000;
export const OMA_REV = 'OM A Rev 22 · ch. 7.2';

// Report time before STD for a 737, at Tel Aviv and everywhere else (7.2.1).
export const REPORT_MIN = 60;
// Post-flight duty after the FDP ends, unless told otherwise (7.2.1).
export const POST_FLIGHT_MIN = 15;
export const MIN_REST_H = 10;          // before an FDP, from release (7.2.7)
export const FREE_IN_168_H = 30;       // free from duty in the past 168 h
export const EXT_MAX_H = 2;            // FDP extension, PIC + FOO (7.2.10)
export const NOT_ACCL_CUT_H = 0.5;     // Tables B/C footnote
const HOME_LON = 34.89;                // LLBG — the theater is ±60° longitude

// Table A — max flight time, un-augmented, by report hour (acclimated).
export const TABLE_A = [[0, 4, 8], [5, 19, 9], [20, 23, 8]];

// Table B — max FDP, un-augmented, by report hour and 1..7+ segments.
export const TABLE_B = [
  [0, 3,   [9, 9, 9, 9, 9, 9, 9]],
  [4, 4,   [10, 10, 10, 10, 9, 9, 9]],
  [5, 5,   [12, 12, 12, 12, 11.5, 11, 10.5]],
  [6, 6,   [13, 13, 12, 12, 11.5, 11, 10.5]],
  [7, 11,  [14, 14, 13, 13, 12.5, 12, 11.5]],
  [12, 12, [13, 13, 13, 13, 12.5, 12, 11.5]],
  [13, 16, [12, 12, 12, 12, 11.5, 11, 10.5]],
  [17, 21, [12, 12, 11, 11, 10, 9, 9]],
  [22, 22, [11, 11, 10, 10, 9, 9, 9]],
  [23, 23, [10, 10, 10, 9, 9, 9, 9]],
];

// Table C — max FDP, augmented, by report hour; columns are rest facility
// class 1/2/3 × 3/4 pilots. At most 3 segments.
export const TABLE_C = [
  [0, 5,   [15, 17, 14, 15.5, 13, 13.5]],
  [6, 6,   [16, 18.5, 15, 16.5, 14, 14.5]],
  [7, 12,  [17, 19, 16.5, 18, 15, 15.5]],
  [13, 16, [16, 18.5, 15, 16.5, 14, 14.5]],
  [17, 23, [15, 17, 14, 15.5, 13, 13.5]],
];
export const AUG_FT = { 3: 13, 4: 17 };
export const AUG_MAX_SEGMENTS = 3;

// Cumulative limits (7.2.6).
export const CUMULATIVE = [
  { id: 'ft672',  what: 'ft',  label: 'Flight time', span: '672 h',    hours: 672, max: 100 },
  { id: 'ft365',  what: 'ft',  label: 'Flight time', span: '365 days', days: 365,  max: 1000 },
  { id: 'fdp168', what: 'fdp', label: 'FDP',         span: '168 h',    hours: 168, max: 60 },
  { id: 'fdp672', what: 'fdp', label: 'FDP',         span: '672 h',    hours: 672, max: 190 },
];

// Non-flight duties that count as duty for rest. Vacation, days off, sick
// and miluim don't; an all-day event has no times to measure rest from.
const DUTY_KINDS = new Set(['sim', 'training', 'course', 'office', 'standby', 'other']);

const ilFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export function israelHm(ms) { return ilFmt.format(new Date(ms)); }
function israelHour(ms) { return Number(israelHm(ms).slice(0, 2)); }

function rowFor(table, hour) { return table.find(([a, b]) => hour >= a && hour <= b); }
export function tableBRow(hour) { return TABLE_B.indexOf(rowFor(TABLE_B, hour)); }
export function tableCRow(hour) { return TABLE_C.indexOf(rowFor(TABLE_C, hour)); }

function legKey(l) { return [l.flight, l.dep_date, l.dep_year, l.dep, l.arr].join('|'); }
function crewOf(l, k) { return String((l.dataCard && l.dataCard[k]) || l[k] || '').trim(); }

// The rest facility a fleet has (7.4.1): the 737 is class 3 (business-class
// seats), the 787 and 777 class 1 (crew bunk). From the type string when the
// leg carries one, else the 4X-E? registration block — EK/EH 737, ED/ER 787,
// EC 777. Unknown is taken as a 737.
export function restClassOf(leg) {
  const type = String((leg.dataCard && leg.dataCard.ac_type) || leg.ac_type || '');
  if (/7[78]7/.test(type)) return 1;
  if (/737/.test(type)) return 3;
  const reg = String((leg.dataCard && leg.dataCard.tail) || leg.tail || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const m = /^4XE([A-Z])/.exec(reg);
  return m && 'DRC'.includes(m[1]) ? 1 : 3;
}

// Every stored leg as times: plan (STD/STA) and, once flown, the actual
// off-block / on-block. Duplicates (a leg in both current and history) once.
export function legTimes(legs) {
  const seen = new Set(), out = [];
  for (const leg of legs || []) {
    if (!leg || !leg.dep_date) continue;
    const k = legKey(leg);
    if (seen.has(k)) continue;
    seen.add(k);
    const p = legPlanActual(leg);
    if (!Number.isFinite(p.std) || !Number.isFinite(p.sta) || p.sta <= p.std) continue;
    const flown = Number.isFinite(p.obt) && Number.isFinite(p.ibt) && p.ibt > p.obt;
    out.push({
      leg, std: p.std, sta: p.sta,
      start: flown ? p.obt : p.std,
      end: flown ? p.ibt : p.sta,
      flown,
      pilots: PILOT_KEYS.filter(k => crewOf(leg, k)).length,
      restClass: restClassOf(leg),
    });
  }
  return out.sort((a, b) => a.std - b.std);
}

// Legs into flight duty periods. A ground time shorter than a required rest
// is the same FDP (split duty isn't permitted, 7.2.13); 6 h is well clear of
// any turnaround and still flags a short rest as a short rest, not a merge.
const SAME_FDP_GAP = 6 * H;
export function groupFdps(times) {
  const fdps = [];
  for (const t of times) {
    const cur = fdps[fdps.length - 1];
    if (cur && t.std - cur.legs[cur.legs.length - 1].end < SAME_FDP_GAP) cur.legs.push(t);
    else fdps.push({ legs: [t] });
  }
  for (const f of fdps) {
    const first = f.legs[0], last = f.legs[f.legs.length - 1];
    f.report = first.std - REPORT_MIN * MIN;   // scheduled report stays put (7.2.9)
    f.plannedEnd = last.sta;
    f.end = last.end;
    f.release = f.end + POST_FLIGHT_MIN * MIN;
    f.flown = f.legs.every(l => l.flown);
    f.segments = f.legs.length;
    f.plannedFt = f.legs.reduce((s, l) => s + (l.sta - l.std), 0);
    f.ft = f.legs.reduce((s, l) => s + (l.end - l.start), 0);
    f.pilots = Math.max(...f.legs.map(l => l.pilots), 0);
    f.restClass = Math.max(...f.legs.map(l => l.restClass));   // the poorer facility rules
  }
  return fdps;
}

// The FDP holding the leg the app is on, else the next one to come, else
// the last flown.
export function pickFdp(fdps, leg, now = Date.now()) {
  if (leg) {
    const k = legKey(leg);
    const i = fdps.findIndex(f => f.legs.some(l => legKey(l.leg) === k));
    if (i >= 0) return i;
  }
  const next = fdps.findIndex(f => f.end + POST_FLIGHT_MIN * MIN >= now);
  return next >= 0 ? next : fdps.length - 1;
}

// Limits for one FDP. opts: { pilots, restClass, notAcclimated, lonOf }.
export function limitsFor(fdp, opts = {}) {
  const hour = israelHour(fdp.report);
  const pilots = Math.min(4, Math.max(2, opts.pilots || fdp.pilots || 2));
  const augmented = pilots >= 3;
  const restClass = [1, 2, 3].includes(opts.restClass) ? opts.restClass : (fdp.restClass || 3);
  let notAccl = opts.notAcclimated;
  if (notAccl == null) {
    // Acclimated to Israel; a departure more than 60° of longitude away is
    // another theater — not acclimated to the departure station.
    const lon = opts.lonOf ? opts.lonOf(fdp.legs[0].leg.dep) : null;
    notAccl = Number.isFinite(lon) && Math.abs(((lon - HOME_LON + 540) % 360) - 180) > 60;
  }
  let maxFdp, maxFt, row, col;
  if (augmented) {
    row = tableCRow(hour);
    col = (restClass - 1) * 2 + (pilots === 4 ? 1 : 0);
    maxFdp = TABLE_C[row][2][col];
    maxFt = AUG_FT[pilots];
  } else {
    row = tableBRow(hour);
    col = Math.min(fdp.segments, 7) - 1;
    maxFdp = TABLE_B[row][2][col];
    maxFt = rowFor(TABLE_A, hour)[2];
  }
  if (notAccl) maxFdp -= NOT_ACCL_CUT_H;
  // An extension the PIC has taken (7.2.10), up to 2 h, recorded per duty.
  const baseFdp = maxFdp;
  const extH = Math.min(EXT_MAX_H, Math.max(0, (opts.extOf ? Number(opts.extOf(fdp)) || 0 : 0) / 60));
  maxFdp += extH;
  const limit = fdp.report + maxFdp * H;
  return {
    hour, pilots, augmented, restClass, notAccl, row, col, baseFdp, extH,
    maxFdp, maxFt,
    limit,                                 // latest on-blocks
    limitExt: fdp.report + (baseFdp + EXT_MAX_H) * H,   // with the full 2 h extension
    plannedFdp: (fdp.plannedEnd - fdp.report) / H,
    actualFdp: fdp.flown ? (fdp.end - fdp.report) / H : null,
    tooManySegments: augmented && fdp.segments > AUG_MAX_SEGMENTS,
  };
}

// Latest take-off for each leg: the rest of the duty keeps its scheduled
// block and ground times, the last on-blocks lands on the FDP limit, and
// take-off is off-blocks + taxi-out. Notify's LTT is the official one.
export function legLtts(fdp, lim, taxiOf = () => 15) {
  const lastSta = fdp.plannedEnd;
  return fdp.legs.map(l => {
    const taxi = taxiOf(String(l.leg.dep || '').toUpperCase());
    const off = lim.limit - (lastSta - l.std);
    return { off, ltt: off + taxi * MIN, lttExt: off + taxi * MIN + (lim.limitExt - lim.limit), taxi };
  });
}

// Duty intervals for rest: each FDP from report to release, plus timed
// non-flight duties.
function dutyIntervals(fdps, duties) {
  const out = fdps.map(f => ({ s: f.report, e: f.release, fdp: f }));
  for (const d of duties || []) {
    if (!d || d.allDay || !DUTY_KINDS.has(d.kind)) continue;
    if (!(d.end > d.start)) continue;
    out.push({ s: d.start, e: d.end, duty: d });
  }
  return out.sort((a, b) => a.s - b.s);
}

// Longest stretch free of duty inside [from, to].
function longestFree(intervals, from, to) {
  let best = 0, cursor = from;
  for (const iv of intervals) {
    if (iv.e <= from) continue;
    if (iv.s >= to) break;
    best = Math.max(best, Math.max(iv.s, from) - cursor);
    cursor = Math.max(cursor, Math.min(iv.e, to));
  }
  return Math.max(best, to - cursor);
}

export function restFor(fdps, idx, duties) {
  const f = fdps[idx];
  const ivs = dutyIntervals(fdps, duties);
  let prev = null;
  for (const iv of ivs) if (iv.e <= f.report && iv.fdp !== f && (!prev || iv.e > prev.e)) prev = iv;
  const before = prev ? (f.report - prev.e) / H : null;
  const free168 = longestFree(ivs.filter(iv => iv.fdp !== f), f.report - 168 * H, f.report) / H;
  const next = fdps[idx + 1] || null;
  return {
    before, prev,
    free168,
    earliestNext: f.release + MIN_REST_H * H,
    after: next ? (next.report - f.release) / H : null,
    next,
  };
}

// Time inside [from, to] across intervals, in hours.
function overlapH(intervals, from, to) {
  let s = 0;
  for (const [a, b] of intervals) s += Math.max(0, Math.min(b, to) - Math.max(a, from));
  return s / H;
}

// Cumulative totals for windows ending at `at` (the end of the duty
// being checked, so it counts what's planned too).
export function cumulative(fdps, at) {
  const ft = [], fdp = [];
  for (const f of fdps) {
    fdp.push([f.report, f.end]);
    for (const l of f.legs) ft.push([l.start, l.end]);
  }
  const DAY = 24 * H;
  return CUMULATIVE.map(c => {
    const from = c.days
      ? Math.floor(at / DAY) * DAY - (c.days - 1) * DAY   // calendar days, UTC
      : at - c.hours * H;
    const used = overlapH(c.what === 'ft' ? ft : fdp, from, at);
    return { ...c, from, used, left: c.max - used };
  });
}

// How far back the stored legs go — a 365-day total is only as good as that.
export function earliestLeg(fdps) { return fdps.length ? fdps[0].report : null; }

// When the duty will actually end, as far as can be told now: a flown leg's
// on-blocks; else the plan, pushed later by the latest delay seen — a leg
// that blocked out or in late, or one still on the ground after its STD.
// The delay carries to the end; a turnaround that absorbs it shows up once
// that leg is flown.
export function projectedEnd(fdp, now = Date.now()) {
  let delay = 0;
  for (const l of fdp.legs) {
    if (l.flown) { delay = l.end - l.sta; continue; }
    const p = legPlanActual(l.leg);
    if (Number.isFinite(p.obt)) delay = Math.max(p.obt - l.std, 0);
    else if (now > l.std) delay = Math.max(delay, now - l.std);
    break;
  }
  return fdp.flown ? fdp.end : fdp.plannedEnd + Math.max(0, delay);
}

// Spare FDP for a duty: max FDP against its projected end, in hours
// (negative = over). null when there's no duty near now worth showing.
export function spareNow(fdp, lim, now = Date.now()) {
  const end = projectedEnd(fdp, now);
  return { end, spare: (lim.limit - end) / H, spareExt: (lim.limitExt - end) / H, planned: lim.maxFdp - lim.plannedFdp };
}

export function evaluate({ legs, duties, activeLeg, idx, opts = {}, taxiOf, now = Date.now() }) {
  const fdps = groupFdps(legTimes(legs));
  if (!fdps.length) return { fdps, empty: true };
  const i = Number.isInteger(idx) ? Math.max(0, Math.min(fdps.length - 1, idx)) : pickFdp(fdps, activeLeg, now);
  const fdp = fdps[i];
  const lim = limitsFor(fdp, opts);
  return {
    fdps, i, fdp, lim,
    ltts: legLtts(fdp, lim, taxiOf),
    rest: restFor(fdps, i, duties),
    cum: cumulative(fdps, fdp.end),
    proj: spareNow(fdp, lim, now),
    since: earliestLeg(fdps),
    live: now >= fdp.report && now <= fdp.release ? { elapsed: (now - fdp.report) / H, left: (lim.limit - now) / H } : null,
  };
}
