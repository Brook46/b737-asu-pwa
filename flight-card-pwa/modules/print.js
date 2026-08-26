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

import * as storage from './storage.js?v=105';

const CFG_KEY = 'fc.print.cfg';

// The writing band. `id` is stable (it's what gets persisted), `label` is what
// prints. Widths are in grid columns out of 12 so a row can hold 2–4 fields.
export const FIELDS = [
  { id: 'flight', label: 'FLIGHT',     w: 4 },
  { id: 'date',   label: 'DATE',       w: 4 },
  { id: 'reg',    label: 'REG',        w: 4 },
  { id: 'std',    label: 'STD',        w: 3 },
  { id: 'eta',    label: 'ETA',        w: 3 },
  { id: 'sob',    label: 'SOB',        w: 3 },
  { id: 'mel',    label: 'MEL',        w: 3 },
  { id: 'block',  label: 'BLOCK FUEL', w: 6 },
  { id: 'trip',   label: 'TRIP FUEL',  w: 6 },
  { id: 'crew',   label: 'CREW',       w: 12 },
];

const DEFAULT_CFG = {
  order: FIELDS.map(f => f.id),
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
    const order = (Array.isArray(raw.order) ? raw.order : []).filter(id => known.has(id));
    for (const f of FIELDS) if (!order.includes(f.id)) order.push(f.id);
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
export function setOrder(ids) {
  const cfg = getConfig();
  const known = new Set(FIELDS.map(f => f.id));
  const next = [];
  for (const id of ids) if (known.has(id) && !next.includes(id)) next.push(id);
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
  const byId = new Map(FIELDS.map(f => [f.id, f]));
  const on = cfg.order.filter(id => !cfg.off.includes(id));
  if (!on.length) return '';
  return `<div class="pr-fields">` + on.map(id => {
    const f = byId.get(id);
    return `<div class="pr-f" style="--w:${f.w}">
      <span class="pr-lbl">${escape(labelFor(id, cfg))}</span>
      <span class="pr-rule"></span>
    </div>`;
  }).join('') + `</div>`;
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
