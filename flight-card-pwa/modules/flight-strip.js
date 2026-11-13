// flight-strip.js — every flight, past and future, in a slim strip that
// slides in from one side of the screen (Settings → Flight strip: right,
// left, bottom, top or off). A swipe in from that edge — or a tap on the
// small handle there — brings it in; it slides back out a few seconds after
// the last touch. Tap a flight to jump to it. Each flight shows its route,
// time and flight number. The search button opens a pop-up that finds a
// flight by anything — date, name, aircraft, airport, flight number.
//
// No DOM of its own until init(); app.js passes the leg list and the picker.

const SIDE_KEY = 'fc.strip.side';
export const SIDES = [['right', 'Right'], ['left', 'Left'], ['bottom', 'Bottom'], ['top', 'Top'], ['off', 'Off']];
const HIDE_MS = 4000, EDGE_PX = 18, PULL_PX = 22;

let o = null;               // { legs, allLegs, keyOf, openOther, index, pick, legTs, crewName, flightLabel, esc }
let el = null, list = null, handle = null, pop = null;
let open = false, touching = false, hideT = 0, wiredDoc = false;

const lsGet = (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
export function side() { const v = lsGet(SIDE_KEY, 'right'); return SIDES.some(s => s[0] === v) ? v : 'right'; }
export function setSide(v) { lsSet(SIDE_KEY, v); build(); }
const vertical = () => side() === 'left' || side() === 'right';

export function init(opts) {
  o = opts;
  build();
  if (!wiredDoc) { wiredDoc = true; wireDoc(); }
}
// The leg list or the picked leg changed (app.js renderLegSwitcher).
export function refresh() { if (open) paint(false); }

function build() {
  el?.remove(); handle?.remove(); closeSearch();
  el = list = handle = null; open = false;
  const s = side();
  if (s === 'off' || !o) return;
  el = document.createElement('div');
  el.className = `fstrip fs-${s}`;
  el.setAttribute('aria-label', 'Flights');
  el.innerHTML = `<div class="fs-head">
      <button type="button" class="fs-find" data-fs-find aria-label="Search flights">
        <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M13 13l4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </button>
      <button type="button" class="fs-now" data-fs-now>Now</button>
    </div>
    <div class="fs-list" role="list"></div>`;
  list = el.querySelector('.fs-list');
  handle = document.createElement('button');
  handle.type = 'button';
  handle.className = `fs-handle fs-${s}`;
  handle.setAttribute('aria-label', 'Show all flights');
  document.body.append(el, handle);
  measure();

  el.addEventListener('pointerdown', () => { touching = true; clearTimeout(hideT); });
  const up = () => { touching = false; arm(); };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  list.addEventListener('scroll', () => arm(), { passive: true });
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-fs-find]')) { openSearch(); return; }
    if (e.target.closest('[data-fs-now]')) { paint(true, nowIndex()); arm(); return; }
    const it = e.target.closest('[data-fs-i]');
    if (it) { o.pick(+it.dataset.fsI); paint(false); arm(2500); }
  });
  handle.addEventListener('click', () => (open ? hide() : show()));
}

// Clear of the bottom bar, and below the header and leg switcher.
function measure() {
  if (!el) return;
  const bar = document.querySelector('.tabbar');
  const bt = bar ? bar.getBoundingClientRect() : null;
  const v = `${bt && bt.height && bt.top > 0 ? Math.round(window.innerHeight - bt.top) : 0}px`;
  const top = Math.max(...['.app-header', '#leg-switcher'].map(q => {
    const n = document.querySelector(q); const r = n && n.offsetParent !== null ? n.getBoundingClientRect() : null;
    return r && r.height ? r.bottom : 0;
  }));
  for (const n of [el, handle]) { n.style.setProperty('--fs-bottom', v); n.style.setProperty('--fs-top', `${Math.round(top) + 6}px`); }
}
function show() {
  if (!el) return;
  measure();
  paint(true);
  el.classList.add('is-open'); handle.classList.add('is-hidden');
  open = true;
  arm();
}
function hide() {
  if (!el || pop) return;            // the search pop-up holds it in
  el.classList.remove('is-open'); handle.classList.remove('is-hidden');
  open = false;
  clearTimeout(hideT);
}
function arm(ms = HIDE_MS) {
  clearTimeout(hideT);
  hideT = setTimeout(() => { if (touching || pop) arm(); else hide(); }, ms);
}

