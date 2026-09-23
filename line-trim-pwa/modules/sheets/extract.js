// sheets/extract.js — pull a trim-check line plan out of a manufacturer
// spreadsheet, whatever its vintage.
//
// Works on the grid shape from xlsx.js: [{ name, grid }] per workbook. Nothing
// here is brand-specific in the matching logic; it keys on what every check
// sheet has in common:
//
//   CHECK TABLE   a header row of riser letters (A B C D E K), an integer index
//                 column to its left, one row per suspension-point number.
//                 Sheets often carry several — production AND manual — and
//                 they differ by up to ~45 mm, which is 4x tolerance. The label
//                 above each table decides which is which; we only ever return
//                 the MANUAL / certification one as check lengths.
//   TOPOLOGY      rows naming a top line (a1, c12) followed by its cascade chain
//                 (a1 → AM1 → AR1). The last element is the main at the riser.
//   RIB POSITION  which rib each top line attaches to — real span position.
//
// Anything that can't be read cleanly is left out rather than guessed.

const LETTERS = new Set(['A', 'B', 'C', 'D', 'E', 'K']);
const isInt = s => /^\d{1,2}(\.0+)?$/.test(String(s).trim());
const num = s => {
  const v = parseFloat(String(s).replace(',', '.'));
  return Number.isFinite(v) ? v : null;
};
const mmOrNull = s => {
  const v = num(s);
  if (v == null || v === 0) return null;
  const mm = v < 20 ? v * 1000 : v;          // a sheet in metres
  return mm >= 1500 && mm <= 15000 ? Math.round(mm * 10) / 10 : null;
};

// A table's identity comes from the heading NEAREST above it. Sheets put long
// notes beside their tables ("brake length in production is measured to the
// stitch line, in the Manual to the sail"), so a note that names both kinds is
// ignored, and the first unambiguous heading walking upward wins.
const MANUAL_RE = /manual\s*check|manual\s*=|certification|for service cent|when the glider has been flown|^manual$|manual checklength/i;
const PROD_RE   = /production|glider at production|unflown|factory|\bprod\b/i;

function tableLabel(grid, row, c0, c1) {
  const lines = [];
  let kind = 'unknown';
  for (let r = row - 1; r >= Math.max(0, row - 6); r--) {
    for (let c = Math.max(0, c0 - 2); c <= c1 + 1; c++) {
      const v = String(grid[r]?.[c] ?? '').trim();
      if (!v || /^[\d.,\s-]+$/.test(v)) continue;
      lines.push(v);
      if (kind !== 'unknown') continue;
      const m = MANUAL_RE.test(v), p = PROD_RE.test(v);
      if (m && !p) kind = 'manual';
      else if (p && !m) kind = 'production';
      // both named in one cell: a note, not a heading — keep looking
    }
  }
  return { label: lines.join(' | '), kind };
}

/** Every A/B/C/D/K check table in one sheet. */
export function findCheckTables(grid) {
  const tables = [];
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r] || [];
    const letterCols = [];
    for (let c = 0; c < row.length; c++) {
      const v = String(row[c] ?? '').trim();
      if (LETTERS.has(v)) letterCols.push({ c, v });
    }
    // Two tables can sit side by side in the same rows (production | manual),
    // so split the header wherever a letter repeats or the columns jump.
    const groups = [];
    for (const x of letterCols) {
      const g = groups[groups.length - 1];
      if (!g || g.some(y => y.v === x.v) || x.c - g[g.length - 1].c > 3) groups.push([x]);
      else g.push(x);
    }
    let lastRow = r;
    for (const g of groups) {
      // a header needs several letters, including B or C
      if (g.length < 3 || !g.some(x => x.v === 'B' || x.v === 'C')) continue;
      const cols = {};
      for (const { c, v } of g) cols[v] = c;
      // some sheets leave the A header cell blank: A sits just left of B
      if (cols.A == null && cols.B != null) cols.A = cols.B - 1;
      const first = Math.min(...Object.values(cols));
      const idxCol = first - 1;
      if (idxCol < 0) continue;

      const lines = {};
      let r2 = r + 1, rowsRead = 0;
      for (; r2 < grid.length; r2++) {
        const idx = grid[r2]?.[idxCol];
        if (!isInt(idx)) {
          if (rowsRead === 0 && r2 - r < 3) continue;   // tolerate a spacer row
          break;
        }
        const n = parseInt(idx, 10);
        for (const [letter, c] of Object.entries(cols)) {
          const mm = mmOrNull(grid[r2]?.[c]);
          if (mm != null) lines[`${letter}${n}`] = mm;
        }
        rowsRead++;
      }
      if (rowsRead < 3 || Object.keys(lines).length < 8) continue;

      const { label, kind } = tableLabel(grid, r, first, Math.max(...Object.values(cols)));
      tables.push({
        row: r, idxCol, cols, lines, rowsRead, label, kind,
        withRisers: /lines\s*\+\s*risers|incl\w*\s+risers?/i.test(label) ? true
                  : /^lines\b(?!\s*\+)/i.test(label.split(' | ').find(p => /^lines\b/i.test(p)) || '') ? false
                  : null,
      });
      lastRow = Math.max(lastRow, r2 - 1);
    }
    r = lastRow;
  }
  return tables;
}

