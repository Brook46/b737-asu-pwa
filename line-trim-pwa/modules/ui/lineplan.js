// ui/lineplan.js — the line plan in the style of a manufacturer's rigging
// diagram (Ozone's, for one): the canopy's planform with its ribs, and every
// line drawn as a tree from its attachment point down its cascade to the riser.
//
//   · one half of the drawing is the structural lines of the side being
//     measured, the other half is that side's brakes (as Ozone draws it);
//   · front (A-riser) lines fan UP to the A riser, rear lines fan DOWN to theirs,
//     brakes fan down to the handle;
//   · the line being measured is traced end to end — point, cascade, main,
//     riser — so it's clear which physical line to put the laser on.
//
// The pilot's left side puts the lines on the screen's left (looking at the
// wing from behind, as the pilot sees it); the right side mirrors it.
// Cascade levels come from the manufacturer sheet when it names them (BGD:
// a1 → AMU1 → AM1 → AR1); otherwise a point joins its main, the main its riser.

import { parseLineId, sideOf, lineOf } from '../linemodel.js?v=17';
import { esc } from './dom.js?v=17';

const W = 360, H = 300, CX = 180, HALF = 172, CY = 150, CH = 74;
const ROW = { A: 0.12, B: 0.3, C: 0.55, D: 0.72, E: 0.84, K: 1, BR: 1 };
const chord = u => CH * Math.sqrt(Math.max(0.04, 1 - u * u));
const le = u => CY - chord(u) / 2;
const te = u => CY + chord(u) / 2;
const Y_UP = 16, Y_DOWN = H - 18;            // riser rows
const EDGE_UP = le(0) - 6, EDGE_DOWN = te(0) + 6;

const RISER_NAME = { A: 'A riser', B: 'B riser', C: 'C riser', D: 'D riser', E: 'E riser', K: 'Brake handle', BR: 'Brake handle', ST: 'Stabilo' };
const isBrake = r => r === 'K' || r === 'BR';

/** Span position 0 (centre) … 1 (tip) per point: its rib, else its number. */
export function spanOf(lineIds, ribs) {
  const hasRibs = ribs && lineIds.some(id => ribs[id] != null);
  if (hasRibs) {
    const max = Math.max(...lineIds.map(id => ribs[id] ?? 0));
    return { max, u: id => (ribs[id] != null ? Math.min(0.97, (ribs[id] + 0.5) / (max + 1.5)) : 0.95), ribs: true };
  }
  const maxIdx = Math.max(...lineIds.map(id => parseLineId(id).pos), 1);
  return { maxIdx, u: id => 0.05 + (parseLineId(id).pos - 1) / Math.max(1, maxIdx - 1) * 0.88, ribs: false };
}

/**
 * Parent links: leaf "pt:A1" → cascade… → main → root "riser:A" (or the main
 * itself when it names a riser, as Ozone's "A' riser" does).
 */
function buildTree(lineIds, mains, cascade) {
  const parent = new Map(), label = new Map(), dir = new Map();
  const mainOf = new Map();
  for (const m of mains) for (const id of m.lineIds) mainOf.set(id, m);
  for (const id of lineIds) {
    const m = mainOf.get(id);
    const riser = m?.riser || parseLineId(id).riser;
    const brake = isBrake(riser);
    const up = !brake && riser === 'A';
    const leaf = `pt:${id}`;
    // a synthetic group is a whole row the sheet doesn't split into mains:
    // draw the row straight to one node named for the row, not a riser
    const synthetic = !!m?.synthetic;
    const mainKey = m && !synthetic ? `m:${m.id}` : null;
    const rootIsMain = m && !synthetic && /riser$/i.test(m.id);
    const root = synthetic ? `row:${riser}` : rootIsMain ? mainKey : `riser:${brake ? 'K' : riser}`;
    const chain = (cascade?.[id] || []).filter(n => !m || n !== m.id).map(n => `c:${n}`);
    const path = [leaf, ...chain, ...(mainKey && mainKey !== root ? [mainKey] : []), root];
    for (let i = 0; i < path.length - 1; i++) if (!parent.has(path[i])) parent.set(path[i], path[i + 1]);
    for (const n of path) dir.set(n, brake ? 'brake' : up ? 'up' : 'down');
    if (mainKey) label.set(mainKey, m.id);
    chain.forEach(n => label.set(n, n.slice(2)));
    label.set(root, synthetic ? (brake ? 'Brakes' : `${riser} row`)
      : rootIsMain ? m.id : RISER_NAME[brake ? 'K' : riser] || `${riser} riser`);
  }
  return { parent, label, dir };
}

