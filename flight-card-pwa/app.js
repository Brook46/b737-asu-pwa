// app.js — bootstrap: theme, header (clocks + tail/flt), sections, overlays, SW.

import * as storage from './modules/storage.js';
import * as dataCard from './modules/data-card.js';
import * as checklist from './modules/checklist.js';
import * as speeches from './modules/speeches.js';
import { lookupRoute, normaliseFlightNumber, displayFlight } from './modules/ly-routes.js';
import { initTheme, cycleTheme, toast, showOverlay, hideOverlay } from './modules/ui.js';
import { rollingTs, rollingYear } from './modules/dates.js';

const $ = (id) => document.getElementById(id);

// ---------- Init theme + register SW ----------
initTheme();
window.fcToast = toast;  // expose for modules that don't import ui

// Safety net for the ~10 dynamic import() chains that have no local catch
// (overlays, calendar sync, sensors). A failed module fetch otherwise dies
// silently in the console and the tapped button just does nothing.
// Throttled: an offline burst shows ONE toast, not ten.
let lastRejToastAt = 0;
window.addEventListener('unhandledrejection', (e) => {
  console.warn('[fc] unhandled rejection', e.reason);
  const now = Date.now();
  if (now - lastRejToastAt > 10_000) {
    lastRejToastAt = now;
    try { toast('Something failed to load — check connection and retry'); } catch {}
  }
});

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
  // -------------- Robust SW update path --------------
  // iOS Safari (especially in installed PWAs) is unreliable about
  // (a) noticing a new sw.js, (b) firing controllerchange, and (c) honoring
  // skipWaiting() called from install. Without belt-AND-braces the pilot
  // ends up with a half-old/half-new shell after every deploy and most
  // buttons appear frozen. We layer four mechanisms:
  //
  //   1. Register, then poll reg.update() every 5 min while the app is
  //      open AND every time the tab becomes visible.
  //   2. On `updatefound`, watch the installing SW. The moment it hits
  //      'installed' (with a current controller present, i.e. there's an
  //      OLD SW), post { type: 'SKIP_WAITING' } so the new SW transitions
  //      to active instead of sitting in `waiting` forever.
  //   3. When the new SW takes over, controllerchange fires → auto-reload.
  //   4. As a fallback the user can always see, surface a tiny floating
  //      "🔄 New version — tap to reload" banner so a single tap finishes
  //      the job manually if iOS swallows controllerchange.
  let __fcReloadingForSwUpdate = false;
  const reloadOnce = () => {
    if (__fcReloadingForSwUpdate) return;
    __fcReloadingForSwUpdate = true;
    setTimeout(() => window.location.reload(), 60);
  };

  function showUpdateBanner() {
    if (document.getElementById('fc-update-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'fc-update-banner';
    banner.className = 'fc-update-banner';
    banner.setAttribute('role', 'status');
    banner.innerHTML = '🔄 <span>New version ready</span> <button type="button" class="fc-update-btn">Reload</button>';
    banner.querySelector('button').addEventListener('click', reloadOnce);
    document.body.appendChild(banner);
  }

  function activateWaitingSW(reg) {
    const waiting = reg?.waiting;
    if (!waiting) return false;
    try { waiting.postMessage({ type: 'SKIP_WAITING' }); } catch {}
    showUpdateBanner();
    return true;
  }

  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');

      // Immediate update check at boot.
      try { await reg.update(); } catch {}

      // Refresh every 5 min so long-lived sessions still notice deploys.
      setInterval(() => { try { reg.update(); } catch {} }, 5 * 60 * 1000);

      // --- Consolidated visibilitychange listener (SW scope) -------------
      // Was three separate listeners (SW update poll, long-resume auto-
      // reload, calendar sync — calendar moved to the module-level handler
      // below). Each branch runs in its own try/catch so a fault in one
      // can't shadow the others. Smaller listener count == smaller target
      // for iOS PWA suspension to detach.
      //
      // iOS's PWA lifecycle aggressively suspends backgrounded apps. When
      // the pilot reopens it after even a few minutes, the JS context can
      // be alive but the top-level addEventListener handlers get detached
      // while delegated handlers on re-rendered children still fire.
      // Symptom: data card body buttons work, header + card-head buttons
      // are frozen. Threshold tuned to be aggressive — the #hard-reload
      // anchor in the header is the always-on backstop if a quick switch
      // triggers an unwanted reload.
      const LONG_AWAY_MS = 5 * 60 * 1000;
      let lastHiddenAt = 0;
      document.addEventListener('visibilitychange', () => {
        const visible = document.visibilityState === 'visible';
        if (!visible) {
          try { lastHiddenAt = Date.now(); } catch {}
          return;
        }
        // SW update check on foreground.
        try { reg.update(); } catch (err) { console.warn('reg.update skipped', err); }
        // Long-resume auto-reload.
        try {
          if (lastHiddenAt) {
            const awayMs = Date.now() - lastHiddenAt;
            lastHiddenAt = 0;
            if (awayMs > LONG_AWAY_MS) reloadOnce();
          }
        } catch (err) { console.warn('long-resume reload skipped', err); }
      });

      // --- pageshow + bfcache ----------------------------------------------
      // iOS Safari can restore the page from the bfcache with persisted=true,
      // which is the textbook "JS context alive but listeners stale" case.
      // A reload here gives us a clean shell.
      window.addEventListener('pageshow', (e) => {
        if (e.persisted) reloadOnce();
      });

      // Already a waiting SW at boot? (Happens when the previous launch
      // installed v(N+1) but the user closed the app before controllerchange.)
      activateWaitingSW(reg);

      // When the registration notices an installing SW, watch it through
      // to 'installed' and then either auto-skip or surface the banner.
      reg.addEventListener('updatefound', () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            activateWaitingSW(reg);
          }
        });
      });
    } catch (err) { console.warn('SW register failed', err); }
  });

  navigator.serviceWorker.addEventListener('controllerchange', reloadOnce);

  // -------------- Freeze detector --------------
  // The "top buttons frozen, body buttons still work" pattern means iOS
  // suspended us and detached top-level event listeners. Pure passive
  // intervals (the 1-second clock tick) usually keep running, but
  // user-driven events don't reach our handlers. We watch for that
  // exact mismatch.
  //
  // Heartbeat: every pointerdown / click / keydown / fresh-visible updates
  // lastInteractionAt. A separate touchstart updates a wantInteractAt
  // timestamp — set ONLY when the pilot's finger touches the screen. If
  // the wantInteractAt is recent (≤ 2 s) but lastInteractionAt is old
  // (> 3 min), the screen is being tapped but no JS sees the events:
  // that's the freeze. Force reload.
  //
  // Conservative thresholds — an idle pilot reading the data card won't
  // trip it (no touches → no wantInteractAt update → no detection).
  let lastInteractionAt = Date.now();
  let wantInteractAt    = 0;
  const interactionEvents = ['pointerdown', 'click', 'keydown'];
  for (const t of interactionEvents) {
    document.addEventListener(t, () => { lastInteractionAt = Date.now(); }, true);
  }
  // touchstart is the "pilot is trying to interact" signal — it fires from
  // the browser's event dispatch even when our addEventListener handlers
  // have been detached.
  document.addEventListener('touchstart', () => {
    wantInteractAt = Date.now();
    lastInteractionAt = Date.now();
  }, true);
  const FREEZE_STALE_MS  = 3 * 60 * 1000;
  const FREEZE_RECENT_MS = 2 * 1000;
  setInterval(() => {
    try {
      if (document.visibilityState !== 'visible') return;
      if (!document.hasFocus()) return;
      const now = Date.now();
      const stale  = now - lastInteractionAt > FREEZE_STALE_MS;
      const tryingNow = now - wantInteractAt < FREEZE_RECENT_MS;
      if (stale && tryingNow) {
        console.warn('[fc] freeze detector tripped — reloading');
        reloadOnce();
      }
    } catch {}
  }, 30 * 1000);

  // Manual escape hatch: long-press the UTC clock (≥ 800 ms) → force reload.
  // The clock is a static <span> with no other event handlers, so this stays
  // tappable even when the rest of the data card / checklist JS is frozen
  // mid-suspension.
  const clockEl = document.getElementById('clock-utc');
  if (clockEl) {
    let pressT = null;
    const clear = () => { if (pressT) { clearTimeout(pressT); pressT = null; } };
    clockEl.addEventListener('pointerdown', () => {
      clear();
      pressT = setTimeout(() => {
        pressT = null;
        // Tiny visual feedback so the pilot knows it fired.
        try { clockEl.style.opacity = '0.4'; } catch {}
        reloadOnce();
      }, 800);
    });
    clockEl.addEventListener('pointerup',    clear);
    clockEl.addEventListener('pointerleave', clear);
    clockEl.addEventListener('pointermove',  (e) => {
      // Any movement cancels — we want a real long-press, not a slow scroll.
      if (Math.abs(e.movementX) > 4 || Math.abs(e.movementY) > 4) clear();
    });
    clockEl.title = 'UTC — long-press to force reload';
  }
}

