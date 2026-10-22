// dates.js — the ONE home of the rolling-year heuristic.
//
// Roster dates arrive as "dd.mm" with no year. The rule everywhere in the
// app: assume the current UTC year, and if that puts the timestamp more
// than 6 months in the past, roll forward a year (so a December bulletin
// read in January lands in the right year). This lived as 8 near-identical
// copies across app.js / storage.js / logbook.js / analytics.js before
// being extracted here — change the rule HERE and only here.

const STALE_MS = 6 * 30 * 24 * 3600 * 1000;

const pad2 = (s) => String(s).padStart(2, '0');

// "dd.mm" + "HH:MM" (UTC) → ms since epoch, or NaN when either part is
// missing/malformed. This is the shared core; callers keep their own
// fallback conventions (NaN vs MAX_SAFE_INTEGER vs null).
export function rollingTs(ddmm, hhmm, nowMs = Date.now()) {
  if (!ddmm || !hhmm) return NaN;
  const dm = String(ddmm).split('.');
  if (dm.length !== 2) return NaN;
  const tm = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm).trim());
  if (!tm) return NaN;
  const dd = pad2(dm[0]), mm = pad2(dm[1]);
  const t = `${pad2(tm[1])}:${tm[2]}`;
  const year = new Date(nowMs).getUTCFullYear();
  let ts = Date.parse(`${year}-${mm}-${dd}T${t}:00Z`);
  if (!Number.isFinite(ts)) return NaN;
  if (nowMs - ts > STALE_MS) {
    ts = Date.parse(`${year + 1}-${mm}-${dd}T${t}:00Z`);
  }
  return ts;
}

// "dd.mm" → the calendar year the rolling window puts that date in, or
// null when the input is malformed. Used where only the year matters
// (logbook month grouping, analytics year buckets).
export function rollingYear(ddmm, nowMs = Date.now()) {
  const ts = rollingTs(ddmm, '00:00', nowMs);
  return Number.isFinite(ts) ? new Date(ts).getUTCFullYear() : null;
}

// The rolling window above is a GUESS, and it is only right for dates within
// ~6 months of now. The logbook keeps flown legs forever, so anything older
// than that gets guessed into the wrong year — two flights a year apart
// collapse onto the same date and the app treats them as one. Wherever the
// true year is known (the calendar's DTSTART, the roster JSON's dd.mm.yyyy)
// legs now carry dep_year / arr_year, and these two helpers prefer it.
//
// dateTs: explicit year when we have one, rolling guess when we don't.
export function dateTs(ddmm, hhmm, year, nowMs = Date.now()) {
  const y = Number(year);
  if (!Number.isInteger(y) || y < 1970 || y > 9999) return rollingTs(ddmm, hhmm, nowMs);
  if (!ddmm || !hhmm) return NaN;
  const dm = String(ddmm).split('.');
  if (dm.length !== 2) return NaN;
  const tm = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm).trim());
  if (!tm) return NaN;
  const ts = Date.parse(`${y}-${pad2(dm[1])}-${pad2(dm[0])}T${pad2(tm[1])}:${tm[2]}:00Z`);
  return Number.isFinite(ts) ? ts : NaN;
}

// The year a "dd.mm" belongs to: the explicit one when known, else guessed.
export function yearOf(ddmm, year, nowMs = Date.now()) {
  const y = Number(year);
  if (Number.isInteger(y) && y >= 1970 && y <= 9999) return y;
  return rollingYear(ddmm, nowMs);
}

// Given a "dd.mm" and a reference timestamp, pick the year that puts the date
// CLOSEST to that reference. Used to anchor slip-text dates (which carry no
// year) to the calendar event they arrived in — and it handles a duty period
// straddling New Year, where "01.01" belongs to the year after a 31.12 event.
export function yearNear(ddmm, anchorMs) {
  if (!ddmm || !Number.isFinite(anchorMs)) return null;
  const dm = String(ddmm).split('.');
  if (dm.length !== 2) return null;
  const base = new Date(anchorMs).getUTCFullYear();
  let best = null, bestDist = Infinity;
  for (const y of [base - 1, base, base + 1]) {
    const ts = Date.parse(`${y}-${pad2(dm[1])}-${pad2(dm[0])}T00:00:00Z`);
    if (!Number.isFinite(ts)) continue;
    const dist = Math.abs(ts - anchorMs);
    if (dist < bestDist) { bestDist = dist; best = y; }
  }
  return best;
}

