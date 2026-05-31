// data-card.js — collapsible sub-groups with inline editable inputs.
// Each cell is a real <input> that saves on every keystroke (debounced in storage).

import * as storage from './storage.js';

// kind: 'int' | 'dec' | 'text'  → drives the inputmode and normalize step
export const FIELDS = [
  { id: 'g-v',     group: 'V-speeds',  cells: [
    { key: 'v1',   label: 'V1',    kind: 'int', suffix: 'kt' },
    { key: 'vr',   label: 'VR',    kind: 'int', suffix: 'kt' },
    { key: 'v2',   label: 'V2',    kind: 'int', suffix: 'kt' },
    { key: 'vref', label: 'Vref',  kind: 'int', suffix: 'kt' },
  ]},
  { id: 'g-to',    group: 'Takeoff',   cells: [
    { key: 'n1',    label: 'N1 TO',  kind: 'dec', suffix: '%' },
    { key: 'flaps', label: 'Flaps',  kind: 'int' },
    { key: 'trim',  label: 'Trim',   kind: 'dec', suffix: 'units' },
    { key: 'cg',    label: 'CG',     kind: 'dec', suffix: '%MAC' },
  ]},
  { id: 'g-wt',    group: 'Weights',   cells: [
    { key: 'tow',  label: 'TOW',  kind: 'int', suffix: 'kg' },
    { key: 'lw',   label: 'LW',   kind: 'int', suffix: 'kg' },
    { key: 'zfw',  label: 'ZFW',  kind: 'int', suffix: 'kg' },
    { key: 'fuel', label: 'Fuel', kind: 'int', suffix: 'kg' },
  ]},
  { id: 'g-sob',   group: 'Souls on board', cells: [
    { key: 'sob_total', label: 'Total',    kind: 'int' },
    { key: 'sob_adt',   label: 'Adults',   kind: 'int' },
    { key: 'sob_chd',   label: 'Children', kind: 'int' },
    { key: 'sob_inf',   label: 'Infants',  kind: 'int' },
  ]},
  { id: 'g-flt',   group: 'Flight',    cells: [
    { key: 'tail',    label: 'Tail',     kind: 'text' },
    { key: 'flight',  label: 'Flight #', kind: 'text' },
    { key: 'dep',     label: 'Dep',      kind: 'text' },
    { key: 'arr',     label: 'Arr',      kind: 'text' },
    { key: 'rwy',     label: 'Runway',   kind: 'text' },
    { key: 'eta',     label: 'ETA',      kind: 'text' },
  ]},
  { id: 'g-crew',  group: 'Crew',      cells: [
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

// In-memory collapsed state for data-card sub-groups.
// Defaults: V-speeds + Takeoff expanded, the rest collapsed (less common).
const DEFAULT_COLLAPSED = new Set(['g-wt', 'g-sob', 'g-flt', 'g-crew']);
let collapsed = new Set(DEFAULT_COLLAPSED);

let onChange = null; // optional callback fired after any cell write

export function setOnChange(fn) { onChange = fn; }

export function render(root) {
  const data = storage.getCurrent().dataCard;
  const html = FIELDS.map(group => {
    const isCol = collapsed.has(group.id);
    const filled = group.cells.filter(c => has(data[c.key])).length;
    const summary = renderSummary(group, data);
    const cells = group.cells.map(c => renderCell(c, data[c.key])).join('');
    return `
      <div class="data-group ${isCol ? 'collapsed' : ''}" data-group="${group.id}">
        <button type="button" class="data-group-head" data-toggle="${group.id}">
          <span class="chev">${isCol ? '▸' : '▾'}</span>
          <span class="data-group-name">${escape(group.group)}</span>
          <span class="data-group-meta">${filled}/${group.cells.length}</span>
        </button>
        <div class="data-group-summary">${escape(summary)}</div>
        <div class="data-grid">${cells}</div>
      </div>
    `;
  }).join('');
  root.innerHTML = html;
  wire(root);
}

function renderCell(c, raw) {
  const v = raw == null ? '' : String(raw);
  const cls = ['data-cell'];
  if (c.wide) cls.push('span2');
  const inputmode = c.kind === 'text' ? 'text' : 'decimal';
  const autocap = c.kind === 'text' ? 'characters' : 'none';
  const labelStr = c.label + (c.suffix ? ' (' + c.suffix + ')' : '');
  return `
    <label class="${cls.join(' ')}">
      <span class="lbl">${escape(labelStr)}</span>
      <input
        type="text"
        inputmode="${inputmode}"
        autocomplete="off"
        autocapitalize="${autocap}"
        autocorrect="off"
        spellcheck="false"
        data-key="${c.key}"
        data-kind="${c.kind}"
        value="${escapeAttr(v)}"
        placeholder="—"
      />
    </label>
  `;
}

function renderSummary(group, data) {
  // Short one-liner shown only when the group is collapsed.
  const filled = group.cells.filter(c => has(data[c.key]));
  if (!filled.length) return '';
  return filled.slice(0, 4).map(c => `${c.label} ${formatValue(c, data[c.key])}`).join(' · ');
}

function wire(root) {
  // Sub-group toggle
  root.querySelectorAll('[data-toggle]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const id = btn.dataset.toggle;
      if (collapsed.has(id)) collapsed.delete(id);
      else collapsed.add(id);
      render(root);
    });
  });
  // Inline input — autosave on input (debounced inside storage)
  root.querySelectorAll('input[data-key]').forEach(inp => {
    inp.addEventListener('input', () => {
      const key = inp.dataset.key;
      const def = CELL_INDEX.get(key);
      const normalized = normalize(def, inp.value);
      storage.setDataField(key, normalized);
      // Update the per-group filled count without a full re-render,
      // so focus stays in the input and iOS keyboard doesn't drop.
      updateGroupMeta(root, key);
      if (onChange) onChange(key);
    });
    // On blur, snap visible text to the formatted value if it differs.
    inp.addEventListener('blur', () => {
      const key = inp.dataset.key;
      const def = CELL_INDEX.get(key);
      const raw = storage.getCurrent().dataCard[key];
      if (raw == null || raw === '') { inp.value = ''; return; }
      inp.value = formatValue(def, raw);
    });
  });
}

