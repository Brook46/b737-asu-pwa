// ui/porosity.js — the fabric porosity check for this glider, per the PMA
// inspection standard (§5.2): four spanwise zones on the top sail, a reading or
// more in each, rated by the zone's average. Readings are saved with the check.

import { $, el, esc, clear, toast } from './dom.js?v=19';
import { icon } from './icons.js?v=19';
import { gliderCard } from './glider.js?v=19';
import { prefs, sessions, draft } from '../store.js?v=19';
import {
  ZONES, UNITS, toLpm, porosityOf, addReading, removeReading, porositySummary,
  RATING_LABEL, RATING_STATUS, LIMIT_FAIL, LIMIT_GOOD,
} from '../porosity.js?v=19';

const COL = { good: 'var(--good)', acceptable: 'var(--warn)', fail: 'var(--bad)' };

/** Top view: the wing split into its four zones, the 5–30% band where readings go. */
export function porosityPlanform(summary, { W = 360, H = 150 } = {}) {
  const CX = W / 2, HALF = W / 2 - 10, CY = 72, CH = 104;
  const chord = u => CH * Math.sqrt(Math.max(0.05, 1 - u * u));
  const le = u => CY - chord(u) / 2 + 8 * u * u;
  const outline = [];
  for (let i = -50; i <= 50; i++) { const u = Math.abs(i) / 50; outline.push(`${(CX + (i / 50) * HALF).toFixed(1)},${le(u).toFixed(1)}`); }
  for (let i = 50; i >= -50; i--) { const u = Math.abs(i) / 50; outline.push(`${(CX + (i / 50) * HALF).toFixed(1)},${(le(u) + chord(u)).toFixed(1)}`); }
  // a zone: a quarter of the span, drawn as the 5–30% chord band inside it
  const band = (u0, u1, s) => {
    const pts = [];
    for (let i = 0; i <= 12; i++) { const u = u0 + (u1 - u0) * i / 12; pts.push(`${(CX + s * u * HALF).toFixed(1)},${(le(u) + 0.05 * chord(u)).toFixed(1)}`); }
    for (let i = 12; i >= 0; i--) { const u = u0 + (u1 - u0) * i / 12; pts.push(`${(CX + s * u * HALF).toFixed(1)},${(le(u) + 0.30 * chord(u)).toFixed(1)}`); }
    return pts.join(' ');
  };
  const span = { 'L-out': [0.5, 1, -1], 'L-in': [0.04, 0.5, -1], 'R-in': [0.04, 0.5, 1], 'R-out': [0.5, 1, 1] };
  let zones = '', dots = '', labels = '';
  for (const z of ZONES) {
    const [u0, u1, s] = span[z.id];
    const zs = summary?.zones.find(x => x.id === z.id);
    const fill = zs?.rating ? COL[zs.rating] : 'var(--ink-3)';
    zones += `<polygon points="${band(u0, Math.min(u1, 0.94), s)}" fill="${fill}" fill-opacity="${zs?.rating ? 0.55 : 0.18}" stroke="${fill}" stroke-width="1"/>`;
    const um = (u0 + Math.min(u1, 0.94)) / 2;
    (zs?.readings || []).forEach((r, i, a) => {
      const u = u0 + (Math.min(u1, 0.94) - u0) * (i + 1) / (a.length + 1);
      dots += `<circle cx="${(CX + s * u * HALF).toFixed(1)}" cy="${(le(u) + 0.175 * chord(u)).toFixed(1)}" r="3.4" fill="var(--surface)" stroke="var(--ink)" stroke-width="1.4"/>`;
    });
    // two short lines at a fixed height, a quarter of the width apart, so they never collide
    const lx = CX + s * (z.id.endsWith('out') ? 0.75 : 0.25) * HALF;
    labels += `<text x="${lx.toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="11" font-weight="700" fill="var(--ink-2)">${esc(z.label)}</text>
      <text x="${lx.toFixed(1)}" y="${H + 7}" text-anchor="middle" font-size="11" font-weight="700" fill="${zs?.rating ? COL[zs.rating] : 'var(--ink-3)'}">${zs?.rating ? RATING_LABEL[zs.rating] : 'no reading'}</text>`;
  }
  return `<svg viewBox="0 0 ${W} ${H + 20}" class="poro-plan" role="img" aria-label="Porosity zones on the top sail">
    <polygon points="${outline.join(' ')}" fill="var(--surface)" stroke="var(--ink-3)" stroke-width="1.2"/>
    <line x1="${CX}" y1="${le(0) - 6}" x2="${CX}" y2="${le(0) + chord(0) + 6}" stroke="var(--line)" stroke-dasharray="3 3"/>
    ${zones}${dots}${labels}
    <text x="${CX}" y="10" text-anchor="middle" font-size="10" fill="var(--ink-3)" letter-spacing=".08em">LEADING EDGE ↑ · TOP SAIL · PILOT'S LEFT ON THE LEFT</text></svg>`;
}

