// Theme + language toggles. Persist to localStorage so first paint matches.

const THEME_KEY = 'pkpwa-theme';
const LANG_KEY = 'pkpwa-lang';

export function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = saved || (prefersDark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);
  return theme;
}

export function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_KEY, theme);
}

const THEME_CYCLE = ['light', 'dark', 'flightdeck'];

export function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') || 'light';
  const idx = THEME_CYCLE.indexOf(cur);
  const next = THEME_CYCLE[(idx + 1) % THEME_CYCLE.length];
  setTheme(next);
  return next;
}

export function initLang() {
  const saved = localStorage.getItem(LANG_KEY) || 'orig';
  return saved;
}

export function setLang(lang) {
  localStorage.setItem(LANG_KEY, lang);
}

export function fmtBytes(n) {
  if (n == null) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

export function fmtDate(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleString();
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
