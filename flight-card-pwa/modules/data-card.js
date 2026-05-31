// data-card.js — renders the data card grid and wires the pad overlay for editing.

import * as storage from './storage.js';
import { openPad } from './ui.js';

// Field definitions — ordered for the narrow layout.
// kind: 'int' | 'dec' | 'text'  → drives the pad type
// suffix: optional unit shown after the value
export const FIELDS = [
  { group: 'V-speeds',  cells: [
    { key: 'v1',   label: 'V1',    kind: 'int', suffix: 'kt' },
    { key: 'vr',   label: 'VR',    kind: 'int', suffix: 'kt' },
    { key: 'v2',   label: 'V2',    kind: 'int', suffix: 'kt' },
    { key: 'vref', label: 'Vref',  kind: 'int', suffix: 'kt' },
  ]},
  { group: 'Takeoff',   cells: [
    { key: 'n1',    label: 'N1 TO',  kind: 'dec', suffix: '%' },
    { key: 'flaps', label: 'Flaps',  kind: 'int' },
    { key: 'trim',  label: 'Trim',   kind: 'dec', suffix: 'units' },
    { key: 'cg',    label: 'CG',     kind: 'dec', suffix: '%MAC' },
  ]},
  { group: 'Weights',   cells: [
    { key: 'tow',  label: 'TOW',  kind: 'int', suffix: 'kg' },
    { key: 'lw',   label: 'LW',   kind: 'int', suffix: 'kg' },
    { key: 'zfw',  label: 'ZFW',  kind: 'int', suffix: 'kg' },
    { key: 'fuel', label: 'Fuel', kind: 'int', suffix: 'kg' },
  ]},
  { group: 'Souls on board', cells: [
    { key: 'sob_total', label: 'Total',    kind: 'int' },
    { key: 'sob_adt',   label: 'Adults',   kind: 'int' },
    { key: 'sob_chd',   label: 'Children', kind: 'int' },
    { key: 'sob_inf',   label: 'Infants',  kind: 'int' },
  ]},
  { group: 'Flight',    cells: [
    { key: 'tail',    label: 'Tail',     kind: 'text', wide: true },
    { key: 'flight',  label: 'Flight #', kind: 'text' },
    { key: 'dep',     label: 'Dep',      kind: 'text' },
    { key: 'arr',     label: 'Arr',      kind: 'text' },
    { key: 'rwy',     label: 'Runway',   kind: 'text' },
    { key: 'eta',     label: 'ETA',      kind: 'text' },
  ]},
  { group: 'Crew',      cells: [
    { key: 'cpt',  label: 'CPT',  kind: 'text', wide: true },
    { key: 'fo',   label: 'FO',   kind: 'text', wide: true },
    { key: 'cc1',  label: 'CC1 / Purser', kind: 'text', wide: true },
    { key: 'cc2',  label: 'CC2',  kind: 'text', wide: true },
    { key: 'cc3',  label: 'CC3',  kind: 'text', wide: true },
    { key: 'cc4',  label: 'CC4',  kind: 'text', wide: true },
  ]},
];

const CELL_INDEX = (() => {
  const m = new Map();
  for (const g of FIELDS) for (const c of g.cells) m.set(c.key, c);
  return m;
})();

export function render(root) {
  const data = storage.getCurrent().dataCard;
  const html = FIELDS.map(group => {
    const cells = group.cells.map(c => {
      const v = data[c.key];
      const empty = v === undefined || v === '';
      const valStr = empty ? '—' : formatValue(c, v);
      const cls = ['data-cell'];
      if (c.wide) cls.push('span2');
      const valCls = ['val'];
      if (empty) valCls.push('empty');
      if (c.kind === 'text') valCls.push('text');
      return `<button type="button" class="${cls.join(' ')}" data-key="${c.key}">
        <span class="lbl">${escape(c.label)}</span>
        <span class="${valCls.join(' ')}">${escape(valStr)}</span>
      </button>`;
    }).join('');
    return `<div class="data-group-label">${escape(group.group)}</div>${cells}`;
  }).join('');
  root.innerHTML = `<div class="data-grid">${html}</div>`;
  root.querySelectorAll('button.data-cell').forEach(btn => {
    btn.addEventListener('click', () => editCell(btn.dataset.key, root));
  });
}

function editCell(key, root) {
  const def = CELL_INDEX.get(key);
  if (!def) return;
  const current = storage.getCurrent().dataCard[key] ?? '';
  openPad({
    label: def.label + (def.suffix ? ` (${def.suffix})` : ''),
    kind: def.kind,
    value: String(current),
    onSave: (val) => {
      storage.setDataField(key, normalize(def, val));
      render(root);
    },
  });
}

function normalize(def, raw) {
  const s = String(raw).trim();
  if (!s) return '';
  if (def.kind === 'int') {
    const n = parseInt(s.replace(/[^\d-]/g, ''), 10);
    return Number.isFinite(n) ? n : '';
  }
  if (def.kind === 'dec') {
    const n = parseFloat(s.replace(/[^\d.\-]/g, ''));
    return Number.isFinite(n) ? n : '';
  }
  return s;
}

function formatValue(def, v) {
  if (def.kind === 'dec' && typeof v === 'number') {
    return v.toFixed(v >= 100 ? 1 : 2).replace(/\.?0+$/, '');
  }
  return String(v);
}

function escape(s) {
  return String(s).replace(/[&<>"']/g, ch => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[ch]);
}

// Allow OCR / external sources to bulk-apply values and re-render.
export function applyExternal(fields, root) {
  // fields: { key: rawString }. Normalize before persisting.
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    const def = CELL_INDEX.get(k);
    if (!def) continue;
    out[k] = normalize(def, v);
  }
  storage.setDataBulk(out);
  if (root) render(root);
}

export function knownKeys() { return Array.from(CELL_INDEX.keys()); }
export function fieldDef(key) { return CELL_INDEX.get(key); }
