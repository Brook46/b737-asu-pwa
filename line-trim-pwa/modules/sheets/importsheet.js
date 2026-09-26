// sheets/importsheet.js — read a pilot's own sheet into something the app can use.
//
// Offers CANDIDATES rather than guessing: a workbook can hold one size per sheet
// (Ozone, Punk), a manual and a production table side by side (BGD), or just a
// column of line names with one column per size. The pilot picks; we only ever
// offer manual/check tables and never a table labelled production.

import { readXlsxSheets, readDelimitedGrid } from '../xlsx.js?v=17';
import { findCheckTables, findTopology, findLoops, findRiserLength } from './extract.js?v=17';
import { detectLineTable, gridToLines, parseLineTable } from '../importer.js?v=17';
import { completeMains, deriveSections, riserOfMain } from './sections.js?v=17';

export async function readSheetFile(file) {
  if (/\.xlsx$/i.test(file.name)) return readXlsxSheets(await file.arrayBuffer());
  if (/\.xls$/i.test(file.name)) throw new Error('Old .xls format — open it in Excel/Numbers and save as .xlsx or .csv first.');
  const { grid } = readDelimitedGrid(await file.text());
  return [{ name: file.name, grid }];
}

/** "A1" → "1A1" when the plan uses Advance-style level prefixes. */
function remapper(expectedIds) {
  if (!expectedIds?.length) return id => id;
  const prefixed = expectedIds.every(id => /^\d[A-Z]\d+$/.test(id));
  if (!prefixed) return id => id;
  const level = expectedIds[0][0];
  return id => (/^[A-Z]\d+$/.test(id) ? level + id : id);
}

function coverage(lines, expectedIds) {
  if (!expectedIds?.length) return null;
  const got = Object.keys(lines);
  return {
    missing: expectedIds.filter(id => lines[id] == null),
    extra: got.filter(id => !expectedIds.includes(id)),
  };
}

/**
 * Everything usable in the workbook, best first.
 * Each: { key, title, detail, kind, lines, ribs?, mains?, loops?, riserMm?, coverage? }
 */
export function candidatesFrom(sheets, expectedIds = null) {
  const remap = remapper(expectedIds);
  const out = [];
  const loops = findLoops(sheets);
  const riserMm = findRiserLength(sheets);

  let anyManual = false;
  const tablesBySheet = sheets.map(s => ({ s, tables: findCheckTables(s.grid) }));
  for (const { s, tables } of tablesBySheet) if (tables.length && (tables.some(t => t.kind === 'manual') || /manual/i.test(s.name))) anyManual = true;

  for (const { s, tables } of tablesBySheet) {
    const topo = findTopology(s.grid);
    for (const t of tables) {
      const sheetSaysManual = /manual/i.test(s.name);
      const kind = t.kind === 'manual' || sheetSaysManual ? 'manual' : t.kind;
      if (kind === 'production') continue;             // never offer production lengths
      if (kind === 'unknown' && anyManual) continue;    // a labelled manual table exists: prefer it
      if (sheetSaysManual && t.withRisers === false && tables.some(x => x.withRisers === true)) continue;
      const lines = Object.fromEntries(Object.entries(t.lines).map(([k, v]) => [remap(k), v]));
      const ribs = Object.fromEntries(Object.entries(topo.ribs).map(([k, v]) => [remap(k), v]).filter(([k]) => lines[k] != null));
      const mains = [...topo.mains.entries()].map(([id, ls]) => ({ id, riser: riserOfMain(id), lines: ls.map(remap) }));
      out.push({
        key: `${s.name}#${t.row}`,
        title: s.name,
        detail: (t.label || 'check table').split(' | ').slice(0, 3).join(' · '),
        kind, lines,
        ribs: Object.keys(ribs).length ? ribs : null,
        mains: mains.length ? mains : null,
        loops, riserMm,
        coverage: coverage(lines, expectedIds),
      });
    }
  }

  // No letter tables: try "line name | value | value…" columns.
  if (!out.length) {
    for (const s of sheets) {
      const det = detectLineTable(s.grid, expectedIds);
      if (det.idCol < 0) continue;
      for (const vc of det.valueCols) {
        const { lines: raw } = gridToLines(s.grid, det.idCol, vc.index);
        const lines = Object.fromEntries(Object.entries(raw).map(([k, v]) => [remap(k), v]));
        out.push({
          key: `${s.name}#col${vc.index}`,
          title: `${s.name} — column “${vc.header}”`,
          detail: `${vc.count} values, e.g. ${vc.sample} mm`,
          kind: 'columns', lines, coverage: coverage(lines, expectedIds),
        });
      }
    }
  }

  // best first: complete coverage, then labelled manual, then size
  const score = c => (c.coverage ? -c.coverage.missing.length * 100 : 0) + (c.kind === 'manual' ? 50 : 0) + Object.keys(c.lines).length;
  return out.sort((a, b) => score(b) - score(a));
}

/** Pasted text → a single candidate. */
export function candidateFromText(text, expectedIds = null) {
  const remap = remapper(expectedIds);
  const { lines: raw, warnings } = parseLineTable(text);
  const lines = Object.fromEntries(Object.entries(raw).map(([k, v]) => [remap(k), v]));
  return { key: 'paste', title: 'Pasted table', detail: warnings.slice(0, 2).join(' · '), kind: 'paste', lines, coverage: coverage(lines, expectedIds) };
}

function sizeFrom(c, declaredMains = null) {
  const base = declaredMains
    ? declaredMains.map(m => ({ id: m.id, riser: m.riser, section: m.section, lines: [...m.lines] }))
    : (c.mains || []);
  const { mains } = completeMains(c.lines, base);
  if (!declaredMains) deriveSections(mains, c.ribs || {});
  return {
    lines: c.lines,
    ribs: c.ribs || undefined,
    mains,
    loops: c.loops?.length ? c.loops : undefined,
    riserMm: c.riserMm ?? undefined,
  };
}

/** A brand-new wing from the pilot's sheet. */
export function buildCustomWing({ brand, model, wingClass, sizeKey, candidate }) {
  const slug = `${brand}-${model}-${sizeKey}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return {
    id: `own-${slug}-${Math.random().toString(36).slice(2, 6)}`,
    brand: brand.trim() || 'My', model: model.trim() || 'wing', wingClass: wingClass || '',
    custom: true,
    source: { publisher: 'Your own line-check sheet', retrieved: new Date().toISOString().slice(0, 10) },
    method: { tensionKg: 5, tolIndMm: 10, tolGlobalMm: 50, reference: 'lines + risers' },
    sizes: { [sizeKey.trim() || 'M']: sizeFrom(candidate) },
  };
}

/** Fill a built-in wing's missing size with the pilot's sheet, keeping its topology. */
export function fillWingSize(wing, sizeKey, candidate) {
  const plan = wing.sizes[sizeKey];
  return {
    ...structuredClone(wing),
    id: `${wing.id}-${sizeKey}-own`.toLowerCase().replace(/[^a-z0-9-]+/g, '-'),
    custom: true,
    source: { publisher: `${wing.brand} ${wing.model} ${sizeKey} — lengths from your own sheet`, retrieved: new Date().toISOString().slice(0, 10) },
    sizes: { [sizeKey]: { ...sizeFrom(candidate, plan?.mains || null), ribs: candidate.ribs || plan?.ribs } },
  };
}
