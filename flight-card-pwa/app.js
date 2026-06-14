// app.js — bootstrap: theme, header (clocks + tail/flt), sections, overlays, SW.

import * as storage from './modules/storage.js';
import * as dataCard from './modules/data-card.js';
import * as checklist from './modules/checklist.js';
import * as speeches from './modules/speeches.js';
import { lookupRoute, normaliseFlightNumber, displayFlight } from './modules/ly-routes.js';
import { initTheme, cycleTheme, toast, showOverlay, hideOverlay } from './modules/ui.js';

const $ = (id) => document.getElementById(id);

// ---------- Init theme + register SW ----------
initTheme();
window.fcToast = toast;  // expose for modules that don't import ui

// The header sync + speeches notify is wired below alongside the wx clear-on-dep-change.

// Auto-collapse the entire checklist card when everything is done.
let checklistAutoCollapsed = false;
checklist.setOnAllDoneChange((allDone) => {
  const card = document.getElementById('card-checklist');
  if (!card) return;
  if (allDone && !checklistAutoCollapsed) {
    card.classList.add('collapsed');
    checklistAutoCollapsed = true;
    syncCardChev('checklist');
  } else if (!allDone && checklistAutoCollapsed) {
    card.classList.remove('collapsed');
    checklistAutoCollapsed = false;
    syncCardChev('checklist');
  }
});

// Paint the small notes summary that appears under the checklist card
// head whenever the card is collapsed. Reads notes + template once and
// stitches them into a "Item: text · Item: text" line. Empty string
// when there are no notes — CSS hides the element on :empty.
function paintChecklistCardSummary() {
  const el = document.getElementById('checklist-card-notes');
  if (!el) return;
  try {
    const cur = storage.getCurrent();
    const notes = cur?.notes || {};
    const noteIds = Object.keys(notes).filter(id => notes[id] && String(notes[id]).trim());
    if (!noteIds.length) { el.textContent = ''; return; }
    const template = storage.getTemplate();
    const labelById = new Map();
    for (const sec of template.sections) {
      for (const item of sec.items) labelById.set(item.id, item.label);
    }
    el.textContent = noteIds
      .map(id => `${labelById.get(id) || '·'}: ${notes[id]}`)
      .join(' · ');
  } catch (err) {
    console.warn('checklist notes summary skipped', err);
  }
}
checklist.setOnAfterRender(paintChecklistCardSummary);
function syncCardChev(target) {
  const btn = document.querySelector(`.card-toggle[data-target="${target}"]`);
  if (!btn) return;
  const open = !document.querySelector(`.card[data-section="${target}"]`).classList.contains('collapsed');
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  btn.querySelector('.chev').textContent = open ? '▾' : '▸';
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err => console.warn('SW register failed', err));
  });
}

// ---------- Render shell ----------
const dataBody = $('data-body');
const checklistBody = $('checklist-body');
const historyBody = $('history-body');

renderAll();
startClocks();
syncHeaderInputs();
consumeRosterFromUrl();

// If the user just shared roster text via the iOS Share Sheet → share-roster.html,
// it bounces back to ./?roster=<encoded>. Parse and apply, then strip the URL.
async function consumeRosterFromUrl() {
  const q = new URLSearchParams(location.search);
  const raw = q.get('roster');
  if (!raw) return;
  try {
    const { parseRoster } = await import('./modules/roster.js');
    const parsed = parseRoster(raw);
    if (parsed) {
      await applyRoster(parsed);
    } else {
      toast('Shared text did not look like a roster');
    }
  } catch (err) {
    console.warn('roster ingest failed', err);
    toast('Roster import failed');
  } finally {
    // Clean the URL so reloads don't keep re-applying
    const url = new URL(location.href);
    url.search = '';
    history.replaceState({}, '', url.toString());
  }
}


function renderAll() {
  dataCard.render(dataBody);
  checklist.render(checklistBody);
  renderHistory();
  renderLegSwitcher();
}

// ---------- Leg switcher ----------
function renderLegSwitcher() {
  const sw = $('leg-switcher');
  const legs = storage.getLegs();
  if (!sw) return;
  if (!legs.length || legs.length < 2) {
    sw.classList.add('hidden');
    return;
  }
  sw.classList.remove('hidden');
  const idx = storage.getLegIndex();
  const leg = legs[idx];
  $('leg-pos').textContent = `Leg ${idx + 1} / ${legs.length}`;
  const flight = leg.flight ? displayFlight(leg.flight) : '';
  const route  = (leg.dep && leg.arr) ? `${leg.dep} → ${leg.arr}` : '';
  $('leg-route').textContent = [flight, route].filter(Boolean).join('  ');
  $('leg-prev').disabled = idx <= 0;
  $('leg-next').disabled = idx >= legs.length - 1;
}
async function applyLeg(idx) {
  const legs = storage.getLegs();
  if (!legs.length) return;
  const clamped = Math.max(0, Math.min(legs.length - 1, idx));
  storage.setLegIndex(clamped);
  // Per-leg state: switching legs swaps the dataCard / ticks / notes bag.
  // The leg's identity fields (flight/tail/dep/arr/...) are seeded into its
  // own dataCard by storage on first access, so a full re-render is the
  // right call — anything the user has typed on this leg comes right back.
  dataCard.render(dataBody);
  checklist.render(checklistBody);
  syncHeaderInputs();
  renderLegSwitcher();
  // Past-leg cue: refresh on leg switch so the dim + PAST pill flip
  // immediately. Wrapped defensively so a bug here can never stop the
  // rest of applyLeg from finishing.
  try { updatePastLegUI(); } catch (err) { console.warn('past-leg cue skipped', err); }
  speeches.notifyDataChange();
}
async function applyRoster(parsed) {
  if (!parsed || !parsed.flights?.length) return;
  // Append to the persistent leg list; storage sorts the combined list by UTC
  // dep time and returns the new index of the most-recently-touched leg so
  // the data card switches to the newly-added (or just-updated) flight.
  // appendLegs dedupes by flight number — a paste that overlaps an existing
  // leg merges into it instead of duplicating.
  const { index: newIdx, added, replaced } = storage.appendLegs(parsed.flights);
  await applyLeg(newIdx);
  renderHistory();
  toast(rosterToast(added, replaced));
}
function rosterToast(added, replaced) {
  if (added && replaced) return `Added ${added}, updated ${replaced}`;
  if (replaced)          return `Updated ${replaced} flight${replaced === 1 ? '' : 's'}`;
  return `Added ${added} flight${added === 1 ? '' : 's'}`;
}
$('leg-prev').addEventListener('click', () => applyLeg(storage.getLegIndex() - 1));
$('leg-next').addEventListener('click', () => applyLeg(storage.getLegIndex() + 1));
$('leg-now').addEventListener('click',  () => applyLeg(pickLegForNow()));

// Pick the leg whose UTC dep→arr window contains the current wall clock, or
// the next upcoming one if we're between legs. Falls back to leg 0 when the
// roster has no timing data.
function pickLegForNow() {
  const legs = storage.getLegs();
  if (!legs.length) return 0;
  const now = Date.now();
  // Resolve a leg's dep/arr as ms-since-epoch by combining dep_date (dd.mm)
  // with dep_time (HH:MM UTC). Year is heuristically "current year unless the
  // resulting timestamp is more than 6 months in the past, in which case roll
  // forward a year" — handles year-end roster bulletins gracefully.
  function toTs(d, t) {
    if (!d || !t) return NaN;
    const dm = d.split('.');
    if (dm.length !== 2) return NaN;
    const yearNow = new Date().getUTCFullYear();
    const iso = `${yearNow}-${dm[1]}-${dm[0]}T${t}:00Z`;
    let ts = Date.parse(iso);
    if (!Number.isFinite(ts)) return NaN;
    // Roll forward if the resulting time is more than 6 months stale
    if (now - ts > 6 * 30 * 24 * 3600 * 1000) {
      ts = Date.parse(`${yearNow + 1}-${dm[1]}-${dm[0]}T${t}:00Z`);
    }
    return ts;
  }
  const windows = legs.map((leg, i) => ({
    i,
    dep: toTs(leg.dep_date, leg.dep_time),
    arr: toTs(leg.arr_date, leg.arr_time),
  }));
  // In-progress: now is inside [dep, arr]
  const active = windows.find(w => Number.isFinite(w.dep) && Number.isFinite(w.arr) && w.dep <= now && now <= w.arr);
  if (active) return active.i;
  // Otherwise the next upcoming dep
  const upcoming = windows.filter(w => Number.isFinite(w.dep) && w.dep >= now).sort((a, b) => a.dep - b.dep);
  if (upcoming.length) return upcoming[0].i;
  // Everything's in the past — most-recent
  const past = windows.filter(w => Number.isFinite(w.dep)).sort((a, b) => b.dep - a.dep);
  if (past.length) return past[0].i;
  return 0;
}

