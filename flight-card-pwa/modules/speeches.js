// speeches.js — passenger PA editor with bilingual side-by-side display.
//
// Each speech: { id, name, bodyEn, bodyHe }
// Both languages share one window: Hebrew block on top (RTL), English below.
// Edit mode swaps each block for a textarea; both autosave independently.
// Display: substitute @vars and render with each @var highlighted.

import * as storage from './storage.js';
import { cityName } from './airports.js';

let activeId = null;
let editing = false;
let liveTick = null;
// Track the last-focused textarea so a tap on an @-token chip knows
// which language block to insert into.
let lastFocusedTa = null;

// @-token chips shown above the editor in edit mode. The text appears
// verbatim on the chip; tap inserts "@<token>" at the cursor. Order
// matches roughly how often a PA uses them — identity first, dynamic
// time/date last — so the most-used ones are easiest to thumb.
const INSERT_TOKENS = [
  '@cpt', '@fo', '@PU', '@flight', '@tail',
  '@dep', '@arr', '@flighttime',
  '@time', '@utc', '@date', '@tod',
];

// @token → data-card field key. (PU = purser = CC1.)
const VAR_MAP = {
  cpt:    'cpt',
  fo:     'fo',
  pu:     'cc1',
  cc1:    'cc1',
  cc2:    'cc2',
  cc3:    'cc3',
  cc4:    'cc4',
  cc5:    'cc5',
  tail:   'tail',
  flight: 'flight',
  flt:    'flight',
  dep:    'dep',
  arr:    'arr',
  eta:    'eta',
  flighttime: 'flight_time',
};

const VAR_RE = /@([a-zA-Z]{2,10})\b/g;

// @tod — "time of day" bucket from local clock. Speech is generally read
// over the PA close to the time it's prepared, so local clock is the
// honest source. Buckets:
//   05–11 → morning, 12–13 → noon, 14–17 → afternoon, 18–21 → evening,
//   22–04 → night.
const TOD_BUCKETS_EN = {
  morning: 'morning', noon: 'noon', afternoon: 'afternoon',
  evening: 'evening', night: 'night',
};
const TOD_BUCKETS_HE = {
  morning: 'בוקר', noon: 'צהריים', afternoon: 'אחר הצהריים',
  evening: 'ערב',  night:  'לילה',
};
function todBucket(date = new Date()) {
  const h = date.getHours();
  if (h >= 5  && h <= 11) return 'morning';
  if (h >= 12 && h <= 13) return 'noon';
  if (h >= 14 && h <= 17) return 'afternoon';
  if (h >= 18 && h <= 21) return 'evening';
  return 'night';
}

function dynamicValue(token, data, lang = 'en') {
  // Auto values that are computed (not from dataCard).
  const t = token.toLowerCase();
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  if (t === 'time' || t === 'localtime') return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  if (t === 'utc' || t === 'zulu') return `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}Z`;
  if (t === 'date') return `${pad(now.getDate())}/${pad(now.getMonth()+1)}`;
  if (t === 'tod') {
    const b = todBucket(now);
    return (lang === 'he' ? TOD_BUCKETS_HE : TOD_BUCKETS_EN)[b];
  }
  return null;
}

// Crew-bearing field keys — substituted through storage.displayCrew so a
// saved nickname (e.g. "Yuvi" for "YUVAL KOLAN") appears in the rendered PA.
const CREW_FIELDS = new Set(['cpt', 'fo', 'cc1', 'cc2', 'cc3', 'cc4', 'cc5']);

export function substitute(body, data, lang = 'en') {
  if (!body) return '';
  return body.replace(VAR_RE, (whole, token) => {
    const dyn = dynamicValue(token, data, lang);
    if (dyn != null) return dyn;
    const key = VAR_MAP[token.toLowerCase()];
    if (!key) return whole;
    let val = data[key];
    if (!val || !String(val).trim()) return whole;
    // dep/arr/eta: expand IATA/ICAO airport codes to city names
    if (key === 'dep' || key === 'arr' || key === 'eta') {
      val = cityName(val);
    }
    // Crew tokens (@cpt / @fo / @PU / @cc2…) go through the registry so
    // nicknames replace canonical names everywhere.
    if (CREW_FIELDS.has(key)) {
      val = storage.displayCrew(val);
    }
    return String(val);
  });
}

// Render mode — also wrap each resolved value in a span so we can highlight.
function renderHtml(body, data, lang = 'en') {
  if (!body) return '';
  let html = '';
  let lastIdx = 0;
  body.replace(VAR_RE, (whole, token, idx) => {
    html += escape(body.slice(lastIdx, idx));
    const dyn = dynamicValue(token, data, lang);
    if (dyn != null) {
      html += `<span class="pa-var" data-auto="1">${escape(dyn)}</span>`;
    } else {
      const key = VAR_MAP[token.toLowerCase()];
      let val = key ? data[key] : null;
      if (val && String(val).trim()) {
        if (key === 'dep' || key === 'arr' || key === 'eta') val = cityName(val);
        if (CREW_FIELDS.has(key)) val = storage.displayCrew(val);
        html += `<span class="pa-var">${escape(String(val))}</span>`;
      } else {
        html += `<span class="pa-var pa-var-empty">${escape(whole)}</span>`;
      }
    }
    lastIdx = idx + whole.length;
    return whole;
  });
  html += escape(body.slice(lastIdx));
  return html.replace(/\n/g, '<br/>');
}

