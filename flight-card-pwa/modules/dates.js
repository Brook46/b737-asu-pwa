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