// ---------- Render shell ----------
const dataBody = $('data-body');
const checklistBody = $('checklist-body');
const historyBody = $('history-body');

// CTOT pill state classes. Declared HERE, above startClocks(), because the
// first synchronous tick reads it — leaving it next to updateCtotColor()
// (its natural home ~250 lines down) puts it in the temporal dead zone and
// every boot tick throws a caught-but-noisy ReferenceError.
const CTOT_CLASSES = ['is-ctot-yellow','is-ctot-green','is-ctot-orange','is-ctot-red'];

renderAll();
startClocks();
syncHeaderInputs();
consumeRosterFromUrl();
// Auto-jump to the leg whose dep → arr+20m window contains "now". 30-second
// cooldown via fc.state.lastBootJumpAt so a quick reload doesn't fight a
// user who just manually picked a different leg.
//
// Deferred to a microtask: the function + its BOOT_JUMP_COOLDOWN_MS const are
// declared further down in this file. Calling synchronously here trips a TDZ
// ReferenceError that **halts the rest of module evaluation** — every
// addEventListener past this point silently never runs. That was the real
// cause of the "top buttons frozen" symptom, not iOS PWA suspension.
queueMicrotask(maybeAutoJumpToCurrentLeg);

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
  // The leg switcher is now ALSO the home for the T/O & LDG role pills
  // (Phase 13). Always visible — even on a single-leg duty — so the pilot
  // can mark roles without digging into the data card. Arrows still hide
  // themselves when there's no neighbour leg.
  sw.classList.remove('hidden');
  const hasMany = legs.length >= 2;
  const idx = storage.getLegIndex();
  const leg = legs[idx] || storage.getCurrent();
  const legInfo = $('leg-pos').parentElement; // .leg-info
  if (legInfo) legInfo.style.display = hasMany ? '' : 'none';
  const ctrls = document.querySelector('.leg-ctrls');
  if (ctrls) ctrls.style.display = hasMany ? '' : 'none';
  if (hasMany) {
    $('leg-pos').textContent = `Leg ${idx + 1} / ${legs.length}`;
    const flight = leg.flight ? displayFlight(leg.flight) : '';
    const route  = (leg.dep && leg.arr) ? `${leg.dep} → ${leg.arr}` : '';
    $('leg-route').textContent = [flight, route].filter(Boolean).join('  ');
    $('leg-prev').disabled = idx <= 0;
    $('leg-next').disabled = idx >= legs.length - 1;
  }
  paintLegRolePills();
}

// Paint the T/O & LDG pills from the active leg's dataCard. Called from
// renderLegSwitcher and after every role-cycle tap so the colour follows
// the value without a full leg re-render.
function paintLegRolePills() {
  const data = storage.getCurrent().dataCard || {};
  for (const [id, key, label] of [
    ['leg-to-role',  'to_role',  'T/O'],
    ['leg-ldg-role', 'ldg_role', 'LDG'],
  ]) {
    const btn = $(id);
    if (!btn) continue;
    const v = String(data[key] || '').toUpperCase();
    btn.classList.toggle('is-pf', v === 'PF');
    btn.classList.toggle('is-pm', v === 'PM');
    btn.classList.toggle('is-none', v !== 'PF' && v !== 'PM');
    btn.innerHTML = `${label}&nbsp;${v || '—'}`;
    btn.setAttribute('aria-label', `${label} role: ${v || 'none'}; tap to cycle`);
  }
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
  // Roster-supplied phones go straight into the global crew registry —
  // calendar wins on every sync, mirroring the crew/flight-time rule.
  if (parsed.phones && typeof parsed.phones === 'object') {
    for (const [canonical, phone] of Object.entries(parsed.phones)) {
      if (phone) storage.setCrewPhone(canonical, phone);
    }
  }
  await applyLeg(newIdx);
  renderHistory();
  toast(rosterToast(added, replaced));
}
function rosterToast(added, replaced) {
  if (added && replaced) return `Added ${added}, updated ${replaced}`;
  if (replaced)          return `Updated ${replaced} flight${replaced === 1 ? '' : 's'}`;
  return `Added ${added} flight${added === 1 ? '' : 's'}`;
}
// Authoritative-sync summary — includes prune count when non-zero so the
// toast is honest about what just happened. Past flown legs are never
// pruned, so this only ever reflects future-leg changes.
function syncSummary({ added, replaced, pruned }) {
  const parts = [];
  if (added)    parts.push(`+${added}`);
  if (replaced) parts.push(`~${replaced}`);
  if (pruned)   parts.push(`−${pruned}`);
  if (!parts.length) return 'Up to date';
  return parts.join(' · ');
}
// leg-prev / leg-next / leg-now are routed via the top-level click dispatch
// (data-action="leg-prev" / "leg-next" / "leg-now").