// ---------- Clocks ----------
function startClocks() {
  tickClocks();
  setInterval(tickClocks, 1000);
}
function tickClocks() {
  const now = new Date();
  const u = $('clock-utc');
  if (u) u.textContent = `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}Z`;
  // Defensive: a bug in either of these must never break the clock or the
  // rest of the app. Caught here so the 1s interval can keep running and
  // the listener-wiring further down in app.js still gets to attach.
  try { updateCtotColor(now); }   catch (err) { console.warn('CTOT colour skipped', err); }
  try { updatePastLegUI(now); }   catch (err) { console.warn('past-leg cue skipped', err); }
  try { maybeFireCtotAlert(now); } catch (err) { console.warn('CTOT alert skipped', err); }
}
function pad(n) { return String(n).padStart(2, '0'); }

// ---------- CTOT slot-state colour ----------
// Paint the CTOT pill based on how far the current UTC sits from the
// entered CTOT slot time. Δ = now − CTOT (negative = early, positive = late):
//   Δ < -20 min          → no colour      (way ahead of slot)
//   -20 ≤ Δ < -10        → yellow         (slot approaching)
//   -10 ≤ Δ ≤ +5         → green          (inside slot window)
//    5 < Δ ≤ +10         → orange         (slipping)
//    Δ > +10             → red            (missed)
// Visuals (CSS) keep the time fully readable — outline + soft tint only,
// never a background flood that hides the digits.
const CTOT_CLASSES = ['is-ctot-yellow','is-ctot-green','is-ctot-orange','is-ctot-red'];
function updateCtotColor(now = new Date()) {
  const wrap = document.querySelector('.hdr-ctot');
  if (!wrap) return;
  CTOT_CLASSES.forEach(c => wrap.classList.remove(c));
  const raw = (storage.getCurrent()?.dataCard?.ctot || '').trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (!m) return;
  const hh = parseInt(m[1], 10), mm = parseInt(m[2], 10);
  if (hh > 23 || mm > 59) return;
  // Today's UTC CTOT. If today's value is more than 12h in the past
  // it's probably a tomorrow-morning slot — roll forward a day.
  let ctotTs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hh, mm, 0);
  if (now.getTime() - ctotTs > 12 * 3600 * 1000) ctotTs += 24 * 3600 * 1000;
  const diffMin = (now.getTime() - ctotTs) / 60000;
  let cls = '';
  if      (diffMin >= -20 && diffMin < -10) cls = 'is-ctot-yellow';
  else if (diffMin >= -10 && diffMin <=  5) cls = 'is-ctot-green';
  else if (diffMin >    5 && diffMin <= 10) cls = 'is-ctot-orange';
  else if (diffMin >   10)                  cls = 'is-ctot-red';
  if (cls) wrap.classList.add(cls);
}

// ---------- CTOT countdown notifications (foreground) ----------
// Active alerts at the same thresholds as the colour cue:
//   T-20 min  → "CTOT in 20 minutes — ELY###"
//   T-10 min  → "CTOT in 10 minutes — ELY###"
//   T 0       → "CTOT now — ELY###"
//
// Foreground only — no service-worker push, no VAPID, no server. Works
// when the PWA is open (iOS 16.4+ installed PWA also fires the banner
// while the app is "recently used" in the background). When the PWA is
// fully closed nothing fires; that's a known limitation of the no-server
// path the user accepted.
//
// Crossing detection: keep the previous diffMin. Fire only when the new
// diff is at-or-past a threshold AND the previous was strictly before it.
// State resets when the CTOT string changes (input handler calls
// resetCtotAlertState) so a fresh countdown starts clean.
const CTOT_ALERTS_KEY = 'fc.notifs.ctot';
const ctotAlerts = {
  prevDiffMin: null,
  // The CTOT string we're tracking. When it changes, the fired set
  // is cleared so a new entry can re-fire each threshold.
  trackedCtot: '',
  fired: new Set(),
};
function ctotAlertsEnabled() {
  try { return localStorage.getItem(CTOT_ALERTS_KEY) === 'on'; }
  catch { return false; }
}
function setCtotAlertsEnabled(on) {
  try { localStorage.setItem(CTOT_ALERTS_KEY, on ? 'on' : ''); } catch {}
}
function resetCtotAlertState() {
  ctotAlerts.prevDiffMin = null;
  ctotAlerts.trackedCtot = '';
  ctotAlerts.fired = new Set();
}

// Compute the CTOT diff in minutes the same way updateCtotColor does, so
// the alerts and the pill colour can never disagree. Returns null when
// there's no valid CTOT to track.
function ctotDiffMinutes(now) {
  const raw = (storage.getCurrent()?.dataCard?.ctot || '').trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (!m) return { raw: '', diff: null };
  const hh = parseInt(m[1], 10), mm = parseInt(m[2], 10);
  if (hh > 23 || mm > 59) return { raw, diff: null };
  let ctotTs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hh, mm, 0);
  if (now.getTime() - ctotTs > 12 * 3600 * 1000) ctotTs += 24 * 3600 * 1000;
  return { raw, diff: (now.getTime() - ctotTs) / 60000 };
}

