// sheets/sections.js — group mains into span-wise sections from rib positions.
//
// A section is a front (A) main plus the rear mains that serve the same ribs;
// its rear-minus-front difference is the angle-of-incidence reading. Shared by
// the library build and by the in-app sheet import so both agree.

const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;

export const riserOfMain = id =>
  (/^([A-EK])[RL]\d/.exec(id)?.[1]) || (/^AST|^ST|stab/i.test(id) ? 'ST' : String(id)[0]);

/**
 * Mutates and returns `mains`, setting `section` on each. A main whose lines
 * mostly sit outside every front main's span (the mixed tip main, e.g. BR4) gets
 * a section of its own, so it never forms a bogus angle-of-incidence pair.
 */
export function deriveSections(mains, ribs) {
  const ribsOf = m => m.lines.map(l => ribs?.[l]).filter(v => v != null);
  const structural = mains.filter(m => /^[A-E]$/.test(m.riser));
  const fronts = structural.filter(m => m.riser === 'A' && ribsOf(m).length)
    .sort((a, b) => mean(ribsOf(a)) - mean(ribsOf(b)));
  if (!fronts.length) {
    let n = 1;
    for (const m of mains) if (m.section == null) m.section = n++;
    return mains;
  }
  fronts.forEach((f, i) => { f.section = i + 1; });
  let next = fronts.length + 1;
  for (const m of structural) {
    if (m.section != null) continue;
    const rs = ribsOf(m);
    if (!rs.length) { m.section = next++; continue; }
    let best = null, bestHits = 0;
    for (const f of fronts) {
      const fr = ribsOf(f);
      const lo = Math.min(...fr) - 1, hi = Math.max(...fr) + 1;
      const hits = rs.filter(r => r >= lo && r <= hi).length;
      if (hits > bestHits) { bestHits = hits; best = f; }
    }
    m.section = best && bestHits >= Math.ceil(rs.length / 2) ? best.section : next++;
  }
  for (const m of mains) if (m.section == null) m.section = next++;
  return mains;
}

/** Every line not claimed by a main goes into a per-letter fallback main. */
export function completeMains(lines, mains) {
  const kept = mains
    .map(m => ({ ...m, riser: m.riser || riserOfMain(m.id), lines: m.lines.filter(l => lines[l] != null) }))
    .filter(m => m.lines.length);
  const claimed = new Set(kept.flatMap(m => m.lines));
  const orphans = Object.keys(lines).filter(k => !claimed.has(k));
  const byLetter = {};
  for (const id of orphans) (byLetter[id.replace(/^\d+/, '').replace(/\d+$/, '')] ||= []).push(id);
  const extra = Object.entries(byLetter).map(([letter, ls]) => ({
    id: letter === 'K' ? 'K' : `${letter}*`, riser: letter, lines: ls, derived: true,
  }));
  return { mains: [...kept, ...extra], orphans };
}