export function open() {
  ensureActive();
  editing = false;
  document.getElementById('pa-overlay').classList.remove('hidden');
  render();
  // Re-render every 30s so @time and @utc stay live.
  if (liveTick) clearInterval(liveTick);
  liveTick = setInterval(() => {
    if (!document.getElementById('pa-overlay').classList.contains('hidden') && !editing) render();
  }, 30 * 1000);
}
export function close() {
  document.getElementById('pa-overlay').classList.add('hidden');
  if (liveTick) { clearInterval(liveTick); liveTick = null; }
}

function ensureActive() {
  const list = storage.getSpeeches();
  if (!list.length) { activeId = storage.addSpeech('PA'); return; }
  if (!activeId || !list.find(s => s.id === activeId)) activeId = list[0].id;
}

function render() {
  const list = storage.getSpeeches();
  const sp = list.find(s => s.id === activeId) || list[0];
  if (!sp) return;
  activeId = sp.id;

  // Tabs
  const tabs = document.getElementById('pa-tabs');
  tabs.innerHTML = list.map(s => `
    <button type="button" class="pa-tab ${s.id === activeId ? 'on' : ''}" data-tab="${s.id}">${escape(s.name)}</button>
  `).join('') + `<button type="button" class="pa-tab add" id="pa-add">＋</button>`;
  tabs.querySelectorAll('[data-tab]').forEach(b => {
    b.addEventListener('click', () => { activeId = b.dataset.tab; editing = false; render(); });
  });
  document.getElementById('pa-add').addEventListener('click', () => {
    const name = prompt('PA name', 'New PA');
    if (!name) return;
    activeId = storage.addSpeech(name.trim());
    editing = true;
    render();
  });

  // Title + actions. In edit mode:
  //   - The title becomes an inline text input that autosaves on every
  //     keystroke (and live-updates the matching tab label).
  //   - ◀ ▶ appear next to the title so the user can move the active PA
  //     left/right in the tab strip.
  const titleEl = document.getElementById('pa-title');
  // 📌 — pin this PA so future app updates skip it during schema reseeds.
  // Available in both modes (read-only and edit) because pinning is a
  // persistence decision, not an edit. Filled pin = pinned; outline = not.
  const pinBtn = `<button type="button" id="pa-pin" class="pa-pin${sp.pinned ? ' is-on' : ''}"
                    title="${sp.pinned ? 'Pinned — app updates won\'t touch this PA. Tap to unpin.' : 'Pin this PA so app updates leave it alone'}"
                    aria-label="${sp.pinned ? 'Unpin' : 'Pin'} ${escape(sp.name)}"
                    aria-pressed="${sp.pinned ? 'true' : 'false'}">📌</button>`;
  if (editing) {
    titleEl.innerHTML =
      `<input type="text" id="pa-title-edit" class="pa-title-input" value="${escape(sp.name)}" aria-label="PA name" />${pinBtn}`;
    const titleInput = document.getElementById('pa-title-edit');
    titleInput.addEventListener('input', () => {
      const v = titleInput.value;
      storage.renameSpeech(activeId, v || 'PA');
      // Live-update the matching tab pill without doing a full render
      // so the input keeps focus + caret position.
      const tabBtn = tabs.querySelector(`[data-tab="${activeId}"]`);
      if (tabBtn) tabBtn.textContent = v || 'PA';
    });
  } else {
    titleEl.innerHTML = `<span class="pa-title-name">${escape(sp.name)}</span>${pinBtn}`;
  }
  document.getElementById('pa-pin').onclick = (e) => {
    e.stopPropagation();
    storage.setSpeechPinned(activeId, !sp.pinned);
    render();
  };
  const langWrap = document.getElementById('pa-lang');
  if (langWrap) {
    if (editing) {
      const i = list.findIndex(s => s.id === activeId);
      langWrap.innerHTML = `
        <button type="button" id="pa-move-left"  class="pa-move" title="Move PA left"  aria-label="Move PA left"  ${i <= 0 ? 'disabled' : ''}>◀</button>
        <button type="button" id="pa-move-right" class="pa-move" title="Move PA right" aria-label="Move PA right" ${i >= list.length - 1 ? 'disabled' : ''}>▶</button>
      `;
      document.getElementById('pa-move-left') .onclick = () => { storage.moveSpeech(activeId, -1); render(); };
      document.getElementById('pa-move-right').onclick = () => { storage.moveSpeech(activeId,  1); render(); };
    } else {
      langWrap.innerHTML = '';
    }
  }

  const editBtn = document.getElementById('pa-edit');
  editBtn.textContent = editing ? '✓' : '✎';
  editBtn.title = editing ? 'Done editing' : 'Edit';
  editBtn.onclick = () => { editing = !editing; lastFocusedTa = null; render(); };
  document.getElementById('pa-rename').onclick = () => doRename(activeId);
  document.getElementById('pa-delete').onclick = () => doDelete(activeId);

  // Body — bilingual: Hebrew block on top (RTL), English below (LTR).
  const body = document.getElementById('pa-body');
  body.classList.remove('rtl');
  body.classList.add('bilingual');
  const data = storage.getCurrent().dataCard;
  const heText = sp.bodyHe || '';
  const enText = sp.bodyEn || '';

  if (editing) {
    const chipsHtml = INSERT_TOKENS
      .map(tok => `<button type="button" class="pa-token-chip" data-token="${escape(tok)}">${escape(tok)}</button>`)
      .join('');
    body.innerHTML = `
      <div class="pa-token-bar" role="toolbar" aria-label="Insert variable">
        <span class="pa-token-hint">Tap to insert →</span>
        ${chipsHtml}
      </div>
      <div class="pa-block pa-block-he" dir="rtl">
        <div class="pa-block-label">עברית</div>
        <textarea data-lang="he" dir="rtl"
          placeholder="כתוב כאן את ההודעה בעברית. הקישו על שבב למעלה כדי להוסיף משתנה במקום להקליד @.">${escape(heText)}</textarea>
      </div>
      <div class="pa-block pa-block-en" dir="ltr">
        <div class="pa-block-label">English</div>
        <textarea data-lang="en" dir="ltr"
          placeholder="Write the PA here. Tap a chip above to insert a variable instead of typing the @ key.">${escape(enText)}</textarea>
      </div>
    `;
    const textareas = body.querySelectorAll('textarea[data-lang]');
    textareas.forEach(ta => {
      ta.addEventListener('input', () => storage.setSpeechBody(sp.id, ta.dataset.lang, ta.value));
      // Remember the last-focused textarea so chip taps know where to
      // insert. blur on the chip itself doesn't fire because mousedown is
      // preventDefault'd; the lastFocusedTa just stays on whichever
      // textarea was active before the tap.
      ta.addEventListener('focus', () => { lastFocusedTa = ta; });
    });
    // Default focus → the Hebrew block (which is the first one and the
    // language the user writes most in). Without this the first chip tap
    // would no-op because no textarea has been focused yet.
    if (!lastFocusedTa) lastFocusedTa = textareas[0] || null;

    body.querySelectorAll('.pa-token-chip').forEach(chip => {
      // pointerdown handles both touch and mouse with a single event and
      // fires BEFORE focus moves, so the textarea keeps its caret. We
      // preventDefault to stop the chip from stealing focus itself. We
      // explicitly do NOT also wire 'click' — on a mouse-tap that would
      // fire after pointerdown, inserting the token a SECOND time.
      chip.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        insertAtCursor(lastFocusedTa, chip.dataset.token, sp.id);
      });
    });
  } else {
    body.innerHTML = `
      <div class="pa-block pa-block-he" dir="rtl">
        <div class="pa-block-label">עברית</div>
        <div class="pa-rendered" dir="rtl">${renderHtml(heText, data, 'he')}</div>
      </div>
      <div class="pa-block pa-block-en" dir="ltr">
        <div class="pa-block-label">English</div>
        <div class="pa-rendered" dir="ltr">${renderHtml(enText, data, 'en')}</div>
      </div>
    `;
  }
  document.getElementById('pa-legend').classList.toggle('hidden', !editing);
}

