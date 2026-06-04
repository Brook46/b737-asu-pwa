// data-card.js — collapsible sub-groups with inline editable inputs.
// Cells autosave on every keystroke (debounced inside storage).

import * as storage from './storage.js';

// kind: 'int' | 'dec' | 'text' | 'atis'
export const FIELDS = [
  { id: 'g-sob',   group: 'Souls on board', cells: [
    { key: 'sob_total', label: 'Total', kind: 'int' },
  ]},
  { id: 'g-atis',  group: 'ATIS',      cells: [
    { key: 'atis',      label: 'ATIS letter', kind: 'atis', wide: true },
    { key: 'atis_note', label: 'Notes',       kind: 'text', wide: true },
  ]},
  // "TO performance" — V-speeds + N1 + Flaps. Has an OPT/FMC auto-fill button
  // in its head (rendered by data-card.js, wired from app.js).
  { id: 'g-to',    group: 'Takeoff performance', hasOptFmc: true, cells: [
    { key: 'v1',    label: 'V1',    kind: 'int', suffix: 'kt' },
    { key: 'vr',    label: 'VR',    kind: 'int', suffix: 'kt' },
    { key: 'v2',    label: 'V2',    kind: 'int', suffix: 'kt' },
    { key: 'n1',    label: 'N1 TO', kind: 'dec', suffix: '%' },
    { key: 'flaps', label: 'Flaps', kind: 'flaps', wide: true },
  ]},
  { id: 'g-fuel',  group: 'Fuel',      cells: [
    { key: 'trip_fuel',  label: 'Trip fuel',  kind: 'int', suffix: 'kg' },
    { key: 'block_fuel', label: 'Block fuel', kind: 'int', suffix: 'kg' },
  ]},
  { id: 'g-flt',   group: 'Flight',    cells: [
    { key: 'dep',         label: 'Dep',         kind: 'text' },
    { key: 'arr',         label: 'Arr',         kind: 'text' },
    { key: 'flight_time', label: 'Flight time', kind: 'text' },
  ]},
  { id: 'g-crew',  group: 'Crew',      cells: [
    { key: 'cpt',  label: 'CPT',         kind: 'text', wide: true },
    { key: 'fo',   label: 'FO',          kind: 'text', wide: true },
    { key: 'cc1',  label: 'Purser (PU)', kind: 'text', wide: true },
    { key: 'cc2',  label: 'CC2',         kind: 'text', wide: true },
    { key: 'cc3',  label: 'CC3',         kind: 'text', wide: true },
    { key: 'cc4',  label: 'CC4',         kind: 'text', wide: true },
    { key: 'cc5',  label: 'CC5',         kind: 'text', wide: true },
  ]},
];

const CELL_INDEX = (() => {
  const m = new Map();
  for (const g of FIELDS) for (const c of g.cells) m.set(c.key, c);
  return m;
})();

const DEFAULT_COLLAPSED = new Set(['g-flt', 'g-crew']);
let collapsed = new Set(DEFAULT_COLLAPSED);

// ATIS cell is now a launcher into the wx (D-ATIS + METAR) overlay.
// Live letter comes from the popup; manual letter still allowed there.

let onChange = null;
let onOptFmc = null;
let onResetGroup = null;
// Flaps picker collapsed by default — tap to open the 5-chip row.
let flapsPickerOpen = false;
// Kept so the picker open/close + chip clicks can repaint the card without
// the caller having to thread `root` through.
let lastRoot = null;
export function setOnChange(fn) { onChange = fn; }
export function setOnOptFmc(fn) { onOptFmc = fn; }
export function setOnResetGroup(fn) { onResetGroup = fn; }

export function render(root) {
  const data = storage.getCurrent().dataCard;
  const html = FIELDS.map(group => {
    const isCol = collapsed.has(group.id);
    const filled = group.cells.filter(c => has(data[c.key])).length;
    const summary = renderSummary(group, data);
    const cells = group.cells.map(c => renderCell(c, data[c.key])).join('');
    const resetBtn = group.hasOptFmc
      ? `<button type="button" class="data-group-reset" data-reset-group="${group.id}" title="Reset takeoff numbers" aria-label="Reset takeoff numbers">↻</button>`
      : '';
    const optBtn = group.hasOptFmc
      ? `<button type="button" class="data-group-action" data-opt-fmc title="Auto-fill from OPT / FMC screenshot">⌖ OPT / FMC</button>`
      : '';
    return `
      <div class="data-group ${isCol ? 'collapsed' : ''}" data-group="${group.id}">
        <div class="data-group-head-row">
          <button type="button" class="data-group-head" data-toggle="${group.id}">
            <span class="chev">${isCol ? '▸' : '▾'}</span>
            <span class="data-group-name">${escape(group.group)}</span>
            <span class="data-group-meta">${filled}/${group.cells.length}</span>
          </button>
          ${resetBtn}
          ${optBtn}
        </div>
        <div class="data-group-summary">${escape(summary)}</div>
        <div class="data-grid">${cells}</div>
      </div>
    `;
  }).join('');
  root.innerHTML = html;
  lastRoot = root;
  wire(root);
}