function maybeFireCtotAlert(now) {
  if (!ctotAlertsEnabled()) return;
  if (typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted') return;

  const { raw, diff } = ctotDiffMinutes(now);
  if (diff == null) { ctotAlerts.prevDiffMin = null; return; }
  // CTOT changed under us → start a fresh crossing track.
  if (raw !== ctotAlerts.trackedCtot) {
    ctotAlerts.trackedCtot = raw;
    ctotAlerts.fired = new Set();
    ctotAlerts.prevDiffMin = diff;
    return;
  }
  const prev = ctotAlerts.prevDiffMin;
  ctotAlerts.prevDiffMin = diff;
  if (prev == null) return;

  const thresholds = [
    { key: 'T-20', when: -20, label: 'CTOT in 20 minutes' },
    { key: 'T-10', when: -10, label: 'CTOT in 10 minutes' },
    { key: 'T0',   when:   0, label: 'CTOT now' },
  ];
  const flightStr = (() => {
    const f = storage.getCurrent()?.dataCard?.flight || '';
    return f ? ' — ' + displayFlight(f) : '';
  })();
  for (const t of thresholds) {
    if (ctotAlerts.fired.has(t.key)) continue;
    if (prev < t.when && diff >= t.when) {
      try {
        new Notification('Flight Card', {
          body: t.label + flightStr,
          icon: './icons/icon-192.png',
          tag:  'fc-ctot-' + t.key,
        });
        ctotAlerts.fired.add(t.key);
      } catch (err) {
        console.warn('Notification fire failed', err);
      }
    }
  }
}

// Bell button — three visual states driven by Notification.permission and
// the local opt-in flag in localStorage. Tap behaviour:
//   default  → requestPermission(). On grant, opt in + fire a confirmation
//              notification. On deny, toast → enable in iOS Settings.
//   granted  → toggle the local opt-in flag. Confirmation notification on
//              first opt-in so the user sees the banner shape.
//   denied   → toast pointing at iOS Settings (permission can only be
//              changed there, not from the page).
function paintCtotBell() {
  const btn = $('hdr-ctot-bell');
  if (!btn) return;
  btn.classList.remove('is-off', 'is-on', 'is-denied');
  let state;
  if (typeof Notification === 'undefined') state = 'off';
  else if (Notification.permission === 'denied') state = 'denied';
  else if (Notification.permission === 'granted' && ctotAlertsEnabled()) state = 'on';
  else state = 'off';
  btn.classList.add('is-' + state);
  btn.textContent = (state === 'on') ? '🔔' : '🔕';
  btn.title = state === 'on'
    ? 'CTOT alerts on (tap to mute)'
    : state === 'denied'
      ? 'Notifications blocked — enable in iOS Settings'
      : 'Enable CTOT alerts (20 / 10 / now)';
}
async function onBellTap() {
  if (typeof Notification === 'undefined') {
    toast('This browser does not support notifications');
    return;
  }
  if (Notification.permission === 'denied') {
    toast('Notifications blocked. Enable in iOS Settings → Flight Card.');
    return;
  }
  if (Notification.permission === 'default') {
    let result = 'default';
    try { result = await Notification.requestPermission(); } catch { result = 'default'; }
    if (result === 'denied') {
      toast('Notifications denied');
      paintCtotBell();
      return;
    }
    if (result !== 'granted') {
      paintCtotBell();
      return;
    }
    setCtotAlertsEnabled(true);
    paintCtotBell();
    try { new Notification('Flight Card', { body: 'CTOT alerts on', icon: './icons/icon-192.png' }); } catch {}
    return;
  }
  // permission === 'granted' → toggle opt-in
  const next = !ctotAlertsEnabled();
  setCtotAlertsEnabled(next);
  paintCtotBell();
  if (next) {
    try { new Notification('Flight Card', { body: 'CTOT alerts on', icon: './icons/icon-192.png' }); } catch {}
  }
}

// ---------- Past-leg indication ----------
// A leg is "past" when its arrival UTC has already happened. When the
// active leg is past:
//   - body.is-past-leg is set → CSS dims the data + checklist cards a
//     little so they feel archived (still readable, just visually
//     "historical record" rather than live data).
//   - The leg-switcher chip gets a small inline "PAST" pill.
// No body background wash, no overlay banner — those caused the bugs
// last time. Just the dim + pill.
function isLegPast(leg, now = new Date()) {
  if (!leg) return false;
  // Prefer arr_date/time; fall back to dep_date/time when arr isn't known.
  const d = leg.arr_date || leg.dep_date;
  const t = leg.arr_time || leg.dep_time;
  if (!d || !t) return false;
  const dm = String(d).split('.');
  if (dm.length !== 2) return false;
  const tm = String(t).match(/^(\d{1,2}):(\d{2})$/);
  if (!tm) return false;
  const yearNow = now.getUTCFullYear();
  let ts = Date.UTC(yearNow, parseInt(dm[1], 10) - 1, parseInt(dm[0], 10), parseInt(tm[1], 10), parseInt(tm[2], 10), 0);
  if (!Number.isFinite(ts)) return false;
  // Roll forward if the resulting time is >6 months stale (handles
  // year-end roster bulletins read in January).
  if (now.getTime() - ts > 6 * 30 * 24 * 3600 * 1000) {
    ts = Date.UTC(yearNow + 1, parseInt(dm[1], 10) - 1, parseInt(dm[0], 10), parseInt(tm[1], 10), parseInt(tm[2], 10), 0);
  }
  return ts < now.getTime();
}
// Find the index of the next upcoming leg — earliest leg whose dep_ts is
// in the future. Returns -1 if no leg has a future dep_ts (everything
// past, or no dep schedule on any leg). Used by updatePastLegUI to tag
// the active leg as "NEXT" when it's the one a pilot is preparing for.
function findNextLegIdx(legs, now) {
  let bestIdx = -1, bestTs = Infinity;
  for (let i = 0; i < legs.length; i++) {
    const ts = legDepTs(legs[i]);
    if (!Number.isFinite(ts)) continue;
    if (ts <= now) continue;
    if (ts < bestTs) { bestTs = ts; bestIdx = i; }
  }
  return bestIdx;
}

function updatePastLegUI(now = new Date()) {
  const legs = storage.getLegs?.() || [];
  const idx  = storage.getLegIndex?.() || 0;
  const leg  = legs[idx] || null;
  const past = isLegPast(leg, now);
  const nextIdx = findNextLegIdx(legs, now.getTime?.() ?? Date.now());
  const isNext = !past && idx === nextIdx;
  document.body.classList.toggle('is-past-leg', past);
  // Toggle the small inline pills on the leg-switcher chip. Built as DOM
  // elements (not innerHTML) so the existing chip text isn't disturbed.
  // Mutually exclusive: a leg can be PAST or NEXT or neither, never both.
  const routeEl = $('leg-route');
  if (!routeEl) return;
  syncChipTag(routeEl, '.leg-past-tag', 'leg-past-tag', 'PAST', past);
  syncChipTag(routeEl, '.leg-next-tag', 'leg-next-tag', 'NEXT', isNext);
}
function syncChipTag(routeEl, selector, className, label, want) {
  const existing = routeEl.querySelector(selector);
  if (want && !existing) {
    const tag = document.createElement('span');
    tag.className = className;
    tag.textContent = label;
    routeEl.appendChild(tag);
  } else if (!want && existing) {
    existing.remove();
  }
}

// ---------- Header tail/flight inputs ----------
// Select-all on focus for header inputs so a single keystroke replaces the value
['hdr-tail', 'hdr-flight', 'hdr-ctot'].forEach(id => {
  const el = $(id);
  if (!el) return;
  el.addEventListener('focus', () => {
    setTimeout(() => { try { el.select(); } catch {} }, 0);
  });
});

function syncHeaderInputs() {
  const data = storage.getCurrent().dataCard;
  const tail = $('hdr-tail');
  const flt  = $('hdr-flight');
  const ctot = $('hdr-ctot');
  if (tail && document.activeElement !== tail) tail.value = data.tail || '';
  // Display the flight number with the ELY callsign prefix — the canonical
  // way a 737NG pilot says it on the radio. Storage keeps just the digits.
  if (flt  && document.activeElement !== flt)  flt.value  = displayFlight(data.flight || '');
  if (ctot && document.activeElement !== ctot) ctot.value = data.ctot || '';
}
$('hdr-tail').addEventListener('input', () => {
  storage.setDataField('tail', $('hdr-tail').value.toUpperCase());
  speeches.notifyDataChange();
});
// Flight number input — typing a new number means "I'm starting a different
// flight", not "edit the current leg's flight number." We don't touch
// storage during input; on blur, if the digits differ from the active leg,
// we pop a confirmation that either creates a new leg (preserving the
// existing one) or, if the number matches an existing leg, just switches
// to it. Empty input clears the current leg's flight (so users can correct
// a typo on a brand-new flight before any data accrues).
//
// HONEST CAVEAT (worth re-stating since this UI implies "from the
// internet"): the route + block time come from a local table in
// modules/ly-routes.js. Aircraft tail and the day's actual departure time
// can't be auto-filled — no free, no-key, CORS-friendly public API exists
// for that, and a wrong tail is worse than no tail. Both come from
// dispatch / OPT after creation.
let pendingNewFlight = null;  // { digits, route, isNew }

$('hdr-flight').addEventListener('input', () => {
  // Free-typing: don't write to storage. Keep what's in the box for blur
  // to handle. Speech vars don't refresh in real time for this field on
  // purpose (the typed value isn't authoritative yet).
});
$('hdr-flight').addEventListener('blur', () => {
  const inp = $('hdr-flight');
  const digits = normaliseFlightNumber(inp.value);
  const current = storage.getCurrent().dataCard.flight || '';
  // Same number → just format-render, no modal.
  if (digits === current) {
    inp.value = displayFlight(digits);
    return;
  }
  // Empty + no existing legs → just clear the field on the single flight.
  if (!digits) {
    inp.value = '';
    if (storage.getLegs().length === 0) {
      storage.setDataField('flight', '');
      speeches.notifyDataChange();
    } else {
      // Revert — clearing an existing leg's flight # via a blur isn't a
      // safe operation; do nothing and snap back to the active leg's value.
      syncHeaderInputs();
    }
    return;
  }
  // If this flight number already exists as a leg → switch to it.
  const legs = storage.getLegs();
  const existingIdx = legs.findIndex(l => normaliseFlightNumber(l.flight) === digits);
  if (existingIdx >= 0) {
    applyLeg(existingIdx).then(() => toast(`Switched to ELY${digits}`));
    return;
  }
  // Otherwise → pop the confirmation modal with the auto-fill preview.
  const route = lookupRoute(digits);
  pendingNewFlight = { digits, route, isNew: true };
  openNewFlightConfirm(pendingNewFlight);
});

function openNewFlightConfirm({ digits, route }) {
  $('nfc-title').textContent = `Start new flight ELY${digits}`;
  const rows = $('nfc-rows');
  rows.innerHTML = '';
  const add = (k, v) => {
    rows.insertAdjacentHTML('beforeend',
      `<dt>${k}</dt><dd>${v}</dd>`);
  };
  if (route) {
    add('Route', `${route.dep} → ${route.arr}`);
    if (route.block) add('Block time', `~${route.block} (typical)`);
    add('Aircraft tail', '<span class="muted">— fill after dispatch</span>');
  } else {
    add('Route',     '<span class="muted">unknown — enter manually</span>');
    add('Block time','<span class="muted">unknown — enter manually</span>');
    add('Aircraft tail', '<span class="muted">— fill after dispatch</span>');
  }
  showOverlay('newflight-confirm-overlay');
}
function closeNewFlightConfirm(revert = true) {
  hideOverlay('newflight-confirm-overlay');
  if (revert) {
    // Snap the input back to the active leg's flight # so the user isn't
    // looking at the abandoned attempt.
    syncHeaderInputs();
  }
  pendingNewFlight = null;
}
$('nfc-close').addEventListener('click',  () => closeNewFlightConfirm(true));
$('nfc-cancel').addEventListener('click', () => closeNewFlightConfirm(true));
$('nfc-create').addEventListener('click', async () => {
  if (!pendingNewFlight) { closeNewFlightConfirm(true); return; }
  const { digits, route } = pendingNewFlight;
  // Build the new leg from what we know. The leg's dataCard gets seeded by
  // storage.appendLegs from these top-level identity fields.
  const newLeg = {
    flight:      digits,
    tail:        '',
    dep:         route?.dep || '',
    arr:         route?.arr || '',
    flight_time: route?.block || '',
    dep_date:    '', dep_time: '',
    arr_date:    '', arr_time: '',
    ctot:        '',
  };
  const { index: newIdx, replaced } = storage.appendLegs([newLeg]);
  await applyLeg(newIdx);
  renderHistory();
  closeNewFlightConfirm(false);  // no revert — the input now points at the new leg
  if (replaced) {
    toast(`ELY${digits} updated`);
  } else {
    toast(route
      ? `ELY${digits}: ${route.dep} → ${route.arr}`
      : `ELY${digits} created`);
  }
});

// Header CTOT input — live HH:MM formatting + autosave
const hdrCtot = $('hdr-ctot');
hdrCtot.addEventListener('input', () => {
  const formatted = formatHHMM(hdrCtot.value);
  if (hdrCtot.value !== formatted) {
    hdrCtot.value = formatted;
    try { hdrCtot.setSelectionRange(formatted.length, formatted.length); } catch {}
  }
  storage.setDataField('ctot', formatted);
  speeches.notifyDataChange();
  try { updateCtotColor(); } catch {}
  // A freshly-typed CTOT starts a clean countdown — clear the
  // crossing-detection state so every threshold can re-fire.
  try { resetCtotAlertState(); } catch {}
});
// Wire the alerts bell. Tap behaviour is split out into onBellTap so
// every error path is contained — a permission-related throw can never
// take down the rest of app.js wiring.
$('hdr-ctot-bell').addEventListener('click', () => {
  try { onBellTap(); } catch (err) { console.warn('bell tap failed', err); }
});
// Paint the bell once on load so its icon reflects current permission
// + opt-in state (the user may already have granted permission from a
// previous session).
try { paintCtotBell(); } catch (err) { console.warn('bell paint failed', err); }

function formatHHMM(raw) {
  const digits = String(raw || '').replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return digits.slice(0, digits.length - 2) + ':' + digits.slice(-2);
}

// ---------- Header actions ----------
$('theme-toggle').addEventListener('click', cycleTheme);
// New Flight button → small modal: reset checklist or paste a roster
$('new-flight').addEventListener('click', () => showOverlay('newflight-overlay'));
$('newflight-close').addEventListener('click', () => hideOverlay('newflight-overlay'));
$('newflight-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'newflight-overlay') hideOverlay('newflight-overlay');
});
$('newflight-reset').addEventListener('click', async () => {
  if (!confirm('Reset everything on this flight? Takeoff numbers, fuel, ATIS, SOB and every tick will be cleared. The flight identity (tail / route / crew) will be re-applied from the leg.')) return;
  // Wipe both halves of the flight's live state.
  storage.clearDataCard();
  storage.resetTicks();
  // Re-apply the active leg so flight #, tail, dep/arr, crew etc. come back —
  // we only wanted to clear V-speeds / fuel / ticks, not lose the flight.
  const legs = storage.getLegs();
  if (legs.length) {
    await applyLeg(storage.getLegIndex());
  } else {
    renderAll();
    syncHeaderInputs();
  }
  checklist.resetOverrides();
  hideOverlay('newflight-overlay');
  toast('Reset complete');
});