function depTs(l) { return o.legTs(l.dep_date, l.dep_time, l.dep_year); }
function endTs(l) {
  const a = o.legTs(l.arr_date || l.dep_date, l.arr_time || l.dep_time, l.dep_year);
  const d = depTs(l);
  return Number.isFinite(a) && a >= d ? a : d + 4 * 3600e3;
}
// The first flight not yet landed.
function nowIndex() {
  const legs = o.legs(), now = Date.now();
  const i = legs.findIndex(l => { const t = endTs(l); return Number.isFinite(t) && t > now; });
  return i < 0 ? legs.length - 1 : i;
}

const DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const dayOf = (l) => { const t = depTs(l); return Number.isFinite(t) ? DAY.format(new Date(t)) : (l.dep_date || ''); };
const route = (l) => `${o.esc(String(l.dep || '').toUpperCase())}<span class="fs-arrow">→</span>${o.esc(String(l.arr || '').toUpperCase())}`;

function itemHtml(l, i, sel, past) {
  const d = l.dataCard || {};
  const sub = `${l.dep_time ? o.esc(l.dep_time) + 'Z' : ''} ${o.esc(o.flightLabel(l.flight) || '')}`.trim();
  const dateTag = vertical() ? '' : `<span class="fs-day">${o.esc(dayOf(l))}</span>`;
  return `<button type="button" role="listitem" class="fs-it${sel ? ' is-sel' : ''}${past ? ' is-past' : ''}${l.deadhead || d.deadhead ? ' is-dh' : ''}" data-fs-i="${i}">
      ${dateTag}<span class="fs-main">${route(l)}</span><span class="fs-sub">${sub}</span></button>`;
}

function paint(center, at = null) {
  if (!el || !o) return;
  const legs = o.legs() || [], idx = o.index(), now = Date.now();
  let html = '', lastDay = '', nowMark = false;
  legs.forEach((l, i) => {
    const past = endTs(l) < now;
    if (!past && !nowMark && i > 0) html += `<div class="fs-nowline" aria-hidden="true"><span>now</span></div>`;
    if (!past) nowMark = true;
    if (vertical()) {
      const day = dayOf(l);
      if (day && day !== lastDay) { html += `<div class="fs-date">${o.esc(day)}</div>`; lastDay = day; }
    }
    html += itemHtml(l, i, i === idx, past);
  });
  list.innerHTML = html || '<p class="fs-mute">No flights</p>';
  if (!center) return;
  const target = list.querySelector(`[data-fs-i="${at ?? idx}"]`);
  if (!target) return;
  if (vertical()) list.scrollTop = target.offsetTop - list.clientHeight / 2 + target.offsetHeight / 2;
  else list.scrollLeft = target.offsetLeft - list.clientWidth / 2 + target.offsetWidth / 2;
}