// A cascade id at riser level: AR1, BR4, CR3, DR1, KL1, KR2, AST … and the
// middle levels AM1, AMU2, AML1, BMU1 — anything uppercase + digits.
const CASCADE = /^[A-Z][A-Z]{0,3}\d{1,2}$/;
const TOPLINE = /^([a-ek])(\d{1,2})$/;          // BGD-style top line id
const RISER_LEVEL = /^[A-EK][RL]\d{1,2}$/;       // AR1 BR4 CR2 DR1 ER1 KR1 KL1

/** Topology + rib positions from a BGD-style line list. */
export function findTopology(grid) {
  // column holding the rib position, from its header
  let ribCol = -1;
  for (let r = 0; r < Math.min(grid.length, 15) && ribCol < 0; r++) {
    const row = grid[r] || [];
    for (let c = 0; c < row.length; c++) {
      if (/rib\s*pos/i.test(String(row[c]))) { ribCol = c; break; }
    }
  }

  const mains = new Map();   // main id -> [lineIds]
  const ribs = {};
  const chains = {};
  for (const row of grid) {
    const m = TOPLINE.exec(String(row?.[0] ?? '').trim());
    if (!m) continue;
    const lineId = (m[1] + m[2]).toUpperCase();
    if (ribCol >= 0) {
      const rib = num(row[ribCol]);
      if (rib != null && rib > 0 && rib < 200) ribs[lineId] = rib;
    }
    // the chain starts where the top id repeats to the right, else right after
    // the rib column; it is a run of cascade ids
    let start = row.findIndex((v, i) => i > 0 && String(v).trim().toLowerCase() === m[0]);
    if (start < 0) continue;
    const chain = [];
    for (let c = start + 1; c < row.length; c++) {
      const v = String(row[c] ?? '').trim();
      if (CASCADE.test(v)) chain.push(v);
      else break;
    }
    if (!chain.length) continue;
    chains[lineId] = chain;
    // The main is the last RISER-level id (AR1, BR4, CR2, DR1, KL1). Some
    // sheets append marker columns after it (Punk: "AR1 | X2 | X1"), so the
    // literal last cell is not trustworthy.
    const riserLevel = chain.filter(id => RISER_LEVEL.test(id));
    const main = riserLevel.length ? riserLevel[riserLevel.length - 1] : chain[chain.length - 1];
    if (!mains.has(main)) mains.set(main, []);
    mains.get(main).push(lineId);
  }
  return { ribs, chains, mains };
}

/** "Loops On CR1 CR2 CR3 and BR4" -> ['CR1','CR2','CR3','BR4'] */
export function findLoops(sheets) {
  for (const { grid } of sheets) {
    for (const row of grid.slice(0, 12)) {
      for (const cell of row) {
        const s = String(cell);
        if (/^loops?\s+on\b/i.test(s)) return [...s.matchAll(/\b([A-Z]{1,2}R\d{1,2})\b/g)].map(m => m[1]);
      }
    }
  }
  return [];
}

/** "500mm Risers", "riser= 530", "including risers 527mm" -> 500 */
export function findRiserLength(sheets) {
  for (const { grid } of sheets) {
    for (const row of grid.slice(0, 40)) {
      for (const cell of row) {
        const s = String(cell);
        if (!/riser/i.test(s)) continue;
        const m = /(\d{3})\s*mm|riser\w*\s*=?\s*(\d{3})/i.exec(s);
        if (m) return Number(m[1] || m[2]);
      }
    }
  }
  return null;
}

/** Design reference like "Cure3V6M_rev5" or "Diva2MLV9_rev35", if the sheet has one. */
export function findDesignRef(sheets) {
  const cells = sheets.flatMap(s => s.grid.flat().map(String));
  return cells.find(c => /^[A-Z][A-Za-z0-9]*?V\d+[A-Z]{1,3}_?rev\d+/.test(c.trim()))
      || cells.find(c => /^[A-Z][A-Za-z]+\d?(XS|S|M|ML|L|XL)V\d/.test(c.trim()))
      || null;
}

/**
 * The whole extraction for one workbook. Returns the manual check lengths, the
 * other tables it saw (so a caller can explain a choice), and topology/ribs
 * when the sheet carries them.
 */
export function extractPlan(sheets) {
  const tables = sheets.flatMap(s => findCheckTables(s.grid).map(t => ({ ...t, sheet: s.name })));
  const manual = tables.filter(t => t.kind === 'manual');
  // several manual tables: prefer the one that states it includes risers
  const pick = manual.find(t => t.withRisers === true) || manual[0] || null;

  let topo = { ribs: {}, chains: {}, mains: new Map() };
  for (const s of sheets) {
    const t = findTopology(s.grid);
    if (t.mains.size > topo.mains.size || Object.keys(t.ribs).length > Object.keys(topo.ribs).length) topo = t;
  }

  return {
    lines: pick ? pick.lines : null,
    table: pick,
    tables,
    ribs: topo.ribs,
    chains: topo.chains,
    mains: [...topo.mains.entries()].map(([id, lines]) => ({ id, lines })),
    loops: findLoops(sheets),
    riserMm: findRiserLength(sheets),
    designRef: findDesignRef(sheets),
  };
}
