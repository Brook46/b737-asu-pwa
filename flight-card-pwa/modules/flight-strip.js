// flight-strip.js — every flight, past and future, in a slim strip that
// slides in from one side of the screen (Settings → Flight strip: right,
// left, bottom, top or off). A swipe in from that edge — or a tap on the
// small handle there — brings it in; it slides back out a few seconds after
// the last touch. Tap a flight to jump to it. One small button switches what
// each flight shows: route, times, crew or aircraft.
//
// No DOM of its own until init(); app.js passes the leg list and the picker.

const SIDE_KEY = 'fc.strip.side', MODE_KEY = 'fc.strip.mode';
export const SIDES = [['right', 'Right'], ['left', 'Left'], ['bottom', 'Bottom'], ['top', 'Top'], ['off', 'Off']];
const MODES = [['route', 'Route'], ['times', 'Times'], ['crew', 'Crew'], ['tail', 'Aircraft']];
const HIDE_MS = 4000, EDGE_PX = 18, PULL_PX = 22;

let o = null;               // { legs, index, pick, legTs, crewName, flightLabel, esc }
let el = null, list = null, handle = null;
let open = false, touching = false, hideT = 0;

const lsGet = (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
export function side() { const v = lsGet(SIDE_KEY, 'right'); return SIDES.some(s => s[0] === v) ? v : 'right'; }
export function setSide(v) { lsSet(SIDE_KEY, v); build(); }
function mode() { const v = lsGet(MODE_KEY, 'route'); return MODES.some(m => m[0] === v) ? v : 'route'; }
const vertical = () => side() === 'left' || side() === 'right';

export function init(opts) {
  o = opts;
  build();
  wireEdge();
}
// The leg list or the picked leg changed (app.js renderLegSwitcher).
export function refresh() { if (open) paint(false); }

function build() {
  el?.remove(); handle?.remove();
  el = list = handle = null; open = false;
  const s = side();
  if (s === 'off' || !o) return;
  el = document.createElement('div');
  el.className = `fstrip fs-${s}`;
  el.setAttribute('aria-label', 'Flights');
  el.innerHTML = `<div class="fs-head">
      <button type="button" class="fs-mode" data-fs-mode></button>
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
  window.addEventListener('resize', measure);

  el.addEventListener('pointerdown', () => { touching = true; clearTimeout(hideT); });
  const up = () => { touching = false; arm(); };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  list.addEventListener('scroll', () => arm(), { passive: true });
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-fs-mode]')) {
      const i = MODES.findIndex(m => m[0] === mode());
      lsSet(MODE_KEY, MODES[(i + 1) % MODES.length][0]);
      paint(false); arm(); return;
    }
    if (e.target.closest('[data-fs-now]')) { paint(true, nowIndex()); arm(); return; }
    const it = e.target.closest('[data-fs-i]');
    if (it) { o.pick(+it.dataset.fsI); paint(false); arm(2500); }
  });
  handle.addEventListener('click', () => (open ? hide() : show()));
  // A tap anywhere else puts it away.
  document.addEventListener('pointerdown', (e) => {
    if (open && el && !el.contains(e.target) && e.target !== handle) hide();
  }, true);
}

// Clear of the bottom bar.
function measure() {
  if (!el) return;
  const bar = document.querySelector('.tabbar');
  const bt = bar ? bar.getBoundingClientRect() : null;
  const v = `${bt && bt.height && bt.top > 0 ? Math.round(window.innerHeight - bt.top) : 0}px`;
  el.style.setProperty('--fs-bottom', v); handle.style.setProperty('--fs-bottom', v);
  // Below the header and leg switcher, so their buttons stay free.
  const top = Math.max(...['.app-header', '#leg-switcher'].map(q => { const n = document.querySelector(q); const r = n && n.offsetParent !== null ? n.getBoundingClientRect() : null; return r && r.height ? r.bottom : 0; }));
  el.style.setProperty('--fs-top', `${Math.round(top) + 6}px`); handle.style.setProperty('--fs-top', `${Math.round(top) + 6}px`);
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
  if (!el) return;
  el.classList.remove('is-open'); handle.classList.remove('is-hidden');
  open = false;
  clearTimeout(hideT);
}
function arm(ms = HIDE_MS) {
  clearTimeout(hideT);
  hideT = setTimeout(() => { if (touching) arm(); else hide(); }, ms);
}

// The first flight not yet landed.
function nowIndex() {
  const legs = o.legs(), now = Date.now();
  const i = legs.findIndex(l => { const t = endTs(l); return Number.isFinite(t) && t > now; });
  return i < 0 ? legs.length - 1 : i;
}
function endTs(l) {
  const a = o.legTs(l.arr_date || l.dep_date, l.arr_time || l.dep_time, l.dep_year);
  const d = o.legTs(l.dep_date, l.dep_time, l.dep_year);
  return Number.isFinite(a) && a >= d ? a : d + 4 * 3600e3;
}

const DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
function itemHtml(l, i, sel, past) {
  const e = o.esc, d = l.dataCard || {};
  const dep = String(l.dep || '').toUpperCase(), arr = String(l.arr || '').toUpperCase();
  const t0 = o.legTs(l.dep_date, l.dep_time, l.dep_year);
  const day = Number.isFinite(t0) ? DAY.format(new Date(t0)) : (l.dep_date || '');
  const m = mode();
  let main, sub;
  if (m === 'times') {
    main = `${e(l.dep_time || '—')}–${e(l.arr_time || '—')}<small>Z</small>`;
    sub = `${e(dep)}→${e(arr)}${d.actual_block_time || d.block_time || l.flight_time ? ' · ' + e(d.actual_block_time || d.block_time || l.flight_time) : ''}`;
  } else if (m === 'crew') {
    const crew = [l.cpt || d.cpt, l.fo || d.fo].filter(Boolean).map(n => o.crewName(n) || n);
    main = crew.length ? crew.map(e).join('<br>') : '<span class="fs-mute">no crew yet</span>';
    sub = `${e(dep)}→${e(arr)}`;
  } else if (m === 'tail') {
    main = e(l.tail || d.tail || '—');
    sub = `${e(dep)}→${e(arr)} · ${e(o.flightLabel(l.flight) || '')}`;
  } else {
    main = `${e(dep)}<span class="fs-arrow">→</span>${e(arr)}`;
    sub = `${e(l.dep_time ? l.dep_time + 'Z' : '')} ${e(o.flightLabel(l.flight) || '')}`.trim();
  }
  const dateTag = vertical() ? '' : `<span class="fs-day">${e(day)}</span>`;
  return `<button type="button" role="listitem" class="fs-it${sel ? ' is-sel' : ''}${past ? ' is-past' : ''}${l.deadhead || d.deadhead ? ' is-dh' : ''}" data-fs-i="${i}">
      ${dateTag}<span class="fs-main">${main}</span><span class="fs-sub">${sub}</span></button>`;
}

function paint(center, at = null) {
  if (!el || !o) return;
  const legs = o.legs() || [], idx = o.index(), now = Date.now();
  el.querySelector('[data-fs-mode]').textContent = `${MODES.find(m => m[0] === mode())[1]} ▾`;
  let html = '', lastDay = '', nowMark = false;
  legs.forEach((l, i) => {
    const t0 = o.legTs(l.dep_date, l.dep_time, l.dep_year);
    const past = endTs(l) < now;
    if (!past && !nowMark && i > 0) { html += `<div class="fs-nowline" aria-hidden="true"><span>now</span></div>`; nowMark = true; }
    if (!past) nowMark = true;
    if (vertical()) {
      const day = Number.isFinite(t0) ? DAY.format(new Date(t0)) : '';
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

// A swipe in from the chosen edge (or starting on the handle) brings it in.
function wireEdge() {
  let start = null;
  document.addEventListener('touchstart', (e) => {
    if (!el || open || e.touches.length !== 1) return;
    const t = e.touches[0], s = side(), W = window.innerWidth, H = window.innerHeight;
    const onHandle = e.target === handle;
    const atEdge = s === 'right' ? t.clientX > W - EDGE_PX : s === 'left' ? t.clientX < EDGE_PX : false;
    start = onHandle || atEdge ? { x: t.clientX, y: t.clientY, s } : null;
    void H;
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
