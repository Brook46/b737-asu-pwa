// speeches.js — passenger PA editor with EN/HE tabs and live variable substitution.
//
// Each speech: { id, name, bodyEn, bodyHe }
// Edit mode: textarea for the active language
// Display: substitute @vars and render with each @var highlighted.

import * as storage from './storage.js';

let activeId = null;
let editing = false;
let lang = 'en'; // 'en' | 'he'
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
  tail:   'tail',
  flight: 'flight',
  flt:    'flight',
  dep:    'dep',
  arr:    'arr',
  eta:    'eta',
  flighttime: 'flight_time',
};

const VAR_RE = /@([a-zA-Z]{2,10})\b/g;

function dynamicValue(token, data) {
  // Auto values that are computed (not from dataCard).
  const t = token.toLowerCase();
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  if (t === 'time' || t === 'localtime') return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  if (t === 'utc' || t === 'zulu') return `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}Z`;
  if (t === 'date') return `${pad(now.getDate())}/${pad(now.getMonth()+1)}`;
  return null;
}

export function substitute(body, data) {
  if (!body) return '';
  return body.replace(VAR_RE, (whole, token) => {
    const dyn = dynamicValue(token, data);
    if (dyn != null) return dyn;
    const key = VAR_MAP[token.toLowerCase()];
    if (!key) return whole;
    const val = data[key];
    return (val && String(val).trim()) ? String(val) : whole;
  });
}

// Render mode — also wrap each resolved value in a span so we can highlight.
function renderHtml(body, data) {
  if (!body) return '';
  let html = '';
  let lastIdx = 0;
  body.replace(VAR_RE, (whole, token, idx) => {
    html += escape(body.slice(lastIdx, idx));
    const dyn = dynamicValue(token, data);
    if (dyn != null) {
      html += `<span class="pa-var" data-auto="1">${escape(dyn)}</span>`;
    } else {
      const key = VAR_MAP[token.toLowerCase()];
      const val = key ? data[key] : null;
      if (val && String(val).trim()) {
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

  // Title + lang + actions
  document.getElementById('pa-title').textContent = sp.name;
  const langWrap = document.getElementById('pa-lang');
  langWrap.innerHTML = `
    <button type="button" class="${lang === 'en' ? 'on' : ''}" data-lang="en">EN</button>
    <button type="button" class="${lang === 'he' ? 'on' : ''}" data-lang="he">עב</button>
  `;
  langWrap.querySelectorAll('[data-lang]').forEach(b => {
    b.addEventListener('click', () => { lang = b.dataset.lang; render(); });
  });

  const editBtn = document.getElementById('pa-edit');
  editBtn.textContent = editing ? '✓' : '✎';
  editBtn.title = editing ? 'Done editing' : 'Edit';
  editBtn.onclick = () => { editing = !editing; render(); };
  document.getElementById('pa-rename').onclick = () => doRename(activeId);
  document.getElementById('pa-delete').onclick = () => doDelete(activeId);

  // Body
  const body = document.getElementById('pa-body');
  body.classList.toggle('rtl', lang === 'he');
  const data = storage.getCurrent().dataCard;
  const text = (lang === 'he' ? sp.bodyHe : sp.bodyEn) || '';
  if (editing) {
    body.innerHTML = `<textarea id="pa-textarea" dir="${lang === 'he' ? 'rtl' : 'ltr'}" placeholder="Write the PA here. Use @cpt @fo @PU @tail @flight @dep @arr @flighttime @time @utc — they auto-fill.">${escape(text)}</textarea>`;
    const ta = document.getElementById('pa-textarea');
    ta.addEventListener('input', () => storage.setSpeechBody(sp.id, lang, ta.value));
  } else {
    body.innerHTML = `<div class="pa-rendered" dir="${lang === 'he' ? 'rtl' : 'ltr'}">${renderHtml(text, data)}</div>`;
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