function updateGroupMeta(root, changedKey) {
  // Find the group containing this key, recount filled cells.
  const data = storage.getCurrent().dataCard;
  for (const g of FIELDS) {
    if (!g.cells.some(c => c.key === changedKey)) continue;
    const filled = g.cells.filter(c => has(data[c.key])).length;
    const groupEl = root.querySelector(`.data-group[data-group="${g.id}"]`);
    if (!groupEl) return;
    const meta = groupEl.querySelector('.data-group-meta');
    if (meta) meta.textContent = `${filled}/${g.cells.length}`;
    const summary = groupEl.querySelector('.data-group-summary');
    if (summary) summary.textContent = renderSummary(g, data);
    return;
  }
}

function has(v) { return v !== undefined && v !== null && v !== ''; }

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
  if (v == null || v === '') return '';
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
function escapeAttr(s) { return String(s).replace(/"/g, '&quot;'); }

// Allow OCR / external sources to bulk-apply values and re-render.
export function applyExternal(fields, root) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    const def = CELL_INDEX.get(k);
    if (!def) continue;
    out[k] = normalize(def, v);
  }
  storage.setDataBulk(out);
  // Expand any groups that received values so the user sees what just landed.
  for (const k of Object.keys(out)) {
    for (const g of FIELDS) if (g.cells.some(c => c.key === k)) collapsed.delete(g.id);
  }
  if (root) render(root);
}

export function knownKeys() { return Array.from(CELL_INDEX.keys()); }
export function fieldDef(key) { return CELL_INDEX.get(key); }
