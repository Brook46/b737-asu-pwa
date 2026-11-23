// avoid.js — the great circle, bent round airspace a flight from Israel
// doesn't enter: Syria, Lebanon, Iraq, Iran, Ukraine, Russia, Belarus, Libya,
// Yemen, Afghanistan, Sudan. Used for the route when no filed route was
// pasted (a pasted route is always flown as written).
//
// Areas are FIRs from the app's own (rough, VAT-Spy) FIR outlines — the same
// ones the CPDLC banner uses — with a ~15 nm margin. When the great circle
// stays clear it's used as is. Otherwise a shortest path over a ½° grid round
// the blocked cells, then pulled tight (each point straight to the farthest
// one still in clear view), so it reads like a sensible routing, not a
// staircase. Rough by design: a picture of the likely way round, not a
// flight plan.
import { firAt } from './cpdlc.js?v=299';

// FIR id → country, for the ones avoided.
const AVOID = [
  [/^OS/, 'Syria'], [/^OL/, 'Lebanon'], [/^OR/, 'Iraq'], [/^OI/, 'Iran'],
  [/^UK/, 'Ukraine'], [/^UM/, 'Belarus / Kaliningrad'], [/^U[EHILNRSUW]/, 'Russia'],
  [/^HL/, 'Libya'], [/^OY/, 'Yemen'], [/^OA/, 'Afghanistan'], [/^HS/, 'Sudan'],
];
export function avoidedName(id) { const a = AVOID.find(([re]) => re.test(id || '')); return a ? a[1] : ''; }

