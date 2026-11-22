// altn.js — the alternates, chosen by hand per destination and kept on this
// device: Porto's are there on every Porto flight until they're changed.
//
// fc.altn = { <arrival code>: ['LPPR', 'LPFR'] }. Saves from before there
// could be several hold one string ('LEGE'); read as a list of one.

const KEY = 'fc.altn';
export const MAX = 4;

function all() {
  try { const o = JSON.parse(localStorage.getItem(KEY) || '{}'); return o && typeof o === 'object' ? o : {}; } catch { return {}; }
}
const norm = (c) => String(c || '').trim().toUpperCase();

export function altnsFor(arr) {
  const v = all()[norm(arr)];
  const list = Array.isArray(v) ? v : v ? [v] : [];
  return [...new Set(list.map(norm).filter(Boolean))];
}
export function setAltns(arr, list) {
  const k = norm(arr);
  if (!k) return;
  const o = all();
  const clean = [...new Set((list || []).map(norm).filter(Boolean))].slice(0, MAX);
  if (clean.length) o[k] = clean; else delete o[k];
  try { localStorage.setItem(KEY, JSON.stringify(o)); } catch {}
  try { window.dispatchEvent(new CustomEvent('fc:altn-changed')); } catch {}
}
export function addAltn(arr, code) {
  const cur = altnsFor(arr);
  if (cur.includes(norm(code))) return false;
  if (cur.length >= MAX) return false;
  setAltns(arr, [...cur, code]);
  return true;
}
export function removeAltn(arr, code) {
  setAltns(arr, altnsFor(arr).filter(c => c !== norm(code)));
}
