// data-card.js — collapsible sub-groups with inline editable inputs.
// Cells autosave on every keystroke (debounced inside storage).

import * as storage from './storage.js';

// kind: 'int' | 'dec' | 'text' | 'atis'
export const FIELDS = [
  { id: 'g-v',     group: 'V-speeds',  cells: [
    { key: 'v1',   label: 'V1',    kind: 'int', suffix: 'kt' },
    { key: 'vr',   label: 'VR',    kind: 'int', suffix: 'kt' },
    { key: 'v2',   label: 'V2',    kind: 'int', suffix: 'kt' },
  ]},
  { id: 'g-to',    group: 'Takeoff',   cells: [
    { key: 'n1',    label: 'N1 TO',  kind: 'dec', suffix: '%' },
    { key: 'flaps', label: 'Flaps',  kind: 'int' },
  ]},
  { id: 'g-fuel',  group: 'Fuel',      cells: [
    { key: 'trip_fuel',  label: 'Trip fuel',  kind: 'int', suffix: 'kg' },
    { key: 'block_fuel', label: 'Block fuel', kind: 'int', suffix: 'kg' },
  ]},
  { id: 'g-sob',   group: 'Souls on board', cells: [
    { key: 'sob_total', label: 'Total', kind: 'int' },
  ]},
  { id: 'g-atis',  group: 'ATIS',      cells: [
    { key: 'atis',   label: 'ATIS letter', kind: 'atis', wide: true },
    { key: 'atis_note', label: 'Notes', kind: 'text', wide: true },
  ]},
  { id: 'g-flt',   group: 'Flight',    cells: [
    { key: 'dep',     label: 'Dep',      kind: 'text' },
    { key: 'arr',     label: 'Arr',      kind: 'text' },
    { key: 'eta',     label: 'ETA',      kind: 'text' },
  ]},
  { id: 'g-crew',  group: 'Crew',      cells: [
    { key: 'cpt',  label: 'CPT',        kind: 'text', wide: true },
    { key: 'fo',   label: 'FO',         kind: 'text', wide: true },
    { key: 'cc1',  label: 'Purser (PU)', kind: 'text', wide: true },
    { key: 'cc2',  label: 'CC2',        kind: 'text', wide: true },
    { key: 'cc3',  label: 'CC3',        kind: 'text', wide: true },
    { key: 'cc4',  label: 'CC4',        kind: 'text', wide: true },
  ]},
];

const CELL_INDEX = (() => {
  const m = new Map();
  for (const g of FIELDS) for (const c of g.cells) m.set(c.key, c);
  return m;
})();

const DEFAULT_COLLAPSED = new Set(['g-flt', 'g-crew']);
let collapsed = new Set(DEFAULT_COLLAPSED);

let onChange = null;
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
  if (c.kind === 'atis') return renderAtisCell(c, raw);
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

function renderAtisCell(c, raw) {
  const v = (raw || '').toString().toUpperCase().slice(0, 1);
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const chips = letters.map(L =>
    `<button type="button" class="atis-chip ${L === v ? 'on' : ''}" data-atis="${L}">${L}</button>`
  ).join('');
  return `
    <div class="data-cell atis-cell span2">
      <span class="lbl">${escape(c.label)}</span>
      <div class="atis-row">
        <div class="atis-current">${v || '—'}</div>
        <div class="atis-chips">${chips}</div>
      </div>
    </div>
  `;
}

function renderSummary(group, data) {
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
  // Inline inputs (autosave on input)
  root.querySelectorAll('input[data-key]').forEach(inp => {
    inp.addEventListener('input', () => {
      const key = inp.dataset.key;
      const def = CELL_INDEX.get(key);
      const normalized = normalize(def, inp.value);
      storage.setDataField(key, normalized);
      updateGroupMeta(root, key);
      if (onChange) onChange(key);
    });
    inp.addEventListener('blur', () => {
      const key = inp.dataset.key;
      const def = CELL_INDEX.get(key);
      const raw = storage.getCurrent().dataCard[key];
      if (raw == null || raw === '') { inp.value = ''; return; }
      inp.value = formatValue(def, raw);
    });
  });
  // ATIS chip picker
  root.querySelectorAll('.atis-chip').forEach(b => {
    b.addEventListener('click', () => {
      const letter = b.dataset.atis;
      const current = storage.getCurrent().dataCard.atis || '';
      // Tap the active chip again → clear
      const next = (current === letter) ? '' : letter;
      storage.setDataField('atis', next);
      // Update visible state without full re-render to keep scroll position
      const cell = b.closest('.atis-cell');
      cell.querySelectorAll('.atis-chip').forEach(c => c.classList.toggle('on', c.dataset.atis === next));
      cell.querySelector('.atis-current').textContent = next || '—';
      updateGroupMeta(root, 'atis');
      if (onChange) onChange('atis');
    });
  });
}

function updateGroupMeta(root, changedKey) {
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
  if (def.kind === 'atis') return s.toUpperCase().slice(0, 1);
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

export function applyExternal(fields, root) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    const def = CELL_INDEX.get(k);
    if (!def) continue;
    out[k] = normalize(def, v);
  }
  storage.setDataBulk(out);
  for (const k of Object.keys(out)) {
    for (const g of FIELDS) if (g.cells.some(c => c.key === k)) collapsed.delete(g.id);
  }
  if (root) render(root);
}

export function knownKeys() { return Array.from(CELL_INDEX.keys()); }
export function fieldDef(key) { return CELL_INDEX.get(key); }