const R = Math.PI / 180;
const hav = (a, b) => {
  const s = Math.sin((b.lat - a.lat) * R / 2) ** 2 + Math.cos(a.lat * R) * Math.cos(b.lat * R) * Math.sin((b.lon - a.lon) * R / 2) ** 2;
  return 2 * Math.asin(Math.sqrt(s)) * 3440.065;
};
function gcPoint(a, b, t) {
  const f1 = a.lat * R, l1 = a.lon * R, f2 = b.lat * R, l2 = b.lon * R;
  const d = 2 * Math.asin(Math.sqrt(Math.sin((f2 - f1) / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin((l2 - l1) / 2) ** 2));
  if (d < 1e-9) return { lat: a.lat, lon: a.lon };
  const A = Math.sin((1 - t) * d) / Math.sin(d), B = Math.sin(t * d) / Math.sin(d);
  const x = A * Math.cos(f1) * Math.cos(l1) + B * Math.cos(f2) * Math.cos(l2);
  const y = A * Math.cos(f1) * Math.sin(l1) + B * Math.cos(f2) * Math.sin(l2);
  const z = A * Math.sin(f1) + B * Math.sin(f2);
  return { lat: Math.atan2(z, Math.hypot(x, y)) / R, lon: Math.atan2(y, x) / R };
}

// A point is blocked if it, or anything ~15 nm round it, is in an avoided FIR.
const memo = new Map();
const M = 0.25;
function blockedAt(lat, lon) {
  const k = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  if (memo.has(k)) return memo.get(k);
  let hit = '';
  for (const [dy, dx] of [[0, 0], [M, 0], [-M, 0], [0, M], [0, -M], [M, M], [M, -M], [-M, M], [-M, -M]]) {
    const n = avoidedName(firAt(lat + dy, lon + dx / Math.max(0.3, Math.cos(lat * R))));
    if (n) { hit = n; break; }
  }
  if (memo.size > 60000) memo.clear();
  memo.set(k, hit);
  return hit;
}
// The countries a straight (great-circle) leg crosses, sampled every ~15 nm.
function crossed(a, b, out = new Set(), margin = true) {
  const n = Math.max(2, Math.ceil(hav(a, b) / 15));
  for (let i = 1; i < n; i++) {
    const p = gcPoint(a, b, i / n);
    const hit = margin ? blockedAt(p.lat, p.lon) : avoidedName(firAt(p.lat, p.lon));
    if (hit) out.add(hit);
  }
  return out;
}

// A → B round the avoided airspace: { wps: [{lat, lon}] (between A and B),
// around: ['Syria', …] } — or null when the great circle is already clear,
// or an end is itself inside an avoided area (nothing sensible to do).
export function avoidRoute(A, B) {
  const hits = crossed(A, B, new Set(), false);
  if (!hits.size) return null;
  if (avoidedName(firAt(A.lat, A.lon)) || avoidedName(firAt(B.lat, B.lon))) return null;
  const S = 0.5;
  const pad = 14;
  const lat0 = Math.max(-80, Math.min(A.lat, B.lat) - pad), lat1 = Math.min(80, Math.max(A.lat, B.lat) + pad);
  const lon0 = Math.min(A.lon, B.lon) - pad, lon1 = Math.max(A.lon, B.lon) + pad;
  const W = Math.ceil((lon1 - lon0) / S) + 1, H = Math.ceil((lat1 - lat0) / S) + 1;
  const cell = (p) => [Math.round((p.lon - lon0) / S), Math.round((p.lat - lat0) / S)];
  const pos = (x, y) => ({ lat: lat0 + y * S, lon: lon0 + x * S });
  const [sx, sy] = cell(A), [gx, gy] = cell(B);
  const idx = (x, y) => y * W + x;
  const goal = pos(gx, gy);
  const g = new Float64Array(W * H).fill(Infinity), from = new Int32Array(W * H).fill(-1), done = new Uint8Array(W * H);
  const blockedCell = new Int8Array(W * H).fill(-1);
  const isBlocked = (x, y) => {
    const i = idx(x, y);
    if (blockedCell[i] < 0) { const p = pos(x, y); blockedCell[i] = (x === sx && y === sy) || (x === gx && y === gy) ? 0 : blockedAt(p.lat, p.lon) ? 1 : 0; }
    return blockedCell[i] === 1;
  };
  // A small binary heap on f = g + h.
  const heap = [];
  const push = (i, f) => { heap.push([f, i]); let k = heap.length - 1; while (k) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
  const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1], [2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2]];
  const s = idx(sx, sy), t = idx(gx, gy);
  g[s] = 0; push(s, hav(A, goal));
  let steps = 0;
  while (heap.length && steps++ < 200000) {
    const [, i] = pop();
    if (done[i]) continue;
    done[i] = 1;
    if (i === t) break;
    const x = i % W, y = (i - x) / W, p = pos(x, y);
    for (const [dx, dy] of NB) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = idx(nx, ny);
      if (done[j] || isBlocked(nx, ny)) continue;
      // Knight moves skip a cell: both cells they pass must be clear.
      if ((Math.abs(dx) === 2 || Math.abs(dy) === 2) && (isBlocked(x + Math.sign(dx), y + Math.sign(dy)) || isBlocked(x + (Math.abs(dx) === 2 ? Math.sign(dx) : 0), y + (Math.abs(dy) === 2 ? Math.sign(dy) : 0)))) continue;
      const q = pos(nx, ny), ng = g[i] + hav(p, q);
      if (ng < g[j]) { g[j] = ng; from[j] = i; push(j, ng + hav(q, goal)); }
    }
  }
  if (from[t] < 0) return null;
  const path = [];
  for (let i = t; i >= 0; i = from[i]) { const x = i % W, y = (i - x) / W; path.unshift(pos(x, y)); if (i === s) break; }
  path[0] = { lat: A.lat, lon: A.lon }; path[path.length - 1] = { lat: B.lat, lon: B.lon };
  // Pull it tight: from each kept point, straight to the farthest point in view.
  const clear = (a, b) => crossed(a, b).size === 0;
  const out = [path[0]];
  let k = 0;
  while (k < path.length - 1) {
    let j = path.length - 1;
    while (j > k + 1 && !clear(path[k], path[j])) j--;
    out.push(path[j]); k = j;
  }
  return { wps: out.slice(1, -1), around: [...hits] };
}