function renderCell(c, raw) {
  if (c.kind === 'atis')    return renderAtisCell(c, raw);
  if (c.kind === 'utctime') return renderUtcCell(c, raw);
  if (c.kind === 'flaps')   return renderFlapsCell(c, raw);
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

// The five certified 737NG takeoff flap settings. Manual entry is restricted
// to these via the chip picker. OCR can still write any value (we don't want
// to silently drop a weird OCR result) but the user-facing buttons only show
// these — and if the stored value isn't one of them, no chip is highlighted.
const FLAP_OPTIONS = [1, 5, 10, 15, 25];

function renderFlapsCell(c, raw) {
  const n = (raw === '' || raw == null) ? '' : Number(raw);
  const displayed = n === '' || !Number.isFinite(n) ? '—' : String(n);
  const cls = ['data-cell', 'flaps-cell'];
  if (c.wide) cls.push('span2');

  // Colour the selected flap: 5 is the standard 737NG takeoff setting (blue),
  // anything else is a non-standard takeoff and gets painted red as a visual
  // alert. Empty stays neutral.
  let stateClass = 'is-empty';
  if (Number.isFinite(n) && n === 5) stateClass = 'is-std';
  else if (Number.isFinite(n))       stateClass = 'is-alt';

  if (!flapsPickerOpen) {
    // Collapsed: just the big number + a tap hint. The whole cell is the
    // button so the tap target is generous.
    const caption = Number.isFinite(n) ? `Flap ${n}` : 'Tap to choose';
    return `
      <div class="${cls.join(' ')}">
        <button type="button" class="flaps-collapsed ${stateClass}" data-flaps-open="1">
          <div class="flaps-big">${escape(displayed)}</div>
          <div class="flaps-meta">
            <span class="lbl">${escape(c.label)}</span>
            <span class="val">${escape(caption)}</span>
          </div>
          <span class="flaps-cta">${Number.isFinite(n) ? 'Change' : 'Pick'}</span>
        </button>
      </div>
    `;
  }

  // Expanded: the five chips, plus a close button. Tapping a chip commits
  // and auto-collapses (handled in wire()).
  const chips = FLAP_OPTIONS.map(opt => {
    const on = Number.isFinite(n) && n === opt;
    const chipState = on ? (opt === 5 ? ' on is-std' : ' on is-alt') : '';
    return `<button type="button" class="flaps-chip${chipState}" data-flaps="${opt}">${opt}</button>`;
  }).join('');
  return `
    <div class="${cls.join(' ')}">
      <div class="flaps-expanded">
        <div class="flaps-head">
          <span class="lbl">Choose flap setting</span>
          <button class="close" data-flaps-close="1" aria-label="Close">✕</button>
        </div>
        <div class="flaps-chips">${chips}</div>
      </div>
    </div>
  `;
}

function renderUtcCell(c, raw) {
  const v = raw == null ? '' : String(raw);
  const cls = ['data-cell','utc-cell'];
  if (c.wide) cls.push('span2');
  return `
    <label class="${cls.join(' ')}">
      <span class="lbl">${escape(c.label)}</span>
      <div class="utc-row">
        <input
          type="text"
          inputmode="numeric"
          autocomplete="off"
          autocapitalize="none"
          autocorrect="off"
          spellcheck="false"
          data-key="${c.key}"
          data-kind="utctime"
          value="${escapeAttr(v)}"
          placeholder="HH:MM"
          maxlength="5"
        />
        <span class="utc-z">Z</span>
        <button type="button" class="utc-now" data-utc-now="${c.key}" title="Record current UTC">Now</button>
      </div>
    </label>
  `;
}

function renderAtisCell(c, raw) {
  const data = storage.getCurrent().dataCard;
  const v   = (raw || '').toString().toUpperCase().slice(0, 1);
  const dep = (data.dep || '').toString().toUpperCase();
  const read = !!v && data.atis_read === v;
  const cls = ['atis-collapsed'];
  if (v) cls.push('has-letter');
  cls.push(read ? 'is-read' : 'is-unread');
  const caption = v
    ? `Information ${atisPhonetic(v)}`
    : (dep ? 'Tap to fetch live' : 'Set Dep first');
  const cta = dep ? (v ? 'Open' : 'Fetch') : '—';
  return `
    <div class="data-cell atis-cell span2">
      <button type="button" class="${cls.join(' ')}" data-wx-open="1" ${dep ? '' : 'disabled'}>
        <div class="atis-big">${v || '—'}</div>
        <div class="atis-meta">
          <span class="lbl">ATIS${dep ? ' · ' + escape(dep) : ''}</span>
          <span class="val">${escape(caption)}</span>
        </div>
        <span class="atis-cta">${cta}</span>
      </button>
    </div>
  `;
}

const PHONETIC = {
  A:'Alpha',B:'Bravo',C:'Charlie',D:'Delta',E:'Echo',F:'Foxtrot',G:'Golf',
  H:'Hotel',I:'India',J:'Juliet',K:'Kilo',L:'Lima',M:'Mike',N:'November',
  O:'Oscar',P:'Papa',Q:'Quebec',R:'Romeo',S:'Sierra',T:'Tango',U:'Uniform',
  V:'Victor',W:'Whiskey',X:'X-ray',Y:'Yankee',Z:'Zulu',
};
function atisPhonetic(L) { return PHONETIC[L.toUpperCase()] || L; }

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
  // OPT / FMC auto-fill (only present on the TO performance group)
  root.querySelectorAll('[data-opt-fmc]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (onOptFmc) onOptFmc();
    });
  });
  // Per-group reset — currently only on the TO performance group. Clears
  // every cell value in that group via the onResetGroup callback.
  root.querySelectorAll('[data-reset-group]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (onResetGroup) onResetGroup(btn.dataset.resetGroup);
    });
  });
  // Inline inputs (autosave on input)
  root.querySelectorAll('input[data-key]').forEach(inp => {
    // Select all on focus so a single keystroke replaces the existing value
    inp.addEventListener('focus', () => {
      // setTimeout so iOS Safari actually honours the selection on tap
      setTimeout(() => { try { inp.select(); } catch {} }, 0);
    });
    inp.addEventListener('input', () => {
      const key = inp.dataset.key;
      const def = CELL_INDEX.get(key);
      const normalized = normalize(def, inp.value);
      // Live-format utctime so the colon appears as the user types
      if (def.kind === 'utctime' && inp.value !== normalized) {
        inp.value = normalized;
        // Cursor at the end after auto-format
        try { inp.setSelectionRange(normalized.length, normalized.length); } catch {}
      }
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
  // CTOT "Now" — fill the current UTC HH:MM
  root.querySelectorAll('[data-utc-now]').forEach(b => {
    b.addEventListener('click', (e) => {
      e.preventDefault();
      const key = b.dataset.utcNow;
      const now = new Date();
      const val = `${String(now.getUTCHours()).padStart(2,'0')}:${String(now.getUTCMinutes()).padStart(2,'0')}`;
      storage.setDataField(key, val);
      const inp = root.querySelector(`input[data-key="${key}"]`);
      if (inp) inp.value = val;
      updateGroupMeta(root, key);
      if (onChange) onChange(key);
    });
  });

  // FLAPS picker — collapsed by default to keep the cell compact. Tap the
  // big-number tile to expand into a 5-chip row (1, 5, 10, 15, 25), tap a
  // chip to commit and auto-collapse. OCR still writes any value through
  // setDataField directly.
  root.querySelectorAll('[data-flaps-open]').forEach(b => {
    b.addEventListener('click', (e) => {
      e.preventDefault();
      flapsPickerOpen = true;
      render(root);
    });
  });
  root.querySelectorAll('[data-flaps-close]').forEach(b => {
    b.addEventListener('click', (e) => {
      e.preventDefault();
      flapsPickerOpen = false;
      render(root);
    });
  });
  root.querySelectorAll('.flaps-chip').forEach(b => {
    b.addEventListener('click', (e) => {
      e.preventDefault();
      const v = Number(b.dataset.flaps);
      const current = storage.getCurrent().dataCard.flaps;
      const next = (Number(current) === v) ? '' : v;
      storage.setDataField('flaps', next);
      flapsPickerOpen = false;
      render(root);
      if (onChange) onChange('flaps');
    });
  });

  // ATIS cell click is wired by app.js (opens the wx overlay) — nothing to
  // do here. Manual letter chips live inside the popup and dispatch back.
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
  if (def.kind === 'utctime') return formatHHMM(s);
  if (def.kind === 'flaps') {
    // Same as int but stored as a plain number so the chip-picker comparison
    // works (Number(stored) === Number(chip)).
    const n = parseInt(s.replace(/[^\d-]/g, ''), 10);
    return Number.isFinite(n) ? n : '';
  }
  return s;
}

// "1" → "1"  · "11" → "11"  · "112" → "1:12"  · "1145" → "11:45"
// Always treats the last 2 digits as minutes once 3+ are typed.
export function formatHHMM(raw) {
  const digits = String(raw || '').replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return digits.slice(0, digits.length - 2) + ':' + digits.slice(-2);
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
