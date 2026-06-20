// analytics.js — read-only aggregations across every stored leg.
//
// Drives the Settings → Analytics overlay (Phase 5). No persistence,
// no schema bump — just pure functions over storage.getLegs() +
// storage.getState().history.
//
// Conventions:
//   • "home" = TLV / LLBG. Hard-coded here because the pilot's based
//     there; if that changes later, surface it as a setting.
//   • Year filter defaults to the current UTC year. Legs whose dep_date
//     lacks a year get bucketed by the rolling-window heuristic used
//     elsewhere (current year unless > 6 months stale).

import * as storage from './storage.js';

const HOME = new Set(['TLV', 'LLBG']);

// ---------- Shared helpers ----------

// Combine dd.mm + HH:MM into a UTC ms timestamp. Mirrors the rolling-window
// heuristic used by the leg switcher and logbook builder.
function depTs(leg) {
  const d = leg?.dep_date, t = leg?.dep_time;
  if (!d || !t) return NaN;
  const [dd, mm] = d.split('.');
  if (!dd || !mm) return NaN;
  const yearNow = new Date().getUTCFullYear();
  let ts = Date.parse(`${yearNow}-${mm}-${dd}T${t}:00Z`);
  if (!Number.isFinite(ts)) return NaN;
  if (Date.now() - ts > 6 * 30 * 24 * 3600 * 1000) {
    ts = Date.parse(`${yearNow + 1}-${mm}-${dd}T${t}:00Z`);
  }
  return ts;
}

function legYear(leg) {
  const ts = depTs(leg);
  return Number.isFinite(ts) ? new Date(ts).getUTCFullYear() : null;
}

// Parse "HH:MM" → total minutes. Returns 0 for missing or malformed input.
function hhmmToMin(s) {
  if (!s) return 0;
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s).trim());
  if (!m) return 0;
  return (parseInt(m[1], 10) | 0) * 60 + (parseInt(m[2], 10) | 0);
}

function fmtMin(total) {
  if (!Number.isFinite(total) || total < 0) return '0:00';
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

// Pull every leg the pilot has touched — current.legs[] + every leg in
// each historical flight record. Sorted by UTC dep time ascending so
// "first ever flight" → "most recent" reads naturally.
export function allLegs() {
  const out = [];
  for (const leg of storage.getLegs() || []) out.push(leg);
  for (const flight of storage.getState().history || []) {
    for (const leg of flight.legs || []) out.push(leg);
  }
  out.sort((a, b) => (depTs(a) || 0) - (depTs(b) || 0));
  return out;
}

// ---------- Aggregations ----------

// Most-frequent non-home destinations. Counts every leg whose arrival is
// non-home (we go to many places, but we come back to the same one). Adds
// each leg's airport ICAO as the key; cityName lookup happens in the UI.
export function topDestinations(legs, n = 5, year = null) {
  const counts = new Map();
  for (const leg of legs) {
    if (year != null && legYear(leg) !== year) continue;
    const arr = String(leg.arr || '').toUpperCase();
    if (!arr || HOME.has(arr)) continue;
    counts.set(arr, (counts.get(arr) | 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([icao, count]) => ({ icao, count }));
}

// Distinct UTC dates with at least one non-home dep OR arr. Approximates
// "nights you slept somewhere other than TLV." Year filter optional.
export function nightsAwayFromHome(legs, year = null) {
  const dates = new Set();
  for (const leg of legs) {
    if (year != null && legYear(leg) !== year) continue;
    const dep = String(leg.dep || '').toUpperCase();
    const arr = String(leg.arr || '').toUpperCase();
    const depAway = dep && !HOME.has(dep);
    const arrAway = arr && !HOME.has(arr);
    if (!depAway && !arrAway) continue;
    const ts = depTs(leg);
    if (!Number.isFinite(ts)) continue;
    const d = new Date(ts);
    const ymd = `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
    dates.add(ymd);
  }
  return dates.size;
}

// Hours flown: prefer actual_flight_time, fall back to block_time, then
// flight_time. Per-tail breakdown sorted by total desc.
export function hoursFlown(legs, year = null) {
  let totalMin = 0;
  const perTail = new Map();
  for (const leg of legs) {
    if (year != null && legYear(leg) !== year) continue;
    const d = leg.dataCard || {};
    const min = hhmmToMin(d.actual_flight_time)
              || hhmmToMin(d.block_time)
              || hhmmToMin(leg.flight_time)
              || hhmmToMin(d.flight_time);
    if (!min) continue;
    totalMin += min;
    const tail = String(leg.tail || d.tail || '—').toUpperCase();
    perTail.set(tail, (perTail.get(tail) | 0) + min);
  }
  const byTail = [...perTail.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([tail, mins]) => ({ tail, mins, label: fmtMin(mins) }));
  return { totalMin, totalLabel: fmtMin(totalMin), byTail };
}

// Average max_g split by landing role. Only counts legs where both ldg_role
// and a numeric max_g are present. Returns null counts when there isn't
// enough data to compute (the UI shows a "need more data" empty state).
export function avgMaxG(legs, year = null) {
  let pfSum = 0, pfN = 0, pmSum = 0, pmN = 0;
  for (const leg of legs) {
    if (year != null && legYear(leg) !== year) continue;
    const d = leg.dataCard || {};
    const role = String(d.ldg_role || '').toUpperCase();
    const g = parseFloat(d.max_g);
    if (!Number.isFinite(g) || g <= 0) continue;
    if (role === 'PF') { pfSum += g; pfN++; }
    else if (role === 'PM') { pmSum += g; pmN++; }
  }
  return {
    pf: pfN ? { avg: pfSum / pfN, count: pfN } : null,
    pm: pmN ? { avg: pmSum / pmN, count: pmN } : null,
  };
}

// Top crewmembers the pilot's flown with most. Counts unique legs per
// canonical name; cpt + fo + cc1..cc5 all contribute. Returns canonical
// names — the UI flows them through displayCrew for nickname-awareness.
export function mostFlownCrew(legs, n = 5, year = null) {
  const CREW_KEYS = ['cpt', 'fo', 'cc1', 'cc2', 'cc3', 'cc4', 'cc5'];
  const counts = new Map();
  for (const leg of legs) {
    if (year != null && legYear(leg) !== year) continue;
    const d = leg.dataCard || {};
    const seen = new Set();
    for (const k of CREW_KEYS) {
      const v = (leg[k] || d[k] || '').toString().trim().toUpperCase();
      if (v) seen.add(v);
    }
    for (const name of seen) {
      counts.set(name, (counts.get(name) | 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, count]) => ({ name, count }));
}

// Convenience: one shot at every metric for the current YTD.
export function snapshot() {
  const legs = allLegs();
  const year = new Date().getUTCFullYear();
  return {
    year,
    legCount:  legs.length,
    top:       topDestinations(legs, 5, year),
    nights:    nightsAwayFromHome(legs, year),
    hours:     hoursFlown(legs, year),
    g:         avgMaxG(legs, year),
    crew:      mostFlownCrew(legs, 5, year),
  };
}