// Data card head — bulk reset across every group marked `resettable: true`
// in modules/data-card.js. By design that's SOB, ATIS, Takeoff performance,
// and Fuel — Flight (dep/arr/flight time) and Crew survive so the
// persistent header stays intact across a "fresh flight" reset.
$('data-reset-all').addEventListener('click', () => {
  const groups = dataCard.FIELDS.filter(g => g.resettable);
  if (!groups.length) return;
  const names = groups.map(g => g.group).join(', ');
  if (!confirm(`Reset ${names}? (Flight + Crew kept.)`)) return;
  for (const g of groups) {
    for (const c of g.cells) storage.setDataField(c.key, '');
  }
  dataCard.render(dataBody);
  speeches.notifyDataChange();
  toast('Data card reset');
});

// Checklist card head — quick reset (unticks only, leaves data card alone).
$('checklist-reset').addEventListener('click', () => {
  if (!confirm('Uncheck every item on the checklist?')) return;
  storage.resetTicks();
  checklist.resetOverrides();
  checklist.render(checklistBody);
  toast('Checklist reset');
});
$('newflight-paste').addEventListener('click', () => {
  hideOverlay('newflight-overlay');
  $('roster-text').value = '';
  showOverlay('roster-overlay');
  setTimeout(() => $('roster-text').focus(), 50);
});

// Roster paste modal — adds flights to the persistent list (no archive)
$('roster-close').addEventListener('click',  () => hideOverlay('roster-overlay'));
$('roster-cancel').addEventListener('click', () => hideOverlay('roster-overlay'));
$('roster-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'roster-overlay') hideOverlay('roster-overlay');
});
$('roster-parse').addEventListener('click', async () => {
  const text = $('roster-text').value || '';
  if (!text.trim()) { toast('Paste your roster first'); return; }
  try {
    const { parseRoster } = await import('./modules/roster.js');
    const parsed = parseRoster(text);
    if (!parsed || !parsed.flights?.length) {
      toast('Could not parse the roster — check the format');
      return;
    }
    await applyRoster(parsed);
    hideOverlay('roster-overlay');
  } catch (err) {
    toast('Parse failed: ' + (err?.message || err));
  }
});

// File picker for the JSON crew-portal export. Reads the file's text into
// the same textarea so the user can sanity-check before tapping Add flights
// — and so a malformed file produces the same "Could not parse" toast as
// a malformed paste.
$('roster-file').addEventListener('change', async (e) => {
  const f = e.target.files?.[0];
  e.target.value = '';  // let the user re-pick the same file later
  if (!f) return;
  try {
    const text = await f.text();
    $('roster-text').value = text;
    toast(`Loaded ${f.name}`);
  } catch (err) {
    toast('Could not read file: ' + (err?.message || err));
  }
});
$('pa-toggle').addEventListener('click', () => speeches.open());

