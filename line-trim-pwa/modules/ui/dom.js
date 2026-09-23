// ui/dom.js — tiny DOM helpers.

export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

/** Escape text for safe interpolation into HTML templates. */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

let toastTimer = null;
export function toast(msg, ms = 2400) {
  $('.toast')?.remove();
  const t = el(`<div class="toast" role="status">${esc(msg)}</div>`);
  document.body.appendChild(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), ms);
}

export function fmtMm(mm) {
  if (mm == null || !isFinite(mm)) return '–';
  return String(Math.round(mm));   // "7371" — no grouping: reads fastest as a monospace figure
}
export function signed(mm, unit = ' mm') {
  if (mm == null || !isFinite(mm)) return '–';
  const v = Math.round(mm * 10) / 10;
  return (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v) + unit;
}

/** CSS class for an EN rating badge. */
export function classBadge(wingClass) {
  const c = String(wingClass || '').toUpperCase();
  const k = /TANDEM/.test(c) ? 'T' : /EN\s*([ABCD])/.exec(c)?.[1] || (/CCC/.test(c) ? 'D' : 'X');
  return `<span class="badge cls-${k}">${esc(wingClass || '—')}</span>`;
}

/** Row colour var for a riser letter. */
export const rowColor = riser => `var(--row-${/^[ABCDE]$/.test(riser) ? riser : 'K'})`;
