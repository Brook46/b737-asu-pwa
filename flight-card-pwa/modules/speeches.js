// speeches.js — passenger announcement editor with tabs.
//
// Tabs: one per saved speech ({ id, name, body }).
// Body: edit mode shows a textarea (raw template with @vars).
//       Display mode renders @cpt, @fo, @PU, @tail, @flight, @dep, @arr replaced
//       with the current data-card values.

import * as storage from './storage.js';

let activeId = null;
let editing = false;

// Map @token (case-insensitive) → data-card field key
const VAR_MAP = {
  cpt:    'cpt',
  fo:     'fo',
  pu:     'cc1',       // PU = Purser; we keep CPT/FO/CC1 in dataCard via the header / future crew section
  cc1:    'cc1',
  cc2:    'cc2',
  cc3:    'cc3',
  cc4:    'cc4',
  tail:   'tail',
  flight: 'flight',
  dep:    'dep',
  arr:    'arr',
};

const VAR_RE = /@([a-zA-Z]{2,8})\b/g;

export function substitute(body, data) {
  if (!body) return '';
  return body.replace(VAR_RE, (whole, token) => {
    const key = VAR_MAP[token.toLowerCase()];
    if (!key) return whole;
    const val = data[key];
    return (val && String(val).trim()) ? String(val) : whole;
  });
}

export function open() {
  ensureActive();
  editing = false;
  document.getElementById('pa-overlay').classList.remove('hidden');
  render();
}
export function close() {
  document.getElementById('pa-overlay').classList.add('hidden');
}

function ensureActive() {
  const list = storage.getSpeeches();
  if (!list.length) {
    activeId = storage.addSpeech('PA');
    return;
  }
  if (!activeId || !list.find(s => s.id === activeId)) {
    activeId = list[0].id;
  }
}

function render() {
  const list = storage.getSpeeches();
  const sp = list.find(s => s.id === activeId) || list[0];
  if (!sp) return;
  activeId = sp.id;

  // Tabs
  const tabs = document.getElementById('pa-tabs');
  tabs.innerHTML = list.map(s => `
    <button type="button"
            class="pa-tab ${s.id === activeId ? 'on' : ''}"
            data-tab="${s.id}">${escape(s.name)}</button>
  `).join('') + `<button type="button" class="pa-tab add" id="pa-add">＋</button>`;
  tabs.querySelectorAll('[data-tab]').forEach(b => {
    b.addEventListener('click', () => { activeId = b.dataset.tab; editing = false; render(); });
    let pressT = null;
    b.addEventListener('touchstart', () => {
      pressT = setTimeout(() => { pressT = null; renameOrDelete(b.dataset.tab); }, 600);
    }, { passive: true });
    b.addEventListener('touchend',  () => { if (pressT) clearTimeout(pressT); pressT = null; });
    b.addEventListener('touchmove', () => { if (pressT) clearTimeout(pressT); pressT = null; });
  });
  document.getElementById('pa-add').addEventListener('click', () => {
    const name = prompt('PA name', 'New PA');
    if (!name) return;
    activeId = storage.addSpeech(name.trim());
    editing = true;
    render();
  });

  // Title row + edit toggle
  document.getElementById('pa-title').textContent = sp.name;
  const editBtn = document.getElementById('pa-edit');
  editBtn.textContent = editing ? '✓' : '✎';
  editBtn.title = editing ? 'Done editing' : 'Edit';
  editBtn.onclick = () => { editing = !editing; render(); };

  // Rename / delete buttons
  const renameBtn = document.getElementById('pa-rename');
  renameBtn.onclick = () => renameOrDelete(activeId, 'rename');
  const delBtn = document.getElementById('pa-delete');
  delBtn.onclick = () => renameOrDelete(activeId, 'delete');

  // Body
  const body = document.getElementById('pa-body');
  const data = storage.getCurrent().dataCard;
  if (editing) {
    body.innerHTML = `<textarea id="pa-textarea" placeholder="Write the PA here. Use @cpt, @fo, @PU, @tail, @flight, @dep, @arr — they auto-fill from the data card.">${escape(sp.body || '')}</textarea>`;
    const ta = document.getElementById('pa-textarea');
    ta.addEventListener('input', () => storage.setSpeechBody(sp.id, ta.value));
  } else {
    const rendered = substitute(sp.body || '', data);
    body.innerHTML = `<div class="pa-rendered">${escape(rendered).replace(/\n/g, '<br/>')}</div>`;
  }

  // Show the var legend only in edit mode
  document.getElementById('pa-legend').classList.toggle('hidden', !editing);
}

function renameOrDelete(id, forceMode) {
  const sp = storage.getSpeech(id);
  if (!sp) return;
  const list = storage.getSpeeches();
  if (forceMode === 'delete') {
    if (list.length <= 1) { alert('At least one PA must remain.'); return; }
    if (!confirm(`Delete "${sp.name}"?`)) return;
    storage.deleteSpeech(id);
    activeId = storage.getSpeeches()[0]?.id;
    render();
    return;
  }
  if (forceMode === 'rename') {
    const name = prompt('Rename PA', sp.name);
    if (name == null) return;
    if (!name.trim()) return;
    storage.renameSpeech(id, name.trim());
    render();
    return;
  }
  // Long-press path: small choice
  const choice = prompt('Type "r" to rename or "d" to delete', '');
  if (choice === 'r') renameOrDelete(id, 'rename');
  else if (choice === 'd') renameOrDelete(id, 'delete');
}

function escape(s) {
  return String(s).replace(/[&<>"']/g, ch => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[ch]);
}

// Re-render when the data card changes (so substitutions stay live).
export function notifyDataChange() {
  if (document.getElementById('pa-overlay')?.classList.contains('hidden')) return;
  render();
}