// ---------- Share sheet (QR + scan + AirDrop sync + Calendar sync) ----------
$('share-toggle').addEventListener('click', async () => {
  showOverlay('settings-overlay');
  await renderFlightQr();
  // Defensive: every helper that touches the new Calendar widgets is
  // wrapped, so a missing module or broken localStorage can't bubble up
  // and stop the existing share-sheet behaviour from working.
  try { paintCalendarSection(); } catch (err) { console.warn('cal paint skipped', err); }
});
$('settings-close').addEventListener('click', () => hideOverlay('settings-overlay'));
$('settings-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'settings-overlay') hideOverlay('settings-overlay');
});

// Calendar URL field — autosave to localStorage on every keystroke via
// the calendar module's setCalendarUrl helper. paintCalendarSection
// loads any previously-saved URL back into the field when the sheet opens.
async function paintCalendarSection() {
  const { getCalendarUrl, getLastSyncAt } = await import('./modules/calendar.js');
  const input = $('cal-url');
  if (input && document.activeElement !== input) input.value = getCalendarUrl();
  const status = $('cal-status');
  if (status) {
    status.classList.remove('is-err', 'is-ok');
    const last = getLastSyncAt();
    status.textContent = last
      ? 'Last synced ' + new Date(last).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })
      : '';
  }
}
$('cal-url').addEventListener('input', async () => {
  try {
    const { setCalendarUrl } = await import('./modules/calendar.js');
    setCalendarUrl($('cal-url').value);
  } catch (err) {
    console.warn('cal url save failed', err);
  }
});
$('cal-sync').addEventListener('click', () => runCalendarSync('manual'));

// Shared sync path — manual button taps and the auto-sync interval both
// land here, so behaviour stays consistent. `source` decides how the
// result is surfaced ('manual' → status banner + toast; 'auto' → toast
// only, and only when something actually changed).
let calSyncRunning = false;
async function runCalendarSync(source) {
  if (calSyncRunning) return;
  const status = $('cal-status');
  const btn    = $('cal-sync');
  if (source === 'manual') {
    if (status) { status.classList.remove('is-err', 'is-ok'); status.textContent = 'Syncing…'; }
    if (btn) btn.disabled = true;
  }
  calSyncRunning = true;
  try {
    const cal = await import('./modules/calendar.js');
    // Save current input first in case the user just edited but didn't blur.
    if (source === 'manual') cal.setCalendarUrl($('cal-url').value);
    const { events, flights } = await cal.syncFromCalendar();
    if (!flights.length) {
      if (source === 'manual') {
        throw new Error(`No flights found in ${events} calendar event${events === 1 ? '' : 's'}`);
      }
      return; // auto: silently no-op when nothing to add
    }
    const { index: newIdx, added, replaced } = storage.appendLegs(flights);
    await applyLeg(newIdx);
    renderHistory();
    if (source === 'manual') {
      if (status) {
        status.classList.add('is-ok');
        status.textContent = rosterToast(added, replaced) + ` from ${events} event${events === 1 ? '' : 's'}`;
      }
      toast(rosterToast(added, replaced));
    } else if (added || replaced) {
      // Auto-sync only toasts when something actually changed.
      toast(rosterToast(added, replaced) + ' (auto-sync)');
    }
  } catch (err) {
    if (source === 'manual' && status) {
      status.classList.add('is-err');
      status.textContent = err?.message || String(err);
    }
    console.warn(`calendar ${source} sync failed`, err);
  } finally {
    calSyncRunning = false;
    if (source === 'manual' && btn) btn.disabled = false;
  }
}

// Auto-refresh: fires the same sync 3 hours before any upcoming leg's
// dep_time, with a 60-min cooldown so the same window doesn't sync
// repeatedly. Runs on every 10-min interval tick + once on app load +
// once on visibility-change (so coming back to the app after hours away
// catches up).
const AUTO_SYNC_WINDOW_MS   = 3 * 60 * 60 * 1000;   // 3h pre-departure
const AUTO_SYNC_COOLDOWN_MS = 60 * 60 * 1000;       // at most once / hr
async function maybeAutoSyncCalendar() {
  try {
    const { isConfigured, getLastSyncAt } = await import('./modules/calendar.js');
    if (!isConfigured()) return;
    const now = Date.now();
    if (now - getLastSyncAt() < AUTO_SYNC_COOLDOWN_MS) return;
    // Any leg whose dep_ts is in (now, now + 3h] triggers a sync.
    const legs = storage.getLegs();
    const inWindow = legs.some(leg => {
      const ts = legDepTs(leg);
      return Number.isFinite(ts) && ts > now && ts - now <= AUTO_SYNC_WINDOW_MS;
    });
    if (!inWindow) return;
    await runCalendarSync('auto');
  } catch (err) {
    console.warn('auto-sync probe skipped', err);
  }
}
function legDepTs(leg) {
  // Same heuristic pickLegForNow uses — combine dd.mm + HH:MM as UTC,
  // roll the year forward if the resulting timestamp is >6 months stale.
  if (!leg || !leg.dep_date || !leg.dep_time) return NaN;
  const dm = String(leg.dep_date).split('.');
  if (dm.length !== 2) return NaN;
  const yearNow = new Date().getUTCFullYear();
  const iso = `${yearNow}-${dm[1]}-${dm[0]}T${leg.dep_time}:00Z`;
  let ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return NaN;
  if (Date.now() - ts > 6 * 30 * 24 * 3600 * 1000) {
    ts = Date.parse(`${yearNow + 1}-${dm[1]}-${dm[0]}T${leg.dep_time}:00Z`);
  }
  return ts;
}
// Boot probe (after a short delay so the rest of the UI is set up first),
// then every 10 minutes, and whenever the tab becomes visible again.
setTimeout(maybeAutoSyncCalendar, 5_000);
setInterval(maybeAutoSyncCalendar, 10 * 60 * 1000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') maybeAutoSyncCalendar();
});

// Render the active flight as a QR into the share-sheet canvas. Lazy-loads
// the qrcode lib on first use; the SW caches it after that.
async function renderFlightQr() {
  const canvas = $('share-qr-canvas');
  const sub    = $('share-qr-sub');
  if (!canvas) return;
  try {
    const { renderToCanvas } = await import('./modules/qr.js');
    const payload = storage.exportLeg();
    const info = await renderToCanvas(canvas, payload);
    const d = storage.getCurrent().dataCard;
    const id = d.flight ? `ELY${d.flight}` : '(this flight)';
    const route = (d.dep && d.arr) ? ` · ${d.dep} → ${d.arr}` : '';
    // Tag with payload size + QR version so future "won't scan" reports
    // are debuggable from the UI without poking at devtools.
    const meta = info ? ` · ${payload.length} B / v${info.version}` : '';
    sub.textContent = `${id}${route}${meta}`;
  } catch (err) {
    const why = err?.message || String(err);
    sub.textContent = `Couldn't generate QR: ${why}`;
    console.warn('QR render failed', err);
  }
}

// Scan path — open the scanner sub-sheet, stream camera, hand a decoded
// payload to storage.importLeg(). The scanner module cleans up the camera
// on stop, so closing the overlay tears everything down.
let scanStop = null;
$('share-scan').addEventListener('click', async () => {
  hideOverlay('settings-overlay');
  showOverlay('scan-overlay');
  $('scan-status').textContent = 'Starting camera…';
  try {
    const { startScanner } = await import('./modules/qr.js');
    scanStop = await startScanner($('scan-video'), async (text) => {
      try {
        const { index: newIdx, replaced } = storage.importLeg(text);
        $('scan-status').textContent = replaced ? 'Updating leg…' : 'Got it — adding leg…';
        await applyLeg(newIdx);
        renderHistory();
        hideOverlay('scan-overlay');
        const f = storage.getCurrent().dataCard.flight;
        toast(replaced
          ? (f ? `ELY${f} updated` : 'Flight updated')
          : (f ? `ELY${f} imported` : 'Flight imported'));
      } catch (err) {
        $('scan-status').textContent = 'Not a Flight Card QR.';
        // Restart the scanner so the user can try again without re-opening.
        setTimeout(() => {
          if (!document.getElementById('scan-overlay').classList.contains('hidden')) {
            $('share-scan').click();
          }
        }, 1500);
      }
    });
    $('scan-status').textContent = 'Point at the other device\'s QR.';
  } catch (err) {
    $('scan-status').textContent = err?.message || 'Camera unavailable.';
  }
});
$('scan-close').addEventListener('click', () => {
  if (scanStop) { try { scanStop(); } catch {} scanStop = null; }
  hideOverlay('scan-overlay');
});
$('scan-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'scan-overlay') $('scan-close').click();
});

