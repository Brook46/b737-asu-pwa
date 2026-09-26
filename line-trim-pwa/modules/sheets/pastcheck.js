// sheets/pastcheck.js — read measurements taken in the past (a spreadsheet, a
// CSV, or pasted notes) into left/right readings for one wing.
//
// Two layouts cover how people write these down:
//   WIDE   line | left | right          ("A1  6421  6425")
//   LONG   side | line | value          ("L  A1  6421")
// Column roles are guessed from headers and contents, and always shown to the
// pilot to confirm — a swapped left/right would invert every asymmetry.

import { detectLineTable } from '../importer.js?v=17';

const LEFT_RE  = /^(l|left|links?|li|gauche|g|izq(uierda)?|sx|sinistra)$/i;
const RIGHT_RE = /^(r|right|rechts?|re|droite|d|der(echa)?|dx|destra)$/i;
const ID_RE    = /^\d?\s?[A-Za-z]{1,3}\s?\d{1,2}[a-z]?$/;

const clean = s => String(s ?? '').trim();
function toMm(s) {
  const v = parseFloat(clean(s).replace(',', '.'));
  if (!Number.isFinite(v) || v === 0) return null;
  const mm = v < 20 ? v * 1000 : v;
  return mm >= 1500 && mm <= 15000 ? Math.round(mm * 10) / 10 : null;
}

/** Pasted notes → a grid. Tabs, commas, semicolons or runs of spaces. */
export function gridFromText(text) {
  return String(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(line => {
    const sep = line.includes('\t') ? '\t' : line.includes(';') ? ';' : (line.match(/,/g) || []).length >= 2 && !/\d,\d{3}\b/.test(line) ? ',' : null;
    return sep ? line.split(sep).map(c => c.trim()) : line.split(/\s+/);
  });
}

/** Normalise "a1", "1 A1", "A 1" to the plan's own ids (incl. Advance "1A1"). */
export function idNormaliser(expectedIds = []) {
  const set = new Set(expectedIds);
  const prefixed = expectedIds.length && expectedIds.every(id => /^\d[A-Z]\d+$/.test(id));
  return raw => {
    // row letter upper-case, a split-point suffix lower-case: "a1b" → "A1b"
    const id = clean(raw).replace(/\s+/g, '').toUpperCase().replace(/(\d)([A-Z])$/, (_, d, t) => d + t.toLowerCase());
    if (!ID_RE.test(id)) return null;
    if (set.has(id)) return id;
    if (prefixed && /^[A-Z]\d+$/.test(id) && set.has(expectedIds[0][0] + id)) return expectedIds[0][0] + id;
    if (!prefixed && /^\d[A-Z]\d+$/.test(id) && set.has(id.slice(1))) return id.slice(1);
    return expectedIds.length ? null : id;
  };
}

/**
 * Work out what the columns are. Returns
 *   { layout: 'wide', idCol, cols: [{ index, header, count, role }] }
 *   { layout: 'long', idCol, sideCol, valueCol }
 * or { layout: null } when nothing usable is found.
 */
export function mapColumns(grid, expectedIds = []) {
  const norm = idNormaliser(expectedIds);
  const width = Math.max(0, ...grid.map(r => r.length));

  // long layout: a column that is mostly L/R words beside a line-id column
  for (let c = 0; c < width; c++) {
    const vals = grid.map(r => clean(r[c])).filter(Boolean);
    const sides = vals.filter(v => LEFT_RE.test(v) || RIGHT_RE.test(v)).length;
    if (sides >= 4 && sides >= vals.length * 0.6) {
      let idCol = -1, best = 0;
      for (let k = 0; k < width; k++) {
        if (k === c) continue;
        const n = grid.filter(r => norm(r[k])).length;
        if (n > best) { best = n; idCol = k; }
      }
      let valueCol = -1; best = 0;
      for (let k = 0; k < width; k++) {
        if (k === c || k === idCol) continue;
        const n = grid.filter(r => toMm(r[k]) != null).length;
        if (n > best) { best = n; valueCol = k; }
      }
      if (idCol >= 0 && valueCol >= 0) return { layout: 'long', idCol, sideCol: c, valueCol };
    }
  }

  const det = detectLineTable(grid, expectedIds.length ? expectedIds : null);
  if (det.idCol < 0 || !det.valueCols.length) {
    // the plan's ids may be prefixed (1A1) while the sheet writes A1: retry loosely
    const loose = detectLineTable(grid, null);
    if (loose.idCol < 0 || !loose.valueCols.length) return { layout: null };
    Object.assign(det, loose);
  }
  const cols = det.valueCols
    .sort((a, b) => a.index - b.index)
    .map(v => ({ index: v.index, header: v.header, count: v.count,
                 role: LEFT_RE.test(clean(v.header)) ? 'L' : RIGHT_RE.test(clean(v.header)) ? 'R' : null }));
  // no headers: the first two numeric columns are left then right
  if (!cols.some(c => c.role)) { if (cols[0]) cols[0].role = 'L'; if (cols[1]) cols[1].role = 'R'; }
  return { layout: 'wide', idCol: det.idCol, cols };
}

/** Pull { L: {id: mm}, R: {id: mm} } out of the grid with confirmed columns. */
export function readingsFrom(grid, map, expectedIds = []) {
  const norm = idNormaliser(expectedIds);
  const out = { L: {}, R: {} };
  if (map.layout === 'long') {
    for (const r of grid) {
      const id = norm(r[map.idCol]); const mm = toMm(r[map.valueCol]); const s = clean(r[map.sideCol]);
      if (!id || mm == null) continue;
      if (LEFT_RE.test(s)) out.L[id] = mm; else if (RIGHT_RE.test(s)) out.R[id] = mm;
    }
    return out;
  }
  for (const r of grid) {
    const id = norm(r[map.idCol]);
    if (!id) continue;
    if (map.left != null) { const mm = toMm(r[map.left]); if (mm != null) out.L[id] = mm; }
    if (map.right != null) { const mm = toMm(r[map.right]); if (mm != null) out.R[id] = mm; }
  }
  return out;
}
