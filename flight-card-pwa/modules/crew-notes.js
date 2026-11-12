// crew-notes.js — the crew notes window: every note the pilot keeps about a
// crew member, in one window shaped like PA's, and a colour tag per person.
// Colours only, no words: what each colour means is the pilot's own.
//
// Opened from a crew name's "note" button on the Brief, on that person;
// the rest are listed under, searchable and filterable by colour. Notes and
// colours are kept with the person in the crew registry (storage.js), so
// they follow them onto every flight; the Brief tints the name with the
// colour. Changes go out as `fc:crew-changed` for the Brief to repaint.

import * as storage from './storage.js?v=281';
import { CREW_COLORS, crewColor } from './crew.js?v=281';
import { showOverlay, hideOverlay, raiseOverlay } from './ui.js?v=281';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let sel = '';          // canonical name shown at the top
let filter = '';       // colour id the list is narrowed to
let query = '';
let wired = false;

export function open(name = '') {
  sel = String(name || '').trim().toUpperCase();
  filter = ''; query = '';
  wire();
  showOverlay('crewnotes-overlay'); raiseOverlay('crewnotes-overlay');
  paint();
  // A new note opens ready to type.
  if (sel && !storage.getCrew(sel)?.note) setTimeout(() => $('crewnotes-text')?.focus(), 60);
}
function close() {
  hideOverlay('crewnotes-overlay');
  changed();
}
function changed() { window.dispatchEvent(new CustomEvent('fc:crew-changed')); }

function paintTop() {
  if (!sel) return '';
  const p = storage.getCrew(sel) || { name: sel, note: '', color: '', flights: 0 };
  const disp = storage.displayCrew(sel);
  const dots = CREW_COLORS.map(c => `<button type="button" class="cn-dot${p.color === c.id ? ' is-on' : ''}" data-cn-color="${c.id}" style="--sw:${c.hex}"
      aria-pressed="${p.color === c.id}" aria-label="${c.id}"></button>`).join('')
    + `<button type="button" class="cn-dot cn-dot-none${!p.color ? ' is-on' : ''}" data-cn-color="" aria-pressed="${!p.color}" aria-label="No colour"></button>`;
  return `<div class="cn-top" style="--sw:${crewColor(p.color)?.hex || 'var(--line)'}">
      <div class="cn-top-h"><b>${esc(disp)}</b>${disp !== sel ? `<small>${esc(sel)}</small>` : ''}
        <span class="cn-flights">${p.flights ? `${p.flights} flight${p.flights === 1 ? '' : 's'} together` : ''}</span></div>
      <div class="cn-dots">${dots}</div>
      <textarea id="crewnotes-text" class="cn-text" dir="auto" rows="5" placeholder="Your note about ${esc(disp)}…">${esc(p.note)}</textarea>
    </div>`;
}

// Tap a colour to list only the people with it; tap again for everyone.
function paintLegend() {
  const crew = storage.allCrew();
  const used = CREW_COLORS.filter(c => crew.some(p => p.color === c.id));
  if (!used.length) return '';
  return `<div class="cn-legend">${used.map(c => {
    const n = crew.filter(p => p.color === c.id).length;
    return `<button type="button" class="cn-filter${filter === c.id ? ' is-on' : ''}" data-cn-filter="${c.id}" style="--sw:${c.hex}" aria-pressed="${filter === c.id}"><i></i>${n}</button>`;
  }).join('')}</div>`;
}

function listRows() {
  const q = query.trim().toLowerCase();
  return storage.allCrew()
    .filter(p => p.name !== sel && (p.note || p.color))
    .filter(p => !filter || p.color === filter)
    .filter(p => !q || `${p.name} ${p.nickname} ${p.note}`.toLowerCase().includes(q))
    .sort((a, b) => storage.displayCrew(a.name).localeCompare(storage.displayCrew(b.name)));
}
function paintList() {
  const rows = listRows();
  if (!rows.length) {
    return `<p class="cn-empty">${query || filter ? 'Nobody matches.' : 'Notes and colours you give crew members are listed here.'}</p>`;
  }
  return rows.map(p => {
    const c = crewColor(p.color);
    const first = String(p.note || '').split('\n')[0];
    return `<button type="button" class="cn-row" data-cn-pick="${esc(p.name)}" style="--sw:${c ? c.hex : 'transparent'}">
        <span class="cn-row-n"><b>${esc(storage.displayCrew(p.name))}</b></span>
        <span class="cn-row-t" dir="auto">${esc(first) || '<i>no note</i>'}</span>
      </button>`;
  }).join('');
}

function paint() {
  const body = $('crewnotes-body');
  if (!body) return;
  body.innerHTML = `${paintTop()}
    <div class="cn-all-h">${sel ? 'All crew notes' : 'Crew notes'}</div>
    <div class="cn-tools">
      ${paintLegend()}
      <div class="cn-search">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>
        <input id="crewnotes-q" type="search" placeholder="Search names and notes" value="${esc(query)}" autocomplete="off" autocorrect="off" spellcheck="false">
      </div>
    </div>
    <div id="crewnotes-list" class="cn-list">${paintList()}</div>`;
  grow();
}
function grow() {
  const ta = $('crewnotes-text');
  if (!ta) return;
  ta.style.height = 'auto';
  ta.style.height = Math.max(110, ta.scrollHeight) + 'px';
}

function wire() {
  if (wired) return;
  wired = true;
  $('crewnotes-close')?.addEventListener('click', close);
  const ov = $('crewnotes-overlay');
  ov.addEventListener('click', (e) => {
    if (e.target === ov) { close(); return; }
    const col = e.target.closest('[data-cn-color]');
    if (col && sel) { storage.setCrewColor(sel, col.dataset.cnColor); paint(); changed(); return; }
    const f = e.target.closest('[data-cn-filter]');
    if (f) {
      filter = filter === f.dataset.cnFilter ? '' : f.dataset.cnFilter;
      const lg = document.querySelector('#crewnotes-body .cn-legend');
      if (lg) lg.outerHTML = paintLegend();
      $('crewnotes-list').innerHTML = paintList();
      return;
    }
    const pk = e.target.closest('[data-cn-pick]');
    if (pk) { sel = pk.dataset.cnPick; paint(); $('crewnotes-body').scrollTop = 0; }
  });
  ov.addEventListener('input', (e) => {
    if (e.target.id === 'crewnotes-text' && sel) { storage.setCrewNote(sel, e.target.value); grow(); return; }
    if (e.target.id === 'crewnotes-q') { query = e.target.value; $('crewnotes-list').innerHTML = paintList(); }
  });
}