// Filename helper — includes today's date and the active flight # if known,
// so the receiving device can tell exports apart at a glance in the Files app.
function exportFilename() {
  const d = new Date();
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const flt = (storage.getCurrent().dataCard.flight || '').toString().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return flt ? `flightcard-${ymd}-LY${flt}.json` : `flightcard-${ymd}.json`;
}

$('sync-export').addEventListener('click', async () => {
  const json = storage.exportJson();
  const blob = new Blob([json], { type: 'application/json' });
  const file = new File([blob], exportFilename(), { type: 'application/json' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Flight Card state', text: file.name });
      // Share Sheet handles the rest — we don't toast on success because iOS
      // might still be presenting the sheet.
      return;
    }
  } catch (err) {
    // User cancelled the share sheet → not an error worth toasting
    if (err?.name === 'AbortError') return;
    console.warn('share failed, falling back to download', err);
  }
  // Fallback: trigger a plain download
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  toast('Downloaded — AirDrop it from Files');
});

$('sync-import').addEventListener('change', async (e) => {
  const f = e.target.files?.[0];
  e.target.value = '';   // allow re-picking the same file later
  if (!f) return;
  if (!confirm('Replace everything on this device with the contents of ' + f.name + '?')) return;
  try {
    const text = await f.text();
    // importJson validates the JSON, migrates it if needed, and flushes to
    // localStorage. A hard reload then re-mounts every module against the
    // new state — simpler than trying to live-rerender every UI slice.
    storage.importJson(text);
    hideOverlay('settings-overlay');
    toast('Imported — reloading…');
    setTimeout(() => location.reload(), 600);
  } catch (err) {
    toast('Import failed: ' + (err?.message || err));
  }
});

// ---------- Flightradar24 quick-track ----------
// Three-letter input (e.g. "EHE") is treated as an Israeli-fleet registration
// suffix and prefixed with "4X-". Anything else passes through untouched.
function normaliseRegistration(raw) {
  const s = String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!s) return '';
  if (/^[A-Z]{3}$/.test(s)) return '4X-' + s;
  return s;
}
$('fr24-btn').addEventListener('click', () => {
  const tail = storage.getCurrent().dataCard.tail || $('hdr-tail').value;
  const reg = normaliseRegistration(tail);
  if (!reg) {
    toast('Set tail # first');
    return;
  }
  const url = 'https://www.flightradar24.com/data/aircraft/' + encodeURIComponent(reg.toLowerCase());
  window.open(url, '_blank', 'noopener,noreferrer');
});
$('pa-close').addEventListener('click', () => speeches.close());

$('pa-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'pa-overlay') speeches.close();
});

// ---------- Live ATIS / METAR popup ----------
let wxRefreshTimer = null;
const WX_REFRESH_MS = 10 * 60 * 1000;

// Airport source state: 'dep' (departure), 'arr' (destination), or 'custom'.
// wxCustomCode holds the user-typed ICAO when source = 'custom'.
// wxDisplayLetter is whatever letter the popup is *currently showing* — so the
// manual chip strip can highlight in sync with the big letter even when the
// popup is on Arr / Custom and the data card's atis field is unchanged.
let wxSource = 'dep';
let wxCustomCode = '';
let wxDisplayLetter = '';

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-wx-open]');
  if (btn && !btn.disabled) openWx();
});
$('wx-close').addEventListener('click', closeWx);
$('wx-overlay').addEventListener('click', (e) => { if (e.target.id === 'wx-overlay') closeWx(); });
$('wx-refresh').addEventListener('click', () => loadWx({ force: true }));

// Source switcher
$('wx-src-dep').addEventListener('click', () => switchWxSource('dep'));
$('wx-src-arr').addEventListener('click', () => switchWxSource('arr'));
// OTHER works in two taps so the keyboard doesn't ambush the user:
//   1st tap → select the Custom source (highlight only, no keyboard)
//   2nd tap → focus the input (keyboard pops up, user can type)
document.querySelector('.wx-src-custom').addEventListener('click', (e) => {
  if (wxSource !== 'custom') {
    e.preventDefault();
    wxSource = 'custom';
    paintWxSrcRow();
    // Do NOT focus the input — that would open the keyboard immediately.
    // The input has its own click handler for the second tap.
  } else {
    // Already on custom — let the click fall through to the input, which
    // focuses it and brings up the keyboard.
    $('wx-src-custom-input').focus();
  }
});
$('wx-src-custom-input').addEventListener('input', () => {
  wxCustomCode = $('wx-src-custom-input').value.trim().toUpperCase();
  // Auto-fetch as soon as we have a plausible 3 or 4-letter code.
  if (wxSource === 'custom' && (wxCustomCode.length === 3 || wxCustomCode.length === 4)) {
    loadWx({ force: false });
  }
});
$('wx-src-custom-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); loadWx({ force: true }); e.target.blur(); }
});

function switchWxSource(src) {
  wxSource = src;
  paintWxSrcRow();
  if (src !== 'custom') loadWx({ force: false });
  // 'custom' first tap only highlights; the second tap (handled in the
  // .wx-src-custom click listener above) focuses the input.
}

function paintWxSrcRow() {
  const d = storage.getCurrent().dataCard;
  $('wx-src-dep-code').textContent = (d.dep || '—').toString().toUpperCase();
  $('wx-src-arr-code').textContent = (d.arr || '—').toString().toUpperCase();
  $('wx-src-dep').classList.toggle('on', wxSource === 'dep');
  $('wx-src-arr').classList.toggle('on', wxSource === 'arr');
  document.querySelector('.wx-src-custom')?.classList.toggle('on', wxSource === 'custom');
  // Disable Dep / Arr buttons when the underlying field is empty so the user
  // gets immediate feedback that there's nothing to fetch there yet.
  $('wx-src-dep').disabled = !d.dep;
  $('wx-src-arr').disabled = !d.arr;
}

function resolveWxCode() {
  const d = storage.getCurrent().dataCard;
  if (wxSource === 'arr')    return (d.arr || '').toString().toUpperCase();
  if (wxSource === 'custom') return wxCustomCode.toUpperCase();
  return (d.dep || '').toString().toUpperCase();
}

async function openWx() {
  const d = storage.getCurrent().dataCard;
  // Pick a sensible default source: dep if set, else arr, else custom.
  if (d.dep) wxSource = 'dep';
  else if (d.arr) wxSource = 'arr';
  else wxSource = 'custom';
  $('wx-src-custom-input').value = wxCustomCode;
  paintWxSrcRow();
  renderManualChips();
  showOverlay('wx-overlay');
  await loadWx({ force: false });
  // Mark current letter as read once popup is open
  const cur = storage.getCurrent().dataCard.atis;
  if (cur && wxSource === 'dep') {
    storage.setDataField('atis_read', cur);
    dataCard.render(dataBody);
  }
  // Auto-refresh every 10 minutes while open
  if (wxRefreshTimer) clearInterval(wxRefreshTimer);
  wxRefreshTimer = setInterval(() => loadWx({ force: true }), WX_REFRESH_MS);
}

function closeWx() {
  hideOverlay('wx-overlay');
  if (wxRefreshTimer) { clearInterval(wxRefreshTimer); wxRefreshTimer = null; }
}