// The rolling window above rolls FORWARD when a date is more than ~6 months
// old, which is right for a roster ("December read in January means next
// December") and exactly wrong for a logbook: a flight flown 7 months ago
// resolved to NEXT year, looked like a future event, and was dropped from the
// logbook entirely. For already-flown legs, resolve to the most recent year
// that puts the date at or before now.
export function yearPast(ddmm, nowMs = Date.now()) {
  if (!ddmm) return null;
  const dm = String(ddmm).split('.');
  if (dm.length !== 2) return null;
  const y = new Date(nowMs).getUTCFullYear();
  const ts = Date.parse(`${y}-${pad2(dm[1])}-${pad2(dm[0])}T00:00:00Z`);
  if (!Number.isFinite(ts)) return null;
  return ts <= nowMs ? y : y - 1;
}

// The single way to turn a LEG's stored date into a timestamp.
//
// A leg that carries dep_year/arr_year uses it, full stop. A leg without one
// can only be legacy data — every parse path has stamped a year since v127 —
// and legacy data is by definition already flown, so it resolves past-biased.
//
// This exists because the fallback used to differ by module: storage's sort and
// app's "which leg is now" used the FORWARD-rolling guess, which threw a flight
// from seven months ago into next February. It sorted after next week's flight
// and looked like the next departure, so the app auto-selected a leg the pilot
// flew months ago. The logbook and analytics had already been moved to the
// past-biased rule, which is exactly how the two halves disagreed.
export function legTs(ddmm, hhmm, year, nowMs = Date.now()) {
  return dateTs(ddmm, hhmm, year || yearPast(ddmm, nowMs), nowMs);
}

// A bare "HH:MM" (UTC) placed on the day nearest a reference timestamp —
// off-block / on-block / CTOT times are stored as HH:MM only, and an actual
// off-block at 23:50 for a 00:05 departure belongs to the day BEFORE. Returns
// NaN without a usable time or reference.
export function nearestHm(hhmm, refMs) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m || !Number.isFinite(refMs)) return NaN;
  const d = new Date(refMs);
  let ts = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), +m[1], +m[2]);
  const DAY = 86400000;
  if (ts - refMs > DAY / 2) ts -= DAY;
  else if (refMs - ts > DAY / 2) ts += DAY;
  return ts;
}

// A leg's plan against what actually happened, all as UTC ms (NaN when
// unknown) plus minute deltas (null when either side is missing).
//   plan:   STD / STA from the roster (STA falls back to STD + block)
//   actual: off-block / on-block (calendar "Actual:" line, CSV ATD/ATA),
//           take-off / landing (CSV Airborne/Landing, GPS)
//   ctot:   the slot, if one was entered for this leg
export function legPlanActual(leg) {
  const d = (leg && leg.dataCard) || {};
  const std = legTs(leg?.dep_date, leg?.dep_time, leg?.dep_year);
  let sta = legTs(leg?.arr_date, leg?.arr_time, leg?.arr_year || leg?.dep_year);
  const bm = /^(\d{1,2}):(\d{2})$/.exec(String(d.block_time || leg?.flight_time || '').trim());
  if (!Number.isFinite(sta) && Number.isFinite(std) && bm) sta = std + ((+bm[1]) * 60 + (+bm[2])) * 60000;
  const obt = nearestHm(d.off_block, std);
  const ibt = nearestHm(d.on_block, Number.isFinite(sta) ? sta : obt);
  const num = (v) => (v === '' || v == null) ? NaN : Number(v);
  const tko = num(d.takeoff_at), ldg = num(d.landing_at);
  const ctot = nearestHm(d.ctot || leg?.ctot, std);
  const delta = (a, b) => (Number.isFinite(a) && Number.isFinite(b)) ? Math.round((a - b) / 60000) : null;
  return {
    std, sta, obt, ibt, ctot,
    takeoff: Number.isFinite(tko) && tko > 0 ? tko : NaN,
    landing: Number.isFinite(ldg) && ldg > 0 ? ldg : NaN,
    obtDelta: delta(obt, std),
    ibtDelta: delta(ibt, sta),
  };
}
