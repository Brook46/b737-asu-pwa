// ui/compare.js — two checks of the same wing, side by side: what moved.

import { gliderIdentity } from './glider.js?v=17';
import { $, el, esc, clear, signed, fmtMm, classBadge } from './dom.js?v=17';
import { icon } from './icons.js?v=17';
import { sessions } from '../store.js?v=17';
import { analyse } from '../trim.js?v=17';
import { SIDES, sideLabel } from '../linemodel.js?v=17';
import { trimProfile, profileScale } from './charts.js?v=17';
import { checkDate, checkName } from './history.js?v=17';

const days = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);

export function renderCompare(root, ctx) {
  clear(root);
  const [A, B] = (ctx.compare || []).map(id => sessions.get(id));
  if (!A || !B) { ctx.goto('history'); return; }
  const a = analyse(A), b = analyse(B);

  const avgAoi = x => { const v = [...(x.perSide.L?.aoi || []), ...(x.perSide.R?.aoi || [])]; return v.length ? v.reduce((p, q) => p + q.aoiMm, 0) / v.length : null; };
  const maxAsym = x => { const v = x.asymmetry.filter(q => q.riser !== 'K'); return v.length ? v.reduce((m, q) => Math.abs(q.diffMm) > Math.abs(m) ? q.diffMm : m, 0) : null; };

  // per line: how much the reading moved between the checks (same target, so
  // delta change = reading change when both measured from the same point)
  const byKey = new Map(a.lines.map(l => [l.key, l]));
  const moved = b.lines.filter(l => byKey.has(l.key)).map(l => ({
    ...l, rel: Math.round((l.delta - byKey.get(l.key).delta) * 10) / 10,
  }));
  const sameRef = (A.measureFrom || 'riser') === (B.measureFrom || 'riser');

  const wrap = el(`<div>
    <button class="btn ghost sm" id="back" style="margin-left:-8px">${icon.back} Your checks</button>
    <div class="row" style="margin:6px 0 4px">${classBadge(B.wingClass || '')}<b class="grow">${esc(B.brand)} ${esc(B.model)} · ${esc(B.sizeKey)}</b>
      <span class="small muted">${esc(gliderIdentity(B) || gliderIdentity(A))}</span></div>
    <div class="compare-heads">
      <div class="card flat"><span class="small muted">Before</span><b>${esc(checkName(A))}</b><span class="small">${esc(checkDate(A))}</span></div>
      <div class="arrow">${icon.chevron}<span class="small muted">${days(checkDate(A), checkDate(B))} days</span></div>
      <div class="card flat"><span class="small muted">After</span><b>${esc(checkName(B))}</b><span class="small">${esc(checkDate(B))}</span></div>
    </div>
    ${sameRef ? '' : `<div class="note warn" style="margin-top:10px">${icon.warn}<span>One check was measured from the riser bottom and the other from the maillons. Deviations still compare; raw readings don't.</span></div>`}
    <div class="tiles" id="tiles"></div>
    <h2>How each line moved</h2>
    <p class="small muted" style="margin-top:-4px">Change in each line between the two checks. Above zero = the line got longer.
      Lines stretching together is normal ageing; one line moving alone is worth a look.</p>
    <div id="charts"></div>
    <h2>Biggest changes</h2>
    <div id="movers"></div>
    <h2>Per main</h2>
    <div class="scroll-x"><table class="data" id="mains"><thead><tr><th>Main</th><th>Before</th><th>After</th><th>Change</th></tr></thead><tbody></tbody></table></div>
  </div>`);
  root.appendChild(wrap);
  $('#back', wrap).addEventListener('click', () => ctx.goto('history'));

  // closer to zero is better for all three (zero = factory trim)
  const tile = (label, va, vb, words) => {
    const d = va != null && vb != null ? vb - va : null;
    return `<div class="tile"><span>${label}</span><b>${vb == null ? '–' : signed(vb)}</b>
      <small>${vb == null ? '' : words && Math.abs(vb) >= 0.5 ? `${vb > 0 ? words[0] : words[1]} · ` : ''}${va == null ? '' : `was ${signed(va)}`}${d != null && Math.abs(d) >= 1 ? ` · ${Math.abs(vb) < Math.abs(va) ? 'better' : 'worse'}` : ''}</small></div>`;
  };
  $('#tiles', wrap).innerHTML =
    tile('Trim speed', avgAoi(a), avgAoi(b), ['faster', 'slower'])
    + tile('Left vs right', maxAsym(a), maxAsym(b))
    + tile('Whole set', a.globalOffsetMm, b.globalOffsetMm, ['long', 'short']);

  const charts = $('#charts', wrap);
  const yMax = profileScale(moved);
  for (const { id, label } of SIDES) {
    const ls = moved.filter(l => l.side === id);
    if (!ls.some(l => /^[A-E]$/.test(l.riser))) continue;
    const { svg } = trimProfile({ lines: ls, ribs: B.ribs, tol: B.tolIndMm, yMax, title: `${label} side — change` });
    const c = el(`<div class="card chart-card"><div class="chart-title"><b>${label} side</b><span>change, mm</span></div></div>`);
    c.appendChild(svg);
    charts.appendChild(c);
  }
  if (!charts.childElementCount) charts.appendChild(el('<p class="muted">No lines measured in both checks.</p>'));

  const top = [...moved].sort((x, y) => Math.abs(y.rel) - Math.abs(x.rel)).slice(0, 6);
  const mv = $('#movers', wrap);
  if (!top.length) mv.appendChild(el('<p class="muted">Nothing to compare.</p>'));
  for (const l of top) {
    const before = byKey.get(l.key);
    mv.appendChild(el(`<div class="mover"><b>${esc(sideLabel(l.side))} ${esc(l.lineId)}</b>
      <span class="num">${fmtMm(before.measured)} → ${fmtMm(l.measured)}</span>
      <span class="num"><b>${signed(l.rel)}</b></span></div>`));
  }

  const tb = $('#mains tbody', wrap);
  for (const side of ['L', 'R']) {
    for (const m of b.perSide[side]?.mains || []) {
      const ma = a.perSide[side]?.mains.find(x => x.id === m.id);
      if (!ma) continue;
      const d = Math.round((m.relMm - ma.relMm) * 10) / 10;
      tb.appendChild(el(`<tr><td>${esc(sideLabel(side))} ${esc(m.id)}</td><td>${signed(ma.relMm, '')}</td><td>${signed(m.relMm, '')}</td>
        <td><b>${signed(d, '')}</b></td></tr>`));
    }
  }
}