// Auto-jump to the current-time leg on app launch. Skipped if the user
// manually picked a different leg within the cooldown — that avoids the
// auto-jump fighting a deliberate pick when the user reloads twice in a row.
// Phase 4 will swap the +20-min buffer (inside pickLegForNow) for the actual
// GPS-detected landing time.
const BOOT_JUMP_COOLDOWN_MS = 30 * 1000;
function maybeAutoJumpToCurrentLeg() {
  const legs = storage.getLegs();
  if (legs.length < 2) return;
  const last = Number(storage.getLastBootJumpAt() || 0);
  if (Date.now() - last < BOOT_JUMP_COOLDOWN_MS) return;
  const idx = pickLegForNow();
  if (idx === storage.getLegIndex()) {
    // Already on the right leg — touch the timestamp so a fast reload
    // doesn't recompute on every launch.
    storage.setLastBootJumpAt(Date.now());
    return;
  }
  storage.setLastBootJumpAt(Date.now());
  applyLeg(idx);
}

// Pick the leg whose UTC dep→arr window contains the current wall clock, or
// the next upcoming one if we're between legs. Falls back to leg 0 when the
// roster has no timing data.
function pickLegForNow() {
  const legs = storage.getLegs();
  if (!legs.length) return 0;
  const now = Date.now();
  // dd.mm + HH:MM → ms via the shared rolling-year heuristic (dates.js).
  const toTs = (d, t) => rollingTs(d, t, now);
  // Extend the "active" window 20 min past scheduled arrival so the leg
  // stays selected during taxi-in / chock time and any modest late-arrival
  // slop. Phase 4 swaps the +20 min buffer for the actual GPS-detected
  // landing time, so the same function continues to work — only the
  // upper bound changes.
  const ACTIVE_BUFFER_MS = 20 * 60 * 1000;
  const windows = legs.map((leg, i) => ({
    i,
    dep: toTs(leg.dep_date, leg.dep_time),
    arr: toTs(leg.arr_date, leg.arr_time),
  }));
  // In-progress: now is inside [dep, arr + buffer]
  const active = windows.find(w =>
    Number.isFinite(w.dep) && Number.isFinite(w.arr)
    && w.dep <= now && now <= w.arr + ACTIVE_BUFFER_MS
  );
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
  // Wrap each tick so a single iteration's exception (e.g. a transient
  // storage read failure mid-suspension) can't kill the interval queue.
  // Without this, one bad tick = silently broken clock for the rest of
  // the session and any tickClocks downstream callers go cold.
  const safeTick = () => { try { tickClocks(); } catch (err) { console.warn('tick failed', err); } };
  safeTick();
  setInterval(safeTick, 1000);
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
// (CTOT_CLASSES is declared up next to the render-shell consts — see the
// TDZ note there.)
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
  const ts = rollingTs(d, t, now.getTime());
  return Number.isFinite(ts) && ts < now.getTime();
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
  syncChipTag(routeEl, '.leg-next-tag', 'leg-next-tag', 'CURRENT', isNext);
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
// hdr-ctot-bell is routed via the top-level click dispatch (data-action="ctot-bell").
// Paint the bell once on load so its icon reflects current permission
// + opt-in state (the user may already have granted permission from a
// previous session).
try { paintCtotBell(); } catch (err) { console.warn('bell paint failed', err); }

function formatHHMM(raw) {
  const digits = String(raw || '').replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return digits.slice(0, digits.length - 2) + ':' + digits.slice(-2);
}

// ---------- Top-level click dispatch ----------
// One document-level capture-phase delegate handles every button outside
// the data card / checklist bodies. Replaces ~12 boot-time
// `$('id').addEventListener('click', fn)` calls with one. iOS PWA
// suspension can detach element-bound listeners (the "top buttons frozen,
// inside-card buttons still work" pattern the pilot reports). A single
// document-level listener is a much smaller target — one survivor
// instead of twelve separate points of failure.
const TOP_ACTIONS = {
  'theme':           () => cycleTheme(),
  'new-flight':      () => showOverlay('newflight-overlay'),
  'data-reset-all':  () => doDataResetAll(),
  'checklist-reset': () => doChecklistReset(),
  'checklist-edit':  () => doChecklistEditToggle(),
  'fr24':            () => doFr24(),
  'pa-toggle':       () => speeches.open(),
  'settings':        () => openSettingsSheet(),
  'leg-prev':        () => applyLeg(storage.getLegIndex() - 1),
  'leg-now':         () => applyLeg(pickLegForNow()),
  'leg-next':        () => applyLeg(storage.getLegIndex() + 1),
  'ctot-bell':       () => { try { onBellTap(); } catch (err) { console.warn('bell tap failed', err); } },
};
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const fn = TOP_ACTIONS[btn.dataset.action];
  if (!fn) return;
  e.preventDefault();
  try { fn(e, btn); } catch (err) { console.warn('top action failed', btn.dataset.action, err); }
}, true);

async function doDataResetAll() {
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
}
function doChecklistReset() {
  if (!confirm('Uncheck every item on the checklist?')) return;
  storage.resetTicks();
  checklist.resetOverrides();
  checklist.render(checklistBody);
  toast('Checklist reset');
}
function doChecklistEditToggle() {
  const on = !checklist.isEditMode();
  checklist.setEditMode(on);
  const btn = document.querySelector('[data-action="checklist-edit"]');
  if (btn) {
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.textContent = on ? '✓' : '✎';
    btn.title = on ? 'Done editing' : 'Edit checklist';
  }
  checklist.render(checklistBody);
}
function doFr24() {
  const tail = storage.getCurrent().dataCard.tail || $('hdr-tail').value;
  const reg = normaliseRegistration(tail);
  if (!reg) { toast('Set tail # first'); return; }
  const url = 'https://www.flightradar24.com/data/aircraft/' + encodeURIComponent(reg.toLowerCase());
  window.open(url, '_blank', 'noopener,noreferrer');
}
function openSettingsSheet() {
  showOverlay('settings-overlay');
  try { paintCalendarSection(); } catch (err) { console.warn('cal paint skipped', err); }
  try { paintSensorsPanel(); }   catch (err) { console.warn('sensors paint skipped', err); }
}