async function loadWx(opts) {
  const code = resolveWxCode();
  if (!code || code.length < 3) {
    paintWx({ icao: code || '—', letter: '', metar: null, taf: null, datis: null, ts: 0 });
    return;
  }
  const refreshBtn = $('wx-refresh');
  refreshBtn.disabled = true;
  refreshBtn.textContent = '…';
  try {
    const { fetchWx, extractLetter, extractText } = await import('./modules/wx.js');
    const res = await fetchWx(code, opts);
    if (!res) {
      paintWx({ icao: code, letter: '', metar: null, taf: null, datis: null, ts: 0 });
      return;
    }
    const liveLetter = extractLetter(res.datis);
    // Only the Dep source feeds back into the data card's ATIS cell —
    // Arr / Custom are reference-only and don't change the card's letter.
    if (liveLetter && wxSource === 'dep') {
      const prev = storage.getCurrent().dataCard.atis;
      if (prev !== liveLetter) {
        storage.setDataField('atis', liveLetter);
        storage.setDataField('atis_read', '');
      }
    }
    const cardLetter = storage.getCurrent().dataCard.atis;
    const letter = (wxSource === 'dep' ? cardLetter : null) || liveLetter || '';
    paintWx({
      icao: res.icao,
      letter,
      metar: res.metar,
      taf:   res.taf,
      datis: res.datis,
      ts: res.ts,
      datisText: extractText(res.datis),
    });
    if (wxSource === 'dep') dataCard.render(dataBody);
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.textContent = '↻';
  }
}

function paintWx({ icao, letter, metar, taf, datis, ts, datisText }) {
  wxDisplayLetter = letter || '';
  const read = !!letter && storage.getCurrent().dataCard.atis_read === letter;
  const wxLetterEl = $('wx-letter');
  wxLetterEl.textContent = letter || '—';
  wxLetterEl.classList.toggle('is-unread', !!letter && !read);
  wxLetterEl.classList.toggle('is-empty', !letter);
  // Keep the manual chip strip in sync with whatever letter the popup is
  // currently showing, regardless of which source feeds it.
  syncChipHighlight();
  $('wx-icao').textContent = icao;
  $('wx-time').textContent = ts ? 'Updated ' + new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  $('wx-atisguru').href = 'https://atis.guru/atis/' + encodeURIComponent(icao);
  const metarEl = $('wx-metar-text');
  if (metar) { metarEl.textContent = metar; metarEl.classList.remove('empty'); }
  else       { metarEl.textContent = 'No METAR available'; metarEl.classList.add('empty'); }
  const tafEl = $('wx-taf-text');
  if (tafEl) {
    if (taf) { tafEl.textContent = taf; tafEl.classList.remove('empty'); }
    else     { tafEl.textContent = `TAF unavailable for ${icao} — tap ↗ to open the source`; tafEl.classList.add('empty'); }
  }
  // Deep-link fallback so even when the proxy is missing or down the
  // user can still read the TAF in Safari with a single tap.
  const tafLink = $('wx-tafview');
  if (tafLink) tafLink.href = 'https://aviationweather.gov/taf?id=' + encodeURIComponent(icao);
  const datisEl = $('wx-datis-text');
  if (datisText) { datisEl.textContent = datisText; datisEl.classList.remove('empty'); }
  else           { datisEl.textContent = `No D-ATIS for ${icao} — use manual letter below`; datisEl.classList.add('empty'); }
}

function renderManualChips() {
  // Highlight reflects the popup's currently shown letter (wxDisplayLetter),
  // so the chip strip and big letter never disagree even on Arr / Custom.
  const chips = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(L =>
    `<button type="button" class="atis-chip${L === wxDisplayLetter ? ' on' : ''}" data-wx-chip="${L}">${L}</button>`
  ).join('');
  $('wx-chips').innerHTML = chips;
  $('wx-chips').querySelectorAll('[data-wx-chip]').forEach(b => {
    b.addEventListener('click', () => {
      const tapped = b.dataset.wxChip;
      // Tapping the currently-selected chip again deselects (clears) — gives
      // the user a way to reset to no letter without picking a wrong one.
      const next = (tapped === wxDisplayLetter) ? '' : tapped;
      // Manual letter only updates the data card when the popup is showing
      // the Dep ATIS — picking a letter while looking at Arr / Custom only
      // updates the popup display, not the flight's ATIS field.
      if (wxSource === 'dep') {
        storage.setDataField('atis', next);
        // Selecting a fresh letter marks it as read; clearing also clears read.
        storage.setDataField('atis_read', next);
        dataCard.render(dataBody);
      }
      paintWxLetter(next);
      syncChipHighlight();
    });
  });
}

// Update the chip "on" class without re-rendering the whole strip, so the
// active-chip indicator can move instantly without losing scroll / focus.
function syncChipHighlight() {
  $('wx-chips').querySelectorAll('[data-wx-chip]').forEach(b => {
    b.classList.toggle('on', b.dataset.wxChip === wxDisplayLetter);
  });
}

function paintWxLetter(letter) {
  wxDisplayLetter = letter || '';
  const wxLetterEl = $('wx-letter');
  wxLetterEl.textContent = letter || '—';
  wxLetterEl.classList.toggle('is-unread', false);
  wxLetterEl.classList.toggle('is-empty', !letter);
}

// CTOT FlightAware lookup — there's no public API for Eurocontrol slot times,
// so we open Flightaware's flight page for the current LY####. The user reads
// the ETD/CTOT delay there and types the value back into the CTOT pill.
$('hdr-ctot-fa').addEventListener('click', () => {
  const flt = (storage.getCurrent().dataCard.flight || '').toString().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!flt) { toast('Set flight # first'); return; }
  // Most company-flight numbers fit "LY0337"; Flightaware accepts that shape.
  const flightCode = /^LY/.test(flt) ? flt : 'LY' + flt;
  window.open('https://www.flightaware.com/live/flight/' + encodeURIComponent(flightCode), '_blank', 'noopener,noreferrer');
});

// OPT / FMC button inside the TO performance group head opens the
// (now screenshot-only) OCR modal.
dataCard.setOnOptFmc(() => {
  resetOcrOverlay();
  showOverlay('ocr-overlay');
});

// Per-group reset (currently wired only for the TO performance group).
dataCard.setOnResetGroup((groupId) => {
  const group = dataCard.FIELDS.find(g => g.id === groupId);
  if (!group) return;
  const label = group.group.toLowerCase();
  if (!confirm(`Reset the ${label} numbers?`)) return;
  // setDataField with '' deletes the key from dataCard, which the render path
  // treats as empty. Iterate every cell in the group so e.g. resetting "TO
  // performance" wipes V1, VR, V2, N1, Flaps in one tap.
  group.cells.forEach(c => storage.setDataField(c.key, ''));
  dataCard.render(dataBody);
  speeches.notifyDataChange();
  toast(`${group.group} reset`);
});

dataCard.setOnChange((key) => {
  if (key === 'tail' || key === 'flight' || key === 'ctot') syncHeaderInputs();
  // Keep the wx popup's source codes in sync with whatever the user types
  if ((key === 'dep' || key === 'arr') && !document.getElementById('wx-overlay').classList.contains('hidden')) {
    paintWxSrcRow();
  }
  // NB: Do not re-render the data card here. Previously this fired on every
  // dep keystroke and destroyed the focused input mid-type — only the first
  // letter ever made it in. The ATIS cell will resync on its next render
  // (when the popup is opened or the group is toggled).
  speeches.notifyDataChange();
});

// ---------- Card collapsibles ----------
document.querySelectorAll('.card-toggle').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.target;
    const card = document.querySelector(`.card[data-section="${target}"]`);
    if (!card) return;
    card.classList.toggle('collapsed');
    const open = !card.classList.contains('collapsed');
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.querySelector('.chev').textContent = open ? '▾' : '▸';
    if (target === 'history' && open) renderHistory();
  });
});

// ---------- Checklist edit mode ----------
$('checklist-edit').addEventListener('click', () => {
  const on = !checklist.isEditMode();
  checklist.setEditMode(on);
  const btn = $('checklist-edit');
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  btn.textContent = on ? '✓' : '✎';
  btn.title = on ? 'Done editing' : 'Edit checklist';
  checklist.render(checklistBody);
});

