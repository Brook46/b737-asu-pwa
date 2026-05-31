// ui.js — theme (3-state SVG), toast, overlay helpers.

const THEME_KEY = 'fc.theme';
const ORDER = ['auto', 'light', 'dark'];

const ICONS = {
  auto: `<circle cx="12" cy="12" r="8"/><path d="M12 4 A8 8 0 0 1 12 20 Z" class="fill"/>`,
  light: `<circle cx="12" cy="12" r="4" class="fill"/>
    <line x1="12" y1="2.3" x2="12" y2="5.3"/>
    <line x1="12" y1="18.7" x2="12" y2="21.7"/>
    <line x1="2.3" y1="12" x2="5.3" y2="12"/>
    <line x1="18.7" y1="12" x2="21.7" y2="12"/>
    <line x1="4.9"  y1="4.9"  x2="7"    y2="7"/>
    <line x1="17"   y1="17"   x2="19.1" y2="19.1"/>
    <line x1="4.9"  y1="19.1" x2="7"    y2="17"/>
    <line x1="17"   y1="7"    x2="19.1" y2="4.9"/>`,
  dark: `<path d="M20.2 14.3 A7.5 7.5 0 1 1 9.7 3.8 A6 6 0 0 0 20.2 14.3 Z" class="fill"/>`,
};

function getTheme() { return localStorage.getItem(THEME_KEY) || 'auto'; }

export function initTheme() {
  applyTheme(getTheme());
  paintThemeIcon();
}

export function cycleTheme() {
  const cur = getTheme();
  const next = ORDER[(ORDER.indexOf(cur) + 1) % ORDER.length];
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
  paintThemeIcon();
  toast(`Theme: ${next}`);
}

function applyTheme(t) {
  const root = document.documentElement;
  if (t === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', t);
}

function paintThemeIcon() {
  const svg = document.getElementById('theme-icon');
  if (!svg) return;
  svg.innerHTML = ICONS[getTheme()];
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

export function showOverlay(id) { document.getElementById(id).classList.remove('hidden'); }
export function hideOverlay(id) { document.getElementById(id).classList.add('hidden'); }

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
