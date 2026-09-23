// ui/planform.js — the canopy seen from above, one dot per attachment point.
//
// With rib positions from the manufacturer sheet each dot sits on its real rib,
// so the picture matches the wing on the grass. Without them, points are spread
// by their number along the span. Screen-left is the pilot's left (wing seen
// from above, flying away from you). Taps pick the NEAREST dot, which keeps a
// dense 70-point wingtip usable with a thumb.

import { parseLineId, lineOf, sideOf } from '../linemodel.js?v=9';
import { esc } from './dom.js?v=9';

const W = 360, CX = 180, HALF = 164, TOP = 22;
const ROW_Y = { A: 0.10, B: 0.30, C: 0.52, D: 0.70, E: 0.82, K: 0.96, BR: 0.96 };

const leadingEdge = u => TOP + 24 * Math.pow(u, 2.4);
const chord = u => 96 * Math.sqrt(Math.max(0.06, 1 - 0.8 * u * u));

function spanOf(lineIds, ribs) {
  const hasRibs = ribs && lineIds.some(id => ribs[id] != null);
  if (hasRibs) {
    const max = Math.max(...lineIds.map(id => ribs[id] ?? 0));
    return id => {
      const r = ribs[id];
      if (r != null) return Math.min(0.97, (r + 0.5) / (max + 1.5));
      // no rib for this one: park it at its row's tip
      return 0.95;
    };
  }
  const maxIdx = Math.max(...lineIds.map(id => parseLineId(id).index), 1);
  return id => 0.05 + (parseLineId(id).index - 1) / Math.max(1, maxIdx - 1) * 0.88;
}

export function renderPlanform(container, { lineIds, ribs, activeKey, statusByKey = {}, onPick }) {
  const u = spanOf(lineIds, ribs);
  const H = TOP + 96 + 34;
  const activeSide = activeKey ? sideOf(activeKey) : null;

  // outline: leading edge tip→tip, trailing edge back
  const le = [], te = [];
  for (let i = -40; i <= 40; i++) {
    const uu = Math.abs(i) / 40, x = CX + (i / 40) * HALF;
    le.push(`${x.toFixed(1)},${leadingEdge(uu).toFixed(1)}`);
    te.unshift(`${x.toFixed(1)},${(leadingEdge(uu) + chord(uu)).toFixed(1)}`);
  }

  const pts = [];
  for (const id of lineIds) {
    const { riser } = parseLineId(id);
    const uu = u(id);
    const y = leadingEdge(uu) + (ROW_Y[riser] ?? 0.5) * chord(uu);
    for (const side of ['L', 'R']) {
      const x = CX + (side === 'L' ? -1 : 1) * uu * HALF;
      pts.push({ key: `${side}:${id}`, id, side, x, y });
    }
  }

  const rowsPresent = [...new Set(lineIds.map(id => parseLineId(id).riser))];
  const rowLabels = rowsPresent.map(r => {
    const y = leadingEdge(0) + (ROW_Y[r] ?? 0.5) * chord(0);
    return `<text class="rowlabel" x="${CX}" y="${(y + 3.5).toFixed(1)}" text-anchor="middle">${r === 'K' || r === 'BR' ? 'K' : esc(r)}</text>`;
  }).join('');

  let active = '';
  const dots = pts.map(p => {
    const st = statusByKey[p.key] || 'todo';
    const isActive = p.key === activeKey;
    const dim = activeSide && p.side !== activeSide && !isActive ? ' dim' : '';
    if (isActive) {
      const anchor = p.x < 40 ? 'start' : p.x > W - 40 ? 'end' : 'middle';
      active = `<circle class="halo" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="9"/>`
        + `<text class="tag" x="${p.x.toFixed(1)}" y="${(p.y - 13).toFixed(1)}" text-anchor="${anchor}">${esc(p.id)}</text>`;
    }
    return `<circle class="pt ${st}${dim}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${isActive ? 5.5 : 3.8}"/>`;
  }).join('');

  container.innerHTML = `
    <svg class="planform" viewBox="0 0 ${W} ${H}" role="img"
         aria-label="Wing from above. ${pts.length} attachment points; tap one to measure it.">
      <polygon class="outline" points="${[...le, ...te].join(' ')}"/>
      <text class="sidelabel" x="6" y="12">LEFT</text>
      <text class="sidelabel" x="${W - 6}" y="12" text-anchor="end">RIGHT</text>
      ${rowLabels}
      <g>${dots}</g>
      ${active}
    </svg>`;

  const svg = container.querySelector('svg');
  svg.addEventListener('click', ev => {
    if (!onPick) return;
    const r = svg.getBoundingClientRect();
    const sx = (ev.clientX - r.left) * (W / r.width);
    const sy = (ev.clientY - r.top) * (H / r.height);
    let best = null, bestD = Infinity;
    for (const p of pts) {
      const d = (p.x - sx) ** 2 + (p.y - sy) ** 2;
      if (d < bestD) { bestD = d; best = p; }
    }
    if (best && bestD < 22 * 22) onPick(best.key);
  });
  return svg;
}

export { lineOf };