// ---------- Header actions ----------
// theme-toggle, new-flight, share-toggle, pa-toggle, fr24-btn → routed via
// data-action delegate above. The remaining overlay close + roster modal
// handlers stay direct since they live inside overlays that get re-rendered.
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

// data-reset-all + checklist-reset are routed via the top-level click
// dispatch (data-action="data-reset-all" / "checklist-reset"). Logic
// lives in doDataResetAll() / doChecklistReset() above.
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
// pa-toggle + share-toggle are routed via the top-level click dispatch.

// ---------- Settings sheet (Calendar sync + AirDrop sync + logbook + analytics) ----------
$('settings-close').addEventListener('click', () => hideOverlay('settings-overlay'));
$('settings-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'settings-overlay') hideOverlay('settings-overlay');
});

// Calendar URL field — autosave to localStorage on every keystroke via
// the calendar module's setCalendarUrl helper. paintCalendarSection
// loads any previously-saved URL back into the field when the sheet opens.
async function paintCalendarSection() {
  const { getCalendarUrl, getLogbookCalendarUrl, getLastSyncAt } =
    await import('./modules/calendar.js');
  const input = $('cal-url');
  if (input && document.activeElement !== input) input.value = getCalendarUrl();
  const logInput = $('cal-url-logbook');
  if (logInput && document.activeElement !== logInput) logInput.value = getLogbookCalendarUrl();
  const status = $('cal-status');
  if (status) {
    status.classList.remove('is-err', 'is-ok');
    const last = getLastSyncAt();
    status.textContent = last
      ? 'Last synced ' + new Date(last).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })
      : '';
  }
}
// Autosave the optional logbook calendar URL too. Identical pattern to
// the duty URL — type=password masks it on screen.
$('cal-url-logbook').addEventListener('input', async () => {
  try {
    const { setLogbookCalendarUrl } = await import('./modules/calendar.js');
    setLogbookCalendarUrl($('cal-url-logbook').value);
  } catch (err) { console.warn('logbook url save failed', err); }
});
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
    const { events, flights, phones } = await cal.syncFromCalendar();
    if (!flights.length) {
      if (source === 'manual') {
        throw new Error(`No flights found in ${events} calendar event${events === 1 ? '' : 's'}`);
      }
      return; // auto: silently no-op when nothing to add
    }
    // Authoritative sync: append/merge incoming, then prune ONLY future
    // legs missing from the duty calendar. Past flown legs and manually-
    // entered legs are always kept. Nothing is ever pushed to the calendar.
    const { index: newIdx, added, replaced, pruned } =
      storage.syncFromCalendar(flights);
    // Calendar phones go into the global crew registry — calendar wins on
    // every sync, matching the Phase 2.1 always-overwrite rule.
    if (phones && typeof phones === 'object') {
      for (const [canonical, phone] of Object.entries(phones)) {
        if (phone) storage.setCrewPhone(canonical, phone);
      }
    }
    await applyLeg(newIdx);
    renderHistory();
    const summary = syncSummary({ added, replaced, pruned });
    if (source === 'manual') {
      if (status) {
        status.classList.add('is-ok');
        status.textContent = `${summary} · ${events} event${events === 1 ? '' : 's'}`;
      }
      toast(summary);
    } else if (added || replaced || pruned) {
      toast(summary + ' (auto-sync)');
    }
    // After every sync — manual or auto — jump to whichever leg's
    // dep → arr + 20 min window contains "now". The cooldown is reset
    // here so the post-sync jump always fires regardless of when the
    // last boot-jump happened.
    try {
      storage.setLastBootJumpAt(0);
      maybeAutoJumpToCurrentLeg();
    } catch (err) { console.warn('post-sync jump skipped', err); }
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
  // Shared rolling-year heuristic — see modules/dates.js.
  return rollingTs(leg?.dep_date, leg?.dep_time);
}
// Boot probe (after a short delay so the rest of the UI is set up first),
// then every 10 minutes, and whenever the tab becomes visible again. Each
// invocation is wrapped so a transient storage / fetch error can't poison
// the interval and freeze subsequent ticks.
const safeAutoSync = () => {
  try { maybeAutoSyncCalendar(); }
  catch (err) { console.warn('calendar auto-sync skipped', err); }
};
setTimeout(safeAutoSync, 5_000);
setInterval(safeAutoSync, 10 * 60 * 1000);
// calendar auto-sync runs from the consolidated module-level visibilitychange
// listener defined below (alongside the GPS re-arm).

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

// Logbook .ics export — every stored leg as one VEVENT. Same Share Sheet
// flow as the AirDrop JSON button above.
$('logbook-export').addEventListener('click', async () => {
  const lb = await import('./modules/logbook.js');
  const legs = lb.allStoredLegs();
  if (!legs.length) {
    toast('No legs to export yet');
    return;
  }
  const ics = lb.buildIcs(legs);
  const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const filename = `flightcard-logbook-${ymd}.ics`;
  const blob = new Blob([ics], { type: 'text/calendar' });
  const file = new File([blob], filename, { type: 'text/calendar' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Flight Card logbook', text: filename });
      return;
    }
  } catch (err) {
    if (err?.name === 'AbortError') return;
    console.warn('share failed, falling back to download', err);
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  toast(`Saved ${legs.length} leg${legs.length === 1 ? '' : 's'} — subscribe in Calendar`);
});

// ---------- Analytics overlay (read-only, computed from stored legs) ----------
$('analytics-open').addEventListener('click', async () => {
  hideOverlay('settings-overlay');
  showOverlay('analytics-overlay');
  const body = $('analytics-body');
  body.innerHTML = '<p class="muted small" style="padding:18px 4px;">Crunching…</p>';
  try {
    const an = await import('./modules/analytics.js');
    const { cityName } = await import('./modules/airports.js');
    const data = an.snapshot();
    body.innerHTML = renderAnalytics(data, { cityName, displayCrew: storage.displayCrew });
  } catch (err) {
    console.warn('analytics render failed', err);
    body.innerHTML = `<p class="muted small">Couldn't compute analytics: ${err?.message || err}</p>`;
  }
});
$('analytics-close').addEventListener('click', () => hideOverlay('analytics-overlay'));
$('analytics-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'analytics-overlay') hideOverlay('analytics-overlay');
});

