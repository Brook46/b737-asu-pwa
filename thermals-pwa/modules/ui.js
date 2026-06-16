// ui.js — small shared UI helpers: toast, overlay show/hide, theme.
// Mirrors the Flight Card PWA's ui.js so the idiom is familiar.

const THEME_KEY = 'thermals.theme';

export function initTheme() {
  const t = localStorage.getItem(THEME_KEY);
  if (t && t !== 'auto') document.documentElement.setAttribute('data-theme', t);
}

let toastT = null;
export function toast(msg, ms = 1800) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  if (toastT) clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.add('hidden'), ms);
}

export function showOverlay(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('hidden');
}
export function hideOverlay(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('hidden');
}

// Relative "time ago" for last-seen stamps. Keeps the roster legible without
// a dependency.
export function ago(ts) {
  if (!ts) return '';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 10) return 'now';
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return `${h}h`;
}

// ---- flight telemetry formatters ----
export function fmtSpeed(mps) { return (mps == null || Number.isNaN(mps)) ? null : `${Math.round(mps * 3.6)} km/h`; }
export function fmtAlt(m) { return (m == null || Number.isNaN(m)) ? null : `${Math.round(m)} m`; }
export function fmtAgl(m) { return (m == null || Number.isNaN(m)) ? null : `${Math.round(m)} m AGL`; }
// Average climb (↑) or sink (↓) in m/s.
export function fmtVario(mps) {
  if (mps == null || Number.isNaN(mps)) return null;
  return `${mps >= 0 ? '↑' : '↓'}${Math.abs(mps).toFixed(1)} m/s`;
}
export function compass(deg) {
  if (deg == null || Number.isNaN(deg)) return null;
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round((deg % 360) / 45) % 8];
}
export function fmtTrack(deg) {
  const c = compass(deg);
  return c == null ? null : `${Math.round(deg)}° ${c}`;
}

// Escape user-supplied text before inserting as HTML.
export function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
