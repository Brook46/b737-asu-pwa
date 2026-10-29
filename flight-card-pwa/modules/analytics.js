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

import * as storage from './storage.js?v=187';
import { dateTs, legTs, yearPast, legPlanActual } from './dates.js?v=187';
import { CREW_KEYS, CREW_FIELDS } from './crew.js?v=187';

const HOME = new Set(['TLV', 'LLBG']);

// ---------- Shared helpers ----------

// Combine dd.mm + HH:MM into a UTC ms timestamp. Shared rolling-year
// heuristic — see modules/dates.js.
function depTs(leg) {
  // Real year when the leg carries one. Without one, resolve PAST-biased, the
  // same as the logbook: the forward-rolling guess pushed anything older than
  // ~6 months into next year, where allLegs()' future filter then dropped it —
  // so old flights silently vanished from the stats and the map too.
  return legTs(leg?.dep_date, leg?.dep_time, leg?.dep_year);
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
  const now = Date.now();
  const out = storage.everyLeg();
  // Statistics count FLOWN flights only — exclude legs whose departure is
  // still in the future so upcoming roster doesn't inflate hours, nights,
  // destinations or crew tallies. Undated legs (NaN dep) pass through; they
  // contribute nothing to the year-bucketed aggregations anyway.
  const flown = out.filter(leg => {
    const ts = depTs(leg);
    return !Number.isFinite(ts) || ts <= now;
  });
  flown.sort((a, b) => (depTs(a) || 0) - (depTs(b) || 0));
  return flown;
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

// Hours flown are BLOCK hours, chock to chock, as a pilot's logbook and the
// company count them: the actual block (calendar "Actual:" line or the CSV's
// ATD→ATA) where known, else the scheduled block. Airborne time
// (actual_flight_time) is a different measure and is no longer summed in
// with them. Per-tail breakdown sorted by total desc.
export function hoursFlown(legs, year = null) {
  let totalMin = 0;
  const perTail = new Map();
  for (const leg of legs) {
    if (year != null && legYear(leg) !== year) continue;
    const d = leg.dataCard || {};
    const min = hhmmToMin(d.actual_block_time)
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

// Heuristic: which name is the app's owner (the pilot)? They're in the
// cockpit on EVERY one of their own legs, so the most-frequent cockpit
// crew member — counting cpt AND fo, since the user may fly either seat —
// is almost certainly them. Requiring a majority share avoids wrongly
// dropping a frequent colleague. Returns '' when data is too sparse.
// Used to filter the pilot out of mostFlownCrew so the top spot isn't "you".
function detectPilotName(legs) {
  const COCKPIT_KEYS = ['cpt', 'fo'];
  const counts = new Map();
  let total = 0;
  for (const leg of legs) {
    const d = leg.dataCard || {};
    const seen = new Set();
    for (const k of COCKPIT_KEYS) {
      const v = (leg[k] || d[k] || '').toString().trim().toUpperCase();
      if (v) seen.add(v);
    }
    if (seen.size) total++;
    for (const name of seen) counts.set(name, (counts.get(name) | 0) + 1);
  }
  if (total < 3) return ''; // too sparse; show everyone
  let best = '', bestN = 0;
  for (const [name, n] of counts) {
    if (n > bestN) { best = name; bestN = n; }
  }
  // The owner sits up front on essentially every leg. A rotating colleague
  // rarely clears half, so a majority share pins the owner reliably whether
  // they fly left or right seat.
  return (bestN / total >= 0.5) ? best : '';
}

// Top crewmembers the pilot's flown with most. Counts unique legs per
// canonical name; cpt + fo + cc1..cc5 all contribute. The pilot themselves
// (most-frequent CPT, detected heuristically) is excluded so the top spot
// isn't always "you". Returns canonical names — the UI flows them through
// displayCrew for nickname-awareness.
export function mostFlownCrew(legs, n = 5, year = null, pilotFrom = legs) {
  const inYear = year == null
    ? legs
    : legs.filter(l => legYear(l) === year);
  // Detect the pilot from the FULL leg history (not just YTD, and not just a
  // search's matches — filter on one captain and they'd look like the owner),
  // so the exclusion is stable.
  const pilot = detectPilotName(pilotFrom);
  const counts = new Map();
  for (const leg of inYear) {
    const d = leg.dataCard || {};
    const seen = new Set();
    for (const k of CREW_KEYS) {
      const v = (leg[k] || d[k] || '').toString().trim().toUpperCase();
      if (v) seen.add(v);
    }
    for (const name of seen) {
      if (pilot && name === pilot) continue;
      counts.set(name, (counts.get(name) | 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, count]) => ({ name, count }));
}

// Most recent UTC dep timestamp per non-home arrival airport, across ALL
// time (not year-filtered) — "when did I last fly there?". Returns a plain
// object { ICAO: ts } so it survives the storage snapshot round-trip.
export function lastToDestination(legs) {
  const out = {};
  for (const leg of legs) {
    const arr = String(leg.arr || '').toUpperCase();
    if (!arr || HOME.has(arr)) continue;
    const ts = depTs(leg);
    if (!Number.isFinite(ts)) continue;
    if (!out[arr] || ts > out[arr]) out[arr] = ts;
  }
  return out;
}

// Most recent UTC dep timestamp per crew member (any role), across ALL time
// — "when did I last fly with them?". Keyed by canonical UPPERCASE name.
export function lastWithCrew(legs) {
  const out = {};
  for (const leg of legs) {
    const d = leg.dataCard || {};
    const ts = depTs(leg);
    if (!Number.isFinite(ts)) continue;
    const seen = new Set();
    for (const k of CREW_KEYS) {
      const v = (leg[k] || d[k] || '').toString().trim().toUpperCase();
      if (v) seen.add(v);
    }
    for (const name of seen) {
      if (!out[name] || ts > out[name]) out[name] = ts;
    }
  }
  return out;
}

// Convenience: one shot at every metric for the current YTD.
// Every year the pilot has flown in, newest first — the choices for the year
// picker. Legs stored before dep_year existed resolve past-biased, so they can
// only land in the last 12 months; see the note on yearPast in dates.js.
export function availableYears(legs = allLegs()) {
  const years = new Set();
  for (const leg of legs) {
    const y = legYear(leg);
    if (y != null) years.add(y);
  }
  return [...years].sort((a, b) => b - a);
}

// year === null means ALL TIME. It used to be hardwired to the current year,
// so the panel silently showed year-to-date only and there was no way to ask
// for anything else.
//
// filters: the search's chosen terms (see matchesFilters). Every card is then
// computed over the matching flights only — "hours with this captain in
// 2025", "where I flew 4X-EKR" — while the year picker and the pilot
// detection still look at everything.
export function snapshot(year = new Date().getUTCFullYear(), filters = []) {
  const all = allLegs();
  const legs = filters.length ? all.filter(l => matchesFilters(l, filters)) : all;
  const inScope = year == null ? legs : legs.filter(l => legYear(l) === year);
  return {
    year,
    filters,
    legCount:  all.length,
    years:     availableYears(all),
    // The flights the cards describe, newest first — the search's result list.
    matches:   inScope.slice().reverse(),
    pool:      legs,
    top:       topDestinations(legs, 5, year),
    nights:    nightsAwayFromHome(legs, year),
    hours:     hoursFlown(legs, year),
    g:         avgMaxG(legs, year),
    crew:      mostFlownCrew(legs, 5, year, all),
    punct:     punctuality(legs, year),
    // All-time recency maps for the "last flew" sub-labels.
    lastDest:  lastToDestination(legs),
    lastCrew:  lastWithCrew(legs),
  };
}

// ---------- Punctuality ----------
// Off-block and in-block against the schedule, from the actual times the
// calendar ("Actual:" lines) and the crew-portal CSV (ATD / ATA) carry.
// On time = within 5 min of STD / STA; also counted within 15 (the industry
// A15). A delta beyond ±12 h is a data mismatch, not a delay, and is skipped.
export function punctuality(legs, year = null) {
  const side = () => ({ n: 0, on: 0, a15: 0, sum: 0 });
  const dep = side(), arr = side();
  const add = (acc, dlt) => {
    if (dlt == null || Math.abs(dlt) > 720) return;
    acc.n++; acc.sum += dlt;
    if (dlt <= 5) acc.on++;
    if (dlt <= 15) acc.a15++;
  };
  for (const leg of legs) {
    if (year != null && legYear(leg) !== year) continue;
    const pa = legPlanActual(leg);
    add(dep, pa.obtDelta);
    add(arr, pa.ibtDelta);
  }
  const out = (a) => a.n ? {
    n: a.n,
    onPct: Math.round(a.on / a.n * 100),
    a15Pct: Math.round(a.a15 / a.n * 100),
    avg: Math.round(a.sum / a.n),
  } : null;
  return { dep: out(dep), arr: out(arr) };
}

// ---------- Search ----------
// What a flight can be found by. Crew includes relief pilots, cabin and
// deadheads (one comma-separated field); destination is either end of the
// leg, so "AMS" finds the way out and the way home; aircraft is the tail and
// the type.
function crewOf(leg) {
  const d = leg.dataCard || {};
  const out = new Set();
  for (const k of CREW_FIELDS) {
    const raw = String(leg[k] || d[k] || '');
    for (const part of (k === 'dh' ? raw.split(',') : [raw])) {
      const v = part.trim().toUpperCase();
      if (v) out.add(v);
    }
  }
  return out;
}
export function legFacets(leg) {
  const d = leg.dataCard || {};
  const up = (v) => String(v || '').trim().toUpperCase();
  return {
    crew: crewOf(leg),
    dest: new Set([up(leg.dep), up(leg.arr)].filter(Boolean)),
    aircraft: new Set([up(leg.tail || d.tail), up(d.ac_type)].filter(Boolean)),
    flight: String(leg.flight || '').replace(/\D/g, '').replace(/^0+/, ''),
  };
}

// Every term the pilot could pick, with how many flights carry it — the
// search's suggestions. { crew: Map(name → n), dest: …, aircraft: …, flight: … }
export function searchIndex(legs = allLegs()) {
  const idx = { crew: new Map(), dest: new Map(), aircraft: new Map(), flight: new Map() };
  const bump = (m, v) => m.set(v, (m.get(v) | 0) + 1);
  for (const leg of legs) {
    const f = legFacets(leg);
    for (const v of f.crew) bump(idx.crew, v);
    for (const v of f.dest) bump(idx.dest, v);
    for (const v of f.aircraft) bump(idx.aircraft, v);
    if (f.flight) bump(idx.flight, f.flight);
  }
  return idx;
}

// filters: [{ type: 'crew'|'dest'|'aircraft'|'flight'|'text', value }].
// ALL must match — picking a captain and then AMS narrows to the AMS flights
// with that captain. 'text' is whatever was typed without picking a
// suggestion, matched as a substring against everything.
export function matchesFilters(leg, filters) {
  if (!filters || !filters.length) return true;
  const f = legFacets(leg);
  return filters.every(({ type, value }) => {
    const v = String(value || '').trim().toUpperCase();
    if (!v) return true;
    if (type === 'flight') return f.flight === v.replace(/\D/g, '').replace(/^0+/, '');
    if (type === 'crew' || type === 'dest' || type === 'aircraft') return f[type].has(v);
    const hay = [...f.crew, ...f.dest, ...f.aircraft, f.flight].join(' | ');
    return hay.includes(v) || (/^\D*\d+$/.test(v) && f.flight === v.replace(/\D/g, '').replace(/^0+/, ''));
  });
}

// ---------- Route heat ----------
// Every distinct route the pilot has flown, with how often and how recently.
// Direction is collapsed (TLV→JFK and JFK→TLV are one line on the map) because
// the map draws one segment between two airports either way.
export function routeHeat(legs = allLegs()) {
  const byPair = new Map();
  for (const leg of legs) {
    const a = String(leg.dep || '').toUpperCase().trim();
    const b = String(leg.arr || '').toUpperCase().trim();
    if (!a || !b || a === b) continue;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    const ts = depTs(leg);
    const hit = byPair.get(key);
    if (hit) {
      hit.count++;
      if (Number.isFinite(ts) && ts > hit.lastTs) hit.lastTs = ts;
    } else {
      byPair.set(key, { dep: a, arr: b, count: 1, lastTs: Number.isFinite(ts) ? ts : 0 });
    }
  }
  return [...byPair.values()].sort((x, y) => x.count - y.count);  // hottest last = drawn on top
}

// Raw material for the map's date filter: one entry per flown leg, with the
// timestamp, so the UI can re-aggregate for any window without re-reading
// storage on every slider move.
export function flownRoutes(legs = allLegs()) {
  const out = [];
  for (const leg of legs) {
    const a = String(leg.dep || '').toUpperCase().trim();
    const b = String(leg.arr || '').toUpperCase().trim();
    if (!a || !b || a === b) continue;
    const ts = depTs(leg);
    out.push({ dep: a, arr: b, ts: Number.isFinite(ts) ? ts : 0 });
  }
  return out;
}

// Aggregate a (possibly date-filtered) list into per-route counts + recency.
export function heatFrom(routeLegs) {
  const byPair = new Map();
  for (const r of routeLegs) {
    const key = r.dep < r.arr ? `${r.dep}|${r.arr}` : `${r.arr}|${r.dep}`;
    const hit = byPair.get(key);
    if (hit) { hit.count++; if (r.ts > hit.lastTs) hit.lastTs = r.ts; }
    else byPair.set(key, { dep: r.dep, arr: r.arr, count: 1, lastTs: r.ts });
  }
  return [...byPair.values()].sort((x, y) => x.count - y.count);
}
