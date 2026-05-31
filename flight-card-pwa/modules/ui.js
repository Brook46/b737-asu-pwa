// ui.js — theme + toast + overlay show/hide helpers.

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

let toastT = null;
export function toast(msg, ms = 1600) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  if (toastT) clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.add('hidden'), ms);
}

export function showOverlay(id) {
  document.getElementById(id).classList.remove('hidden');
}
export function hideOverlay(id) {
  document.getElementById(id).classList.add('hidden');
}

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
