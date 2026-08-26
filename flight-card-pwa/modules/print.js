// print.js — paper "kneeboard" cards for the checklist.
//
// One card = a quarter of an A4 sheet (105 × 148.5 mm), laid out as:
//   • a top band of labelled blanks the pilot fills in by hand (pen/pencil),
//   • the checklist down the left,
//   • a big blank block on the right for anything else.
//
// A sheet prints the SAME card four times so one A4 yields four cards; the
// "both sides" option emits a second identical page so a duplex printer gets
// eight per sheet. Duplex itself lives in the system print dialog — a web page
// cannot switch a printer to two-sided, so we only make the back side exist.
//
// Field order and which fields appear are user-editable and persisted; the
// pilot rearranges them in the preview before printing.

import * as storage from './storage.js?v=107';

const CFG_KEY = 'fc.print.cfg';

// The writing band. `id` is stable (it's what gets persisted), `label` is what
// prints. Widths are in grid columns out of 12 so a row can hold 2–4 fields.
// `row` is the printed line a field lands on; everything sharing a row splits
// that line evenly, so a field's width is simply a consequence of how many you
// put beside it. No fixed weights — the pilot decides by moving things around.
export const FIELDS = [
  { id: 'flight', label: 'FLIGHT',     row: 1 },
  { id: 'date',   label: 'DATE',       row: 1 },
  { id: 'reg',    label: 'REG',        row: 1 },
  { id: 'std',    label: 'STD',        row: 2 },
  { id: 'eta',    label: 'ETA',        row: 2 },
  { id: 'sob',    label: 'SOB',        row: 2 },
  { id: 'mel',    label: 'MEL',        row: 2 },
  { id: 'block',  label: 'BLOCK FUEL', row: 3 },
  { id: 'trip',   label: 'TRIP FUEL',  row: 3 },
  { id: 'crew',   label: 'CREW',       row: 4 },
];
// A marker inside `order`. Fields between two markers share a printed line —
// drag a divider and every field above it moves to the row above. This
// replaced per-field row numbers, which were fiddly to reason about.
export const DIVIDER = '|';

function defaultOrder() {
  const out = [];
  let lastRow = null;
  for (const f of FIELDS) {
    if (lastRow !== null && f.row !== lastRow) out.push(DIVIDER);
    out.push(f.id);
    lastRow = f.row;
  }
  return out;
}

const DEFAULT_CFG = {
  order: defaultOrder(),
  off: [],              // ids switched off
  labels: {},           // id → the pilot's own wording, overriding FIELDS
  checklist: true,      // show the checklist column
  blank: true,          // show the free-writing block
  bothSides: false,
};

export function getConfig() {
  try {
    const raw = JSON.parse(localStorage.getItem(CFG_KEY) || 'null');
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_CFG };
    // Merge against defaults so a config saved before a field existed still
    // renders that field instead of silently dropping it.
    const known = new Set(FIELDS.map(f => f.id));
    let order = [];
    for (const e of (Array.isArray(raw.order) ? raw.order : [])) {
      if (e === DIVIDER) order.push(DIVIDER);
      else if (known.has(e) && !order.includes(e)) order.push(e);
    }
    for (const f of FIELDS) if (!order.includes(f.id)) order.push(f.id);
    // A config saved before dividers existed (possibly with row numbers) has
    // none — rebuild the splits from whatever grouping it had.
    if (!order.includes(DIVIDER)) {
      const rowOf = (id) => {
        const n = Number(raw.rows && raw.rows[id]);
        if (Number.isInteger(n) && n > 0) return n;
        const f = FIELDS.find(x => x.id === id);
        return f ? f.row : 1;
      };
      const rebuilt = [];
      let last = null;
      for (const id of order.slice().sort((a, b) => rowOf(a) - rowOf(b))) {
        if (last !== null && rowOf(id) !== last) rebuilt.push(DIVIDER);
        rebuilt.push(id);
        last = rowOf(id);
      }
      order = rebuilt;
    }
    const labels = {};
    if (raw.labels && typeof raw.labels === 'object') {
      for (const [id, v] of Object.entries(raw.labels)) {
        if (known.has(id) && typeof v === 'string' && v.trim()) labels[id] = v.slice(0, 24);
      }
    }
    return {
      order,
      off:       Array.isArray(raw.off) ? raw.off.filter(id => known.has(id)) : [],
      labels,
      checklist: raw.checklist !== false,
      blank:     raw.blank !== false,
      bothSides: !!raw.bothSides,
    };
  } catch { return { ...DEFAULT_CFG }; }
}

export function setConfig(cfg) {
  try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch {}
}

export function moveField(id, delta) {
  const cfg = getConfig();
  const i = cfg.order.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= cfg.order.length) return cfg;
  [cfg.order[i], cfg.order[j]] = [cfg.order[j], cfg.order[i]];
  setConfig(cfg);
  return cfg;
}