// ---------- In-app Logbook overlay (Phase 14) ----------
// Read-only list of every stored leg, newest first. Reuses logbook.js's
// allStoredLegs() so the source-of-truth stays consistent with the .ics
// export. Tap a row → switch active leg via applyLeg + close the overlay.
$('logbook-view').addEventListener('click', async () => {
  hideOverlay('settings-overlay');
  showOverlay('logbook-overlay');
  const body = $('logbook-body');
  body.innerHTML = '<p class="lb-empty">Loading…</p>';
  try {
    const lb = await import('./modules/logbook.js');
    const legs = (lb.allStoredLegs() || []).slice().reverse(); // newest first
    body.innerHTML = renderLogbookList(legs);
    wireLogbookRows(body);
  } catch (err) {
    console.warn('logbook view failed', err);
    body.innerHTML = '<p class="lb-empty">Couldn\'t load the logbook.</p>';
  }
});
$('logbook-close').addEventListener('click', () => hideOverlay('logbook-overlay'));
$('logbook-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'logbook-overlay') hideOverlay('logbook-overlay');
});

function lbMonthKey(leg) {
  // dd.mm → "Mon YYYY" bucket via the shared rolling-year heuristic
  // (dates.js), so groupings match the logbook .ics exporter.
  const dm = String(leg.dep_date || '').split('.');
  if (dm.length !== 2) return 'Unknown date';
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const monthIdx = parseInt(dm[1], 10) - 1;
  if (!(monthIdx >= 0 && monthIdx < 12)) return 'Unknown date';
  const year = rollingYear(leg.dep_date);
  if (year == null) return 'Unknown date';
  return `${monthNames[monthIdx]} ${year}`;
}

function renderLogbookList(legs) {
  if (!legs.length) {
    return '<p class="lb-empty">No legs stored yet. Sync your duty calendar or paste a roster from Settings.</p>';
  }
  // Active leg in fc.state.current — for highlighting the row the user
  // currently has open in the data card.
  const activeIdx = storage.getLegIndex();
  const activeLeg = (storage.getLegs() || [])[activeIdx];
  const activeKey = activeLeg ? `${activeLeg.flight}|${activeLeg.dep_date}|${activeLeg.dep}|${activeLeg.arr}` : '';
  let lastMonth = '';
  const parts = [];
  for (const leg of legs) {
    const monthH = lbMonthKey(leg);
    if (monthH !== lastMonth) {
      parts.push(`<div class="lb-month-h">${esc(monthH)}</div>`);
      lastMonth = monthH;
    }
    const dm = String(leg.dep_date || '').split('.');
    const day = dm[0] || '—';
    const mon = dm[1] || '';
    // displayFlight already prepends the ELY callsign — don't double-stamp.
    const flight = leg.flight ? displayFlight(leg.flight) : 'Flight';
    const route = (leg.dep && leg.arr) ? `${leg.dep} → ${leg.arr}` : '—';
    const time = (leg.dep_time && leg.arr_time) ? `${leg.dep_time}–${leg.arr_time}Z` : '';
    const d = leg.dataCard || {};
    const actual = d.actual_flight_time || d.block_time || leg.flight_time || '';
    const toR  = String(d.to_role  || '').toUpperCase();
    const ldgR = String(d.ldg_role || '').toUpperCase();
    const tags = [
      toR  ? `<span class="lb-tag ${toR === 'PF' ? 'is-pf' : toR === 'PM' ? 'is-pm' : ''}">T/O ${toR}</span>` : '',
      ldgR ? `<span class="lb-tag ${ldgR === 'PF' ? 'is-pf' : ldgR === 'PM' ? 'is-pm' : ''}">LDG ${ldgR}</span>` : '',
      actual ? `<span class="lb-tag">${esc(actual)}</span>` : '',
    ].filter(Boolean).join('');
    const key = `${leg.flight}|${leg.dep_date}|${leg.dep}|${leg.arr}`;
    const isActive = key === activeKey;
    parts.push(`
      <button type="button" class="lb-row${isActive ? ' is-active' : ''}"
              data-flight="${esc(leg.flight || '')}"
              data-dep-date="${esc(leg.dep_date || '')}"
              data-dep="${esc(leg.dep || '')}"
              data-arr="${esc(leg.arr || '')}">
        <span class="lb-date"><span class="lb-day">${esc(day)}</span>${esc(mon)}</span>
        <span class="lb-mid">
          <div class="lb-flight">${esc(flight)}</div>
          <div class="lb-route">${esc(route)}${time ? '  ·  ' + esc(time) : ''}</div>
        </span>
        <span class="lb-tags">${tags}</span>
      </button>
    `);
  }
  return parts.join('');
}

function wireLogbookRows(body) {
  body.addEventListener('click', (e) => {
    const row = e.target.closest('.lb-row');
    if (!row) return;
    e.preventDefault();
    // Find the matching leg in the active duty's legs[] — only those can
    // be made the active leg via the leg switcher. Historical flights live
    // in fc.state.history and aren't directly addressable; tapping one of
    // those rows is a read-only ack.
    const legs = storage.getLegs() || [];
    const idx = legs.findIndex(l =>
      String(l.flight || '') === row.dataset.flight &&
      String(l.dep_date || '') === row.dataset.depDate &&
      String(l.dep || '') === row.dataset.dep &&
      String(l.arr || '') === row.dataset.arr
    );
    if (idx >= 0) {
      hideOverlay('logbook-overlay');
      applyLeg(idx);
    } else {
      toast('From a previous duty — view only');
    }
  }, { once: false });
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, ch =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
}

// Tiny inline-SVG renderer for a horizontal bar list. No chart library —
// keeps the bundle thin and the visual consistent with the rest of the
// app's flat style.
function renderBars(rows, opts = {}) {
  if (!rows.length) {
    return `<p class="an-empty">${esc(opts.emptyMsg || 'Not enough data yet — fly more flights.')}</p>`;
  }
  const max = Math.max(1, ...rows.map(r => r.count));
  const html = rows.map(r => {
    const pct = Math.round((r.count / max) * 100);
    return `
      <div class="an-bar-row">
        <div>
          <span class="an-bar-label">${esc(r.label)}</span>
          ${r.sub ? `<span class="an-bar-sub">${esc(r.sub)}</span>` : ''}
        </div>
        <div class="an-bar-track"><div class="an-bar-fill" style="width:${pct}%"></div></div>
        <span class="an-bar-count">${r.count}</span>
      </div>
    `;
  }).join('');
  return `<div class="an-bars">${html}</div>`;
}