// ---------- Search pop-up ----------
// One box finds a flight by anything it holds: a date ("13 nov", "13.11",
// "fri"), a name, the aircraft, an airport, the flight number. Several words
// must all match. It searches every flight ever stored — the roster and the
// whole logbook — nearest in time first; empty, it lists the flights from
// now on. A flight in the roster opens in place, an older one in the logbook.
function crewOf(l) {
  const d = l.dataCard || {};
  return [l.cpt || d.cpt, l.fo || d.fo].filter(Boolean).map(n => o.crewName(n) || n);
}
function haystack(l) {
  const t = depTs(l), parts = [l.dep, l.arr, l.flight, o.flightLabel(l.flight), l.tail, dayOf(l), l.dep_date, l.dep_time, l.arr_time, ...crewOf(l)];
  if (Number.isFinite(t)) {
    const dt = new Date(t);
    parts.push(`${dt.getUTCDate()}/${dt.getUTCMonth() + 1}`, `${dt.getUTCDate()}.${dt.getUTCMonth() + 1}`,
      dt.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' }), dt.toLocaleString('en-GB', { weekday: 'long', timeZone: 'UTC' }), String(dt.getUTCFullYear()));
  }
  // Anything else short the leg and its data card hold: cabin crew, deadhead,
  // passengers, notes' first words…
  for (const src of [l, l.dataCard || {}]) for (const v of Object.values(src)) {
    if (typeof v === 'string' && v.length < 120) parts.push(o.crewName(v) || '', v);
    else if (Array.isArray(v)) for (const x of v) if (typeof x === 'string' && x.length < 120) parts.push(o.crewName(x) || '', x);
  }
  return parts.filter(Boolean).join(' ').toLowerCase();
}
function openSearch() {
  if (pop) return;
  clearTimeout(hideT);
  pop = document.createElement('div');
  pop.className = 'fs-pop';
  pop.innerHTML = `<div class="fs-pop-card" role="dialog" aria-label="Find a flight">
      <div class="fs-pop-head">
        <input type="search" class="fs-q" placeholder="Date, name, aircraft, airport, flight…" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="search">
        <button type="button" class="fs-pop-x" data-fs-close aria-label="Close">✕</button>
      </div>
      <div class="fs-res" role="list"></div>
    </div>`;
  document.body.append(pop);
  const q = pop.querySelector('.fs-q');
  // Every stored flight, once each: the roster's own first, then the logbook.
  const cur = o.legs() || [];
  const curKey = new Map(cur.map((l, i) => [o.keyOf(l), i]));
  const seen = new Set(), legs = [];
  for (const l of [...cur, ...((o.allLegs && o.allLegs()) || [])]) {
    const k = o.keyOf(l);
    if (seen.has(k)) continue;
    seen.add(k); legs.push(l);
  }
  const hay = legs.map(haystack), ts = legs.map(depTs);
  const run = () => {
    const words = q.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const now = Date.now(), selKey = cur[o.index()] ? o.keyOf(cur[o.index()]) : '';
    let hits = legs.map((l, i) => i).filter(i => words.every(w => hay[i].includes(w)));
    if (!words.length) hits = hits.filter(i => endTs(legs[i]) >= now).sort((a, b) => ts[a] - ts[b]);
    else hits.sort((a, b) => Math.abs((ts[a] || 0) - now) - Math.abs((ts[b] || 0) - now));
    const more = hits.length > 200 ? `<p class="fs-mute fs-r-none">${hits.length - 200} more — add a word to narrow it</p>` : '';
    pop.querySelector('.fs-res').innerHTML = hits.slice(0, 200).map(i => {
      const l = legs[i], crew = crewOf(l), k = o.keyOf(l);
      const where = curKey.has(k) ? `data-fs-r="${curKey.get(k)}"` : `data-fs-lb="${o.esc(k)}"`;
      return `<button type="button" role="listitem" class="fs-r${k === selKey ? ' is-sel' : ''}${endTs(l) < now ? ' is-past' : ''}" ${where}>
          <span class="fs-r-day">${o.esc(dayOf(l))}<small>${o.esc(l.dep_time ? l.dep_time + 'Z' : '')}</small></span>
          <span class="fs-r-mid"><b>${route(l)}</b><small>${o.esc([o.flightLabel(l.flight), l.tail || (l.dataCard || {}).tail].filter(Boolean).join(' · '))}</small></span>
          <span class="fs-r-crew">${crew.map(o.esc).join('<br>')}</span>
        </button>`;
    }).join('') + more || `<p class="fs-mute fs-r-none">No flight matches</p>`;
  };
  q.addEventListener('input', run);
  pop.addEventListener('click', (e) => {
    if (e.target === pop || e.target.closest('[data-fs-close]')) { closeSearch(); arm(); return; }
    const r = e.target.closest('[data-fs-r]');
    if (r) { const i = +r.dataset.fsR; closeSearch(); o.pick(i); paint(true, i); arm(2500); return; }
    const lb = e.target.closest('[data-fs-lb]');
    if (lb) { closeSearch(); hide(); o.openOther(lb.dataset.fsLb); }
  });
  run();
  setTimeout(() => q.focus(), 50);
}
function closeSearch() { pop?.remove(); pop = null; }

// A swipe in from the chosen edge (or starting on the handle) brings it in;
// a tap anywhere else puts it away. Wired once.
function wireDoc() {
  let start = null;
  window.addEventListener('resize', measure);
  document.addEventListener('pointerdown', (e) => {
    if (open && el && !pop && !el.contains(e.target) && e.target !== handle) hide();
  }, true);
  document.addEventListener('touchstart', (e) => {
    if (!el || open || e.touches.length !== 1) return;
    const t = e.touches[0], s = side(), W = window.innerWidth;
    const atEdge = s === 'right' ? t.clientX > W - EDGE_PX : s === 'left' ? t.clientX < EDGE_PX : false;
    start = e.target === handle || atEdge ? { x: t.clientX, y: t.clientY, s } : null;
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (!start || open) return;
    const t = e.touches[0];
    const dx = t.clientX - start.x, dy = t.clientY - start.y;
    const pulled = start.s === 'right' ? -dx : start.s === 'left' ? dx : start.s === 'bottom' ? -dy : dy;
    if (pulled > PULL_PX) { start = null; show(); }
  }, { passive: true });
  document.addEventListener('touchend', () => { start = null; }, { passive: true });
}
