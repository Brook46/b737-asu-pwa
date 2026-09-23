// xlsx.js — minimal .xlsx reader, no dependencies.
//
// An .xlsx is a ZIP of XML. Browsers can inflate raw DEFLATE natively via
// DecompressionStream('deflate-raw'), so the whole thing needs no library.
//
// Deliberately narrow: no formulas (we read cached values), no styles, no dates.
// Line-length sheets are plain text and numbers.

const U32 = (dv, o) => dv.getUint32(o, true);
const U16 = (dv, o) => dv.getUint16(o, true);

async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('This browser cannot inflate ZIP data (no DecompressionStream).');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Read a ZIP into { filename: Uint8Array }. Stored + deflated entries only. */
export async function unzip(arrayBuffer) {
  const buf = new Uint8Array(arrayBuffer);
  const dv = new DataView(arrayBuffer);

  // End of central directory: scan back from the tail for 0x06054b50.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (U32(dv, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a ZIP file (no end-of-central-directory record).');

  const count = U16(dv, eocd + 10);
  let ptr = U32(dv, eocd + 16);
  if (ptr === 0xffffffff) throw new Error('ZIP64 archives are not supported.');

  const out = {};
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (U32(dv, ptr) !== 0x02014b50) break;
    const method   = U16(dv, ptr + 10);
    const compSize = U32(dv, ptr + 20);
    const nameLen  = U16(dv, ptr + 28);
    const extraLen = U16(dv, ptr + 30);
    const cmtLen   = U16(dv, ptr + 32);
    const localOff = U32(dv, ptr + 42);
    const name = dec.decode(buf.subarray(ptr + 46, ptr + 46 + nameLen));
    ptr += 46 + nameLen + extraLen + cmtLen;

    if (U32(dv, localOff) !== 0x04034b50) continue;
    const lNameLen  = U16(dv, localOff + 26);
    const lExtraLen = U16(dv, localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compSize);
    out[name] = method === 0 ? raw : await inflateRaw(raw);
  }
  return out;
}

const text = bytes => new TextDecoder().decode(bytes);

// Sheet XML is machine-generated and highly regular, so it is scanned directly
// rather than through DOMParser. That keeps this module usable outside a
// document (tests, workers) and avoids building a DOM for a 10k-cell sheet.
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function unescapeXml(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X'
        ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });
}
const attr = (tag, name) => {
  const m = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"|\\b${name}\\s*=\\s*'([^']*)'`).exec(tag);
  return m ? unescapeXml(m[1] ?? m[2]) : null;
};
/** Text of every <t> element inside a fragment, concatenated (rich-text runs). */
const innerText = frag =>
  [...frag.matchAll(/<t\b[^>]*?\/>|<t\b[^>]*>([\s\S]*?)<\/t>/g)]
    .map(m => unescapeXml(m[1] ?? '')).join('');

/** "BC7" -> 54 (zero-based column index). */
export function colIndex(ref) {
  const m = /^([A-Z]+)/.exec(ref);
  if (!m) return 0;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function sharedStringsOf(files) {
  const shared = [];
  if (files['xl/sharedStrings.xml']) {
    const xml = text(files['xl/sharedStrings.xml']);
    for (const m of xml.matchAll(/<si\b[^>]*?\/>|<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
      shared.push(m[1] ? innerText(m[1]) : '');
    }
  }
  return shared;
}

/** Workbook order of { name, path } — names resolved through the rels file. */
function sheetList(files) {
  const rels = {};
  if (files['xl/_rels/workbook.xml.rels']) {
    for (const m of text(files['xl/_rels/workbook.xml.rels']).matchAll(/<Relationship\b[^>]*>/g)) {
      const id = attr(m[0], 'Id');
      let target = attr(m[0], 'Target') || '';
      target = target.replace(/^\/?xl\//, '').replace(/^\//, '');
      if (id) rels[id] = 'xl/' + target;
    }
  }
  const byOrder = Object.keys(files)
    .filter(f => /^xl\/worksheets\/sheet\d+\.xml$/.test(f))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const out = [];
  if (files['xl/workbook.xml']) {
    const declared = [...text(files['xl/workbook.xml']).matchAll(/<sheet\b[^>]*>/g)];
    declared.forEach((m, i) => {
      const name = attr(m[0], 'name');
      // resolve through the rels file; writers that omit it get paired by order
      const path = rels[attr(m[0], 'r:id')] || byOrder[i];
      if (name && path && files[path]) out.push({ name, path });
    });
  }
  if (!out.length) for (const path of byOrder) out.push({ name: path, path });
  return out;
}

function parseSheet(xml, shared) {
  const grid = [];
  for (const rowM of xml.matchAll(/<row\b([^>]*?)\/>|<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rowR = Number(attr(rowM[1] ?? rowM[2] ?? '', 'r'));
    // honour the row number, so an omitted row keeps later rows in place
    while (rowR && grid.length < rowR - 1) grid.push([]);
    const body = rowM[3] ?? '';
    const cells = [];
    let auto = 0;
    // Self-closing alternative FIRST, with a lazy attribute run: Excel writes
    // styled empty cells as <c r="H9" s="5"/>, and an open-tag pattern with
    // [^>]* would match those too, then swallow the NEXT cell up to its </c>,
    // shifting every later column left.
    for (const cM of body.matchAll(/<c\b([^>]*?)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const tag = cM[1] ?? cM[2] ?? '';
      const inner = cM[3] ?? '';
      const ref = attr(tag, 'r');
      const idx = ref ? colIndex(ref) : auto;   // r is optional in some writers
      auto = idx + 1;
      const type = attr(tag, 't');
      const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let value = '';
      if (type === 's') value = shared[Number(v)] ?? '';
      else if (type === 'inlineStr' || type === 'str') value = innerText(inner) || unescapeXml(v ?? '');
      else value = unescapeXml(v ?? '');       // numbers: Excel's cached result, never the formula
      while (cells.length < idx) cells.push('');
      cells[idx] = String(value).trim();
    }
    grid.push(cells);
  }
  return grid;
}

/** Every worksheet, in workbook order: [{ name, grid }]. */
export async function readXlsxSheets(arrayBuffer) {
  const files = await unzip(arrayBuffer);
  const shared = sharedStringsOf(files);
  const list = sheetList(files);
  if (!list.length) throw new Error('No worksheet found in the workbook.');
  return list.map(({ name, path }) => ({ name, grid: parseSheet(text(files[path]), shared) }));
}

/**
 * The first worksheet as a grid of strings: { grid, sheetName }.
 * Kept for callers that only want one table.
 */
export async function readXlsxGrid(arrayBuffer) {
  const [first] = await readXlsxSheets(arrayBuffer);
  return { grid: first.grid, sheetName: first.name };
}

/** CSV/TSV to the same grid shape, so both feed one code path. */
export function readDelimitedGrid(str) {
  const sep = (str.match(/\t/g) || []).length > (str.match(/,/g) || []).length ? '\t' : ',';
  return {
    sheetName: 'text',
    grid: str.split(/\r?\n/).map(line => {
      // tolerate simple quoted fields
      const out = [];
      let cur = '', q = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (q) {
          if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
          else if (ch === '"') q = false;
          else cur += ch;
        } else if (ch === '"') q = true;
        else if (ch === sep) { out.push(cur.trim()); cur = ''; }
        else cur += ch;
      }
      out.push(cur.trim());
      return out;
    }),
  };
}
