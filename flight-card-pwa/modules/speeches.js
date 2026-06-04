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

  // Title + actions. Language toggle dropped — both languages live in one
  // window now (Hebrew first, English below).
  document.getElementById('pa-title').textContent = sp.name;
  const langWrap = document.getElementById('pa-lang');
  if (langWrap) langWrap.innerHTML = '';

  const editBtn = document.getElementById('pa-edit');
  editBtn.textContent = editing ? '✓' : '✎';
  editBtn.title = editing ? 'Done editing' : 'Edit';
  editBtn.onclick = () => { editing = !editing; render(); };
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
    body.innerHTML = `
      <div class="pa-block pa-block-he" dir="rtl">
        <div class="pa-block-label">עברית</div>
        <textarea data-lang="he" dir="rtl"
          placeholder="כתוב כאן את ההודעה בעברית. השתמש ב־@cpt @fo @PU @tail @flight @dep @arr @flighttime @time @utc @tod">${escape(heText)}</textarea>
      </div>
      <div class="pa-block pa-block-en" dir="ltr">
        <div class="pa-block-label">English</div>
        <textarea data-lang="en" dir="ltr"
          placeholder="Write the PA here. Use @cpt @fo @PU @tail @flight @dep @arr @flighttime @time @utc @tod — they auto-fill.">${escape(enText)}</textarea>
      </div>
    `;
    body.querySelectorAll('textarea[data-lang]').forEach(ta => {
      ta.addEventListener('input', () => storage.setSpeechBody(sp.id, ta.dataset.lang, ta.value));
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