// ---------- OCR overlay ----------
// The overlay opens via dataCard.setOnOptFmc() (wired earlier). No header
// button to bind here — the OPT/FMC entry point is on the Takeoff
// performance group head.
//
// Every close path also resets state AND invalidates any in-flight OCR — so
// the modal never gets stuck on an old progress / review view, and a
// still-running Tesseract job that finishes later won't pop the overlay back
// open or write into a closed dialog.
function closeOcr() {
  ocrCancelToken++;
  resetOcrOverlay();
  hideOverlay('ocr-overlay');
}
$('ocr-close').addEventListener('click',  closeOcr);
$('ocr-cancel').addEventListener('click', closeOcr);
$('ocr-cancel-progress').addEventListener('click', closeOcr);
$('ocr-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'ocr-overlay') closeOcr();
});

// OPT/FMC modal is now screenshot-upload only. Camera, Paste-image, and
// Paste-text entry points were removed — rosters go via New Flight → Paste
// roster, takeoff numbers via this single Upload button.
$('ocr-file').addEventListener('change', (e) => handleOcrFile(e.target.files?.[0]));

// Bumped by closeOcr() so that any OCR result arriving after a close is
// silently dropped instead of repopulating the (now-closed) review section.
let ocrCancelToken = 0;
const OCR_TIMEOUT_MS = 90_000;

async function handleOcrFile(file) {
  if (!file) return;
  const myToken = ++ocrCancelToken;
  $('ocr-source').classList.add('hidden');
  $('ocr-progress').classList.remove('hidden');
  $('ocr-progress-text').textContent = 'Preparing image…';
  try {
    const { ocrImage } = await import('./modules/ocr.js');
    // 90s timeout — if Tesseract or its language data refuses to load (offline
    // first run, blocked CDN, weirdly large image) we bail with a clean error
    // instead of sitting on a spinner forever.
    const text = await Promise.race([
      ocrImage(file, (msg, frac) => {
        if (myToken === ocrCancelToken) {
          $('ocr-progress-text').textContent = `${msg} ${(frac * 100).toFixed(0)}%`;
        }
      }),
      new Promise((_, reject) => setTimeout(
        () => reject(new Error('OCR timed out — try a smaller or clearer screenshot')),
        OCR_TIMEOUT_MS
      )),
    ]);
    if (myToken !== ocrCancelToken) return;  // user closed → drop result
    await runParse(text);
  } catch (err) {
    if (myToken !== ocrCancelToken) return;
    console.error(err);
    toast('OCR failed: ' + (err?.message || err));
    resetOcrOverlay();
  }
}

async function runParse(text) {
  // Roster first — if the pasted text is a duty roster, take that branch.
  const { parseRoster } = await import('./modules/roster.js');
  const roster = parseRoster(text);
  if (roster) {
    await applyRoster(roster);
    // Keep the paste-text panel open so the user can paste another roster
    // (or edit / re-parse the current one) without re-opening the sheet.
    const details = document.querySelector('.ocr-paste');
    if (details) details.open = true;
    return;
  }
  const { parseFmcText, buildReviewFields } = await import('./modules/ocr.js');
  const parsed = parseFmcText(text);
  $('ocr-progress').classList.add('hidden');
  // dep / arr deliberately excluded — the roster already sets them and a
  // takeoff-perf screenshot shouldn't overwrite the route.
  const headline = ['v1','vr','v2','n1','flaps','trip_fuel','block_fuel','sob_total','atis','tail','flight'];
  const fields = buildReviewFields(parsed, headline);
  const matchedCount = fields.filter(f => f.matched).length;
  $('ocr-review').classList.remove('hidden');
  $('ocr-review').querySelector('p.small').textContent =
    matchedCount > 0
      ? `Matched ${matchedCount} field${matchedCount === 1 ? '' : 's'}. Review, edit, then Apply.`
      : `No fields matched — you can still type them in below, then Apply.`;
  const root = $('ocr-fields');
  root.innerHTML = fields.map(f => `
    <div class="ocr-field${f.matched ? '' : ' unmatched'}" data-key="${f.key}">
      <label>${f.label}</label>
      <input type="text" value="${escapeAttr(f.value)}" data-key="${f.key}" />
    </div>
  `).join('');
}

$('ocr-apply').addEventListener('click', () => {
  const root = $('ocr-fields');
  const out = {};
  root.querySelectorAll('input[data-key]').forEach(inp => {
    const v = inp.value.trim();
    if (v !== '') out[inp.dataset.key] = v;
  });
  if (Object.keys(out).length === 0) {
    toast('Nothing to apply');
    return;
  }
  // tail / flight live in the header (not in data-card FIELDS), so applyExternal
  // would silently drop them. Pull them out and write them directly. Also
  // normalise a 3-letter Israeli-fleet tail suffix to its full 4X-XXX form.
  const headerBag = {};
  if (out.tail) {
    const t = String(out.tail).toUpperCase().replace(/\s+/g, '');
    headerBag.tail = /^[A-Z]{3}$/.test(t) ? '4X-' + t : t;
    delete out.tail;
  }
  if (out.flight) {
    headerBag.flight = String(out.flight).toUpperCase();
    delete out.flight;
  }
  if (Object.keys(headerBag).length) storage.setDataBulk(headerBag);
  const totalApplied = Object.keys(headerBag).length + Object.keys(out).length;
  dataCard.applyExternal(out, dataBody);
  syncHeaderInputs();
  speeches.notifyDataChange();
  hideOverlay('ocr-overlay');
  toast(`Applied ${totalApplied} field${totalApplied === 1 ? '' : 's'}`);
});

function resetOcrOverlay() {
  $('ocr-source').classList.remove('hidden');
  $('ocr-progress').classList.add('hidden');
  $('ocr-review').classList.add('hidden');
  $('ocr-file').value = '';
}

// ---------- History (now the persistent leg list) ----------
// The History card is the single source of truth for which flights are
// remembered. Each row corresponds to one entry in legs[]; tapping the row
// switches to it (same as the leg-switcher's ◀/▶), the trash icon deletes it.
function renderHistory() {
  const legs = storage.getLegs();
  const activeIdx = storage.getLegIndex();
  if (!legs.length) {
    historyBody.innerHTML = `<div class="history-empty">No flights yet. Tap the new-flight button → Paste roster.</div>`;
    return;
  }
  historyBody.innerHTML = legs.map((leg, i) => {
    const id = [leg.tail, leg.flight ? 'LY' + leg.flight : ''].filter(Boolean).join(' · ') || 'Flight';
    const route = (leg.dep && leg.arr) ? `${leg.dep} → ${leg.arr}` : '';
    const when  = (leg.dep_date && leg.dep_time) ? `${leg.dep_date}  ${leg.dep_time}Z` : '';
    const isActive = i === activeIdx;
    return `<div class="history-item${isActive ? ' active' : ''}" data-leg-idx="${i}">
      <div class="hi-top">
        <span class="hi-id">${escapeHtml(id)}</span>
        <span class="hi-date">${escapeHtml(when)}</span>
        <button type="button" class="hi-del" data-leg-del="${i}" title="Delete this flight" aria-label="Delete this flight">🗑</button>
      </div>
      <div class="hi-line">${escapeHtml(route)}${leg.flight_time ? ' · ' + leg.flight_time : ''}</div>
    </div>`;
  }).join('');
  historyBody.querySelectorAll('.history-item').forEach(el => {
    el.addEventListener('click', async (e) => {
      if (e.target.closest('[data-leg-del]')) return;
      const i = parseInt(el.dataset.legIdx, 10);
      await applyLeg(i);
      renderHistory();
    });
  });
  historyBody.querySelectorAll('[data-leg-del]').forEach(b => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const i = parseInt(b.dataset.legDel, 10);
      const leg = storage.getLegs()[i];
      const label = leg ? `LY${leg.flight || ''} ${leg.dep || ''}→${leg.arr || ''}`.trim() : 'this flight';
      if (!confirm(`Delete ${label}?`)) return;
      storage.deleteLeg(i);
      renderHistory();
      renderLegSwitcher();
      syncHeaderInputs();
    });
  });
}

function fmtDateShort(ts) {
  const d = new Date(ts);
  return `${pad(d.getDate())}/${pad(d.getMonth()+1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------- Helpers ----------
function escapeAttr(s) { return String(s).replace(/"/g, '&quot;'); }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch]);
}