export function renderPorosity(root, ctx) {
  const s = ctx.session;
  if (!s) { ctx.goto('wings'); return; }
  const p = porosityOf(s);
  if (!p.readings.length) p.unit = prefs.get().porosityUnit || p.unit;
  const persist = () => { if (s.savedAt) sessions.save(s); else draft.set(s); };
  clear(root);
  const wrap = el(`<div>
    <button class="btn ghost sm" id="back" style="margin-left:-8px">${icon.back} Back</button>
    <div id="glider"></div>
    <h1>Porosity check</h1>
    <p class="lede">How air-tight the top sail still is — the fabric check of the PMA inspection standard.</p>
    <details class="more card flat" style="margin-bottom:12px"><summary>${icon.chevron} How to measure</summary>
      <ul class="plain small" style="margin-top:8px">
        <li>Split the wing into <b>four zones</b> across the span (left outer, left inner, right inner, right outer). At least <b>one reading in every zone</b>.</li>
        <li>On the <b>top sail</b>, <b>5–30% of the chord</b> back from the leading edge, on a clean, uncreased spot — not at the centre cell.</li>
        <li>Air flowing <b>from inside the canopy out</b>. Readings at least <b>4 cells apart</b>.</li>
        <li>A zone passes when its average is under <b>${LIMIT_FAIL} l/m²/min</b> (at 20 mbar): under ${LIMIT_GOOD} is good, ${LIMIT_GOOD}–${LIMIT_FAIL} acceptable.</li>
      </ul></details>
    <label class="field"><span>Your porosimeter</span>
      <select class="input" id="unit">${UNITS.map(u => `<option value="${u.id}">${esc(u.label)}</option>`).join('')}</select></label>
    <div class="card" id="plan"></div>
    <div class="zones" id="zones"></div>
    <div id="summary" style="margin-top:12px"></div>
  </div>`);
  root.appendChild(wrap);
  $('#glider', wrap).appendChild(gliderCard(s, { compact: true, onChange: persist }));
  $('#back', wrap).addEventListener('click', () => ctx.goto(ctx.porosityBack || 'result'));
  const unitSel = $('#unit', wrap);
  unitSel.value = p.unit;
  unitSel.addEventListener('change', () => { p.unit = unitSel.value; prefs.set({ porosityUnit: p.unit }); persist(); draw(); });

  function draw() {
    const sum = porositySummary(s);
    $('#plan', wrap).innerHTML = porosityPlanform(sum);
    const host = $('#zones', wrap);
    clear(host);
    const unit = UNITS.find(u => u.id === p.unit);
    for (const z of ZONES) {
      const zs = sum?.zones.find(x => x.id === z.id);
      const card = el(`<div class="card zone">
        <div class="zone-head"><b>${esc(z.label)}</b>
          ${zs?.rating ? `<span class="status ${RATING_STATUS[zs.rating]}">${RATING_LABEL[zs.rating]}</span>` : '<span class="small muted">no reading</span>'}</div>
        ${zs?.n ? `<div class="small muted">average ${zs.avgLpm} l/m²/min · ${zs.n} reading${zs.n > 1 ? 's' : ''}</div>` : ''}
        <div class="zone-readings"></div>
        <form class="zone-add">
          <input class="input" name="v" inputmode="decimal" placeholder="${unit.short === 's' ? 'seconds' : 'l/m²/min'}" aria-label="Reading in ${esc(unit.label)}">
          <input class="input" name="cell" inputmode="numeric" placeholder="cell" aria-label="Cell number from the centre (optional)">
          <button class="btn sm primary" type="submit">${icon.plus} Add</button>
        </form></div>`);
      const list = card.querySelector('.zone-readings');
      for (const r of zs?.readings || []) {
        const lpm = toLpm(r.value, r.unit);
        const chip = el(`<span class="reading-chip">${r.value}${r.unit === 'jdc' ? ' s' : ''}${r.unit === 'jdc' ? ` → ${Math.round(lpm)}` : ''}${r.cell != null ? ` · cell ${r.cell}` : ''}
          <button type="button" aria-label="Remove this reading">✕</button></span>`);
        chip.querySelector('button').addEventListener('click', () => { removeReading(s, r.id); persist(); draw(); });
        list.appendChild(chip);
      }
      card.querySelector('form').addEventListener('submit', e => {
        e.preventDefault();
        const f = e.target;
        const v = parseFloat(String(f.v.value).replace(',', '.'));
        const cell = f.cell.value.trim() === '' ? null : parseInt(f.cell.value, 10);
        if (!addReading(s, z.id, v, { cell: Number.isFinite(cell) ? cell : null })) { toast('Enter the reading as a number'); return; }
        persist(); draw();
        host.querySelectorAll('.zone-add input[name="v"]')[ZONES.findIndex(x => x.id === z.id)]?.focus();
      });
      host.appendChild(card);
    }
    const sh = $('#summary', wrap);
    if (!sum) { sh.innerHTML = '<p class="muted small">Add a reading in each zone; the result appears here.</p>'; return; }
    const level = !sum.complete ? 'none' : sum.worst === 'fail' ? 'bad' : sum.worst === 'acceptable' ? 'warn' : 'good';
    sh.innerHTML = `<div class="verdict ${level}"><div class="vicon">${level === 'good' ? icon.ok : level === 'none' ? icon.info : icon.warn}</div>
      <div><b>${!sum.complete ? 'Not finished' : sum.passed ? `Passed — ${RATING_LABEL[sum.worst].toLowerCase()}` : 'Failed'}</b>
      <p>${sum.complete ? (sum.passed ? `Every zone averages under ${LIMIT_FAIL} l/m²/min.` : `A zone averages ${LIMIT_FAIL} l/m²/min or more — the fabric no longer meets the standard.`) : ''}
      ${sum.notes.map(esc).join(' ')}</p></div></div>`;
  }
  draw();
}