function renderAnalytics(data, { cityName, displayCrew }) {
  if (!data.legCount) {
    return `
      <p class="muted small" style="padding:18px 4px;">
        No legs stored yet. Once your calendar syncs or you paste a roster, your
        analytics appear here.
      </p>`;
  }
  // Top destinations
  const topRows = data.top.map(d => ({
    label: d.icao,
    sub:   cityName(d.icao) || '',
    count: d.count,
  }));
  // Tail breakdown chips
  const tailChips = data.hours.byTail
    .slice(0, 5)
    .map(t => `<span class="an-tail-chip"><strong>${esc(t.tail)}</strong> ${esc(t.label)}</span>`)
    .join('');
  // Landing G split
  const g = data.g || {};
  let gContent = '';
  if (!g.pf && !g.pm) {
    gContent = `<p class="an-empty">Fly some legs with T/O · LDG roles tagged + landing G logged.</p>`;
  } else {
    const tile = (entry, role) => entry
      ? `<div class="an-g-tile is-${role.toLowerCase()}">
          <div class="an-g-role">${role}</div>
          <div class="an-g-num">${entry.avg.toFixed(2)} G</div>
          <div class="an-g-count">${entry.count} landing${entry.count === 1 ? '' : 's'}</div>
        </div>`
      : `<div class="an-g-tile is-${role.toLowerCase()}">
          <div class="an-g-role">${role}</div>
          <div class="an-g-num">—</div>
          <div class="an-g-count">No data</div>
        </div>`;
    const delta = (g.pf && g.pm)
      ? `<div class="an-delta">PF avg is ${(g.pf.avg - g.pm.avg).toFixed(2)} G ${
          g.pf.avg >= g.pm.avg ? 'higher' : 'lower'} than PM</div>`
      : '';
    gContent = `<div class="an-g-split">${tile(g.pf, 'PF')}${tile(g.pm, 'PM')}</div>${delta}`;
  }
  // Most flown with — bars; labels through displayCrew so nicknames show.
  const crewRows = data.crew.map(c => ({
    label: displayCrew(c.name) || c.name,
    sub:   '',
    count: c.count,
  }));

  return `
    <div class="an-card">
      <h4>Top destinations (${data.year})</h4>
      ${renderBars(topRows, { emptyMsg: 'No non-home arrivals yet this year.' })}
    </div>
    <div class="an-card">
      <h4>Nights away from home (${data.year})</h4>
      <div class="an-big">${data.nights}</div>
      <div class="an-big-sub">distinct calendar days with at least one non-TLV leg</div>
    </div>
    <div class="an-card">
      <h4>Hours flown YTD (${data.year})</h4>
      <div class="an-big">${esc(data.hours.totalLabel)}</div>
      <div class="an-big-sub">prefers actual flight time when set, then block, then scheduled</div>
      ${tailChips ? `<div class="an-tails">${tailChips}</div>` : ''}
    </div>
    <div class="an-card">
      <h4>Landing G — PF vs PM (${data.year})</h4>
      ${gContent}
    </div>
    <div class="an-card">
      <h4>Most flown with (${data.year})</h4>
      ${renderBars(crewRows, { emptyMsg: 'No crew on file yet for this year.' })}
    </div>
  `;
}

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
// fr24-btn is routed via the top-level click dispatch (data-action="fr24");
// logic in doFr24() above.
$('pa-close').addEventListener('click', () => speeches.close());

$('pa-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'pa-overlay') speeches.close();
});

// ---------- Settings → Sensors panel + GPS / Motion permission flow ----------
// Module-scoped GPS + motion handles so boot-arm and disarm cooperate cleanly.
let gpsMod = null;  // lazily imported gps module
let gMod   = null;  // lazily imported g module
let gpsActive = false;
async function loadSensorMods() {
  if (!gpsMod) gpsMod = await import('./modules/gps.js');
  if (!gMod)   gMod   = await import('./modules/g.js');
  return { gps: gpsMod, g: gMod };
}

async function paintSensorsPanel() {
  const { gps, g } = await loadSensorMods();
  const rows = document.querySelectorAll('#sensors-grid .sensor-row');
  // Geolocation — cachedPermission() prefers the Permissions API where
  // available, so opening Settings never triggers an iOS prompt.
  const geoState = gps.isSupported() ? await gps.cachedPermission() : 'denied';
  setSensorRow(rows, 'geolocation', geoState);
  // Motion — uses our own localStorage cache because iOS doesn't expose
  // the DeviceMotion permission via the Permissions API.
  const motState = g.cachedPermission();
  setSensorRow(rows, 'motion', motState);
}

function setSensorRow(rows, name, state) {
  for (const row of rows) {
    if (row.dataset.sensor !== name) continue;
    row.dataset.permission = state;
    const label = row.querySelector('.sensor-state');
    label.dataset.state = state;
    label.textContent = state === 'granted' ? 'On' : state === 'denied' ? 'Off' : 'Tap to allow';
    const btn = row.querySelector('.sensor-btn');
    btn.textContent = state === 'denied' ? 'Open iOS Settings' : 'Request';
  }
}

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-sensor-req]');
  if (!btn) return;
  const { gps, g } = await loadSensorMods();
  const which = btn.dataset.sensorReq;
  let state = 'denied';
  if (which === 'geolocation') state = await gps.requestPermission();
  else if (which === 'motion') state = await g.requestPermission();
  setSensorRow(document.querySelectorAll('#sensors-grid .sensor-row'), which, state);
  // Granted geolocation should immediately arm the detector if the active
  // leg is in its window.
  if (state === 'granted' && which === 'geolocation') tryArmGps();
});

