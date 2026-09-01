// speeches.js — passenger PA editor with bilingual side-by-side display.
//
// Each speech: { id, name, bodyEn, bodyHe }
// Both languages share one window: Hebrew block on top (RTL), English below.
// Edit mode swaps each block for a contenteditable that shows the real
// colours while you type; both autosave independently.
// Display: substitute @vars and render with each @var highlighted.

import * as storage from './storage.js?v=124';
import { cityName } from './airports.js?v=124';

let activeId = null;
let editing = false;
let liveTick = null;
// Track the last-focused editor so a tap on an @-token chip or a colour swatch
// knows which language block it applies to.
let lastFocusedTa = null;

// @-token chips shown above the editor in edit mode. The text appears
// verbatim on the chip; tap inserts "@<token>" at the cursor. Order
// matches roughly how often a PA uses them — identity first, dynamic
// time/date last — so the most-used ones are easiest to thumb.
// @crew / @cockpit / @cabin come first: they expand to the WHOLE crew in one
// token ("Captain Alon, First Officer Dan and Maya"), so a PA written once
// keeps naming everyone correctly on every leg without re-editing.
const INSERT_TOKENS = [
  '@crew', '@cockpit', '@cabin',
  '@cpt', '@fo', '@PU', '@cc2', '@cc3', '@cc4', '@cc5', '@cc6', '@cc7', '@cc8',
  '@flight', '@tail', '@dep', '@arr', '@flighttime',
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
  cc6:    'cc6',
  cc7:    'cc7',
  cc8:    'cc8',
  tail:   'tail',
  flight: 'flight',
  flt:    'flight',
  dep:    'dep',
  arr:    'arr',
  eta:    'eta',
  flighttime: 'flight_time',
};

const VAR_RE = /@([a-zA-Z]{2,10})\b/g;

// ---- Highlight + colour ----
// The PA body stays PLAIN TEXT and carries inline markers, rather than becoming
// rich HTML. That matters: @tokens are substituted by scanning this string, the
// same body is shared between the Hebrew and English blocks, and every stored
// PA is plain text today. Markers keep all of that working — and the toolbar
// writes them, so nothing has to be typed by hand.
//   {h}…{/}  highlight      {r} red   {a} amber   {g} green   {b} blue
const MARK_RE = /\{(h|r|a|g|b|\/)\}/g;
const MARK_CLASS = { h: 'pa-hl', r: 'pa-c-r', a: 'pa-c-a', g: 'pa-c-g', b: 'pa-c-b' };

// Convert markers to spans, keeping the tags balanced: an unmatched {/} is
// dropped and anything left open is closed at the end, so a half-typed marker
// can never close the surrounding block and break the layout.
function applyMarkup(html) {
  let depth = 0;
  let out = html.replace(MARK_RE, (whole, k) => {
    if (k === '/') {
      if (depth === 0) return '';
      depth--;
      return '</span>';
    }
    depth++;
    return `<span class="${MARK_CLASS[k]}">`;
  });
  while (depth-- > 0) out += '</span>';
  return out;
}

// Plain-text output (copying, sharing) carries no markers.
export function stripMarkup(text) {
  return String(text || '').replace(MARK_RE, '');
}

// ---- WYSIWYG editing ----
// The editor is contenteditable and shows the real colours; the stored body is
// still the plain marker text. These two functions are the bridge. The literal
// colours below are what the editor writes (via execCommand) and what the
// serializer reads back, so they must match MARK_CLASS's palette exactly.
const EDIT_COLOURS = { r: '#e5484d', a: '#f5a524', g: '#30a46c', b: '#3b82f6' };
const EDIT_HL = 'rgba(45, 212, 191, 0.28)';   // a teal wash — legible on both themes
const RGB = { 'rgb(229, 72, 77)': 'r', 'rgb(245, 165, 36)': 'a',
              'rgb(48, 164, 108)': 'g', 'rgb(59, 130, 246)': 'b' };

// marker text → HTML for the contenteditable box.
export function markupToEditHtml(text) {
  const esc = escape(String(text || ''));
  let depth = 0;
  let out = esc.replace(MARK_RE, (whole, k) => {
    if (k === '/') { if (!depth) return ''; depth--; return '</span>'; }
    depth++;
    return k === 'h'
      ? `<span style="background-color:${EDIT_HL}">`
      : `<span style="color:${EDIT_COLOURS[k]}">`;
  });
  while (depth-- > 0) out += '</span>';
  return out.replace(/\n/g, '<br>');
}

