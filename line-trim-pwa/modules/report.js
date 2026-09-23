// report.js — the printable check report: which glider, the verdict, three views
// of the wing (from below, from the front, from the side) coloured by how far each
// line is off, and a table of every line with its position, target, reading and
// difference, left and right side by side.
//
// One self-contained HTML page (inline styles and SVG) so it prints, saves as PDF
// and opens anywhere, offline. Colours: status only — in tolerance, a bit out,
// out — each also carried by a sign in the table, never by colour alone.

import { analyse } from './trim.js?v=14';
import { parseLineId, isBrakeRiser } from './linemodel.js?v=14';
import { spanOf } from './ui/lineplan.js?v=14';
import { download } from './exporter.js?v=14';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const signed = v => (v == null || !Number.isFinite(v) ? '–' : (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(Math.round(v * 10) / 10));
const fmt = v => (v == null || !Number.isFinite(v) ? '–' : String(Math.round(v * 10) / 10));
const COL = { good: '#1f8a4c', warn: '#c77c00', bad: '#c62828', none: '#a7adb3' };
const MARK = { good: '✓', warn: '!', bad: '✕' };
const ROW_CHORD = { A: 0.12, B: 0.3, C: 0.52, D: 0.7, E: 0.82, K: 1, BR: 1, ST: 0.9 };
const ROWS = ['A', 'B', 'C', 'D', 'E', 'K', 'BR', 'ST'];
const dateOf = s => s.measuredOn || new Date(s.savedAt || s.createdAt).toISOString().slice(0, 10);

// ---- views ----------------------------------------------------------------------

/** From below: the planform, leading edge up; seen from below, the pilot's left is on the right. */
function viewBelow(s, byKey, span) {
  const W = 720, H = 250, CX = W / 2, HALF = 330, CY = 118, CH = 150;
  const chord = u => CH * Math.sqrt(Math.max(0.04, 1 - u * u));
  const le = u => CY - chord(u) / 2;
  const pts = [], out = [];
  for (let i = -60; i <= 60; i++) { const u = Math.abs(i) / 60; out.push(`${(CX + (i / 60) * HALF).toFixed(1)},${le(u).toFixed(1)}`); }
  for (let i = 60; i >= -60; i--) { const u = Math.abs(i) / 60; out.push(`${(CX + (i / 60) * HALF).toFixed(1)},${(le(u) + chord(u)).toFixed(1)}`); }
  for (const id of Object.keys(s.nominal)) {
    const { riser } = parseLineId(id);
    const u = span.u(id);
    for (const side of ['L', 'R']) {
      const x = CX + (side === 'L' ? 1 : -1) * u * HALF;     // mirrored: seen from below
      const y = le(u) + (ROW_CHORD[riser] ?? 0.5) * chord(u);
      const l = byKey.get(`${side}:${id}`);
      pts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${l ? 4.2 : 3.2}" fill="${l ? COL[l.status] : '#fff'}" stroke="${l ? '#fff' : COL.none}" stroke-width="${l ? 1 : 1.2}"/>`);
    }
  }
  const rowLabels = [...new Set(Object.keys(s.nominal).map(id => parseLineId(id).riser))]
    .map(r => `<text x="${CX}" y="${(le(0) + (ROW_CHORD[r] ?? 0.5) * chord(0) + 4).toFixed(1)}" class="rl">${esc(isBrakeRiser(r) ? 'K' : r)}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="view" role="img" aria-label="The wing from below">
    <polygon points="${out.join(' ')}" fill="#f4f6f5" stroke="#8a9299" stroke-width="1.2"/>
    <line x1="${CX}" y1="${le(0) - 8}" x2="${CX}" y2="${le(0) + chord(0) + 8}" stroke="#c9cfd4" stroke-dasharray="3 3"/>
    <text x="${CX}" y="14" class="cap">LEADING EDGE ↑</text>
    <text x="${CX + HALF - 4}" y="${H - 8}" class="side" text-anchor="end">LEFT (pilot's)</text>
    <text x="${CX - HALF + 4}" y="${H - 8}" class="side" text-anchor="start">RIGHT (pilot's)</text>
    ${rowLabels}${pts.join('')}</svg>`;
}

/** From the front: the arc of the wing, every line down to its riser. */
function viewFront(s, byKey, span) {
  const W = 720, H = 330, CX = W / 2, R = 250, TOP = 24, THETA = 1.12;     // ~64° out to the tip
  const riserY = TOP + R + 40;
  const at = (u, side) => {
    const t = u * THETA;
    return { x: CX + (side === 'L' ? 1 : -1) * R * 1.28 * Math.sin(t), y: TOP + R - R * Math.cos(t) };
  };
  let arc = '';
  for (const side of ['L', 'R']) {
    const p = []; for (let i = 0; i <= 40; i++) { const q = at(i / 40, side); p.push(`${q.x.toFixed(1)},${q.y.toFixed(1)}`); }
    arc += `<polyline points="${p.join(' ')}" fill="none" stroke="#8a9299" stroke-width="7" stroke-linecap="round" opacity=".25"/>`;
  }
  // rows overlap from the front: drop each row a little for depth, and draw the
  // lines that are off last, worst on top, so they can't hide behind good ones
  const RANK = { none: 0, good: 1, warn: 2, bad: 3 };
  const items = [];
  for (const id of Object.keys(s.nominal)) {
    const { riser } = parseLineId(id);
    const drop = Math.max(0, ROWS.indexOf(riser)) * 4;
    for (const side of ['L', 'R']) {
      const p = at(span.u(id), side);
      const l = byKey.get(`${side}:${id}`);
      items.push({ x: p.x, y: p.y + drop, rx: CX + (side === 'L' ? 1 : -1) * (isBrakeRiser(riser) ? 30 : 14), st: l ? l.status : 'none' });
    }
  }
  items.sort((a, b) => RANK[a.st] - RANK[b.st]);
  let ls = '', dots = '';
  for (const it of items) {
    const c = COL[it.st], off = it.st === 'warn' || it.st === 'bad';
    ls += `<line x1="${it.x.toFixed(1)}" y1="${it.y.toFixed(1)}" x2="${it.rx}" y2="${riserY}" stroke="${c}" stroke-width="${off ? 1.8 : 0.7}" opacity="${off ? 1 : 0.45}"/>`;
    dots += `<circle cx="${it.x.toFixed(1)}" cy="${it.y.toFixed(1)}" r="${off ? 3 : 2.2}" fill="${c}"/>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" class="view" role="img" aria-label="The wing from the front">
    ${arc}${ls}${dots}
    <rect x="${CX - 22}" y="${riserY}" width="44" height="16" rx="4" fill="#5b636b"/>
    <text x="${CX}" y="${riserY + 34}" class="cap">risers</text>
    <text x="${CX + 340}" y="${H - 8}" class="side" text-anchor="end">LEFT (pilot's)</text>
    <text x="${CX - 340}" y="${H - 8}" class="side" text-anchor="start">RIGHT (pilot's)</text></svg>`;
}

/** From the left side: the profile, each row's lines, and the trim tilt (exaggerated). */
function viewSide(s, a) {
  const W = 720, H = 360, X0 = 90, X1 = 560, Y = 80, riser = { x: X0 + (X1 - X0) * 0.36, y: 300 };
  const chordX = f => X0 + (X1 - X0) * f;
  const lower = f => Y + 22 * Math.sin(Math.PI * Math.min(1, f) * 0.95) * (1 - f * 0.55);
  const upper = f => Y - 34 * Math.sin(Math.PI * Math.pow(Math.min(1, f), 0.72)) * (1 - f * 0.25);
  const rows = ROWS.filter(r => Object.keys(s.nominal).some(id => parseLineId(id).riser === r));
  const stat = {};
  for (const r of rows) {
    const ls = a.lines.filter(l => l.riser === r);
    const m = ls.length ? ls.reduce((x, l) => x + l.rel, 0) / ls.length : null;
    const st = m == null ? 'none' : Math.abs(m) <= a.tolInd ? 'good' : Math.abs(m) <= a.tolInd * 2 ? 'warn' : 'bad';
    stat[r] = { m, n: ls.length, st };
  }
  // tilt about the A row: rear rows vs A, 1 mm drawn as EX px at the rear row
  const front = stat.A?.m;
  const rearRow = ['E', 'D', 'C', 'B'].find(r => stat[r]?.m != null);
  const dRear = front != null && rearRow ? stat[rearRow].m - front : 0;
  const EX = 2.5;
  const pivot = { x: chordX(ROW_CHORD.A), y: lower(ROW_CHORD.A) };
  const reach = rearRow ? chordX(ROW_CHORD[rearRow]) - pivot.x : 1;
  // shorter rear lines pull the rear down (nose up, slower); longer let it rise
  const ang = Math.atan2(-dRear * EX, reach);
  const rot = (x, y) => ({
    x: pivot.x + (x - pivot.x) * Math.cos(ang) - (y - pivot.y) * Math.sin(ang),
    y: pivot.y + (x - pivot.x) * Math.sin(ang) + (y - pivot.y) * Math.cos(ang),
  });
  const profile = (tf = (x, y) => ({ x, y })) => {
    const up = [], lo = [];
    for (let i = 0; i <= 40; i++) {
      const f = i / 40;
      const u = tf(chordX(f), upper(f)), l = tf(chordX(f), lower(f));
      up.push(`${u.x.toFixed(1)},${u.y.toFixed(1)}`); lo.unshift(`${l.x.toFixed(1)},${l.y.toFixed(1)}`);
    }
    return `M${up.join(' L')} L${lo.join(' L')} Z`;
  };
  let lines = '', labels = '';
  rows.forEach((r, i) => {
    const f = ROW_CHORD[r] ?? 0.5;
    const p = rot(chordX(f), lower(f));
    const st = stat[r];
    lines += `<line x1="${p.x.toFixed(1)}" y1="${p.y.toFixed(1)}" x2="${riser.x}" y2="${riser.y}" stroke="${COL[st.st]}" stroke-width="${st.st === 'good' || st.st === 'none' ? 1.4 : 2.6}"/>
      <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4.5" fill="${COL[st.st]}" stroke="#fff" stroke-width="1"/>
      <text x="${p.x.toFixed(1)}" y="${(p.y - 9).toFixed(1)}" text-anchor="middle" class="rl">${esc(isBrakeRiser(r) ? 'K' : r)}</text>`;
    labels += `<text x="${W - 12}" y="${176 + i * 21}" text-anchor="end" class="lab"><tspan font-weight="700" fill="${COL[st.st]}">${st.st === 'none' ? '○' : MARK[st.st]}</tspan> <tspan font-weight="700">${esc(isBrakeRiser(r) ? 'Brakes' : `${r} row`)}</tspan>  ${st.m == null ? 'not measured' : `${signed(st.m)} mm avg · ${st.n} lines`}</text>`;
  });
  const verdict = Math.abs(dRear) < 1 ? 'Rear rows level with the A row — factory angle of incidence.'
    : `Rear rows ${Math.abs(Math.round(dRear))} mm ${dRear > 0 ? 'long' : 'short'} vs the A row → trimmed ${dRear > 0 ? 'faster' : 'slower'} than factory.`;
  return `<svg viewBox="0 0 ${W} ${H}" class="view" role="img" aria-label="The wing from the side">
    <path d="${profile()}" fill="none" stroke="#b4bac0" stroke-dasharray="4 3" stroke-width="1.2"/>
    <path d="${profile(rot)}" fill="#f4f6f5" stroke="#5b636b" stroke-width="1.6"/>
    ${lines}
    <rect x="${riser.x - 6}" y="${riser.y}" width="12" height="20" rx="3" fill="#5b636b"/>
    <text x="${riser.x}" y="${riser.y + 36}" class="cap">risers</text>
    <text x="${X0 - 12}" y="${Y + 4}" text-anchor="end" class="lab">nose</text>
    <text x="${X1 + 8}" y="${Y + 24}" class="lab">tail</text>
    ${labels}
    <text x="12" y="${H - 8}" class="lab">${esc(verdict)}</text></svg>`;
}

// ---- table ------------------------------------------------------------------------

// the row is in the group heading above, so position = main and span place
function positionOf(s, id, mainName) {
  const { index, sub } = parseLineId(id);
  const bits = [];
  if (mainName) bits.push(`main ${mainName}`);
  const rib = s.ribs?.[id];
  bits.push(rib != null ? `rib ${rib}` : `#${index}${sub} from centre`);
  return bits.join(' · ');
}

function lineTable(s, a, byKey) {
  const mainOf = new Map();
  for (const m of s.mains || []) if (!m.synthetic) for (const id of m.lineIds || m.lines || []) mainOf.set(id, m.id);
  const ids = Object.keys(s.nominal).sort((x, y) => {
    const px = parseLineId(x), py = parseLineId(y);
    return ROWS.indexOf(px.riser) - ROWS.indexOf(py.riser) || px.pos - py.pos;
  });
  const cell = l => l
    ? `<td class="num">${fmt(l.measured)}</td><td class="num d ${l.status}">${MARK[l.status]} ${signed(l.rel)}</td>`
    : '<td class="num muted">–</td><td class="num muted">–</td>';
  let body = '', row = null;
  for (const id of ids) {
    const r = parseLineId(id).riser;
    if (r !== row) { row = r; body += `<tr class="grp"><td colspan="8">${esc(isBrakeRiser(r) ? 'Brakes' : `${r} row`)}</td></tr>`; }
    const L = byKey.get(`L:${id}`), R = byKey.get(`R:${id}`);
    const lr = L && R ? L.delta - R.delta : null;
    const lrSt = lr == null ? '' : Math.abs(lr) <= a.tolInd ? 'good' : Math.abs(lr) <= a.tolInd * 2 ? 'warn' : 'bad';
    body += `<tr><td><b>${esc(id)}</b></td><td class="pos">${esc(positionOf(s, id, mainOf.get(id)))}</td>
      <td class="num">${fmt(s.nominal[id])}</td>${cell(L)}${cell(R)}
      <td class="num d ${lrSt}">${lr == null ? '–' : signed(lr)}</td></tr>`;
  }
  return `<div class="tablewrap"><table class="lines">
    <thead><tr><th rowspan="2">Line</th><th rowspan="2">Position</th><th rowspan="2">Target<br><small>mm</small></th>
      <th colspan="2">Left</th><th colspan="2">Right</th><th rowspan="2">L − R<br><small>mm</small></th></tr>
      <tr><th>Measured</th><th>Diff</th><th>Measured</th><th>Diff</th></tr></thead>
    <tbody>${body}</tbody></table></div>`;
}

function fixList(a) {
  const recs = a.recommendations || [];
  if (!recs.length) return '<p>No main needs adjusting: every main is within tolerance on both sides.</p>';
  return `<table class="fix"><thead><tr><th>Side</th><th>Main</th><th>What to do</th><th>Lines</th></tr></thead><tbody>${recs.map(m => `
    <tr><td>${esc(m.sideLabel)}</td><td><b>${esc(m.label || m.id)}</b></td>
      <td>${m.action === 'inspect' ? `Inspect — lines spread ${fmt(m.spreadMm)} mm within this main` : m.action === 'note' ? `Out by ${signed(m.relMm)} mm — reset at the handle / check` : `${m.action === 'shorten' ? 'Shorten' : 'Lengthen'} ${fmt(Math.abs(m.recommendMm))} mm`}</td>
      <td>${m.n}</td></tr>`).join('')}</tbody></table>`;
}

// ---- page ---------------------------------------------------------------------------

export function reportHtml(s, { embedded = false } = {}) {
  const a = analyse(s);
  const byKey = new Map(a.lines.map(l => [l.key, l]));
  const span = spanOf(Object.keys(s.nominal), s.ribs);
  const who = [s.serial ? `Serial ${s.serial}` : '', s.owner ? `Owner ${s.owner}` : ''].filter(Boolean).join(' · ');
  const title = `${s.brand} ${s.model} ${s.sizeKey} — line check ${dateOf(s)}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root { --ink:#15191c; --ink2:#4a5157; --line:#dfe3e6; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: var(--ink); background: #fff; }
  main { max-width: 900px; margin: 0 auto; padding: 24px 20px 40px; }
  h1 { font-size: 24px; margin: 0 0 2px; } h2 { font-size: 17px; margin: 26px 0 8px; border-bottom: 2px solid var(--ink); padding-bottom: 4px; }
  .sub { color: var(--ink2); margin: 0 0 12px; }
  .facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 6px 16px; margin: 10px 0; }
  .facts div { border-left: 3px solid var(--line); padding-left: 8px; } .facts b { display: block; font-size: 15px; } .facts span { color: var(--ink2); font-size: 12px; }
  .verdict { padding: 10px 14px; border-radius: 8px; background: #f2f4f5; border-left: 5px solid; margin: 10px 0; }
  .verdict.good { border-color: ${COL.good}; } .verdict.warn { border-color: ${COL.warn}; } .verdict.bad { border-color: ${COL.bad}; } .verdict.none { border-color: ${COL.none}; }
  .view { width: 100%; height: auto; display: block; margin: 4px 0 2px; }
  .view text { font-family: inherit; } .cap { font-size: 11px; fill: var(--ink2); text-anchor: middle; letter-spacing: .08em; }
  .side { font-size: 12px; font-weight: 700; fill: var(--ink2); } .rl { font-size: 11px; font-weight: 800; fill: #7c858c; text-anchor: middle; }
  .lab { font-size: 12.5px; fill: var(--ink); }
  .legend { display: flex; flex-wrap: wrap; gap: 14px; font-size: 12px; color: var(--ink2); margin: 2px 0 6px; }
  .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 5px; vertical-align: -1px; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  th, td { padding: 4px 6px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
  thead th { background: #f2f4f5; font-size: 11.5px; } th small { font-weight: 400; color: var(--ink2); }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  td.pos { color: var(--ink2); font-size: 11.5px; min-width: 9em; }
  .tablewrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  @media (max-width: 560px) { table { font-size: 11.5px; } th, td { padding: 4px 4px; } td.pos { min-width: 7em; } }
  td.d { font-weight: 700; } td.d.good { color: ${COL.good}; } td.d.warn { color: ${COL.warn}; background: #fff6e5; } td.d.bad { color: ${COL.bad}; background: #fdecec; }
  tr.grp td { background: #e9edef; font-weight: 800; letter-spacing: .04em; }
  .muted { color: #9aa1a7; }
  .note { font-size: 12px; color: var(--ink2); }
  .bar { position: sticky; top: 0; background: #15191c; color: #fff; padding: 8px 20px; display: flex; gap: 10px; align-items: center; justify-content: space-between; font-size: 13px; }
  .bar button { font: inherit; border: 0; border-radius: 6px; padding: 6px 12px; background: #fff; color: #15191c; font-weight: 700; cursor: pointer; }
  @media print { .bar { display: none; } main { padding: 0; } h2 { break-after: avoid; } .view { break-inside: avoid; } tr { break-inside: avoid; } @page { margin: 14mm; } }
</style></head><body>
${embedded ? '' : '<div class="bar"><span>Line Trim report</span><button onclick="print()">Print / save as PDF</button></div>'}
<main>
  <h1>${esc(s.brand)} ${esc(s.model)} · size ${esc(s.sizeKey)}</h1>
  <p class="sub">${esc(s.name || 'Line check')} · measured ${esc(dateOf(s))}${who ? ` · ${esc(who)}` : ''}</p>
  <div class="facts">
    <div><b>${esc(s.wingClass || '—')}</b><span>class</span></div>
    <div><b>${a.measuredCount} / ${a.totalCount}</b><span>readings</span></div>
    <div><b>${s.tensionKg} kg · ±${a.tolInd} mm</b><span>tension · tolerance</span></div>
    <div><b>${s.measureFrom === 'maillon' ? 'Maillons' : 'Riser bottom'}</b><span>measured from</span></div>
    <div><b>${esc(a.refLabel)} (${signed(a.refDelta)} mm)</b><span>reference</span></div>
  </div>
  <div class="verdict ${esc(a.verdict.level)}"><b>${esc(a.verdict.title)}</b><br>${esc(a.verdict.detail)}</div>

  <h2>The wing from below</h2>
  <div class="legend"><span><i style="background:${COL.good}"></i>within ±${a.tolInd} mm</span><span><i style="background:${COL.warn}"></i>up to ±${a.tolInd * 2} mm</span><span><i style="background:${COL.bad}"></i>more than ±${a.tolInd * 2} mm</span><span><i style="border:1.5px solid ${COL.none}"></i>not measured</span></div>
  ${viewBelow(s, byKey, span)}
  <p class="note">Leading edge up, seen from underneath — so the pilot's left side is on the right of the drawing. Each dot is an attachment point, coloured by its difference after the reference.</p>

  <h2>The wing from the front</h2>
  ${viewFront(s, byKey, span)}
  <p class="note">Seen from in front of the pilot, every line drawn from its attachment point down to the risers, in the same colours. The rows overlap from this angle, so each row sits a little lower than the one in front, and lines that are off are drawn on top.</p>

  <h2>The wing from the side</h2>
  ${viewSide(s, a)}
  <p class="note">Seen from the left. Each row's line is coloured by that row's average difference. A few millimetres can't be seen at true scale, so the tilt is exaggerated; the dashed outline is the factory trim.</p>

  <h2>What to do</h2>
  ${fixList(a)}

  <h2>Every line</h2>
  <p class="note">Target = the manufacturer's check length${s.measureFrom === 'maillon' ? ' (risers off)' : ''}.
    ${Math.abs(a.refDelta) < 0.05 ? 'Diff = measured − target.'
      : `Diff = measured − target − ${signed(a.refDelta)} mm: the whole set sits ${Math.abs(a.refDelta)} mm ${a.refDelta > 0 ? 'long' : 'short'} (reference: ${esc(a.refLabel)}), and trim is judged line against line, so that common offset is taken out.`}
    ✓ within ±${a.tolInd} mm · ! within ±${a.tolInd * 2} mm · ✕ beyond. L − R compares the same line on both sides.</p>
  ${lineTable(s, a, byKey)}

  <p class="note" style="margin-top:22px">Line Trim · ${esc(s.source || '')} · not a certified measuring instrument; the manufacturer's current sheet is the authority.</p>
</main></body></html>`;
}

const fileBase = s => `linetrim_${s.brand}_${s.model}_${s.sizeKey}_${dateOf(s)}`.replace(/[^a-z0-9_-]+/gi, '');

export const reportFileName = s => `${fileBase(s)}_report.html`;

/** Save the report as a standalone .html file (prints from any browser). */
export function saveReport(s) {
  download(reportFileName(s), 'text/html', reportHtml(s));
}
