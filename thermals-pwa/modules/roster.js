// roster.js — the crew panel: list of today's pilots with show/hide filters,
// and the per-pilot detail card (all shared fields + WhatsApp).
//
// app.js feeds pilot upserts/removals here and into map.js; roster owns the
// canonical client-side pilot map and the visibility filter set.

import { glyphSVG } from './icons.js';
import { STATES } from '../config.js';
import { ago, esc } from './ui.js';
import { waNumber } from './profile.js';

const pilots = new Map();          // id -> pilot
const hidden = new Set();          // ids the user has toggled off
let onVisibilityChange = () => {};
let onFocus = () => {};            // (lng,lat) => recenter map

export function init({ onVisibility, onFocusPilot }) {
  onVisibilityChange = onVisibility || onVisibilityChange;
  onFocus = onFocusPilot || onFocus;
  document.getElementById('roster-showall')?.addEventListener('click', showAll);
}

export function upsert(p) { pilots.set(p.id, { ...pilots.get(p.id), ...p }); render(); }
export function remove(id) { pilots.delete(id); hidden.delete(id); render(); }
export function setAll(list) { pilots.clear(); list.forEach((p) => pilots.set(p.id, p)); render(); }
export function get(id) { return pilots.get(id); }
export function isHidden(id) { return hidden.has(id); }

function showAll() {
  const wasHidden = [...hidden];
  hidden.clear();
  wasHidden.forEach((id) => onVisibilityChange(id, true));
  render();
}

function toggle(id) {
  const nowHidden = !hidden.has(id);
  if (nowHidden) hidden.add(id); else hidden.delete(id);
  onVisibilityChange(id, !nowHidden);
  render();
}

export function render() {
  const host = document.getElementById('roster-list');
  if (!host) return;
  const list = [...pilots.values()].sort((a, b) => (a.nickname || '').localeCompare(b.nickname || ''));
  const count = document.getElementById('roster-count');
  if (count) count.textContent = String(list.length);

  if (!list.length) {
    host.innerHTML = `<p class="roster-empty">No one else sharing yet today. You're first up. 🪂</p>`;
    return;
  }

  // SOS pilots sort to the top.
  list.sort((a, b) => (b.sos ? 1 : 0) - (a.sos ? 1 : 0));

  host.innerHTML = list.map((p) => {
    const off = hidden.has(p.id) ? ' is-off' : '';
    const sos = p.sos ? ' is-sos' : '';
    const st = STATES[p.state] || STATES.WALKING;
    const seatTxt = (p.state === 'RETRIEVE' && p.seats > 0) ? ` · ${p.seats} seat${p.seats === 1 ? '' : 's'} free` : '';
    const distTxt = (p.distKm != null) ? ` · ${p.distKm < 10 ? p.distKm.toFixed(1) : Math.round(p.distKm)} km` : '';
    const sub = p.sos ? '🚨 SOS — needs help' : `${esc(st.label)}${seatTxt}${distTxt} · ${ago(p.ts)}`;
    return `<div class="roster-row${off}${sos}" data-id="${esc(p.id)}">
      <button class="roster-eye" data-act="toggle" title="Show / hide on map" aria-pressed="${!off}">
        ${eyeSVG(!hidden.has(p.id))}
      </button>
      <button class="roster-main" data-act="card">
        <span class="roster-glyph" style="--pilot-color:${esc(p.color || '#888')}">
          ${glyphSVG(p.state, '#fff', 20)}
        </span>
        <span class="roster-text">
          <span class="roster-nick">${esc(p.nickname || 'Pilot')}</span>
          <span class="roster-sub">${sub}</span>
        </span>
      </button>
    </div>`;
  }).join('');

  host.querySelectorAll('.roster-row').forEach((row) => {
    const id = row.dataset.id;
    row.querySelector('[data-act="toggle"]')?.addEventListener('click', () => toggle(id));
    row.querySelector('[data-act="card"]')?.addEventListener('click', () => openCard(id));
  });
}

function eyeSVG(on) {
  return on
    ? `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>`
    : `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M2 12s3.5-7 10-7a11 11 0 0 1 5 1.3"/><path d="M22 12s-3.5 7-10 7a11 11 0 0 1-5-1.3"/><line x1="3" y1="3" x2="21" y2="21"/></svg>`;
}

// Detail card: every shared field + a WhatsApp button + focus-on-map.
export function openCard(id) {
  const p = pilots.get(id);
  if (!p) return;
  const host = document.getElementById('pilot-card');
  if (!host) return;
  const st = STATES[p.state] || STATES.WALKING;
  const wa = waNumber(p.phone);
  const links = (p.links || '').split('\n').map((s) => s.trim()).filter(Boolean);

  host.innerHTML = `
    <div class="card-head${p.sos ? ' is-sos' : ''}" style="--pilot-color:${esc(p.color || '#888')}">
      <span class="card-glyph">${glyphSVG(p.state, '#fff', 30)}</span>
      <div>
        <h2>${esc(p.nickname || 'Pilot')}</h2>
        <p class="card-state">${p.sos ? '🚨 SOS — needs help' : `${esc(st.label)} · seen ${ago(p.ts)} ago`}</p>
      </div>
      <button class="card-close" data-act="close" aria-label="Close">✕</button>
    </div>
    <dl class="card-fields">
      ${p.state === 'RETRIEVE' && p.seats > 0 ? field('Free seats', `${p.seats} in the car`) : ''}
      ${field('Blood type', p.bloodType)}
      ${field('Vehicle', p.vehicle)}
      ${field('Emergency contact', p.emergency)}
      ${field('Phone', p.phone)}
      ${links.length ? `<dt>Links</dt><dd>${links.map((l) => `<a href="${esc(l)}" target="_blank" rel="noopener">${esc(l)}</a>`).join('<br>')}</dd>` : ''}
    </dl>
    <div class="card-actions">
      ${wa ? `<a class="btn btn-wa" href="https://wa.me/${wa}?text=${encodeURIComponent('Hey ' + (p.nickname || '') + ' — ')}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
      ${p.lng != null ? `<button class="btn" data-act="focus">Show on map</button>` : ''}
    </div>`;

  host.classList.remove('hidden');
  host.querySelector('[data-act="close"]')?.addEventListener('click', () => host.classList.add('hidden'));
  host.querySelector('[data-act="focus"]')?.addEventListener('click', () => {
    host.classList.add('hidden');
    onFocus(p.lng, p.lat);
  });
}

function field(label, val) {
  if (!val) return '';
  return `<dt>${esc(label)}</dt><dd>${esc(val)}</dd>`;
}