// The editor's DOM → marker text. Each text node's effective style is read
// from its ancestors, so however the browser nests its spans, what comes out
// is the same simple marker string the rest of the app already understands.
export function editHtmlToMarkup(root) {
  const runs = [];
  const walk = (node, hl, colour) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        const t = child.nodeValue.replace(/\u200B/g, '');
        if (t) runs.push({ t, hl, colour });
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const tag = child.tagName;
      if (tag === 'BR') { runs.push({ t: '\n', hl, colour }); continue; }
      let nextHl = hl, nextColour = colour;
      const bg = (child.style && child.style.backgroundColor) || '';
      if (bg && bg !== 'transparent') nextHl = true;
      const col = normaliseRgb((child.style && child.style.color) || '');
      if (RGB[col]) nextColour = RGB[col];
      // A block child starts a new line, except the very first one.
      const isBlock = tag === 'DIV' || tag === 'P';
      if (isBlock && runs.length) runs.push({ t: '\n', hl: false, colour: null });
      walk(child, nextHl, nextColour);
    }
  };
  walk(root, false, null);

  let out = '';
  let curHl = false, curColour = null;
  const close = () => {
    if (curColour) { out += '{/}'; curColour = null; }
    if (curHl)     { out += '{/}'; curHl = false; }
  };
  for (const run of runs) {
    if (run.t === '\n') { close(); out += '\n'; continue; }
    if (run.hl !== curHl || run.colour !== curColour) {
      close();
      if (run.hl)     { out += '{h}'; curHl = true; }
      if (run.colour) { out += `{${run.colour}}`; curColour = run.colour; }
    }
    out += run.t;
  }
  close();
  return out;
}

