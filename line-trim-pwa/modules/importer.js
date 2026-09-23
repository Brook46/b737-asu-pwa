// importer.js — turn a pasted manufacturer line-length table into a line map.
//
// Tolerant of the shapes these sheets come in:
//   A1  6.523                     (metres)
//   A1  6523                      (millimetres)
//   A1, 6.52                      (csv)
//   A1  2.35  1.90  2.28          (main / mid / top  -> summed)
//   A1 \t 6,523                   (tab + comma decimal)
// Header/among rows without a leading line id are ignored.

// Accepts "A1", "BR2", "K10" and Advance's <level><riser><index> form "1A15".
const ID_RE = /^(\d?\s?[A-Za-z]{1,3}\s?\d{1,2})/;

function toMm(value) {
  // value already a Number. Heuristic: < 20 -> metres, else millimetres.
  if (!isFinite(value)) return null;
  if (value > 0 && value < 20) return Math.round(value * 1000);
  return Math.round(value);
}

export function parseLineTable(text) {
  const lines = {};
  const warnings = [];
  let seen = 0;

  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const idMatch = ID_RE.exec(line);
    if (!idMatch) continue;

    const id = idMatch[1].replace(/\s+/g, '').toUpperCase();
    const rest = line.slice(idMatch[0].length);
    const nums = (rest.match(/-?\d+(?:[.,]\d+)?/g) || [])
      .map(s => parseFloat(s.replace(',', '.')))
      .filter(n => isFinite(n));

    if (!nums.length) { warnings.push(`No number found for "${id}"`); continue; }

    let mm;
    if (nums.length === 1) {
      mm = toMm(nums[0]);
    } else {
      // cascade segments — same unit for all, then sum
      const seg = nums.map(toMm);
      mm = seg.reduce((a, b) => a + b, 0);
    }
    if (mm == null || mm < 500 || mm > 15000) {
      warnings.push(`"${id}" -> ${mm} mm looks out of range, skipped`);
      continue;
    }
    lines[id] = mm;
    seen++;
  }

  if (!seen) warnings.push('No usable rows. Expected e.g. "A1  6.523" per line.');
  return { lines, warnings };
}

// ---- spreadsheet grids ------------------------------------------------------
// A manufacturer sheet is usually one column of line names plus one numeric
// column per size, so we find the name column and then let the caller pick which
// numeric column to read rather than guessing at the size.

const looksLikeLineId = s => /^\d?\s?[A-Za-z]{1,3}\s?\d{1,2}$/.test(String(s).trim());

function cellToMm(s) {
  const v = parseFloat(String(s).replace(',', '.'));
  if (!isFinite(v)) return null;
  const mm = toMm(v);
  return mm != null && mm >= 500 && mm <= 15000 ? mm : null;
}

/**
 * Find the line-name column and every plausible length column in a grid.
 * `expectedIds` (optional) makes the name-column detection much stronger.
 */
export function detectLineTable(grid, expectedIds = null) {
  const width = Math.max(0, ...grid.map(r => r.length));
  const want = expectedIds ? new Set(expectedIds.map(s => s.toUpperCase())) : null;

  let idCol = -1, idScore = 0;
  for (let c = 0; c < width; c++) {
    let score = 0;
    for (const row of grid) {
      const cell = String(row[c] ?? '').replace(/\s+/g, '').toUpperCase();
      if (!cell) continue;
      if (want ? want.has(cell) : looksLikeLineId(cell)) score++;
    }
    if (score > idScore) { idScore = score; idCol = c; }
  }
  if (idCol === -1) return { idCol: -1, valueCols: [], idScore: 0 };

  const valueCols = [];
  for (let c = 0; c < width; c++) {
    if (c === idCol) continue;
    let count = 0, sample = null, firstRow = -1;
    for (let r = 0; r < grid.length; r++) {
      const id = String(grid[r][idCol] ?? '').replace(/\s+/g, '').toUpperCase();
      if (!id || (want ? !want.has(id) : !looksLikeLineId(id))) continue;
      const mm = cellToMm(grid[r][c]);
      if (mm != null) { count++; if (sample == null) { sample = mm; firstRow = r; } }
    }
    if (!count) continue;
    // header = nearest non-empty cell above the first data row in this column
    let header = '';
    for (let r = firstRow - 1; r >= 0 && r >= firstRow - 6; r--) {
      const h = String(grid[r][c] ?? '').trim();
      if (h) { header = h; break; }
    }
    valueCols.push({ index: c, header: header || `column ${c + 1}`, count, sample });
  }
  valueCols.sort((a, b) => b.count - a.count);
  return { idCol, valueCols, idScore };
}

/** Pull { lineId: mm } out of a grid given the chosen columns. */
export function gridToLines(grid, idCol, valueCol) {
  const lines = {};
  const warnings = [];
  for (const row of grid) {
    const id = String(row[idCol] ?? '').replace(/\s+/g, '').toUpperCase();
    if (!id || !looksLikeLineId(id)) continue;
    const mm = cellToMm(row[valueCol]);
    if (mm == null) { warnings.push(`${id}: no usable number`); continue; }
    if (lines[id] != null && lines[id] !== mm) warnings.push(`${id} appears twice with different values`);
    lines[id] = mm;
  }
  return { lines, warnings };
}
