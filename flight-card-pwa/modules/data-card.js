// data-card.js — collapsible sub-groups with inline editable inputs.
// Cells autosave on every keystroke (debounced inside storage).

import * as storage from './storage.js';

// kind: 'int' | 'dec' | 'text' | 'atis'
export const FIELDS = [
  { id: 'g-to',    group: 'Takeoff numbers', cells: [
    { key: 'v1',    label: 'V1',    kind: 'int', suffix: 'kt' },
    { key: 'vr',    label: 'VR',    kind: 'int', suffix: 'kt' },
    { key: 'v2',    label: 'V2',    kind: 'int', suffix: 'kt' },
    { key: 'n1',    label: 'N1 TO', kind: 'dec', suffix: '%' },
    { key: 'flaps', label: 'Flaps', kind: 'int' },
  ]},
  { id: 'g-fuel',  group: 'Fuel',      cells: [
    { key: 'trip_fuel',  label: 'Trip fuel',  kind: 'int', suffix: 'kg' },
    { key: 'block_fuel', label: 'Block fuel', kind: 'int', suffix: 'kg' },
  ]},
  { id: 'g-sob',   group: 'Souls on board', cells: [
    { key: 'sob_total', label: 'Total', kind: 'int' },
  ]},
  { id: 'g-atis',  group: 'ATIS',      cells: [
    { key: 'atis',      label: 'ATIS letter', kind: 'atis', wide: true },
    { key: 'atis_note', label: 'Notes',       kind: 'text', wide: true },
  ]},
  { id: 'g-flt',   group: 'Flight',    cells: [
    { key: 'dep',         label: 'Dep',         kind: 'dep'  },
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
  ]},
];

const CELL_INDEX = (() => {
  const m = new Map();
  for (const g of FIELDS) for (const c of g.cells) m.set(c.key, c);
  return m;
})();

const DEFAULT_COLLAPSED = new Set(['g-flt', 'g-crew']);
let collapsed = new Set(DEFAULT_COLLAPSED);

// ATIS picker state: closed by default. Tap the cell to open the chip grid,
// tap a letter to commit AND auto-close.
let atisPickerOpen = false;

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
  if (c.kind === 'atis')    return renderAtisCell(c, raw);
  if (c.kind === 'utctime') return renderUtcCell(c, raw);
  if (c.kind === 'dep')     return renderDepCell(c, raw);
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

function renderDepCell(c, raw) {
  const v = raw == null ? '' : String(raw);
  return `
    <label class="data-cell dep-cell">
      <span class="lbl">${escape(c.label)}</span>
      <div class="dep-row">
        <input
          type="text"
          inputmode="text"
          autocomplete="off"
          autocapitalize="characters"
          autocorrect="off"
          spellcheck="false"
          data-key="${c.key}"
          data-kind="dep"
          value="${escapeAttr(v)}"
          placeholder="—"
          maxlength="4"
        />
        <button type="button" class="dep-loc" data-dep-locate="1" title="Use my location" aria-label="Use my location">📍</button>
      </div>
    </label>
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
  const v = (raw || '').toString().toUpperCase().slice(0, 1);
  if (!atisPickerOpen) {
    return `
      <div class="data-cell atis-cell span2">
        <button type="button" class="atis-collapsed ${v ? 'has-letter' : ''}" data-atis-open="1">
          <div class="atis-big">${v || '—'}</div>
          <div class="atis-meta">
            <span class="lbl">ATIS letter</span>
            <span class="val">${v ? `Information ${atisPhonetic(v)}` : 'Tap to choose…'}</span>
          </div>
          <span class="atis-cta">${v ? 'Change' : 'Pick'}</span>
        </button>
      </div>
    `;
  }
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const chips = letters.map(L =>
    `<button type="button" class="atis-chip ${L === v ? 'on' : ''}" data-atis="${L}">${L}</button>`
  ).join('');
  return `
    <div class="data-cell atis-cell span2">
      <div class="atis-expanded">
        <div class="atis-head">
          <span class="lbl">Choose ATIS letter</span>
          <button class="close" data-atis-close="1" aria-label="Close">✕</button>
        </div>
        <div class="atis-chips">${chips}</div>
      </div>
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
  // Inline inputs (autosave on input)
  root.querySelectorAll('input[data-key]').forEach(inp => {
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
  // Dep "Use my location"
  root.querySelectorAll('[data-dep-locate]').forEach(b => {
    b.addEventListener('click', async (e) => {
      e.preventDefault();
      b.disabled = true;
      const original = b.textContent;
      b.textContent = '…';
      try {
        const { detect } = await import('./airports.js');
        const hit = await detect();
        if (!hit) throw new Error('No airport found nearby');
        storage.setDataField('dep', hit.iata);
        const inp = root.querySelector('input[data-key="dep"]');
        if (inp) inp.value = hit.iata;
        updateGroupMeta(root, 'dep');
        if (onChange) onChange('dep');
        if (window.fcToast) window.fcToast(`Dep set to ${hit.iata} (${Math.round(hit.distanceKm)} km)`);
      } catch (err) {
        if (window.fcToast) window.fcToast('Location: ' + (err?.message || err));
      } finally {
        b.disabled = false;
        b.textContent = original;
      }
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

  // ATIS — open the picker on demand
  root.querySelectorAll('[data-atis-open]').forEach(b => {
    b.addEventListener('click', () => { atisPickerOpen = true; render(root); });
  });
  root.querySelectorAll('[data-atis-close]').forEach(b => {
    b.addEventListener('click', () => { atisPickerOpen = false; render(root); });
  });
  // ATIS chip → save AND auto-close the picker, then re-render so the
  // collapsed cell shows the highlighted letter.
  root.querySelectorAll('.atis-chip').forEach(b => {
    b.addEventListener('click', () => {
      const letter = b.dataset.atis;
      const current = storage.getCurrent().dataCard.atis || '';
      const next = (current === letter) ? '' : letter;
      storage.setDataField('atis', next);
      atisPickerOpen = false;
      render(root);
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
  if (def.kind === 'utctime') return formatHHMM(s);
  if (def.kind === 'dep')     return s.toUpperCase().slice(0, 4);
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