function normaliseRgb(v) {
  return String(v || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// @tod — "time of day" bucket from local clock. Speech is generally read
// over the PA close to the time it's prepared, so local clock is the
// honest source. Buckets:
//   05–11 → morning, 12–13 → day, 14–17 → afternoon, 18–21 → evening,
//   22–04 → night.
// The midday bucket says "day" / "יום" (not "noon" / "צהריים") so the PA
// reads "Good day" and "יום טוב" — what the pilot actually says over the PA.
const TOD_BUCKETS_EN = {
  morning: 'morning', noon: 'day', afternoon: 'afternoon',
  evening: 'evening', night: 'night',
};
const TOD_BUCKETS_HE = {
  morning: 'בוקר', noon: 'יום', afternoon: 'אחר הצהריים',
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

// ---- Whole-crew tokens ----
// @crew / @cockpit / @cabin build a natural-language list from whichever crew
// slots are filled on the active leg, so the PA never has to be re-edited when
// the crew changes. Role titles are prefixed for the three slots that have
// one; CC2–CC5 are named only. Names go through storage.displayCrew so saved
// nicknames win, same as the single-crew tokens.
const CREW_ROLES_EN = { cpt: 'Captain', fo: 'First Officer', cc1: 'Purser' };
const CREW_ROLES_HE = { cpt: 'קברניט',  fo: 'קצין ראשון',   cc1: 'ממונה'  };
const CABIN_KEYS   = ['cc1', 'cc2', 'cc3', 'cc4', 'cc5', 'cc6', 'cc7', 'cc8'];
const COCKPIT_KEYS = ['cpt', 'fo'];

function crewList(data, lang, keys) {
  const roles = lang === 'he' ? CREW_ROLES_HE : CREW_ROLES_EN;
  const parts = [];
  const seen = new Set();
  for (const key of keys) {
    const raw = String(data[key] || '').trim();
    if (!raw) continue;
    const name = storage.displayCrew(raw) || raw;
    const dedupe = name.toUpperCase();
    if (seen.has(dedupe)) continue;      // same person in two slots → once
    seen.add(dedupe);
    parts.push(roles[key] ? `${roles[key]} ${name}` : name);
  }
  if (!parts.length) return null;        // → token renders as unresolved
  if (parts.length === 1) return parts[0];
  const last = parts.pop();
  // Hebrew's "and" is the prefix ו attached to the following word ("דן ומאיה").
  return lang === 'he'
    ? `${parts.join(', ')} ו${last}`
    : `${parts.join(', ')} and ${last}`;
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
  if (t === 'crew')    return crewList(data, lang, [...COCKPIT_KEYS, ...CABIN_KEYS]);
  if (t === 'cockpit') return crewList(data, lang, COCKPIT_KEYS);
  if (t === 'cabin')   return crewList(data, lang, CABIN_KEYS);
  return null;
}

// Crew-bearing field keys — substituted through storage.displayCrew so a
// saved nickname (e.g. "Yuvi" for "YUVAL KOLAN") appears in the rendered PA.
const CREW_FIELDS = new Set(['cpt', 'fo', 'cc1', 'cc2', 'cc3', 'cc4', 'cc5', 'cc6', 'cc7', 'cc8']);

export function substitute(body, data, lang = 'en') {
  if (!body) return '';
  return stripMarkup(body).replace(VAR_RE, (whole, token) => {
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
  // After escaping, so user text can never inject markup of its own; the spans
  // inserted above contain no braces, so a whole-string pass is safe and lets a
  // highlight span a token ("{r}Captain @cpt{/}").
  return applyMarkup(html).replace(/\n/g, '<br/>');
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
  if (editing) {
    titleEl.innerHTML =
      `<input type="text" id="pa-title-edit" class="pa-title-input" value="${escape(sp.name)}" aria-label="PA name" />`;
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
    titleEl.innerHTML = `<span class="pa-title-name">${escape(sp.name)}</span>`;
  }
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
      <div class="pa-fmt-bar" role="toolbar" aria-label="Highlight and colour">
        <span class="pa-token-hint">Select text, or pick then type →</span>
        <button type="button" class="pa-swatch pa-swatch-h" data-mark="h"
                title="Highlight" aria-label="Highlight"></button>
        <button type="button" class="pa-swatch" data-mark="r" style="--sw:${EDIT_COLOURS.r}" title="Red"   aria-label="Red text"></button>
        <button type="button" class="pa-swatch" data-mark="a" style="--sw:${EDIT_COLOURS.a}" title="Amber" aria-label="Amber text"></button>
        <button type="button" class="pa-swatch" data-mark="g" style="--sw:${EDIT_COLOURS.g}" title="Green" aria-label="Green text"></button>
        <button type="button" class="pa-swatch" data-mark="b" style="--sw:${EDIT_COLOURS.b}" title="Blue"  aria-label="Blue text"></button>
        <button type="button" class="pa-swatch pa-swatch-x" data-mark="clear"
                title="Remove highlight and colour" aria-label="Clear formatting">✕</button>
      </div>
      <div class="pa-block pa-block-he" dir="rtl">
        <div class="pa-block-label">עברית</div>
        <div class="pa-editor" contenteditable="true" data-lang="he" dir="rtl"
             role="textbox" aria-multiline="true" aria-label="Hebrew PA text"
             data-placeholder="כתוב כאן את ההודעה בעברית.">${markupToEditHtml(heText)}</div>
      </div>
      <div class="pa-block pa-block-en" dir="ltr">
        <div class="pa-block-label">English</div>
        <div class="pa-editor" contenteditable="true" data-lang="en" dir="ltr"
             role="textbox" aria-multiline="true" aria-label="English PA text"
             data-placeholder="Write the PA here.">${markupToEditHtml(enText)}</div>
      </div>
    `;
    const textareas = body.querySelectorAll('.pa-editor[data-lang]');
    textareas.forEach(ta => {
      ta.addEventListener('input', () => {
        storage.setSpeechBody(sp.id, ta.dataset.lang, editHtmlToMarkup(ta));
      });
      // Paste as plain text: pasted styling would serialise into colours the
      // palette doesn't have, and would then be lost on the next open.
      ta.addEventListener('paste', (e) => {
        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData)?.getData('text/plain') || '';
        if (text) document.execCommand('insertText', false, text);
        storage.setSpeechBody(sp.id, ta.dataset.lang, editHtmlToMarkup(ta));
      });
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

    body.querySelectorAll('.pa-swatch').forEach(btn => {
      // pointerdown + preventDefault so the textarea keeps its selection — a
      // click would blur it first and there would be nothing left to wrap.
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        applyStyle(lastFocusedTa, btn.dataset.mark, sp.id);
      });
    });

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
// Apply a colour or highlight to the live editor. execCommand is deprecated on
// paper but is the only thing that gets the important half of this right on
// iOS Safari: with NOTHING selected it sets a pending format, so picking a
// colour and then typing produces coloured text — which is exactly what was
// asked for and is fiddly to reproduce by hand with Ranges.
function applyStyle(el, kind, speechId) {
  if (!el || !kind) return;
  el.focus();
  try {
    document.execCommand('styleWithCSS', false, true);
    if (kind === 'clear') {
      document.execCommand('removeFormat', false, null);
    } else if (kind === 'h') {
      // Safari names it hiliteColor; other engines accept backColor.
      if (!document.execCommand('hiliteColor', false, EDIT_HL)) {
        document.execCommand('backColor', false, EDIT_HL);
      }
    } else {
      document.execCommand('foreColor', false, EDIT_COLOURS[kind]);
    }
  } catch (err) { console.warn('PA style failed', err); }
  storage.setSpeechBody(speechId, el.dataset.lang, editHtmlToMarkup(el));
  lastFocusedTa = el;
}

function insertAtCursor(ta, text, speechId) {
  if (!ta || !text) return;
  ta.focus();
  // insertText respects the caret and whatever pending colour is active, so an
  // @token dropped into coloured text picks up that colour like any other word.
  try { document.execCommand('insertText', false, text); }
  catch (err) { console.warn('token insert failed', err); }
  storage.setSpeechBody(speechId, ta.dataset.lang, editHtmlToMarkup(ta));
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