// Insert `text` at the textarea's caret. If the textarea has a selection,
// the selection is replaced. Autosaves the new body and keeps focus +
// caret position so the user can keep typing.
function insertAtCursor(ta, text, speechId) {
  if (!ta || !text) return;
  const start = ta.selectionStart ?? ta.value.length;
  const end   = ta.selectionEnd   ?? ta.value.length;
  const before = ta.value.slice(0, start);
  const after  = ta.value.slice(end);
  ta.value = before + text + after;
  const caret = start + text.length;
  ta.focus();
  try { ta.setSelectionRange(caret, caret); } catch {}
  storage.setSpeechBody(speechId, ta.dataset.lang, ta.value);
  lastFocusedTa = ta;
}

function doRename(id) {
  const sp = storage.getSpeech(id);
  if (!sp) return;
  const name = prompt('Rename PA', sp.name);
  if (name == null || !name.trim()) return;
  storage.renameSpeech(id, name.trim());
  render();
}
function doDelete(id) {
  const sp = storage.getSpeech(id);
  if (!sp) return;
  const list = storage.getSpeeches();
  if (list.length <= 1) { alert('At least one PA must remain.'); return; }
  if (!confirm(`Delete "${sp.name}"?`)) return;
  storage.deleteSpeech(id);
  activeId = storage.getSpeeches()[0]?.id;
  render();
}

function escape(s) {
  return String(s).replace(/[&<>"']/g, ch => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[ch]);
}

export function notifyDataChange() {
  if (document.getElementById('pa-overlay')?.classList.contains('hidden')) return;
  if (!editing) render();
}
