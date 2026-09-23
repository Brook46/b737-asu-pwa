// ui/charts.js — the three pictures that make a trim check readable.
//
//  trimProfile  small multiples (Left, Right): deviation of every line against
//               the reference, one 2px line per riser row, centre → tip, with the
//               tolerance band shaded. The row lines' relative height IS the
//               angle of incidence, so the shape reads at a glance.
//  aoiBars      diverging bars per section: + faster / − slower.
//  gauge        the single-reading needle on the measure screen.
//
// Row colours come from --row-A…E (validated categorical order); text always
// uses ink tokens. Every chart has a legend or title naming its series and a
// table elsewhere on the page holds every value, so hover only enhances.

import { parseLineId } from '../linemodel.js?v=14';
import { signed } from './dom.js?v=14';

const ROWS = ['A', 'B', 'C', 'D', 'E'];
const NS = 'http://www.w3.org/2000/svg';

function niceMax(v, min = 20) {
  const m = Math.max(min, Math.ceil((Math.abs(v) + 4) / 10) * 10);
  return m;
}

// ------------------------------------------------------------------ tooltip
let tip = null;
function showTip(x, y, rows, title) {
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'tooltip';
    document.body.appendChild(tip);
  }
  tip.replaceChildren();
  if (title) {
    const t = document.createElement('div');
    t.style.cssText = 'font-size:12px;opacity:.75;margin-bottom:3px';
    t.textContent = title;
    tip.appendChild(t);
  }
  for (const r of rows) {
    const line = document.createElement('div');
    line.style.cssText = 'display:flex;align-items:center;gap:6px';
    if (r.color) {
      const key = document.createElement('i');
      key.style.cssText = `display:inline-block;width:12px;height:3px;border-radius:2px;background:${r.color}`;
      line.appendChild(key);
    }
    const v = document.createElement('b');
    v.textContent = r.value;
    const l = document.createElement('span');
    l.textContent = ' ' + r.label;
    line.append(v, l);
    tip.appendChild(line);
  }
  tip.hidden = false;
  const pad = 12, w = tip.offsetWidth, h = tip.offsetHeight;
  let left = x + pad, top = y - h - pad;
  if (left + w > window.innerWidth - 8) left = x - w - pad;
  if (top < 8) top = y + pad;
  tip.style.left = `${Math.max(8, left)}px`;
  tip.style.top = `${top}px`;
}
export function hideTip() { if (tip) tip.hidden = true; }

// ------------------------------------------------------------ trim profile
/**
 * @param lines  analysis lines for ONE side: [{ lineId, riser, rel, status }]
 * @param ribs   { lineId: rib } or null
 * @param yMax   shared scale so the two sides compare honestly
 */
