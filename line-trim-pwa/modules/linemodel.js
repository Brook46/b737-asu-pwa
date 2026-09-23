// linemodel.js — line ids, sides, main lines/sections and measuring orders.
//
// Model (mirrors how trim shops actually work):
//   side (L/R)  →  main line  →  suspension points
// A "main" is what you actually adjust at the maillon; its length is the MEAN of
// the suspension points hanging off it. Mains that sit at the same span position
// form a "section" (e.g. AR1/BR1), and a section's front-vs-rear difference is
// the angle-of-incidence number.

// 'K' is the brake (as we-measure.io and most manufacturer sheets name it);
// 'BR' is accepted as a legacy alias so older imports keep working.
// Riser display order, front to back.
export const RISER_ORDER = ['A', 'B', 'C', 'D', 'E', 'K', 'BR', 'ST'];

export const RISER_LABEL = {
  A: 'A', B: 'B', C: 'C', D: 'D', E: 'E', K: 'Brake', BR: 'Brake', ST: 'Stabilo',
};

export const isBrakeRiser = r => r === 'K' || r === 'BR';

// Left/right as seen from above in the wing's direction of flight.
export const SIDES = [{ id: 'L', label: 'Left' }, { id: 'R', label: 'Right' }];

export const keyFor = (side, lineId) => `${side}:${lineId}`;
export const sideOf = key => key.slice(0, key.indexOf(':'));
export const lineOf = key => key.slice(key.indexOf(':') + 1);
export const sideLabel = side => (SIDES.find(s => s.id === side)?.label || side);

/**
 * Line ids come in two shapes:
 *   "A10"   -> { level: null, riser:'A',  index: 10 }
 *   "1A15"  -> { level: 1,    riser:'A',  index: 15 }   Advance <level><riser><index>,
 *                                                        level 1 = canopy attachment
 *   "K2"    -> { level: null, riser:'K',  index: 2 }
 *   "A1b"   -> { level: null, riser:'A',  index: 1, sub:'b' }  Skywalk's split points:
 *                                                        a1a / a1b are the two ends of
 *                                                        one top line, side by side
 */
export function parseLineId(id) {
  const m = /^(\d*)([A-Za-z]+?)(\d+)([a-z]?)$/.exec(String(id).trim());
  if (!m) return { level: null, riser: String(id), index: 0, sub: '', pos: 0 };
  const index = Number(m[3]);
  return {
    level: m[1] === '' ? null : Number(m[1]),
    riser: m[2].toUpperCase(),
    index,
    sub: m[4],
    // span position: a split point's "b" end sits just outboard of its "a" end
    pos: index + (m[4] ? (m[4].charCodeAt(0) - 97) * 0.4 : 0),
  };
}

/** Risers whose MAIN line is adjusted at the maillon. Brakes are retied at the handle. */
export function isTrimmableRiser(riser) {
  return riser === 'A' || riser === 'B' || riser === 'C' || riser === 'D' || riser === 'E';
}
/** Load-bearing risers — the ones that set angle of incidence. */
export function isStructuralRiser(riser) {
  return isTrimmableRiser(riser);
}

/** Ordered [{ riser, label, trimmable, lineIds }]. */
export function groupLines(lineIds) {
  const byRiser = new Map();
  for (const id of lineIds) {
    const { riser } = parseLineId(id);
    if (!byRiser.has(riser)) byRiser.set(riser, []);
    byRiser.get(riser).push(id);
  }
  const order = [...RISER_ORDER, ...[...byRiser.keys()].filter(r => !RISER_ORDER.includes(r))];
  return order
    .filter(r => byRiser.has(r))
    .map(riser => ({
      riser,
      label: RISER_LABEL[riser] || riser,
      trimmable: isTrimmableRiser(riser),
      lineIds: byRiser.get(riser).sort((a, b) => parseLineId(a).pos - parseLineId(b).pos),
    }));
}

/**
 * Main lines for a size. A line plan may declare them explicitly:
 *   mains: [{ id:'AR1', riser:'A', section:1, lines:['A1','A2'] }, …]
 * Wings that fork onto shared mains (a 2.5-liner where C hangs off the B main)
 * need that declaration. Without one, fall back to one main per riser.
 */
export function mainsFor(lineIds, declared) {
  if (Array.isArray(declared) && declared.length) {
    return declared.map(m => ({
      id: m.id,
      riser: m.riser,
      section: m.section ?? 1,
      label: m.label || m.id,
      trimmable: isTrimmableRiser(m.riser),
      lineIds: m.lines.filter(l => lineIds.includes(l)),
    })).filter(m => m.lineIds.length);
  }
  return groupLines(lineIds).map(g => ({
    id: isTrimmableRiser(g.riser) ? `${g.riser} row` : g.label === 'Brake' ? 'Brakes' : g.label,
    riser: g.riser,
    section: 1,
    label: g.label,
    trimmable: g.trimmable,
    lineIds: g.lineIds,
    synthetic: true,          // a whole row, not a line the sheet names
  }));
}

/** Mains grouped by section, front riser first. */
export function sectionsFor(mains) {
  const bySection = new Map();
  for (const m of mains) {
    if (!bySection.has(m.section)) bySection.set(m.section, []);
    bySection.get(m.section).push(m);
  }
  return [...bySection.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([section, ms]) => ({
      section,
      mains: ms.sort((a, b) => RISER_ORDER.indexOf(a.riser) - RISER_ORDER.indexOf(b.riser)),
    }));
}

// ---- measuring orders -------------------------------------------------------
// we-measure.io offers rows / columns / sections; the same three make sense here.
export const ORDERS = [
  { id: 'rows',     label: 'Rows — A1…An, then B1…Bn' },
  { id: 'columns',  label: 'Columns — rib by rib, A→D, centre out' },
  { id: 'sections', label: 'Sections — every point on one main, then the next' },
];

function orderLines(lineIds, mains, mode, ribs) {
  const groups = groupLines(lineIds);
  if (mode === 'columns' && ribs && lineIds.some(id => ribs[id] != null)) {
    // walk the real span: every line on a rib, front to back, then the next rib out
    const rank = id => RISER_ORDER.indexOf(parseLineId(id).riser);
    return [...lineIds].sort((a, b) =>
      (ribs[a] ?? 999) - (ribs[b] ?? 999) || rank(a) - rank(b) || parseLineId(a).pos - parseLineId(b).pos);
  }
  if (mode === 'columns') {
    const maxIndex = Math.max(...lineIds.map(id => parseLineId(id).index), 0);
    const out = [];
    for (let i = 1; i <= maxIndex; i++) {
      for (const g of groups) {
        out.push(...g.lineIds.filter(id => parseLineId(id).index === i));
      }
    }
    // anything with a non-numeric id still needs measuring
    return [...out, ...lineIds.filter(id => !out.includes(id))];
  }
  if (mode === 'sections') {
    const out = [];
    for (const { mains: ms } of sectionsFor(mains)) for (const m of ms) out.push(...m.lineIds);
    return [...out, ...lineIds.filter(id => !out.includes(id))];
  }
  return groups.flatMap(g => g.lineIds);   // 'rows'
}

/**
 * Full measuring order as side-qualified keys. Both sides are measured — an
 * asymmetric wing turns, and that only shows up when L and R are separate.
 * Starts on the left, as the shop convention does.
 */
export function walkOrder(lineIds, { mains = null, order = 'rows', sides = ['L', 'R'], ribs = null } = {}) {
  const ms = mains || mainsFor(lineIds, null);
  const ordered = orderLines(lineIds, ms, order, ribs);
  return sides.flatMap(side => ordered.map(id => keyFor(side, id)));
}