export function renderLinePlan(container, { lineIds, mains, cascade, ribs, activeKey, statusByKey = {}, onPick }) {
  const side = activeKey ? sideOf(activeKey) : 'L';
  const activeId = activeKey ? lineOf(activeKey) : null;
  // structure on the measured side's half, brakes on the other
  const sStruct = side === 'L' ? -1 : 1;
  const span = spanOf(lineIds, ribs);
  const { parent, label, dir } = buildTree(lineIds, mains || [], cascade);

  // ---- leaves
  const pos = new Map();
  const leaves = [];
  for (const id of lineIds) {
    const { riser } = parseLineId(id);
    const u = span.u(id);
    const brake = isBrake(riser);
    const x = CX + (brake ? -sStruct : sStruct) * u * HALF;
    const y = le(u) + (ROW[riser] ?? 0.5) * chord(u);
    pos.set(`pt:${id}`, { x, y });
    leaves.push({ id, key: `${side}:${id}`, x, y });
  }

  // ---- inner nodes: children, height above the leaves
  const kids = new Map();
  for (const [c, p] of parent) (kids.get(p) || kids.set(p, []).get(p)).push(c);
  // a node with one child adds nothing but a kink: skip it (roots stay)
  for (const [n, ks] of [...kids]) {
    if (ks.length !== 1 || !parent.has(n)) continue;
    const up = parent.get(n), only = ks[0];
    parent.set(only, up);
    parent.delete(n);
    kids.delete(n);
    const sib = kids.get(up);
    sib.splice(sib.indexOf(n), 1, only);
  }
  const height = new Map();
  const hOf = n => {
    if (height.has(n)) return height.get(n);
    const ks = kids.get(n);
    const h = ks ? 1 + Math.max(...ks.map(hOf)) : 0;
    height.set(n, h);
    return h;
  };
  const roots = [...kids.keys()].filter(n => !parent.has(n));
  roots.forEach(hOf);
  const maxH = { up: 1, down: 1, brake: 1 };
  for (const r of roots) maxH[dir.get(r)] = Math.max(maxH[dir.get(r)], height.get(r));

  const xOf = n => {
    if (pos.has(n)) return pos.get(n).x;
    const ks = kids.get(n) || [];
    const x = ks.reduce((a, k) => a + xOf(k), 0) / Math.max(1, ks.length);
    pos.set(n, { x, y: 0 });
    return x;
  };
  for (const r of roots) xOf(r);
  for (const [n, p] of pos) {
    if (n.startsWith('pt:')) continue;
    const d = dir.get(n), h = height.get(n), top = maxH[d];
    const isRoot = !parent.has(n);
    if (d === 'up') p.y = isRoot ? Y_UP : EDGE_UP - (h / top) * (EDGE_UP - Y_UP);
    else p.y = isRoot ? Y_DOWN : EDGE_DOWN + (h / top) * (Y_DOWN - EDGE_DOWN);
  }
  // keep riser labels apart along each row (rear risers and the brake handle
  // share the bottom row, so they're spaced together)
  for (const ds of [['up'], ['down', 'brake']]) {
    const rs = roots.filter(r => ds.includes(dir.get(r))).sort((a, b) => pos.get(a).x - pos.get(b).x);
    for (let i = 1; i < rs.length; i++) {
      const a = pos.get(rs[i - 1]), b = pos.get(rs[i]);
      if (b.x - a.x < 58) b.x = a.x + 58;
    }
  }

  // ---- the active line's path, and its whole main
  const activePath = new Set();
  if (activeId) for (let n = `pt:${activeId}`; n; n = parent.get(n)) activePath.add(n);
  const activeRoot = [...activePath].find(n => !parent.has(n));
  const inActiveTree = n => { for (let x = n; x; x = parent.get(x)) if (activePath.has(x) && x !== activeRoot) return true; return false; };

  // ---- canopy: lens outline, ribs, centre line
  const outline = [];
  for (let i = -48; i <= 48; i++) { const u = Math.abs(i) / 48; outline.push(`${(CX + (i / 48) * HALF).toFixed(1)},${le(u).toFixed(1)}`); }
  for (let i = 48; i >= -48; i--) { const u = Math.abs(i) / 48; outline.push(`${(CX + (i / 48) * HALF).toFixed(1)},${te(u).toFixed(1)}`); }
  const ribUs = [];
  if (span.ribs) for (let r = 0; r <= span.max + 1; r++) ribUs.push((r + 0.5) / (span.max + 1.5));
  else {
    const us = [...new Set(lineIds.map(id => span.u(id)))].sort((a, b) => a - b);
    us.forEach((u, i) => { ribUs.push(u); if (i) ribUs.push((u + us[i - 1]) / 2); });
    ribUs.push(0.015);
  }
  const ribLines = ribUs.filter(u => u < 0.995).flatMap(u => [-1, 1].map(s => {
    const x = (CX + s * u * HALF).toFixed(1);
    return `M${x} ${le(u).toFixed(1)}V${te(u).toFixed(1)}`;
  })).join('');

  // ---- edges
  let base = '', tree = '', trace = '';
  for (const [c, p] of parent) {
    const a = pos.get(c), b = pos.get(p);
    if (!a || !b) continue;
    const d = `M${a.x.toFixed(1)} ${a.y.toFixed(1)}L${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
    if (activePath.has(c)) trace += d;
    else if (inActiveTree(p) || (p === activeRoot)) tree += d;
    else base += d;
  }

  // ---- labels: every riser, and each node along the active line
  const txt = (x, y, t, cls, anchor = 'middle') =>
    `<text class="${cls}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}">${esc(t)}</text>`;
  let labels = '';
  for (const r of roots) {
    const p = pos.get(r), d = dir.get(r);
    labels += `<circle class="riser-node" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.4"/>`
      + txt(Math.min(W - 30, Math.max(30, p.x)), d === 'up' ? p.y - 6 : p.y + 14, label.get(r) || '', activePath.has(r) ? 'riser-label on' : 'riser-label');
  }
  for (const n of activePath) {
    if (n.startsWith('pt:') || !parent.has(n)) continue;
    const p = pos.get(n);
    const right = p.x < CX + sStruct * 40 ? p.x < CX : sStruct < 0;
    labels += `<circle class="node on" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2.6"/>`
      + txt(p.x + (right ? 6 : -6), p.y + 3.5, label.get(n) || '', 'node-label', right ? 'start' : 'end');
  }

  // ---- points
  let dots = '', halo = '';
  for (const l of leaves) {
    const st = statusByKey[l.key] || 'todo';
    const on = l.id === activeId;
    dots += `<circle class="pt ${st}${inActiveTree(`pt:${l.id}`) || on ? '' : ' faint'}" cx="${l.x.toFixed(1)}" cy="${l.y.toFixed(1)}" r="${on ? 5 : 3.2}"/>`;
    if (on) {
      halo = `<circle class="halo" cx="${l.x.toFixed(1)}" cy="${l.y.toFixed(1)}" r="8.5"/>`
        + `<text class="tag" x="${l.x.toFixed(1)}" y="${(l.y + (parseLineId(l.id).riser === 'A' ? 20 : -11)).toFixed(1)}" text-anchor="middle">${esc(l.id)}</text>`;
    }
  }

  const sideName = side === 'L' ? 'LEFT' : 'RIGHT';
  container.innerHTML = `
    <svg class="lineplan" viewBox="0 0 ${W} ${H}" role="img"
         aria-label="Line plan, ${sideName.toLowerCase()} side: ${leaves.length} lines. The highlighted line runs from ${esc(activeId || '')} to its riser. Tap a point to measure it.">
      <polygon class="canopy" points="${outline.join(' ')}"/>
      <path class="rib" d="${ribLines}"/>
      <path class="centre" d="M${CX} ${le(0) - 12}V${te(0) + 12}"/>
      ${txt(CX - sStruct * 7, le(0) - 5, 'BRAKES', 'half-label', sStruct < 0 ? 'start' : 'end')}
      ${leaves.some(l => isBrake(parseLineId(l.id).riser)) ? ''
        : txt(CX - sStruct * HALF / 2, CY + 4, 'no brake lengths on this sheet', 'half-label')}
      <path class="edge" d="${base}"/>
      <path class="edge tree" d="${tree}"/>
      <path class="edge trace" d="${trace}"/>
      ${labels}
      <g>${dots}</g>
      ${halo}
    </svg>`;

  const svg = container.querySelector('svg');
  svg.addEventListener('click', ev => {
    if (!onPick) return;
    const r = svg.getBoundingClientRect();
    const sx = (ev.clientX - r.left) * (W / r.width);
    const sy = (ev.clientY - r.top) * (H / r.height);
    let best = null, bestD = Infinity;
    for (const p of leaves) {
      const d = (p.x - sx) ** 2 + (p.y - sy) ** 2;
      if (d < bestD) { bestD = d; best = p; }
    }
    if (best && bestD < 20 * 20) onPick(best.key);
  });
  return svg;
}