export function toggleField(id) {
  const cfg = getConfig();
  const i = cfg.off.indexOf(id);
  if (i >= 0) cfg.off.splice(i, 1); else cfg.off.push(id);
  setConfig(cfg);
  return cfg;
}

// The printed wording for a field: the pilot's own if they've retyped it.
export function labelFor(id, cfg = getConfig()) {
  const custom = cfg.labels && cfg.labels[id];
  if (custom) return custom;
  const f = FIELDS.find(x => x.id === id);
  return f ? f.label : id;
}

export function setLabel(id, text) {
  const cfg = getConfig();
  cfg.labels = cfg.labels || {};
  const t = String(text || '').trim().slice(0, 24);
  const def = FIELDS.find(f => f.id === id);
  // Storing a label identical to the default just bloats the config, and it
  // would also freeze the wording if the default ever changes.
  if (!t || (def && t === def.label)) delete cfg.labels[id];
  else cfg.labels[id] = t;
  setConfig(cfg);
  return cfg;
}

// Commit a whole order at once — what a drag-to-reorder gesture produces.
export function addDivider() {
  const cfg = getConfig();
  cfg.order = [...cfg.order, DIVIDER];
  setConfig(cfg);
  return cfg;
}

// Remove the divider at a position in `order` (dividers are interchangeable,
// so position is the only way to say which one).
export function removeDividerAt(index) {
  const cfg = getConfig();
  if (cfg.order[index] === DIVIDER) {
    cfg.order = cfg.order.filter((_, i) => i !== index);
    setConfig(cfg);
  }
  return cfg;
}

export function setOrder(entries) {
  const cfg = getConfig();
  const known = new Set(FIELDS.map(f => f.id));
  const next = [];
  for (const e of entries) {
    if (e === DIVIDER) next.push(DIVIDER);
    else if (known.has(e) && !next.includes(e)) next.push(e);
  }
  for (const f of FIELDS) if (!next.includes(f.id)) next.push(f.id);
  cfg.order = next;
  setConfig(cfg);
  return cfg;
}

export function toggleFlag(key) {
  const cfg = getConfig();
  cfg[key] = !cfg[key];
  setConfig(cfg);
  return cfg;
}

function escape(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[ch]);
}

// ---------- Card ----------

function fieldsHtml(cfg) {
  // Split on dividers; each run is one printed line. Empty runs (two dividers
  // together, or a row whose fields are all switched off) just vanish.
  const rows = [[]];
  for (const e of cfg.order) {
    if (e === DIVIDER) { rows.push([]); continue; }
    if (!cfg.off.includes(e)) rows[rows.length - 1].push(e);
  }
  const filled = rows.filter(r => r.length);
  if (!filled.length) return '';
  return `<div class="pr-fields">` + filled.map(ids =>
    `<div class="pr-row">` + ids.map(id =>
      // The label sits ON the rule (the box's own bottom border), not floating
      // above a separate line — see .pr-f in app.css.
      `<div class="pr-f"><span class="pr-lbl">${escape(labelFor(id, cfg))}</span></div>`
    ).join('') + `</div>`
  ).join('') + `</div>`;
}

function checklistHtml() {
  const tpl = storage.getTemplate();
  const secs = (tpl && Array.isArray(tpl.sections)) ? tpl.sections : [];
  if (!secs.length) return `<div class="pr-cl"><div class="pr-cl-empty">No checklist items.</div></div>`;
  return `<div class="pr-cl">` + secs.map(sec => `
    <div class="pr-cl-sec">
      <div class="pr-cl-name">${escape(sec.name)}</div>
      ${(sec.items || []).map(it =>
        `<div class="pr-cl-item"><span class="pr-box"></span>${escape(it.label)}</div>`
      ).join('')}
    </div>`).join('') + `</div>`;
}

// One quarter-sheet card. Identical in the preview and on paper — the preview
// renders the very same markup, only scaled, so what you see is what prints.
export function cardHtml(cfg = getConfig()) {
  const cols = [];
  if (cfg.checklist) cols.push(checklistHtml());
  if (cfg.blank) cols.push(`<div class="pr-blank"><span class="pr-lbl">NOTES</span></div>`);
  const body = cols.length ? `<div class="pr-body" data-cols="${cols.length}">${cols.join('')}</div>` : '';
  return `<div class="pr-card">${fieldsHtml(cfg)}${body}</div>`;
}

// ---------- Sheets ----------

// An A4 page holding the same card 4×. `pages` = 1 or 2 (2 = both sides).
export function sheetsHtml(cfg = getConfig()) {
  const card = cardHtml(cfg);
  const sheet = `<div class="pr-sheet">${card}${card}${card}${card}</div>`;
  return cfg.bothSides ? sheet + sheet : sheet;
}

// Paint the hidden print container, then hand off to the browser's dialog.
export function print(cfg = getConfig()) {
  const root = document.getElementById('print-root');
  if (!root) return;
  root.innerHTML = sheetsHtml(cfg);
  // Let layout settle before the (synchronous, blocking) print call, or Safari
  // can snapshot a half-laid-out page.
  requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
}
