// altn.js — the alternates, chosen by hand and kept on this device. Two
// kinds, shown together:
//   for every flight to a destination — Porto's are there on every Porto
//     flight until removed (fc.altn = { <arrival code>: ['LPPR', …] });
//   for one flight only (fc.altnFlight = { <flight key>: ['LEGE', …] }).
// Saves from before there could be several hold one string ('LEGE'); read
// as a list of one.

const KEY = 'fc.altn';
const FKEY = 'fc.altnFlight';
export const MAX = 4;

function read(k) {
  try { const o = JSON.parse(localStorage.getItem(k) || '{}'); return o && typeof o === 'object' ? o : {}; } catch { return {}; }
}
function write(k, o) {
  try { localStorage.setItem(k, JSON.stringify(o)); } catch {}
  try { window.dispatchEvent(new CustomEvent('fc:altn-changed')); } catch {}
}
const norm = (c) => String(c || '').trim().toUpperCase();
const listOf = (v) => [...new Set((Array.isArray(v) ? v : v ? [v] : []).map(norm).filter(Boolean))];
export function flightKey(leg) {
  return [String(leg?.flight || '').replace(/\D/g, '').replace(/^0+/, ''), leg?.dep_date, leg?.dep_year, norm(leg?.dep), norm(leg?.arr)].join('|');
}

// Every flight to `arr`.
export function altnsFor(arr) { return listOf(read(KEY)[norm(arr)]); }
// This flight only.
export function flightAltns(leg) { return leg ? listOf(read(FKEY)[flightKey(leg)]) : []; }
// Both, destination's first: what the Brief, Route info and the chips show.
export function altnsOfLeg(leg) {
  const a = altnsFor(leg?.arr);
  return [...a, ...flightAltns(leg).filter(c => !a.includes(c))].slice(0, MAX);
}
// 'dest' | 'flight' | '' — which list holds `code` for this leg.
export function scopeOf(leg, code) {
  const c = norm(code);
  return altnsFor(leg?.arr).includes(c) ? 'dest' : flightAltns(leg).includes(c) ? 'flight' : '';
}

export function setAltns(arr, list) {
  const k = norm(arr);
  if (!k) return;
  const o = read(KEY), clean = listOf(list).slice(0, MAX);
  if (clean.length) o[k] = clean; else delete o[k];
  write(KEY, o);
}
function setFlight(leg, list) {
  const o = read(FKEY), k = flightKey(leg), clean = listOf(list).slice(0, MAX);
  delete o[k];                       // re-set at the end: newest last
  if (clean.length) o[k] = clean;
  // A few hundred flights at most; the oldest go first.
  const keys = Object.keys(o);
  for (const old of keys.slice(0, Math.max(0, keys.length - 300))) delete o[old];
  write(FKEY, o);
}
// `scope` 'flight' (default) or 'dest'. False when it's already there or full.
export function addAltn(leg, code, scope = 'flight') {
  const c = norm(code);
  if (!c || altnsOfLeg(leg).includes(c) || altnsOfLeg(leg).length >= MAX) return false;
  if (scope === 'dest') setAltns(leg?.arr, [...altnsFor(leg?.arr), c]);
  else setFlight(leg, [...flightAltns(leg), c]);
  return true;
}
// Off this flight's list and the destination's, whichever holds it.
export function removeAltn(leg, code) {
  const c = norm(code);
  if (altnsFor(leg?.arr).includes(c)) setAltns(leg?.arr, altnsFor(leg?.arr).filter(x => x !== c));
  if (flightAltns(leg).includes(c)) setFlight(leg, flightAltns(leg).filter(x => x !== c));
}
// Move one between "this flight" and "every flight to the destination".
export function moveAltn(leg, code, scope) {
  const c = norm(code);
  if (scopeOf(leg, c) === scope) return;
  removeAltn(leg, c);
  if (scope === 'dest') setAltns(leg?.arr, [...altnsFor(leg?.arr), c]);
  else setFlight(leg, [...flightAltns(leg), c]);
}