// ---------- Landing score modal ----------
function showLandingScore(maxG, leg) {
  const sheet = document.querySelector('#landing-overlay .landing-sheet');
  const gEl   = $('landing-g');
  const vEl   = $('landing-verdict');
  const mEl   = $('landing-meta');
  let score = 'good', verdict = 'Good — coffee on me';
  if (maxG == null) {
    score = '';
    verdict = 'No motion data — manually log if needed';
  } else if (maxG > 1.6) {
    score = 'poor'; verdict = 'Poor — buy the cabin coffee';
  } else if (maxG > 1.3) {
    score = 'ok';   verdict = 'OK — typical';
  } else {
    score = 'good'; verdict = 'Good — smooth touchdown';
  }
  sheet.dataset.score = score;
  gEl.textContent = (maxG != null) ? maxG.toFixed(2) + ' G' : '— G';
  vEl.textContent = verdict;
  const d = leg?.dataCard || {};
  const lines = [];
  if (d.actual_flight_time) lines.push(`Actual flight time: ${d.actual_flight_time}`);
  if (d.block_time)         lines.push(`Block: ${d.block_time}`);
  if (d.ldg_role)           lines.push(`Landing role: ${d.ldg_role}`);
  mEl.textContent = lines.join('\n');
  showOverlay('landing-overlay');
}
$('landing-close').addEventListener('click', () => hideOverlay('landing-overlay'));
$('landing-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'landing-overlay') hideOverlay('landing-overlay');
});

// ---------- Boot-time GPS arming + visibility handler ----------
// Arm only when:
//   1. We have permission already (no surprise prompts on boot).
//   2. The active leg has a sane dep_time/arr_time window.
//   3. "Now" sits inside [dep_time, arr_time + 30 min].
// The detector itself writes takeoff_at / landing_at to leg.dataCard so a
// reload mid-flight resumes from the right phase.
function activeLegInWindow() {
  const leg = storage.getLeg();
  if (!leg) return null;
  const depIso = utcLegDate(leg.dep_date, leg.dep_time);
  const arrIso = utcLegDate(leg.arr_date, leg.arr_time);
  if (!depIso || !arrIso) return null;
  const now = Date.now();
  const dep = Date.parse(depIso);
  const arr = Date.parse(arrIso) + 30 * 60 * 1000; // +30 min taxi-in
  if (!Number.isFinite(dep) || !Number.isFinite(arr)) return null;
  return (now >= dep - 30 * 60 * 1000 && now <= arr) ? leg : null;
}
function utcLegDate(ddmm, hhmm) {
  if (!ddmm || !hhmm) return '';
  const [dd, mm] = String(ddmm).split('.');
  if (!dd || !mm) return '';
  const y = new Date().getUTCFullYear();
  return `${y}-${mm}-${dd}T${hhmm}:00Z`;
}

async function tryArmGps() {
  const leg = activeLegInWindow();
  if (!leg) return;
  const { gps, g } = await loadSensorMods();
  const state = await gps.requestPermission();
  if (state !== 'granted') return;
  if (gpsActive) gps.disarm();
  gpsActive = true;
  gps.arm(leg, (kind, payload) => {
    if (kind === 'airborne') {
      // Start motion capture for the touchdown window. Permission may not
      // have been granted yet — start() silently no-ops if not supported.
      g.start();
      toast('Airborne — GPS logging flight time');
    } else if (kind === 'landed') {
      const peak = g.peakG(payload.landing_at, 10);
      g.stop();
      if (peak != null) {
        storage.setDataField('max_g', peak.toFixed(2));
      }
      dataCard.render(dataBody);
      showLandingScore(peak, storage.getLeg());
      gpsActive = false;
    } else if (kind === 'error') {
      console.warn('GPS detector error', payload);
    }
  });
}
// --- Consolidated module-level visibilitychange listener ------------------
// Was two listeners (calendar auto-sync re-fire + GPS arm on resume). Now
// one ordered try/catch chain. See the SW-scope handler above for the
// other half (SW update + long-resume reload).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  try { safeAutoSync(); } catch (err) { console.warn('auto-sync skipped', err); }
  try { tryArmGps(); }   catch (err) { console.warn('gps arm skipped', err); }
});
// Boot — fire after the initial auto-jump so the leg is settled.
setTimeout(tryArmGps, 2_000);

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
// Big letter tap → toggle the manual A–Z strip back into view (override).
$('wx-letter').addEventListener('click', () => {
  const popup = document.getElementById('wx-overlay');
  if (!popup) return;
  popup.classList.toggle('wx-show-manual');
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

// Per-chip ↻ refresh — delegated on the source row so each Dep/Arr/Other chip
// gets its own refresh control right next to the airport code. Tap forces a
// fresh fetch for that airport (switching the active source first if needed).
// Listening on 'pointerdown' with capture so we stop the event before the
// parent <button class="wx-src"> sees a click and triggers a plain source-
// switch (which only honours the WX cache).
document.querySelector('.wx-src-row').addEventListener('pointerdown', (e) => {
  const r = e.target.closest('.wx-src-refresh');
  if (!r) return;
  e.preventDefault();
  e.stopPropagation();
  const src = r.dataset.refresh;
  // Skip if the chip is disabled (no airport set yet).
  if (src === 'dep' && $('wx-src-dep').disabled) return;
  if (src === 'arr' && $('wx-src-arr').disabled) return;
  if (wxSource !== src) {
    wxSource = src;
    paintWxSrcRow();
  }
  // Visual spin on the tapped icon — animation auto-clears, but we strip the
  // class on animationend so a quick re-tap can re-trigger it.
  r.classList.remove('spinning');
  // Force a reflow so a repeated add restarts the animation.
  void r.offsetWidth;
  r.classList.add('spinning');
  r.addEventListener('animationend', () => r.classList.remove('spinning'), { once: true });
  loadWx({ force: true });
}, true);

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
  // Pick a default source: whichever matches the sticky atis_icao first, so
  // re-opening the popup lands on the airport the user last looked at. If
  // nothing matches, fall back to dep → arr → custom.
  const sticky = (d.atis_icao || '').toString().toUpperCase();
  const depCode = (d.dep || '').toString().toUpperCase();
  const arrCode = (d.arr || '').toString().toUpperCase();
  if (sticky && sticky === depCode) wxSource = 'dep';
  else if (sticky && sticky === arrCode) wxSource = 'arr';
  else if (sticky) { wxSource = 'custom'; wxCustomCode = sticky; }
  else if (depCode) wxSource = 'dep';
  else if (arrCode) wxSource = 'arr';
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
  // Reset the manual-override hint so the next open starts in default mode.
  document.getElementById('wx-overlay')?.classList.remove('wx-show-manual');
  // Persist whichever source the popup last showed onto the data card so the
  // ATIS chip on the main screen flips to that airport. Latest-source-wins
  // semantics — one chip, one ICAO + letter at a time.
  const code = resolveWxCode();
  const letter = (wxDisplayLetter || '').toString().toUpperCase().slice(0, 1);
  if (code) {
    const prev = storage.getCurrent().dataCard;
    if (letter !== prev.atis) {
      storage.setDataField('atis', letter);
      storage.setDataField('atis_read', '');
    }
    if (code !== (prev.atis_icao || '')) {
      storage.setDataField('atis_icao', code);
    }
    dataCard.render(dataBody);
  }
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
    // The popup shows whichever letter D-ATIS just returned (or the existing
    // card letter when source=Dep and no live letter yet). The data card's
    // ATIS chip isn't written here — closeWx() commits whatever source the
    // popup was last on so the chip flips on close, not on every refresh.
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
  // Hide the manual A–Z chip strip when D-ATIS has already supplied a letter
  // — the strip is fallback noise in that case. Reveal it again on tap of
  // the big letter via the override toggle below.
  const popup = document.getElementById('wx-overlay');
  if (popup) popup.classList.toggle('wx-has-letter', !!letter);
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
  // The METAR cell's label and body track the dep airport, so repaint it
  // when dep changes. Surgical swap avoids stealing focus from the dep
  // input mid-type.
  if (key === 'dep') {
    dataCard.paintMetar(dataBody);
  }
  // NB: Do not re-render the data card here. Previously this fired on every
  // dep keystroke and destroyed the focused input mid-type — only the first
  // letter ever made it in. The ATIS cell will resync on its next render
  // (when the popup is opened or the group is toggled).
  speeches.notifyDataChange();
});

