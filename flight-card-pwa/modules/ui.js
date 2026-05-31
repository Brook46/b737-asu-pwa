// ui.js — overlay + pad + toast + theme helpers.

// ---------- Theme ----------
const THEME_KEY = 'fc.theme';

export function initTheme() {
  const t = localStorage.getItem(THEME_KEY) || 'auto';
  applyTheme(t);
}

export function cycleTheme() {
  const order = ['auto', 'light', 'dark'];
  const cur = localStorage.getItem(THEME_KEY) || 'auto';
  const next = order[(order.indexOf(cur) + 1) % order.length];
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
  toast(`Theme: ${next}`);
}

function applyTheme(t) {
  const root = document.documentElement;
  if (t === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', t);
}

// ---------- Toast ----------
let toastT = null;
export function toast(msg, ms = 1600) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  if (toastT) clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.add('hidden'), ms);
}

// ---------- Pad overlay (numeric / text) ----------
// Single overlay reused for every cell. We do not call .focus() on the input
// so iOS does not raise the system keyboard — the pad is the keyboard.

let padState = null;

export function openPad({ label, kind, value, onSave }) {
  const ov = document.getElementById('pad-overlay');
  document.getElementById('pad-label').textContent = label || '';
  const valInput = document.getElementById('pad-value');
  valInput.value = value ?? '';
  valInput.readOnly = (kind !== 'text');  // text fields: allow iOS keyboard for letters
  if (kind === 'text') valInput.inputMode = 'text';
  else valInput.inputMode = 'none';

  padState = { kind, onSave };
  renderPadGrid(kind);
  ov.classList.remove('hidden');
}

function closePad() {
  const ov = document.getElementById('pad-overlay');
  ov.classList.add('hidden');
  padState = null;
}

function renderPadGrid(kind) {
  const grid = document.getElementById('pad-grid');
  if (kind === 'text') {
    // Text mode: hide the numeric grid — user uses iOS keyboard on the value input.
    grid.innerHTML = '';
    grid.style.display = 'none';
    return;
  }
  grid.style.display = '';
  const keys = ['1','2','3','4','5','6','7','8','9'];
  const decimal = kind === 'dec';
  const trailing = decimal
    ? [{ k: '.', cls: '' }, { k: '0', cls: '' }, { k: '⌫', cls: '' }]
    : [{ k: '-', cls: '' }, { k: '0', cls: '' }, { k: '⌫', cls: '' }];
  const html = keys.map(k => `<button data-k="${k}">${k}</button>`).join('')
    + trailing.map(t => `<button data-k="${t.k}" class="${t.cls}">${t.k}</button>`).join('');
  grid.innerHTML = html;
  grid.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => padTap(b.dataset.k));
  });
}

function padTap(k) {
  const v = document.getElementById('pad-value');
  if (k === '⌫') v.value = v.value.slice(0, -1);
  else if (k === '.') { if (!v.value.includes('.')) v.value = (v.value || '0') + '.'; }
  else if (k === '-') {
    if (v.value.startsWith('-')) v.value = v.value.slice(1);
    else v.value = '-' + v.value;
  }
  else v.value = (v.value || '') + k;
}

export function wirePadControls() {
  document.getElementById('pad-close').addEventListener('click', closePad);
  document.getElementById('pad-cancel').addEventListener('click', closePad);
  document.getElementById('pad-clear').addEventListener('click', () => {
    document.getElementById('pad-value').value = '';
  });
  document.getElementById('pad-save').addEventListener('click', () => {
    const v = document.getElementById('pad-value').value;
    const cb = padState && padState.onSave;
    closePad();
    if (cb) cb(v);
  });
  // tap on backdrop closes
  document.getElementById('pad-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'pad-overlay') closePad();
  });
}

// ---------- Generic overlay show/hide ----------
export function showOverlay(id) {
  document.getElementById(id).classList.remove('hidden');
}
export function hideOverlay(id) {
  document.getElementById(id).classList.add('hidden');
}

// ---------- Format helpers ----------
export function fmtDate(ts) {
  const d = new Date(ts);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}/${mm}/${yy}`;
}
export function fmtTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
