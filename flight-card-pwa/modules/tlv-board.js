// tlv-board.js — Ben Gurion's own flight board for the active leg.
//
// TOBT / TSAT, CTOT and the filed flight plan are all released only to
// airlines, handlers and ATC — there is no public feed for any of them. What
// IS public is the Israel Airports Authority's flight board on data.gov.il:
// every LY departure and arrival at TLV over a rolling ~3-day window, with the
// airport's live status, its updated time, the terminal and the check-in
// counters. Keyless and CORS-open, so the app reads it directly — no worker.
//
// Record shape (checked live): CHOPER 'LY', CHFLTN '5141' (zero-padded to 3),
// CHAORD 'D'|'A', CHSTOL scheduled / CHPTOL updated — both Israel LOCAL time,
// '2026-10-21T13:31:00' — CHLOC1 the other airport (IATA), CHRMINE / CHRMINH
// status in English / Hebrew, CHTERM terminal, CHCINT counters, CHCKZN zone.

import { icalToMs } from './duties.js?v=180';
import { legTs } from './dates.js?v=180';

const API = 'https://data.gov.il/api/3/action/datastore_search';
const RESOURCE = 'e83f763b-b7d7-479e-b172-ae981ddc6de5';
const TTL_MS = 5 * 60 * 1000;
const HOME = new Set(['TLV', 'LLBG']);
const H = 3600 * 1000;

const mem = new Map();          // cache key → board

const digits = (f) => String(f == null ? '' : f).replace(/\D/g, '').replace(/^0+/, '');

// '2026-10-21T13:31:00' (Israel local) → UTC ms.
function localToMs(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(s || ''));
  if (!m) return NaN;
  const r = icalToMs(`${m[1]}${m[2]}${m[3]}T${m[4]}${m[5]}00`, 'Asia/Jerusalem');
  return r ? r.ms : NaN;
}

// Which end of the leg is TLV, and when the board's time for it is due.
function legSide(leg) {
  const dep = String(leg?.dep || '').toUpperCase(), arr = String(leg?.arr || '').toUpperCase();
  if (HOME.has(dep)) return { dir: 'D', other: arr, ts: legTs(leg.dep_date, leg.dep_time, leg.dep_year) };
  if (HOME.has(arr)) {
    const ts = legTs(leg.arr_date, leg.arr_time, leg.arr_year || leg.dep_year);
    return { dir: 'A', other: dep, ts: Number.isFinite(ts) ? ts : legTs(leg.dep_date, leg.dep_time, leg.dep_year) };
  }
  return null;
}

// Is this leg one the board can know about? TLV at either end, flight number
// set, and departing within the board's window.
export function applies(leg, now = Date.now()) {
  const side = legSide(leg);
  if (!side || !digits(leg.flight) || !Number.isFinite(side.ts)) return false;
  const depTs = legTs(leg.dep_date, leg.dep_time, leg.dep_year);
  const t = Number.isFinite(depTs) ? depTs : side.ts;
  return t > now - 12 * H && t < now + 72 * H;
}

function cacheKey(leg, side) {
  return `fc.board.${digits(leg.flight)}${side.dir}@${new Date(side.ts).toISOString().slice(0, 10)}`;
}
function readCache(key) {
  if (mem.has(key)) return mem.get(key);
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null');
    if (v && typeof v === 'object') { mem.set(key, v); return v; }
  } catch {}
  return null;
}
function writeCache(key, board) {
  mem.set(key, board);
  try { localStorage.setItem(key, JSON.stringify(board)); } catch {}
}

// The board's entry for this leg, or null. Cached for five minutes; offline
// or on any error, the last copy comes back marked stale — never a throw.
export async function boardFor(leg, { force = false } = {}) {
  if (!applies(leg)) return null;
  const side = legSide(leg);
  const key = cacheKey(leg, side);
  const cached = readCache(key);
  if (!force && cached && Date.now() - cached.fetchedAt < TTL_MS) return cached.none ? null : cached;
  try {
    const n = digits(leg.flight).padStart(3, '0');
    const filters = JSON.stringify({ CHOPER: 'LY', CHFLTN: n, CHAORD: side.dir });
    const url = `${API}?resource_id=${RESOURCE}&limit=10&filters=${encodeURIComponent(filters)}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    const recs = (json && json.result && json.result.records) || [];
    // Same number can appear on two days in the window: take the record for
    // this leg's route whose scheduled time is nearest the leg's, within 12 h.
    let best = null, bestGap = Infinity;
    for (const r of recs) {
      if (side.other && r.CHLOC1 && String(r.CHLOC1).toUpperCase() !== side.other) continue;
      const gap = Math.abs(localToMs(r.CHSTOL) - side.ts);
      if (gap < bestGap) { best = r; bestGap = gap; }
    }
    if (!best || !(bestGap <= 12 * H)) {
      const none = { none: true, fetchedAt: Date.now() };
      writeCache(key, none);
      return null;
    }
    const schedMs = localToMs(best.CHSTOL), updatedMs = localToMs(best.CHPTOL);
    const board = {
      dir: side.dir,
      status: String(best.CHRMINE || '').trim(),
      statusHe: String(best.CHRMINH || '').trim(),
      schedMs, updatedMs,
      delayMin: Number.isFinite(schedMs) && Number.isFinite(updatedMs)
        ? Math.round((updatedMs - schedMs) / 60000) : 0,
      terminal: best.CHTERM != null && best.CHTERM !== '' ? String(best.CHTERM) : '',
      checkin: String(best.CHCINT || '').trim(),
      zone: String(best.CHCKZN || '').trim(),
      fetchedAt: Date.now(),
    };
    writeCache(key, board);
    return board;
  } catch (err) {
    if (cached && !cached.none) return { ...cached, stale: true };
    return null;
  }
}
