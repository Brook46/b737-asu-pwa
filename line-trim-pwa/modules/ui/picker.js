// ui/picker.js — screen 1: which wing, which size.

import { $, $$, el, esc, clear, classBadge } from './dom.js?v=10';
import { icon } from './icons.js?v=10';
import { listWings, CLASSES } from '../library.js?v=10';
import { prefs, draft } from '../store.js?v=10';
import { progress } from '../session.js?v=10';

const FILTERS = [
  { id: 'all', label: 'All' },
  ...CLASSES.filter(c => c !== 'CCC').map(c => ({ id: c, label: c })),
  { id: 'yours', label: 'Yours' },
];

export async function renderPicker(root, ctx) {
  clear(root);
  const p = prefs.get();
  const wrap = el(`
    <div>
      <h1>Which wing?</h1>
      <p class="lede">Real manufacturer check lengths — pick your wing and size.</p>
      <div id="resume"></div>
      <div class="search"><span>${icon.search}</span>
        <input class="input" id="q" type="search" placeholder="Search brand or model" autocomplete="off" aria-label="Search wings">
      </div>
      <div class="chips" id="filters" role="toolbar" aria-label="Filter by class" style="margin-top:10px"></div>
      <div class="wing-list" id="list" style="margin-top:6px"><p class="empty">Loading wings…</p></div>
      <button class="btn block soft" id="own" style="margin-top:14px">${icon.upload} Add a wing from your own sheet</button>
    </div>`);
  root.appendChild(wrap);
  $('#own', wrap).addEventListener('click', () => ctx.goto('import'));

  // resume: an unfinished check beats everything
  const d = draft.get();
  const resume = $('#resume', wrap);
  if (d && d.v === 3 && Object.keys(d.measured || {}).length) {
    const pr = progress(d);
    const b = el(`<button class="resume">
      <div><b>Continue your check</b><span>${esc(d.brand)} ${esc(d.model)} ${esc(d.sizeKey)} · ${pr.done} of ${pr.total} readings</span></div>
      ${icon.chevron}</button>`);
    b.addEventListener('click', () => { ctx.session = d; ctx.goto('measure'); });
    resume.appendChild(b);
  }

  let wings = [];
  try { wings = await listWings(); }
  catch (e) {
    $('#list', wrap).innerHTML = `<p class="empty">Couldn't load the wing library (${esc(e.message)}). Your own wings still work.</p>`;
  }

  if (!d && p.lastWing) {
    const w = wings.find(x => x.id === p.lastWing.id);
    const sz = w?.sizes.find(s => s.key === p.lastWing.size);
    if (w && sz?.ready) {
      const b = el(`<button class="resume">
        <div><b>${esc(w.brand)} ${esc(w.model)} · ${esc(sz.key)}</b><span>Your last wing — start a new check</span></div>
        ${icon.chevron}</button>`);
      b.addEventListener('click', () => ctx.chooseWing(w.id, sz.key));
      resume.appendChild(b);
    }
  }

  let filter = 'all';
  const filters = $('#filters', wrap);
  for (const f of FILTERS) {
    const n = f.id === 'all' ? wings.length : f.id === 'yours' ? wings.filter(w => w.custom).length
            : wings.filter(w => w.wingClass === f.id).length;
    if (!n && f.id !== 'all') continue;
    const c = el(`<button class="chip" aria-pressed="${f.id === filter}" data-f="${esc(f.id)}">${esc(f.label)} <span class="muted">${n}</span></button>`);
    c.addEventListener('click', () => {
      filter = f.id;
      $$('.chip', filters).forEach(x => x.setAttribute('aria-pressed', String(x.dataset.f === filter)));
      draw();
    });
    filters.appendChild(c);
  }

  const q = $('#q', wrap);
  q.addEventListener('input', draw);

  let open = p.lastWing?.id || null;
  function draw() {
    const list = $('#list', wrap);
    clear(list);
    const term = q.value.trim().toLowerCase();
    const shown = wings.filter(w =>
      (filter === 'all' || (filter === 'yours' ? w.custom : w.wingClass === filter))
      && (!term || `${w.brand} ${w.model} ${w.wingClass} ${w.category || ''}`.toLowerCase().includes(term)));
    if (!shown.length) {
      list.appendChild(el(`<p class="empty">No wing matches. Add yours from its manufacturer sheet ↓</p>`));
      return;
    }
    for (const w of shown) list.appendChild(card(w));
  }

  function card(w) {
    const ready = w.sizes.filter(s => s.ready).length;
    const meta = [w.year, w.liners ? `${w.liners}-liner` : null, w.category].filter(Boolean).map(esc).join(' · ');
    const c = el(`<div class="wing" data-open="${w.id === open}">
      <div class="wing-head" role="button" tabindex="0" aria-expanded="${w.id === open}">
        ${classBadge(w.wingClass)}
        <div class="grow">
          <div class="name">${esc(w.brand)} ${esc(w.model)}</div>
          <div class="meta">${meta || '&nbsp;'}</div>
        </div>
        <span class="chev">${icon.chevron}</span>
      </div>
      <div class="sizes" ${w.id === open ? '' : 'hidden'}></div>
      <div class="wing-note" ${w.id === open && ready < w.sizes.length ? '' : 'hidden'}>
        Dashed sizes need your own line-check sheet — tap one to add it.</div>
    </div>`);
    const sizes = $('.sizes', c);
    for (const s of w.sizes) {
      const b = el(`<button class="size ${s.ready ? '' : 'needs'}" aria-label="Size ${esc(s.key)}${s.ready ? '' : ', needs your sheet'}">${esc(s.key)}</button>`);
      b.addEventListener('click', () => ctx.chooseWing(w.id, s.key));
      sizes.appendChild(b);
    }
    const head = $('.wing-head', c);
    const toggle = () => { open = open === w.id ? null : w.id; draw(); };
    head.addEventListener('click', toggle);
    head.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    return c;
  }

  draw();
}
