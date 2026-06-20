// data-card.js — collapsible sub-groups with inline editable inputs.
// Cells autosave on every keystroke (debounced inside storage).

import * as storage from './storage.js';
import * as wx from './wx.js';

// kind: 'int' | 'dec' | 'text' | 'atis' | 'flaps' | 'fuel'
// resettable: true → renders a ↻ button on the group head and lets the
// "Reset data card" action wipe the group's cells. Crew + Flight are
// deliberately left out so the persistent header info survives a reset.
export const FIELDS = [
  { id: 'g-sob',   group: 'Souls on board', resettable: true, cells: [
    { key: 'sob_total', label: 'Total', kind: 'int' },
  ]},
  { id: 'g-atis',  group: 'ATIS', resettable: true, cells: [
    { key: 'atis',      label: 'ATIS letter', kind: 'atis',  wide: true },
    // Pilots don't need a free-text ATIS notes box — they want to see the
    // live METAR for the departure airport. Cell is read-only and pulls
    // from wx.js's in-memory cache (populated by the WX popup).
    { key: 'metar',     label: 'METAR',       kind: 'metar', wide: true },
  ]},
  // "TO performance" — V-speeds + N1 + Flaps. Has an OPT/FMC auto-fill button
  // in its head (rendered by data-card.js, wired from app.js).
  { id: 'g-to',    group: 'Takeoff performance', hasOptFmc: true, resettable: true, cells: [
    { key: 'v1',    label: 'V1',    kind: 'int', suffix: 'kt' },
    { key: 'vr',    label: 'VR',    kind: 'int', suffix: 'kt' },
    { key: 'v2',    label: 'V2',    kind: 'int', suffix: 'kt' },
    { key: 'n1',    label: 'N1 TO', kind: 'dec', suffix: '%' },
    { key: 'flaps', label: 'Flaps', kind: 'flaps', wide: true },
  ]},
  { id: 'g-fuel',  group: 'Fuel', resettable: true, cells: [
    // kind: 'fuel' — accepts both kg (e.g. 12300) and tonnes (e.g. 12.3 or
    // even bare "12"). The tonnes→kg conversion runs on blur, see normalize().
    { key: 'trip_fuel',  label: 'Trip fuel',  kind: 'fuel', suffix: 'kg' },
    { key: 'block_fuel', label: 'Block fuel', kind: 'fuel', suffix: 'kg' },
  ]},
  { id: 'g-flt',   group: 'Flight',    cells: [
    { key: 'dep',         label: 'Dep',         kind: 'text' },
    { key: 'arr',         label: 'Arr',         kind: 'text' },
    // 'hhmm' formats as HH:MM as the user types, same digit-rule as the
    // CTOT input. Up to 4 digits → last two are minutes.
    { key: 'flight_time', label: 'Flight time', kind: 'hhmm' },
    // Logbook fields — block_time is the scheduled snapshot at first sync
    // (read-only), actual_flight_time fills automatically from GPS in
    // Phase 4 but is also manually editable.
    { key: 'block_time',         label: 'Block',  kind: 'hhmm', readonly: true },
    { key: 'actual_flight_time', label: 'Actual', kind: 'hhmm' },
    // Tri-state PF / PM / '' role chips. Tap cycles. Manual per leg —
    // the GPS detector can't tell who flew the leg.
    { key: 'to_role',  label: 'T/O',  kind: 'role', wide: true },
    { key: 'ldg_role', label: 'LDG',  kind: 'role', wide: true },
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
    // METAR is a derived/cached value, not user data — don't include it in
    // the filled count or denominator that the collapsed head shows.
    const countCells = group.cells.filter(c => c.kind !== 'metar');
    const filled = countCells.filter(c => has(data[c.key])).length;
    const summary = renderSummary(group, data);
    const cells = group.cells.map(c => renderCell(c, data[c.key])).join('');
    const resetBtn = group.resettable
      ? `<button type="button" class="data-group-reset" data-reset-group="${group.id}" title="Reset ${escape(group.group)}" aria-label="Reset ${escape(group.group)}">↻</button>`
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
            <span class="data-group-meta">${filled}/${countCells.length}</span>
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

const CREW_CELL_KEYS = new Set(['cpt', 'fo', 'cc1', 'cc2', 'cc3', 'cc4', 'cc5']);

// The official WhatsApp glyph (chat bubble with handset). Sized via the
// .crew-chip-wa CSS rule. fill="currentColor" so the colour follows the
// CSS so we can paint it brand-green via the chip class.
const WHATSAPP_SVG = `
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="currentColor">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.297-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
  </svg>`;

// Crew action chips: ✎ edit · WhatsApp · ⏱ last flight. Now sit at the right
// edge of the name input on the same row (see .crew-row in app.css).
function renderCrewChips(rawName) {
  const canonical = String(rawName || '').trim().toUpperCase();
  if (!canonical) return '';
  const entry = storage.getCrew(canonical);
  const hasPhone = !!(entry && entry.phone);
  const hasNick  = !!(entry && entry.nickname);
  const waCls = 'crew-chip crew-chip-wa' + (hasPhone ? '' : ' is-disabled');
  return `
    <div class="crew-chips" data-crew-name="${escapeAttr(canonical)}">
      <button type="button" class="crew-chip${hasNick ? ' has-nick' : ''}"
              data-crew-action="edit"
              title="Edit nickname &amp; phone"
              aria-label="Edit nickname and phone for ${escapeAttr(canonical)}">✎</button>
      <button type="button" class="${waCls}"
              data-crew-action="whatsapp"
              title="${hasPhone ? 'Open WhatsApp' : 'Set a phone first'}"
              aria-label="Open WhatsApp chat with ${escapeAttr(canonical)}">${WHATSAPP_SVG}</button>
      <button type="button" class="crew-chip"
              data-crew-action="lastflight"
              title="Last flight with this crew member"
              aria-label="Show last flight with ${escapeAttr(canonical)}">⏱</button>
    </div>
  `;
}

// PF / PM tri-state cell — tap cycles through PF → PM → '' (none).
// Wired via app.js's [data-role-key] click delegate.
function renderRoleCell(c, raw) {
  const v = String(raw || '').toUpperCase();
  const cls = ['data-cell', 'role-cell'];
  if (c.wide) cls.push('span2');
  if (v === 'PF') cls.push('is-pf');
  else if (v === 'PM') cls.push('is-pm');
  else cls.push('is-none');
  const display = v || '—';
  return `
    <div class="${cls.join(' ')}">
      <span class="lbl">${escape(c.label)}</span>
      <button type="button" class="role-pill" data-role-key="${c.key}"
              aria-label="${escape(c.label)} role: ${escape(display)}; tap to cycle">${escape(display)}</button>
    </div>
  `;
}

function renderCell(c, raw) {
  if (c.kind === 'atis')    return renderAtisCell(c, raw);
  if (c.kind === 'utctime') return renderUtcCell(c, raw);
  if (c.kind === 'flaps')   return renderFlapsCell(c, raw);
  if (c.kind === 'metar')   return renderMetarCell(c);
  if (c.kind === 'role')    return renderRoleCell(c, raw);
  const v = raw == null ? '' : String(raw);
  // Crew cells: display the nickname (if set) in the input so the pilot sees
  // "Yuvi" instead of "YUVAL KOLAN" in the cockpit. The underlying storage
  // keeps the canonical name; the input shows the display version. The
  // input is read-only when a nickname is in effect so the display name
  // never accidentally overwrites the canonical key.
  let displayValue = v;
  let inputReadonly = c.readonly ? ' readonly' : '';
  if (CREW_CELL_KEYS.has(c.key) && v) {
    const display = storage.displayCrew(v);
    if (display && display !== v.toUpperCase()) {
      displayValue = display;
      inputReadonly = ' readonly';
    }
  }
  const cls = ['data-cell'];
  if (c.wide) cls.push('span2');
  if (CREW_CELL_KEYS.has(c.key) && v) cls.push('crew-cell');
  const inputmode = c.kind === 'text' ? 'text'
                  : c.kind === 'hhmm' ? 'numeric'
                  : 'decimal';
  const autocap = c.kind === 'text' ? 'characters' : 'none';
  const labelStr = c.label + (c.suffix ? ' (' + c.suffix + ')' : '');
  const placeholder = c.kind === 'hhmm' ? 'HH:MM' : '—';
  const maxlen = c.kind === 'hhmm' ? ' maxlength="5"' : '';
  const chips = CREW_CELL_KEYS.has(c.key) ? renderCrewChips(v) : '';
  const inputHtml = `
      <input
        type="text"
        inputmode="${inputmode}"
        autocomplete="off"
        autocapitalize="${autocap}"
        autocorrect="off"
        spellcheck="false"
        data-key="${c.key}"
        data-kind="${c.kind}"
        value="${escapeAttr(displayValue)}"
        placeholder="${placeholder}"${maxlen}${inputReadonly}
      />`;
  // Crew cells render the input + chip strip in a horizontal row so the
  // chips sit at the right edge level with the name. Other cells stay
  // single-column.
  const body = chips
    ? `<div class="crew-row">${inputHtml}${chips}</div>`
    : inputHtml;
  return `
    <label class="${cls.join(' ')}">
      <span class="lbl">${escape(labelStr)}</span>
      ${body}
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

// Read-only METAR display sitting under the ATIS letter. Pulls from wx.js's
// in-memory cache (populated on the *first* WX-popup fetch for this dep).
// When the cache is cold the cell shows a hint to open the WX popup instead
// of forcing a network round-trip on every data-card render.
function renderMetarCell(c) {
  const data = storage.getCurrent().dataCard;
  const dep = (data.dep || '').toString().toUpperCase();
  const entry = dep ? wx.peekCachedWx(dep) : null;
  const metar = entry?.metar;
  let body;
  let stateCls = '';
  if (!dep) {
    body = 'Set Dep first';
    stateCls = 'is-empty';
  } else if (!metar) {
    body = 'Tap the ATIS button above to fetch';
    stateCls = 'is-empty';
  } else {
    body = metar;
  }
  return `
    <div class="data-cell metar-cell span2 ${stateCls}">
      <span class="lbl">${escape(c.label)}${dep ? ' · ' + escape(dep) : ''}</span>
      <div class="metar-text">${escape(body)}</div>
    </div>
  `;
}

// Surgically refresh the METAR cell without re-rendering the whole data card
// — used by app.js after the WX popup fetches so the new METAR appears
// inline without disturbing whatever cell the pilot is currently editing.
export function paintMetar(root) {
  if (!root) return;
  const cell = root.querySelector('.data-cell.metar-cell');
  if (!cell) return;
  const c = CELL_INDEX.get('metar');
  if (!c) return;
  cell.outerHTML = renderMetarCell(c);
}

function renderAtisCell(c, raw) {
  const data = storage.getCurrent().dataCard;
  const v   = (raw || '').toString().toUpperCase().slice(0, 1);
  const dep = (data.dep || '').toString().toUpperCase();
  // The chip displays whichever airport the popup was last on (sticky ICAO).
  // Falls back to Dep so a fresh leg without any popup interaction still
  // shows the right airport.
  const shownIcao = (data.atis_icao || dep || '').toString().toUpperCase();
  const read = !!v && data.atis_read === v;
  const cls = ['atis-collapsed'];
  if (v) cls.push('has-letter');
  cls.push(read ? 'is-read' : 'is-unread');
  const caption = v
    ? `Information ${atisPhonetic(v)}`
    : (shownIcao ? 'Tap to fetch live' : 'Set Dep first');
  const cta = shownIcao ? (v ? 'Open' : 'Fetch') : '—';
  return `
    <div class="data-cell atis-cell span2">
      <button type="button" class="${cls.join(' ')}" data-wx-open="1" ${shownIcao ? '' : 'disabled'}>
        <div class="atis-big">${v || '—'}</div>
        <div class="atis-meta">
          <span class="lbl">ATIS${shownIcao ? ' · ' + escape(shownIcao) : ''}</span>
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
  // METAR is a derived value (cached, multi-line) — never useful in the
  // one-line collapsed summary, so exclude it explicitly.
  const filled = group.cells.filter(c => c.kind !== 'metar' && has(data[c.key]));
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
      // Live-format utctime + hhmm so the colon appears as the user types
      if ((def.kind === 'utctime' || def.kind === 'hhmm') && inp.value !== normalized) {
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
      let raw = storage.getCurrent().dataCard[key];
      if (raw == null || raw === '') { inp.value = ''; return; }
      // Fuel finalizer: if the value looks like tonnes (small number, or a
      // string with a decimal still in it), convert to kg. Threshold of 100
      // separates a tonnes-style entry (e.g. 12, 12.3, 5.5) from someone
      // already typing kg (e.g. 5500, 12300).
      if (def.kind === 'fuel') {
        const n = parseFloat(String(raw).replace(/[^\d.]/g, ''));
        if (Number.isFinite(n)) {
          const kg = n < 100 ? Math.round(n * 1000) : Math.round(n);
          raw = kg;
          storage.setDataField(key, kg);
          updateGroupMeta(root, key);
          if (onChange) onChange(key);
        }
      }
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
  if (def.kind === 'fuel') {
    // Keep the user's string intact during typing (don't strip the decimal
    // point or auto-multiply yet, that would mangle "12.3" into "123"). We
    // store a plain Number when it's a clean integer so downstream math
    // works, and we keep the raw string while a "." is mid-typing.
    const cleaned = s.replace(/[^\d.]/g, '');
    if (!cleaned) return '';
    // Mid-decimal-entry ("12.")  — keep as string so the dot survives the
    // input re-render.
    if (cleaned.endsWith('.')) return cleaned;
    const n = parseFloat(cleaned);
    if (!Number.isFinite(n)) return '';
    // Plain integer with no dot? Number.
    if (!cleaned.includes('.')) return n;
    // Has a dot but no fractional part (e.g. "12.0") → integer.
    if (Number.isInteger(n)) return n;
    // Otherwise keep the decimal string until blur finalizes it.
    return cleaned;
  }
  if (def.kind === 'atis') return s.toUpperCase().slice(0, 1);
  if (def.kind === 'utctime') return formatHHMM(s);
  if (def.kind === 'hhmm')    return formatHHMM(s);
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
  // Crew cells: surface the nickname (if set) in collapsed summaries too.
  if (def && CREW_CELL_KEYS.has(def.key)) {
    return storage.displayCrew(String(v));
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
