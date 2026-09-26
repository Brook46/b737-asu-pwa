// exporter.js — session download + shareable text summary.

import { porositySummary, RATING_LABEL } from './porosity.js?v=19';
import { analyse, aoiNote } from './trim.js?v=19';
import { sideLabel } from './linemodel.js?v=19';
import { signed } from './ui/dom.js?v=19';

export function download(name, mime, text) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = s => new Date(s.savedAt || s.createdAt).toISOString().slice(0, 16).replace(/[:T]/g, '-');
const base  = s => `linetrim_${s.brand}_${s.model}_${s.sizeKey}_${stamp(s)}`.replace(/[^a-z0-9_-]+/gi, '');

export function exportJson(s) {
  download(base(s) + '.json', 'application/json',
    JSON.stringify({ session: s, analysis: analyse(s) }, null, 2));
}

export function exportCsv(s) {
  const a = analyse(s);
  const rows = [['side', 'line', 'main', 'nominal_mm', 'target_mm', 'reading_mm',
                 'delta_mm', 'relative_mm', 'status', 'source', 'implausible']];
  for (const l of a.lines) {
    rows.push([l.side, l.lineId, l.mainId ?? '', l.nominal, l.target, l.measured,
               l.delta, l.rel, l.status, l.source, l.implausible ? 'yes' : '']);
  }
  rows.push([]);
  rows.push(['glider', `${s.brand} ${s.model}`, 'size', s.sizeKey, 'serial', s.serial || '', 'owner', s.owner || '']);
  rows.push(['reference', a.refLabel, 'ref_delta_mm', a.refDelta]);
  rows.push(['global_offset_mm', a.globalOffsetMm, 'tolerance_mm', a.tolInd]);
  rows.push([]);
  rows.push(['side', 'main', 'nom_mm', 'rdg_mm', 'delta_mm', 'rel_mm', 'spread_mm', 'action', 'recommend_mm']);
  for (const side of ['L', 'R']) {
    for (const m of a.perSide[side]?.mains || []) {
      rows.push([side, m.id, m.nomMm, m.rdgMm, m.deltaMm, m.relMm, m.spreadMm, m.action, m.recommendMm]);
    }
  }
  rows.push([]);
  rows.push(['side', 'section', 'aoi_mm  (+ = faster)']);
  for (const side of ['L', 'R']) {
    for (const x of a.perSide[side]?.aoi || []) rows.push([side, `${x.rearId}-${x.frontId}`, x.aoiMm]);
  }
  rows.push([]);
  rows.push(['main', 'left_mm', 'right_mm', 'l_minus_r_mm', 'status']);
  for (const x of a.asymmetry) rows.push([x.mainId, x.leftMm, x.rightMm, x.diffMm, x.status]);
  const por = porositySummary(s);
  if (por) {
    rows.push([]);
    rows.push(['porosity_zone', 'reading', 'unit', 'l_m2_min_20mbar', 'cell', 'zone_avg', 'zone_rating']);
    for (const z of por.zones) for (const r of z.readings) {
      rows.push([z.label, r.value, r.unit === 'jdc' ? 's (JDC 10 mbar)' : 'l/m2/min', r.unit === 'jdc' ? Math.round(5400 / r.value) : r.value, r.cell ?? '', z.avgLpm, z.rating ? RATING_LABEL[z.rating] : '']);
    }
  }
  download(base(s) + '.csv', 'text/csv', rows.map(r => r.join(',')).join('\n'));
}

export function sessionSummaryText(s, a = analyse(s)) {
  const L = [];
  const name = m => `${m.sideLabel} ${m.label}`;
  L.push(`Line trim — ${s.brand} ${s.model} ${s.sizeKey}`);
  if (s.serial || s.owner) L.push([s.serial ? `Serial ${s.serial}` : '', s.owner ? `Owner ${s.owner}` : ''].filter(Boolean).join(' · '));
  L.push(new Date(s.savedAt || s.createdAt).toLocaleString());
  L.push(`Tension ${s.tensionKg} kg · tol ±${a.tolInd} mm · measured from the ${s.measureFrom === 'maillon' ? 'maillons' : 'riser bottom'} · zero offset ${signed(s.refOffsetMm || 0)}`);
  L.push(`Reference: ${a.refLabel} (${signed(a.refDelta)})`);
  L.push(`Readings: ${a.integrity.laser} laser, ${a.integrity.manual} manual`
       + (a.integrity.implausible.length ? ` · ${a.integrity.implausible.length} IMPLAUSIBLE` : '')
       + (a.integrity.editedAfterComplete ? ' · edited after completion' : '')
       + (a.integrity.simulating ? ' · SIMULATION ACTIVE' : ''));
  L.push('');
  L.push(`${a.verdict.title}: ${a.verdict.detail}`);
  const por = porositySummary(s);
  if (por) {
    L.push('');
    L.push(`Porosity: ${!por.complete ? 'not finished' : por.passed ? `passed (${RATING_LABEL[por.worst].toLowerCase()})` : 'FAILED'}`);
    for (const z of por.zones) L.push(`  ${z.label}: ${z.rating ? `${RATING_LABEL[z.rating]} — ${z.avgLpm} l/m²/min avg of ${z.n}` : 'no reading'}`);
  }

  L.push('\nAngle of incidence (+ = faster):');
  for (const side of ['L', 'R']) {
    for (const x of a.perSide[side]?.aoi || []) {
      L.push(`  ${sideLabel(side)} ${x.rearId}-${x.frontId}: ${signed(x.aoiMm)}`);
    }
  }
  const all = [...(a.perSide.L?.aoi || []), ...(a.perSide.R?.aoi || [])];
  if (all.length) {
    const avg = Math.round(all.reduce((x, y) => x + y.aoiMm, 0) / all.length * 10) / 10;
    L.push(`  wing average ${signed(avg)} — ${aoiNote(avg, a.tolInd)}`);
  }

  L.push('\nLeft / right:');
  if (a.turn) L.push(`  TURNS ${a.turn.toward.toUpperCase()} — ${a.turn.note}`);
  for (const x of a.asymmetry) {
    L.push(`  ${x.mainId}: L ${signed(x.leftMm)} / R ${signed(x.rightMm)} → ${signed(x.diffMm)} [${x.status}]`);
  }

  L.push('\nAdjustment plan:');
  const acts = a.recommendations;
  if (!acts.length) L.push('  nothing to do — every main in trim');
  for (const m of acts) {
    if (m.action === 'inspect') L.push(`  ${name(m)}: INSPECT lines ${m.outliers.join(', ')} (spread ${m.spreadMm} mm)`);
    else if (m.action === 'note') L.push(`  ${name(m)}: ${Math.abs(m.recommendMm)} mm ${m.recommendMm < 0 ? 'too long' : 'too short'} (not a maillon item)`);
    else L.push(`  ${name(m)} main: ${m.action} ${Math.abs(m.recommendMm)} mm`);
  }
  L.push(`\nGlobal offset: ${signed(a.globalOffsetMm)} (allowance ±${a.tolGlobal} mm)`);

  L.push('\nside, line, nominal, reading, delta, rel');
  for (const l of a.lines) {
    L.push(`  ${l.side}, ${l.lineId}, ${l.nominal}, ${l.measured}, ${signed(l.delta)}, ${signed(l.rel)}`);
  }
  return L.join('\n');
}