// ---------- PF / PM role tri-state ----------
// Tap cycles: '' → PF → PM → '' (none). Delegated at DOCUMENT level so the
// two pills in the leg-switcher and any future legacy pills inside the
// data card both work through a single handler. Lives on the active leg's
// dataCard; never sync-overwritten — the calendar doesn't carry the PF/PM
// split.
const ROLE_CYCLE = { '': 'PF', 'PF': 'PM', 'PM': '' };
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-role-key]');
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  const key = btn.dataset.roleKey;
  const cur = (storage.getCurrent().dataCard[key] || '').toString().toUpperCase();
  const next = ROLE_CYCLE[cur] || '';
  storage.setDataField(key, next);
  paintLegRolePills();
  // The data card no longer carries these pills (Phase 13), but if a future
  // panel exposes them again, a render keeps them in sync.
  dataCard.render(dataBody);
});

// ---------- Per-crew chip row (✎ edit · 💬 WhatsApp · ⏱ last flight) ----------
// Delegated to dataBody so the handlers survive every data card re-render.
// The chips live inside the cell's <label>; preventDefault stops the click
// from focusing the underlying readonly input on iOS.
dataBody.addEventListener('click', (e) => {
  const chip = e.target.closest('[data-crew-action]');
  if (!chip) return;
  e.preventDefault();
  e.stopPropagation();
  const wrap = chip.closest('[data-crew-name]');
  const name = wrap?.dataset.crewName;
  if (!name) return;
  const action = chip.dataset.crewAction;
  if (action === 'edit')        promptCrewEdit(name);
  else if (action === 'whatsapp') openWhatsApp(name);
  else if (action === 'lastflight') showLastFlightWith(name);
});

function promptCrewEdit(name) {
  const entry = storage.getCrew(name) || { nickname: '', phone: '' };
  const nick = window.prompt(
    `Nickname for ${name}\n(empty to clear and use the canonical name)`,
    entry.nickname || ''
  );
  if (nick === null) return; // Cancel — leave both fields alone
  storage.setCrewNickname(name, nick);
  const phone = window.prompt(
    `Phone for ${name} (E.164 format, e.g. +972541234567)\n(empty to clear)`,
    entry.phone || ''
  );
  if (phone !== null) storage.setCrewPhone(name, phone);
  dataCard.render(dataBody);
  speeches.notifyDataChange();
}

function openWhatsApp(name) {
  const entry = storage.getCrew(name);
  const phone = entry?.phone || '';
  if (!phone) {
    // No phone yet — jump straight to the editor so the tap isn't a no-op.
    promptCrewEdit(name);
    return;
  }
  // wa.me wants digits only.
  const digits = phone.replace(/[^\d]/g, '');
  if (!digits) {
    toast(`Phone for ${name} doesn't look valid`);
    return;
  }
  window.location.href = 'https://wa.me/' + digits;
}

function showLastFlightWith(name) {
  const legs = storage.allLegsWith(name);
  const disp = storage.displayCrew(name);
  $('crewlog-title').textContent = `Flights with ${disp}`;
  const body = $('crewlog-body');
  if (!legs.length) {
    body.innerHTML = `<p class="muted small crewlog-empty">No prior flights with ${escapeHtmlSimple(disp)} yet.</p>`;
  } else {
    const rows = legs.map(leg => {
      const d = leg.dataCard || {};
      const ely   = leg.flight ? `ELY${escapeHtmlSimple(leg.flight)}` : '—';
      const route = (leg.dep && leg.arr)
        ? `${escapeHtmlSimple(leg.dep)} → ${escapeHtmlSimple(leg.arr)}`
        : '—';
      const date  = leg.dep_date ? escapeHtmlSimple(leg.dep_date) : '';
      const toR   = d.to_role  ? escapeHtmlSimple(d.to_role)  : '';
      const ldgR  = d.ldg_role ? escapeHtmlSimple(d.ldg_role) : '';
      const role  = (toR || ldgR)
        ? `<span class="crewlog-role">T/O ${toR || '—'} · LDG ${ldgR || '—'}</span>`
        : '';
      return `
        <div class="crewlog-row">
          <span class="crewlog-flight">${ely}</span>
          <span class="crewlog-route">${route}</span>
          <span class="crewlog-date">${date}</span>
          ${role}
        </div>`;
    }).join('');
    body.innerHTML = `
      <p class="muted small crewlog-count">${legs.length} flight${legs.length === 1 ? '' : 's'} together</p>
      <div class="crewlog-list">${rows}</div>`;
  }
  showOverlay('crewlog-overlay');
}
function escapeHtmlSimple(s) {
  return String(s).replace(/[&<>"']/g, ch =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
}
$('crewlog-close').addEventListener('click', () => hideOverlay('crewlog-overlay'));
$('crewlog-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'crewlog-overlay') hideOverlay('crewlog-overlay');
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
// checklist-edit is routed via the top-level click dispatch
// (data-action="checklist-edit"); logic in doChecklistEditToggle() above.

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