export function trimProfile({ lines, ribs, tol, yMax, title }) {
  const W = 340, H = 190, L = 38, R = 22, T = 10, B = 26;
  const pw = W - L - R, ph = H - T - B;
  const structural = lines.filter(l => ROWS.includes(l.riser));
  const xOf = l => (ribs && ribs[l.lineId] != null ? ribs[l.lineId] : parseLineId(l.lineId).pos);
  const xs = structural.map(xOf);
  const x0 = Math.min(...xs, 1), x1 = Math.max(...xs, x0 + 1);
  const sx = v => L + ((v - x0) / (x1 - x0)) * pw;
  const sy = v => T + ph / 2 - (Math.max(-yMax, Math.min(yMax, v)) / yMax) * (ph / 2);

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'chart');
  svg.setAttribute('role', 'img');
  svg.setAttribute('tabindex', '0');
  svg.setAttribute('aria-label', `${title}: deviation of each line from the reference, centre to tip. Values are in the readings table.`);

  const parts = [];
  // tolerance band + grid
  parts.push(`<rect class="band" x="${L}" y="${sy(tol)}" width="${pw}" height="${sy(-tol) - sy(tol)}"/>`);
  const step = yMax > 40 ? 20 : 10;
  for (let v = -yMax; v <= yMax; v += step) {
    parts.push(`<line class="${v === 0 ? 'zero' : 'grid'}" x1="${L}" x2="${L + pw}" y1="${sy(v)}" y2="${sy(v)}"/>`);
    parts.push(`<text class="axis-t" x="${L - 6}" y="${sy(v) + 3.5}" text-anchor="end">${v > 0 ? '+' : ''}${v}</text>`);
  }
  parts.push(`<text class="axis-t" x="${L}" y="${H - 6}">centre</text>`);
  parts.push(`<text class="axis-t" x="${L + pw}" y="${H - 6}" text-anchor="end">tip</text>`);
  parts.push(`<text class="axis-t" x="${L + pw / 2}" y="${H - 6}" text-anchor="middle">${ribs ? 'rib' : 'line no.'}</text>`);

  // series
  const present = ROWS.filter(r => structural.some(l => l.riser === r));
  const ends = [];
  for (const r of present) {
    const pts = structural.filter(l => l.riser === r).sort((a, b) => xOf(a) - xOf(b));
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(xOf(p)).toFixed(1)},${sy(p.rel).toFixed(1)}`).join('');
    parts.push(`<path class="series" d="${d}" stroke="var(--row-${r})"/>`);
    for (const p of pts) {
      parts.push(`<circle class="mark" cx="${sx(xOf(p)).toFixed(1)}" cy="${sy(p.rel).toFixed(1)}" r="4" fill="var(--row-${r})"/>`);
    }
    const last = pts[pts.length - 1];
    ends.push({ r, y: sy(last.rel), x: sx(xOf(last)) });
  }
  // direct end labels, only when they don't collide (legend carries identity anyway)
  ends.sort((a, b) => a.y - b.y);
  for (let i = 0; i < ends.length; i++) {
    const tooClose = (i > 0 && ends[i].y - ends[i - 1].y < 11) || (i < ends.length - 1 && ends[i + 1].y - ends[i].y < 11);
    if (!tooClose) parts.push(`<text class="direct" x="${ends[i].x + 7}" y="${ends[i].y + 4}" fill="var(--ink-2)">${ends[i].r}</text>`);
  }
  parts.push(`<line class="xhair" x1="0" x2="0" y1="${T}" y2="${T + ph}" visibility="hidden"/>`);
  parts.push(`<rect class="hit" x="${L}" y="${T}" width="${pw}" height="${ph}"/>`);
  svg.innerHTML = parts.join('');

  // crosshair: snap to the nearest x that has data, list every row there
  const xsSorted = [...new Set(xs)].sort((a, b) => a - b);
  const xhair = svg.querySelector('.xhair');
  let focusIdx = 0;
  function at(xv, clientX, clientY) {
    const px = sx(xv);
    xhair.setAttribute('x1', px); xhair.setAttribute('x2', px); xhair.setAttribute('visibility', 'visible');
    const here = structural.filter(l => xOf(l) === xv).sort((a, b) => ROWS.indexOf(a.riser) - ROWS.indexOf(b.riser));
    showTip(clientX, clientY, here.map(l => ({ color: `var(--row-${l.riser})`, value: signed(l.rel), label: l.lineId })),
      `${title} · ${ribs ? 'rib' : 'no.'} ${xv}`);
  }
  svg.addEventListener('pointermove', ev => {
    const r = svg.getBoundingClientRect();
    const vx = x0 + (((ev.clientX - r.left) * (W / r.width)) - L) / pw * (x1 - x0);
    let best = xsSorted[0];
    for (const v of xsSorted) if (Math.abs(v - vx) < Math.abs(best - vx)) best = v;
    focusIdx = xsSorted.indexOf(best);
    at(best, ev.clientX, ev.clientY);
  });
  svg.addEventListener('pointerleave', () => { xhair.setAttribute('visibility', 'hidden'); hideTip(); });
  svg.addEventListener('keydown', ev => {
    if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return;
    ev.preventDefault();
    focusIdx = Math.max(0, Math.min(xsSorted.length - 1, focusIdx + (ev.key === 'ArrowRight' ? 1 : -1)));
    const r = svg.getBoundingClientRect();
    at(xsSorted[focusIdx], r.left + (sx(xsSorted[focusIdx]) / W) * r.width, r.top + 20);
  });
  svg.addEventListener('blur', () => { xhair.setAttribute('visibility', 'hidden'); hideTip(); });
  return { svg, rows: present };
}

/** Shared y-scale for the two sides. */
export function profileScale(allLines) {
  const vals = allLines.filter(l => ROWS.includes(l.riser)).map(l => Math.abs(l.rel));
  return niceMax(Math.max(0, ...vals));
}

// --------------------------------------------------------------- AoI bars
/**
 * items: [{ label, L: mm|null, R: mm|null }] — + faster, − slower.
 */
export function aoiBars({ items, tol }) {
  const rowH = 22, gap = 14, W = 340, L = 92, R = 58;
  const pw = W - L - R, mid = L + pw / 2;
  const maxV = niceMax(Math.max(tol, ...items.flatMap(i => [i.L, i.R]).filter(v => v != null).map(Math.abs)), 10);
  const H = items.length * (rowH * 2 + gap) + 26;
  const sx = v => mid + (Math.max(-maxV, Math.min(maxV, v)) / maxV) * (pw / 2);

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'chart');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Angle of incidence per section, left and right. Positive is faster, negative slower.');
  const parts = [];
  parts.push(`<rect class="band" x="${sx(-tol / 2)}" y="0" width="${sx(tol / 2) - sx(-tol / 2)}" height="${H - 22}"/>`);
  parts.push(`<line class="zero" x1="${mid}" x2="${mid}" y1="0" y2="${H - 22}"/>`);
  parts.push(`<text class="axis-t" x="${L}" y="${H - 6}">← slower</text>`);
  parts.push(`<text class="axis-t" x="${L + pw}" y="${H - 6}" text-anchor="end">faster →</text>`);

  const hits = [];
  items.forEach((it, i) => {
    const y0 = i * (rowH * 2 + gap) + 4;
    parts.push(`<text class="axis-s" x="0" y="${y0 + rowH + 3}">${it.label}</text>`);
    [['L', 'Left'], ['R', 'Right']].forEach(([k, name], j) => {
      const v = it[k];
      const y = y0 + j * rowH + 2, h = rowH - 6;
      parts.push(`<text class="axis-t" x="${L - 8}" y="${y + h / 2 + 3.5}" text-anchor="end">${name[0]}</text>`);
      if (v == null) return;
      const xa = sx(0), xb = sx(v);
      const x = Math.min(xa, xb), w = Math.max(2, Math.abs(xb - xa));
      const fill = v >= 0 ? 'var(--row-A)' : 'var(--row-B)';
      // 4px rounded data end, square at the baseline
      const rx = Math.min(4, w / 2);
      const d = v >= 0
        ? `M${x},${y}h${w - rx}q${rx},0 ${rx},${rx}v${h - 2 * rx}q0,${rx} -${rx},${rx}h-${w - rx}z`
        : `M${x + w},${y}h-${w - rx}q-${rx},0 -${rx},${rx}v${h - 2 * rx}q0,${rx} ${rx},${rx}h${w - rx}z`;
      parts.push(`<path d="${d}" fill="${fill}"/>`);
      const tx = v >= 0 ? xb + 6 : xb - 6;
      parts.push(`<text class="axis-s" x="${tx}" y="${y + h / 2 + 4}" text-anchor="${v >= 0 ? 'start' : 'end'}">${signed(v, '')}</text>`);
      hits.push({ x: L, y, w: pw, h: rowH, v, name, label: it.label });
    });
  });
  for (const hh of hits) parts.push(`<rect class="hit" x="${hh.x}" y="${hh.y - 2}" width="${hh.w}" height="${hh.h}" data-i="${hits.indexOf(hh)}"/>`);
  svg.innerHTML = parts.join('');
  svg.querySelectorAll('.hit').forEach(r => {
    const hh = hits[+r.dataset.i];
    r.addEventListener('pointermove', ev => showTip(ev.clientX, ev.clientY,
      [{ value: signed(hh.v), label: hh.v >= 0 ? 'faster than factory' : 'slower than factory' }], `${hh.label} · ${hh.name}`));
    r.addEventListener('pointerleave', hideTip);
  });
  return svg;
}

// ------------------------------------------------------------------ gauge
/** The needle for one reading. delta in mm; returns an SVG string. */
export function gauge(delta, tol) {
  const W = 320, H = 44, L = 14, R = 14, span = Math.max(30, tol * 3);
  const pw = W - L - R;
  const sx = v => L + ((Math.max(-span, Math.min(span, v)) + span) / (2 * span)) * pw;
  const status = delta == null ? null : Math.abs(delta) <= tol ? 'good' : Math.abs(delta) <= tol * 2 ? 'warn' : 'bad';
  const color = status === 'good' ? 'var(--good)' : status === 'warn' ? '#d58c00' : 'var(--bad)';
  const ticks = [-2 * tol, -tol, 0, tol, 2 * tol].map(v =>
    `<text class="tick" x="${sx(v)}" y="${H - 2}" text-anchor="middle">${v > 0 ? '+' : ''}${v}</text>`).join('');
  const needle = delta == null ? '' : (() => {
    const x = sx(delta);
    const over = Math.abs(delta) > span;
    return `<line class="needle" x1="${x}" x2="${x}" y1="4" y2="26" stroke="${color}"/>`
      + (over ? `<path d="${delta > 0 ? `M${x + 4},9 l6,6 -6,6z` : `M${x - 4},9 l-6,6 6,6z`}" fill="${color}"/>` : '');
  })();
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${delta == null ? 'No reading yet' : `Deviation ${signed(delta)}, tolerance ±${tol} mm`}">
    <rect class="band" x="${sx(-tol)}" y="6" width="${sx(tol) - sx(-tol)}" height="18" rx="4"/>
    <line class="axis" x1="${L}" x2="${W - R}" y1="15" y2="15"/>
    <line class="zero" x1="${sx(0)}" x2="${sx(0)}" y1="6" y2="24"/>
    ${ticks}${needle}
  </svg>`;
}
