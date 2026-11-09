// app.js — bootstrap: theme, header (clocks + tail/flt), sections, overlays, SW.

import { DUTY_KINDS } from './modules/duties.js?v=262';
import { CREW_KEYS, crewShort, crewLabel, slotsToShow } from './modules/crew.js?v=262';
import * as storage from './modules/storage.js?v=262';
import * as socialChanges from './modules/social-changes.js?v=262';
import * as dataCard from './modules/data-card.js?v=262';
import * as checklist from './modules/checklist.js?v=262';
import * as speeches from './modules/speeches.js?v=262';
import { lookupRoute, normaliseFlightNumber, displayFlight } from './modules/ly-routes.js?v=262';
import { autoPhase } from './modules/phase.js?v=262';
import { initTheme, cycleTheme, setTheme, toast, showOverlay, hideOverlay, raiseOverlay } from './modules/ui.js?v=262';
import { rollingTs, dateTs, yearOf, yearPast, legTs, legPlanActual } from './modules/dates.js?v=262';

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
      // Keep the Airspeed Unreliable app saved inside Flight Card too, so it
      // opens with no internet (see openEmbedded).
      registerAsuWorker();

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
let metarTypeTimer = 0;   // debounces the METAR fetch while a Dep is typed
const checklistBody = $('checklist-body');
const historyBody = $('history-body');

// How many past flights the card shows before the "show all" tap. A backfilled
// logbook is hundreds of sectors; rendering them all every repaint makes the
// card the slowest thing on the screen for no benefit.
const HIST_PAST_PAGE = 25;
let histShowAllPast = false;
// A PDF already built for "Share as PDF", kept when iOS refused the share
// because the tap had gone stale. Declared up here, not beside its handler:
// paintPrintPreview reads it too, and a let still in its temporal dead zone
// throws even under typeof.
let pdfReady = null;
let ftlIdx = null, ftlOpts = {}, ftlShown = null, ftlMode = 'mine';   // Flight time limits sheet: duty shown, hand-set options
let pdfModule = null;   // print-pdf.js once loaded, so a ready PDF shares with no await first
// Social-note highlighter: the last selection made inside the Social note, as
// character offsets. Kept because on iPad, tapping a colour button can clear
// the live selection before the tap lands.
// Notes highlighter brush (see "Highlighter brush" below): declared up here,
// with the state above, so nothing at boot can meet them uninitialised.
let shownSocial = null;             // the Social note text on screen (setSocialHtml)
let myNoteId = '';                  // the Notes tab's note on screen
let myNotesEditing = false;         // Notes tab: Edit on (drag / rename / delete tabs)
let brush = null;                   // 'yellow' | 'green' | 'pink' | 'blue' | 'erase' | null
let brushHist = { undo: [], redo: [] };

const HL_KEY = 'fc.social.highlights';   // this device's Social-note highlights
// A note holding real tags (old rich-text form), not just a '<' — see noteToHtml.
const NOTE_HTML_RE = /<(?:br|div|p|span|b|i|u|strong|em|font|mark)\b[^>]*>/i;


// CTOT pill state classes. Declared HERE, above startClocks(), because the
// first synchronous tick reads it — leaving it next to updateCtotColor()
// (its natural home ~250 lines down) puts it in the temporal dead zone and
// every boot tick throws a caught-but-noisy ReferenceError.
const CTOT_CLASSES = ['is-ctot-yellow','is-ctot-green','is-ctot-orange','is-ctot-red'];
// When the pilot last chose a leg themselves (arrows, History, logbook,
// flight number). For 30 minutes after, syncs and the boot jump leave that
// leg on screen instead of jumping to "the leg for now" — opening last
// month's flight and having an auto-sync whisk it away was the bug. Declared
// up here because boot-time code reads it.
let manualLegPickAt = 0;
// The pilot's own choice of phase: { leg, phase }, for that leg only. Declared
// up here because the boot-time renderLegSwitcher reads it.
let phaseHold = null;
try { phaseHold = JSON.parse(localStorage.getItem('fc.phaseHold') || 'null'); } catch {}
let dockedKey = '';      // the leg Route info is showing for in the In flight tab
// The checklist as a floating window: stays that way, and on top of every
// screen, until switched back. { on, open, x, y } on this device.
let floatPref = { on: false, open: false, x: 0, y: 0 };
try { floatPref = { ...floatPref, ...JSON.parse(localStorage.getItem('fc.checklistFloat') || '{}') }; } catch {}
const MANUAL_LEG_HOLD_MS = 30 * 60 * 1000;
function pickLeg(idx) { manualLegPickAt = Date.now(); return applyLeg(idx); }
function holdingManualLeg() { return Date.now() - manualLegPickAt < MANUAL_LEG_HOLD_MS; }

dataCard.setWxNode($('before-wx'));
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
// Logbook auto-push (hosted .ics the calendar apps subscribe to) — wired
// off the critical path; the module further defers its first push by 8s
// and only hits the network when the calendar content actually changed.
import('./modules/logbook-push.js?v=262').then(m => m.init())
  .catch(err => console.warn('logbook-push init failed', err));
// If this load came from tapping the header ↻, refresh every remote source
// too. Deferred so it never competes with first paint (and so the functions
// it calls are long past their declarations — see the TDZ note above).
setTimeout(() => {
  try { consumeSyncAfterReload(); }
  catch (err) { console.warn('post-reload sync skipped', err); }
}, 1_200);

// If the user just shared roster text via the iOS Share Sheet → share-roster.html,
// it bounces back to ./?roster=<encoded>. Parse and apply, then strip the URL.
async function consumeRosterFromUrl() {
  const q = new URLSearchParams(location.search);
  const raw = q.get('roster');
  if (!raw) return;
  try {
    const { parseRoster } = await import('./modules/roster.js?v=262');
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
  // Date + scheduled UTC off-blocks, not "Leg 86 / 86" — the position in a
  // long list says nothing about the flight, whereas the date and STD are what
  // identify it. The year is appended only when the leg is NOT in the current
  // year, so the common case stays short and an old leg is still unambiguous.
  // Falls back to the leg count when a leg has no schedule at all, rather than
  // leaving the slot blank.
  const legPos = $('leg-pos');
  if (legPos) {
    let label = '';
    if (leg.dep_date) {
      label = `${legDateLabel(leg.dep_date, leg.dep_year)}${leg.dep_time ? '  ' + leg.dep_time + 'Z' : ''}`;
    } else if (hasMany) {
      label = `Leg ${idx + 1} / ${legs.length}`;
    }
    legPos.textContent = label;
    legPos.style.display = label ? '' : 'none';
  }
  const ctrls = document.querySelector('.leg-ctrls');
  if (ctrls) ctrls.style.display = hasMany ? '' : 'none';
  if (hasMany) {
    $('leg-prev').disabled = idx <= 0;
    $('leg-next').disabled = idx >= legs.length - 1;
  }
  // Flight number + tappable Dep / Arr codes.
  const flightNo = $('leg-flightno');
  if (flightNo) flightNo.textContent = leg.flight ? displayFlight(leg.flight) : '';
  const dep = String(leg.dep || '').toUpperCase();
  const arr = String(leg.arr || '').toUpperCase();
  const depBtn = $('leg-dep'), arrBtn = $('leg-arr'), arrow = $('leg-arrow');
  if (depBtn) { depBtn.textContent = dep || '—'; depBtn.dataset.airport = dep; depBtn.hidden = !dep; }
  if (arrBtn) { arrBtn.textContent = arr || '—'; arrBtn.dataset.airport = arr; arrBtn.hidden = !arr; }
  if (arrow) arrow.hidden = !(dep && arr);
  try { paintSocialDots(); } catch {}
  paintLegRolePills();
  paintTlvBoard();
  paintFdpChip();
  try { dataCard.refreshMetar(dataBody); } catch {}
  paintReadyLine();
  try { paintPhase(); } catch (err) { console.warn('phase paint skipped', err); }
}

// ---------- The tabs: Brief, In flight ----------
// A flight opens on the tab time and GPS choose (modules/phase.js); a tap holds
// another for this leg, and tapping the one they'd choose hands it back.
// Everything's a function declaration: this runs during boot.
function legPhase() {
  const leg = storage.getLegs()[storage.getLegIndex()] || null;
  const auto = autoPhase(leg, storage.getCurrent().dataCard);
  const held = leg && phaseHold && phaseHold.leg === lbKeyOf(leg) ? phaseHold.phase : '';
  return { leg, auto, phase: ['before', 'air'].includes(held) ? held : auto };
}
function setPhase(phase, focus = '') {
  const { leg, auto, phase: was } = legPhase();
  phaseHold = leg && phase !== auto ? { leg: lbKeyOf(leg), phase } : null;
  try {
    if (phaseHold) localStorage.setItem('fc.phaseHold', JSON.stringify(phaseHold));
    else localStorage.removeItem('fc.phaseHold');
  } catch {}
  if (!floatPref.on) setChecklistOpen(false);
  if (dataCard.isEditing()) { dataCard.setEditing(false); $('data-edit').setAttribute('aria-pressed', 'false'); }
  if (phase === was && phase !== 'air') window.scrollTo({ top: 0, behavior: 'smooth' });
  paintPhase(focus, true);
}
function paintPhase(focus = '', tapped = false) {
  const { leg, phase } = legPhase();
  // The clock never changes the tab under someone typing.
  const shown = document.body.dataset.phase;
  const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || '');
  if (!tapped && shown && shown !== phase && typing) return;
  document.body.dataset.phase = phase;
  paintTabs();
  const routed = !!(leg && leg.dep && leg.arr);
  $('phase-air').hidden = phase !== 'air' || routed;
  syncRouteDock(phase === 'air' && routed ? lbKeyOf(leg) : '', focus);
  $('before-wx').hidden = phase !== 'before';
  if (phase === 'before') paintBeforeWx(leg);
}
function paintTabs() {
  const open = !$('card-checklist').hidden;
  const page = open && !floatPref.on;   // a floating checklist leaves the screen under it the current tab
  const phase = document.body.dataset.phase;
  $('tab-checklist').classList.toggle('is-on', open);
  document.querySelectorAll('[data-phase-set]').forEach(b => {
    b.classList.toggle('is-on', !page && b.dataset.phaseSet === phase);
  });
}
async function syncRouteDock(key, focus) {
  if (key === dockedKey && !focus) return;
  const was = dockedKey;
  dockedKey = key;
  try {
    const ru = await import('./modules/route-ui.js?v=262');
    ru.wire();
    if (key && key === was) ru.focusAirport(focus);
    else if (key) await ru.dock({ focus });
    else if (was) ru.undock();
  } catch (err) { console.warn('route tab failed', err); toast('Route info failed to load'); }
}
// Opened over the In flight tab and now closed: the tab comes back.
window.addEventListener('fc:route-closed', () => { dockedKey = ''; paintPhase(); });
// An alternate set from Route info: show it on the Brief at once.
window.addEventListener('fc:altn-changed', () => {
  altnEditing = false;
  try { paintBeforeWx(storage.getLegs()[storage.getLegIndex()] || null); } catch {}
});

// The alternate, chosen by hand per destination and kept on this device:
// Porto's is there on every Porto flight until it's changed.
const ALTN_KEY = 'fc.altn';
function altnFor(arr) {
  try { return (JSON.parse(localStorage.getItem(ALTN_KEY) || '{}'))[arr] || ''; } catch { return ''; }
}
function setAltn(arr, code) {
  try {
    const all = JSON.parse(localStorage.getItem(ALTN_KEY) || '{}');
    if (code) all[arr] = code; else delete all[arr];
    localStorage.setItem(ALTN_KEY, JSON.stringify(all));
  } catch {}
}
let altnEditing = false;

// The Brief tab's weather: what's on the device at once, then a fresh copy.
// When this flight is at an airport (ms): off-block at the departure, on
// the ground at the destination / alternate — actual times first, then the
// plan moved by the off-block delay. NaN without times. Used to underline
// the TAF groups in force an hour either side.
function wxEtaFor(end, leg = storage.getLegs()[storage.getLegIndex()] || null) {
  if (!leg) return NaN;
  const p = legPlanActual(leg);
  const ok = Number.isFinite;
  if (end === 'dep') return ok(p.obt) ? p.obt : ok(p.ctot) ? p.ctot : p.std;
  if (ok(p.ibt)) return p.ibt;
  if (ok(p.landing)) return p.landing;
  const delay = ok(p.obt) && ok(p.std) ? p.obt - p.std : 0;
  return ok(p.sta) ? p.sta + delay : NaN;
}
// The time shown top right of each weather window: ETD at the departure,
// ETA at the destination, and at the alternate an estimate — the
// destination ETA plus a go-around and the flight across (≈10 min + the
// distance at 280 kt), to the nearest 5 min.
async function wxTimeFor(end, leg = storage.getLegs()[storage.getLegIndex()] || null) {
  if (end === 'dep' || end === 'arr') return { ms: wxEtaFor(end, leg), label: end === 'dep' ? 'ETD' : 'ETA', est: false };
  if (end !== 'altn') return { ms: NaN };
  const base = wxEtaFor('arr', leg);
  const arr = String((leg && leg.arr) || storage.getCurrent().dataCard.arr || '').toUpperCase();
  const alt = altnFor(arr);
  if (!Number.isFinite(base) || !alt) return { ms: NaN };
  try {
    const [ri, pr] = await Promise.all([import('./modules/route-info.js?v=262'), import('./modules/plan-route.js?v=262')]);
    const db = await ri.loadDb();
    const a = ri.findAirport(db, arr), b = ri.findAirport(db, alt);
    if (!a || !b) return { ms: NaN };
    const min = Math.round((10 + pr.distNm(a, b) / 280 * 60) / 5) * 5;
    return { ms: base + min * 60e3, label: 'ETA', est: true, min };
  } catch { return { ms: NaN }; }
}
function wxTimeText(t) {
  if (!t || !Number.isFinite(t.ms)) return '';
  const z = new Date(t.ms).toISOString().slice(11, 16) + 'Z';
  return `${t.label} ${t.est ? '≈' : ''}${z}`;
}
async function paintBeforeWx(leg, force = false) {
  const el = $('before-wx');
  const seq = (paintBeforeWx.seq = (paintBeforeWx.seq || 0) + 1);
  const d = storage.getCurrent().dataCard;
  const arrCode = String((leg && leg.arr) || d.arr || '').toUpperCase();
  const ends = [['dep', 'Departure', (leg && leg.dep) || d.dep], ['arr', 'Arrival', arrCode], ['altn', 'Alternate', altnFor(arrCode)]]
    .map(([src, name, code]) => [src, name, String(code || '').toUpperCase()]).filter(e => e[2]);
  let wx, ru;
  try {
    wx = await import('./modules/wx.js?v=262');
    ru = await import('./modules/route-ui.js?v=262');
    await wx.codesReady();
  } catch { return; }
  // Coloured by the Route card's own rules, so the two always agree.
  const paint = async () => {
    const cards = await Promise.all(ends.map(async ([src, name, code]) => {
      const e = wx.peekCachedWx(code);
      const age = e && e.metar ? wx.metarAgeMin(e.metar) : null;
      // The METAR's age only when it's getting old — otherwise it's noise.
      const old = age == null || age < 60 ? '' : `METAR ${Math.round(age / 60)} h old`;
      const when = await wxTimeFor(src, leg);
      const [metar, taf] = await ru.colouredReports(code, [e?.metar || '', e?.taf || ''], when.ms);
      const whenTxt = wxTimeText(when);
      const L = e?.datis ? wx.extractLetter(e.datis, src === 'dep' ? 'dep' : 'arr') : '';
      // The alternate's NOTAMs, from the last Route info update.
      let nt = '';
      if (src === 'altn') {
        const n = await ru.notamsFor(leg || storage.getCurrent().dataCard, code).catch(() => null);
        nt = `<button type="button" class="wx-foot-btn${n && n.tags.length ? ' is-bad' : ''}" data-altn-notams="${escapeHtml(code)}">${
          !n ? 'NOTAMs: update Route info' : `NOTAMs ${n.count}${n.tags.length ? ' · ⛔ ' + escapeHtml(n.tags.join(' · ')) : ''}`}</button>
          <button type="button" class="wx-foot-btn" data-altn-edit>Change</button>`;
      }
      // Header (airport · which end … ETD/ETA), the reports, then one row of
      // actions underneath — nothing sits on top of anything.
      const tile = `<div class="wx-card">
        <button type="button" class="wx-end" data-wx-end="${src}" data-code="${escapeHtml(code)}">
          <span class="ph-h"><span><b>${escapeHtml(code)}</b> ${name}${old ? ` <i class="ph-old">${old}</i>` : ''}</span>${whenTxt ? `<span class="ph-when"${when.est ? ` title="Destination ETA + about ${when.min} min"` : ''}>${whenTxt}</span>` : ''}</span>
          ${metar ? `<span class="ph-wx">${metar}</span>` : '<span class="muted small">No METAR saved</span>'}
          ${taf ? `<span class="ph-wx ph-taf">${taf}</span>` : ''}
        </button>
        <div class="wx-foot">${nt}<button type="button" class="wx-atis-go" data-wx-end="${src}" data-code="${escapeHtml(code)}">ATIS${L ? ` <span class="atis-tag">${escapeHtml(L)}</span>` : ''} ›</button></div>
      </div>`;
      return src === 'altn' && altnEditing ? '' : tile;
    }));
    // No alternate yet, or changing it: a box for the airport.
    const cur = altnFor(arrCode);
    const altnRow = !arrCode ? ''
      : altnEditing ? `<form class="wx-altn-form" data-altn-form>
          <input type="text" name="altn" value="${escapeHtml(cur)}" placeholder="Alternate for ${escapeHtml(arrCode)} (ICAO or IATA)"
                 autocapitalize="characters" autocomplete="off" spellcheck="false" maxlength="4" aria-label="Alternate airport" />
          <button type="submit" class="btn primary">Save</button>
          ${cur ? '<button type="button" class="btn" data-altn-clear>Remove</button>' : ''}
          <button type="button" class="btn" data-altn-cancel>Cancel</button>
        </form>`
      : cur ? '' : `<button type="button" class="wx-altn-add" data-altn-edit>+ Alternate</button>`;
    if (seq === paintBeforeWx.seq) {
      el.innerHTML = cards.join('') + altnRow;
      if (altnEditing) el.querySelector('[data-altn-form] input')?.focus();
    }
  };
  await paint();
  if (navigator.onLine === false) return;
  // The ATIS too (D-ATIS / ACARS), so each tile's ATIS › carries its letter.
  await Promise.all(ends.map(e => wx.fetchWx(e[2], { force }).catch(() => null)));
  await paint();
  try { syncCardAtis(wx); } catch {}
}

// ---- ATIS kept current by itself ----
// Every 10 minutes while the app is open (and on returning to it), the ATIS
// is fetched for the departure, destination and alternate — and the next
// leg's destination, the one you'll be turning round for. The card's ATIS
// letter follows the live one for its airport; a new letter shows red
// (unread) until you open it.
function atisAirports() {
  const legs = storage.getLegs(), i = storage.getLegIndex();
  const leg = legs[i] || null, next = legs[i + 1] || null;
  const d = storage.getCurrent().dataCard;
  const arr = String((leg && leg.arr) || d.arr || '').toUpperCase();
  return [...new Set([(leg && leg.dep) || d.dep, arr, altnFor(arr), next && next.arr]
    .map(c => String(c || '').toUpperCase()).filter(Boolean))];
}
async function refreshAtisAll(force = false) {
  if (navigator.onLine === false || document.visibilityState === 'hidden') return;
  let wx;
  try { wx = await import('./modules/wx.js?v=262'); await wx.codesReady(); } catch { return; }
  await Promise.all(atisAirports().map(c => wx.fetchWx(c, { force }).catch(() => null)));
  syncCardAtis(wx);
  try { window.dispatchEvent(new CustomEvent('fc:atis-updated')); } catch {}
  prewarmAtisDiagrams(wx);
  if (!$('before-wx').hidden) { try { paintBeforeWx(storage.getLegs()[storage.getLegIndex()] || null); } catch {} }
}
// The card's letter = the live letter at its airport (the one last looked
// at in the ATIS window, else the departure). Nothing live: left alone.
function syncCardAtis(wx) {
  const d = storage.getCurrent().dataCard;
  const code = String(d.atis_icao || d.dep || '').toUpperCase();
  if (!code) return;
  const e = wx.peekCachedWx(code);
  if (!e || !e.datis) return;
  const isArr = !!d.arr && wx.peekCachedWx(d.arr)?.icao === e.icao;      // IATA or ICAO alike
  const live = wx.extractLetter(e.datis, isArr ? 'arr' : 'dep');
  if (!live || (live === d.atis && e.icao === String(d.atis_icao || '').toUpperCase())) return;
  storage.setDataField('atis', live);
  storage.setDataField('atis_icao', e.icao || code);
  dataCard.render(dataBody);
}
setTimeout(() => { refreshAtisAll().catch(() => {}); }, 8_000);
setInterval(() => { refreshAtisAll(true).catch(() => {}); }, 10 * 60 * 1000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshAtisAll().catch(() => {});
});
$('before-wx').addEventListener('click', (e) => {
  const leg = storage.getLegs()[storage.getLegIndex()] || null;
  const arr = String((leg && leg.arr) || storage.getCurrent().dataCard.arr || '').toUpperCase();
  if (e.target.closest('[data-altn-edit]')) { altnEditing = true; paintBeforeWx(leg); return; }
  const an = e.target.closest('[data-altn-notams]');
  if (an) { openRouteInfo(an.dataset.altnNotams); return; }
  if (e.target.closest('[data-altn-cancel]')) { altnEditing = false; paintBeforeWx(leg); return; }
  if (e.target.closest('[data-altn-clear]')) { setAltn(arr, ''); altnEditing = false; paintBeforeWx(leg); return; }
  const b = e.target.closest('[data-wx-end]');
  if (b) openWx(b.dataset.wxEnd, b.dataset.code, { atisOnly: true });
});
$('before-wx').addEventListener('submit', async (e) => {
  e.preventDefault();
  const leg = storage.getLegs()[storage.getLegIndex()] || null;
  const arr = String((leg && leg.arr) || storage.getCurrent().dataCard.arr || '').toUpperCase();
  const code = String(new FormData(e.target).get('altn') || '').trim().toUpperCase();
  if (code) {
    // An airport the app knows (either code), or any four letters.
    let known = /^[A-Z]{4}$/.test(code);
    try { const ri = await import('./modules/route-info.js?v=262'); known = known || !!ri.findAirport(await ri.loadDb(), code); } catch {}
    if (!known) { toast(`${code} isn't an airport the app knows`); return; }
  }
  setAltn(arr, code);
  altnEditing = false;
  paintBeforeWx(leg);
});
// The checklist: closed until asked for, a page on a phone and the right-hand
// side on an iPad when opened, a window on request.
function setChecklistOpen(open) {
  const el = $('card-checklist');
  el.hidden = !open;
  el.classList.toggle('is-float', floatPref.on);
  $('checklist-float-btn').setAttribute('aria-pressed', String(floatPref.on));
  el.place();
  if (open) checklist.render(checklistBody);
  floatPref.open = open;
  saveFloatPref();
  paintTabs();
}
function saveFloatPref() {
  try { localStorage.setItem('fc.checklistFloat', JSON.stringify(floatPref)); } catch {}
}
// A place like the other tabs: it opens over Brief, and tapped again it closes.
// Floating, it opens over whatever's on screen.
function checklistTab() {
  if (!$('card-checklist').hidden) { setChecklistOpen(false); return; }
  if (!floatPref.on && document.body.dataset.phase !== 'before') setPhase('before');
  setChecklistOpen(true);
}
function setChecklistFloat(on) {
  const el = $('card-checklist');
  const from = el.hidden ? null : el.getBoundingClientRect();
  floatPref.on = on;
  // Back to normal: it belongs over Brief again.
  if (!on && document.body.dataset.phase !== 'before') setPhase('before');
  setChecklistOpen(true);
  if (from) morphChecklist(el, from, on);
}
// Page ⇄ window as one movement, the way iPadOS turns an app into a floating
// window: from where it was, scaled into where it lands, on the system's
// sheet curve. The drag offset stays the element's own transform; the
// animation runs over it and hands back to it at the end.
function morphChecklist(el, from, toFloat) {
  if (!el.animate || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const to = el.getBoundingClientRect();
  if (!to.width || !to.height) return;
  const rest = el.style.transform || 'none';
  const m = new DOMMatrix(rest === 'none' ? undefined : rest);
  const layoutLeft = to.left - m.e, layoutTop = to.top - m.f;
  el.animate([
    { transformOrigin: '0 0', borderRadius: toFloat ? '0px' : '20px',
      transform: `translate(${from.left - layoutLeft}px, ${from.top - layoutTop}px) scale(${from.width / to.width}, ${from.height / to.height})` },
    { transformOrigin: '0 0', borderRadius: toFloat ? '20px' : '0px', transform: rest },
  ], { duration: 420, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' });
  // The content fades back in as it settles, so stretched text never reads.
  el.querySelector('.checklist-scroll')?.animate([{ opacity: 0.2 }, { opacity: 1 }], { duration: 320, delay: 120, easing: 'ease-out', fill: 'backwards' });
}
// The bars' heights, for what sits between them (Route info, the checklist).
(function wireTopHeight() {
  const top = document.querySelector('.app-top');
  const put = () => document.documentElement.style.setProperty('--top-h', Math.round(top.getBoundingClientRect().height) + 'px');
  put();
  new ResizeObserver(put).observe(top);
})();
(function wireChecklistDrag() {
  const head = $('checklist-head'), win = $('card-checklist');
  let from = null;
  // Where it's been dragged to, kept on the screen: the head stays reachable,
  // wherever it was dropped and after the iPad turns.
  win.place = () => {
    win.style.transform = '';
    if (win.hidden || !floatPref.on) return;
    const r = win.getBoundingClientRect();
    floatPref.x = Math.max(-r.left, Math.min(innerWidth - r.width - r.left, floatPref.x));
    floatPref.y = Math.max(-r.top, Math.min(innerHeight - 120 - r.top, floatPref.y));
    win.style.transform = `translate(${floatPref.x}px, ${floatPref.y}px)`;
  };
  window.addEventListener('resize', () => win.place());
  head.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button') || !win.classList.contains('is-float')) return;
    from = { px: e.clientX - floatPref.x, py: e.clientY - floatPref.y };
    try { head.setPointerCapture(e.pointerId); } catch {}
  });
  head.addEventListener('pointermove', (e) => {
    if (!from) return;
    floatPref.x = e.clientX - from.px;
    floatPref.y = e.clientY - from.py;
    win.place();
  });
  const end = () => { if (from) saveFloatPref(); from = null; };
  head.addEventListener('pointerup', end);
  head.addEventListener('pointercancel', end);
})();
// Left floating and open: still there after a reload.
if (floatPref.on && floatPref.open) setChecklistOpen(true);

// ---------- Ben Gurion flight board chip ----------
// The airport's own status for this leg — the closest public thing to a
// start-up / off-block time (TOBT, TSAT and CTOT are airline-and-ATC only).
// Shown on any leg departing or arriving at TLV within the board's window;
// see modules/tlv-board.js. A function declaration with its state on itself,
// so the boot-time renderLegSwitcher call can't hit a TDZ.
async function paintTlvBoard(force = false) {
  const el = $('leg-board');
  if (!el) return;
  const seq = (paintTlvBoard.seq = (paintTlvBoard.seq || 0) + 1);
  const leg = storage.getLegs()[storage.getLegIndex()] || null;
  let tb = null;
  try { tb = await import('./modules/tlv-board.js?v=262'); } catch {}
  if (!leg || !tb || !tb.applies(leg)) { el.hidden = true; return; }
  const b = await tb.boardFor(leg, { force });
  if (seq !== paintTlvBoard.seq) return;          // the leg changed meanwhile
  if (!b) { el.hidden = true; return; }
  const hm = (ms) => Number.isFinite(ms) ? new Date(ms).toISOString().slice(11, 16) + 'Z' : '';
  const st = b.status.toUpperCase();
  const tone = /CANCEL/.test(st) ? 'is-bad'
    : /DELAY/.test(st) || b.delayMin >= 15 ? 'is-late'
    : /ON TIME|DEPARTED|LANDED|FINAL|NOT FINAL/.test(st) ? 'is-ok' : '';
  const delay = b.delayMin ? ` (${b.delayMin > 0 ? '+' : ''}${b.delayMin})` : '';
  const parts = [
    `<b>TLV</b>`,
    st ? `<span class="leg-board-st">${escapeHtml(st)}</span>` : '',
    b.updatedMs ? `${b.dir === 'D' ? 'dep' : 'arr'} ${hm(b.updatedMs)}${delay}` : '',
    b.terminal ? `T${escapeHtml(b.terminal)}` : '',
    b.dir === 'D' && b.checkin ? `check-in ${escapeHtml(b.checkin)}${b.zone ? ' ' + escapeHtml(b.zone) : ''}` : '',
    b.stale ? `${Math.max(1, Math.round((Date.now() - b.fetchedAt) / 60000))} min ago` : '',
  ].filter(Boolean);
  el.innerHTML = parts.join(' · ');
  el.className = `leg-board ${tone}${b.stale ? ' is-stale' : ''}`;
  el.title = `Ben Gurion flight board${b.statusHe ? ' — ' + b.statusHe : ''}`;
  el.hidden = false;
}

// ---------- Spare FDP chip ----------
// How much of the max FDP is left for the active leg's duty (modules/ftl.js):
// planned before the duty, projected from delays once it's running, actual
// once flown. Green with an hour to spare, amber inside it, red past the
// limit (and how far into the 2 h extension). Tap for the full sheet.
// Shown from 24 h before report until 3 h after release.
async function paintFdpChip() {
  const el = $('leg-fdp');
  if (!el) return;
  const seq = (paintFdpChip.seq = (paintFdpChip.seq || 0) + 1);
  try {
    const ftl = await import('./modules/ftl.js?v=262');
    if (seq !== paintFdpChip.seq) return;
    const now = Date.now();
    const r = ftl.evaluate({ legs: storage.everyLeg(), duties: [], activeLeg: storage.getLegs()[storage.getLegIndex()], opts: { extOf: ftlExtOf, etaOf: ftlEtaOf }, taxiOf: taxiMinutes, now });
    const H = 3600000;
    if (r.empty || now < r.fdp.report - 24 * H || now > r.fdp.release + 3 * H) { el.hidden = true; return; }
    const sp = r.fdp.flown ? r.lim.maxFdp - r.lim.actualFdp : r.proj.spare;
    const tone = sp < 0 ? 'is-bad' : sp < 1 ? 'is-warn' : 'is-good';
    const txt = sp < 0
      ? `FDP <b>${ftlH(-sp)}</b> over${-sp <= ftl.EXT_MAX_H - r.lim.extH ? ' · ext.' : ' · past ext.'}`
      : `FDP <b>${ftlH(sp)}</b> spare`;
    el.innerHTML = `${txt} <small>max ${ftlH(r.lim.maxFdp)}${r.lim.extH ? ' incl. ext' : ''}</small>`;
    el.className = `leg-fdp ${tone}`;
    el.title = `Max FDP ${ftlH(r.lim.maxFdp)}, latest on-blocks ${ftlZ(r.lim.limit)} — tap for flight time limits`;
    el.hidden = false;
  } catch (err) { console.warn('fdp chip failed', err); el.hidden = true; }
}

// Paint the T/O & LDG pills from the active leg's dataCard. Called from
// renderLegSwitcher and after every role-cycle tap so the colour follows
// the value without a full leg re-render.
function paintLegRolePills() {
  const data = storage.getCurrent().dataCard || {};
  document.querySelectorAll('.leg-role-pill[data-role-key]').forEach(btn => {
    const key = btn.dataset.roleKey;
    const label = key === 'to_role' ? 'T/O' : 'LDG';
    const v = String(data[key] || '').toUpperCase();
    btn.classList.toggle('is-pf', v === 'PF');
    btn.classList.toggle('is-pm', v === 'PM');
    btn.classList.toggle('is-none', v !== 'PF' && v !== 'PM');
    btn.innerHTML = `${label}&nbsp;${v || '—'}`;
    btn.setAttribute('aria-label', `${label} role: ${v || 'none'}; tap to cycle`);
  });
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
  if (holdingManualLeg()) return;
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
  // legTs: a leg with no stored year is legacy history, so it resolves into
  // the past rather than being guessed a year forward and mistaken for the
  // next departure. See dates.js.
  const toTs = (d, t, y) => legTs(d, t, y, now);
  // Extend the "active" window 20 min past scheduled arrival so the leg
  // stays selected during taxi-in / chock time and any modest late-arrival
  // slop. Phase 4 swaps the +20 min buffer for the actual GPS-detected
  // landing time, so the same function continues to work — only the
  // upper bound changes.
  const ACTIVE_BUFFER_MS = 20 * 60 * 1000;
  const windows = legs.map((leg, i) => ({
    i,
    dep: toTs(leg.dep_date, leg.dep_time, leg.dep_year),
    arr: toTs(leg.arr_date, leg.arr_time, leg.arr_year),
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
  try { paintOffBlock(now); }     catch (err) { console.warn('off-block line skipped', err); }
}

// ---------- Off-block target from the CTOT ----------
// TOBT / TSAT are airport A-CDM data the public can't get, so this is the
// app's own arithmetic, labelled as such: the CTOT is a TAKE-OFF time with a
// −5 / +10 min tolerance, so to make it the aircraft must be off blocks by
//   CTOT − taxi-out          (target)
//   CTOT + 10 − taxi-out     (latest, still inside the slot)
// Taxi-out defaults to 15 min and is set per departure airport by tapping
// the line — stored on this device as fc.taxi.<CODE>. Runs on the 1-s clock
// tick, so everything here is a function declaration (boot-time TDZ).
function taxiMinutes(code) {
  try {
    const v = parseInt(localStorage.getItem('fc.taxi.' + code), 10);
    if (v >= 1 && v <= 60) return v;
  } catch {}
  return 15;
}
function offBlockDepCode() {
  const leg = storage.getLegs()[storage.getLegIndex()] || null;
  return String((leg && leg.dep) || storage.getCurrent()?.dataCard?.dep || '').toUpperCase();
}
function offBlockTimes(now = new Date()) {
  const { diff } = ctotDiffMinutes(now);
  if (diff == null) return null;
  const leg = storage.getLegs()[storage.getLegIndex()] || null;
  const d = storage.getCurrent()?.dataCard || {};
  const taxi = taxiMinutes(offBlockDepCode());
  let ctot = now.getTime() - diff * 60000;
  // The plan, straight from the calendar: STD / STA. The CTOT pill only
  // carries HH:MM, so pin it to the day nearest the leg's STD (a slot for a
  // 23:50Z departure can fall after midnight).
  const std = leg ? legTs(leg.dep_date, leg.dep_time, leg.dep_year) : NaN;
  const sta = leg ? legTs(leg.arr_date, leg.arr_time, leg.arr_year || leg.dep_year) : NaN;
  if (Number.isFinite(std)) {
    const DAY = 86400000;
    for (const k of [-1, 1]) {
      if (Math.abs(ctot + k * DAY - std) < Math.abs(ctot - std)) ctot += k * DAY;
    }
  }
  // Block = off-block → on-block, so it already holds taxi-out AND taxi-in:
  // in-block = off-block + block, never + taxi again. A typed flight time is
  // the block here too (setDataField carries it to block_time).
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(d.block_time || d.flight_time || (leg && leg.flight_time) || '').trim());
  const blockMin = m ? (+m[1]) * 60 + (+m[2]) : NaN;
  const target = ctot - taxi * 60000;
  const ibt = Number.isFinite(blockMin) ? target + blockMin * 60000 : NaN;
  const planIbt = Number.isFinite(sta) ? sta
    : (Number.isFinite(std) && Number.isFinite(blockMin)) ? std + blockMin * 60000 : NaN;
  return {
    ctot, taxi, target, ibt,
    latest: ctot + (10 - taxi) * 60000,
    obtDelta: Number.isFinite(std) ? Math.round((target - std) / 60000) : null,
    ibtDelta: Number.isFinite(ibt) && Number.isFinite(planIbt) ? Math.round((ibt - planIbt) / 60000) : null,
  };
}
// Early / on time / late against the calendar's plan. On time runs to +5,
// late to +15; past that it's a real delay.
function planTone(delta) {
  if (delta == null) return '';
  if (delta < -2) return 'is-early';
  if (delta <= 5) return 'is-ontime';
  if (delta <= 15) return 'is-late';
  return 'is-vlate';
}
function paintOffBlock(now = new Date()) {
  const el = $('leg-ctot');
  if (!el) return;
  // A flown leg: show what actually happened against the plan instead of a
  // CTOT estimate — off-block, wheels-up, touchdown, in-block.
  const legNow = storage.getLegs()[storage.getLegIndex()] || null;
  const pa = legNow ? legPlanActual(legNow) : null;
  if (pa && (Number.isFinite(pa.obt) || Number.isFinite(pa.ibt))) {
    const hm = (ms) => new Date(ms).toISOString().slice(11, 16);
    const dl = (n) => n == null ? '' : `<i>${fmtDelta(n)}</i>`;
    const html = [
      Number.isFinite(pa.ctot) ? `<span class="ob-tok">CTOT <b>${hm(pa.ctot)}Z</b></span>` : '',
      Number.isFinite(pa.obt) ? `<span class="ob-tok ${planTone(pa.obtDelta)}" title="Actual off-block vs schedule">OBT <b>${hm(pa.obt)}</b>${dl(pa.obtDelta)}</span>` : '',
      Number.isFinite(pa.takeoff) ? `<span class="ob-tok">T/O <b>${hm(pa.takeoff)}</b></span>` : '',
      Number.isFinite(pa.landing) ? `<span class="ob-tok">LDG <b>${hm(pa.landing)}</b></span>` : '',
      Number.isFinite(pa.ibt) ? `<span class="ob-tok ${planTone(pa.ibtDelta)}" title="Actual in-block vs schedule">IBT <b>${hm(pa.ibt)}</b>${dl(pa.ibtDelta)}</span>` : '',
      `<span class="ob-tok ob-taxi">actual</span>`,
    ].filter(Boolean).join('');
    if (el.innerHTML !== html) el.innerHTML = html;
    if (el.className !== 'leg-ctot is-actual') el.className = 'leg-ctot is-actual';
    if (el.hidden) el.hidden = false;
    return;
  }
  const t = offBlockTimes(now);
  if (!t) { if (!el.hidden) el.hidden = true; return; }
  const hm = (ms) => new Date(ms).toISOString().slice(11, 16);
  const dl = (n) => n == null ? '' : `<i>${n === 0 ? '±0' : (n > 0 ? '+' : '−') + Math.abs(n)}</i>`;
  const toTarget = (t.target - now.getTime()) / 60000;
  // Countdown to off-block while it matters; nothing once long gone.
  const due = now.getTime() > t.latest + 3 * 3600000 ? ''
    : now.getTime() > t.latest ? '<span class="ob-due is-missed">missed</span>'
    : toTarget <= 0 ? '<span class="ob-due is-now">now</span>'
    : toTarget <= 30 ? `<span class="ob-due">in ${Math.ceil(toTarget)}′</span>` : '';
  const html = [
    `<span class="ob-tok"><b>CTOT ${hm(t.ctot)}Z</b></span>`,
    `<span class="ob-tok ${planTone(t.obtDelta)}" title="Off-block: CTOT − taxi; latest still inside the slot">OBT <b>${hm(t.target)}</b>${dl(t.obtDelta)}<small>≤${hm(t.latest)}</small></span>`,
    due,
    Number.isFinite(t.ibt)
      ? `<span class="ob-tok ${planTone(t.ibtDelta)}" title="In-block: off-block + block time">IBT <b>${hm(t.ibt)}</b>${dl(t.ibtDelta)}</span>` : '',
    `<span class="ob-tok ob-taxi">taxi ${t.taxi}′</span>`,
  ].filter(Boolean).join('');
  if (el.innerHTML !== html) el.innerHTML = html;
  if (el.className !== 'leg-ctot') el.className = 'leg-ctot';
  if (el.hidden) el.hidden = false;
}
$('leg-ctot')?.addEventListener('click', () => {
  if ($('leg-ctot').classList.contains('is-actual')) return;   // nothing to set on a flown leg
  const code = offBlockDepCode() || 'this airport';
  const cur = taxiMinutes(offBlockDepCode());
  const v = prompt(`Taxi-out time at ${code}, in minutes`, String(cur));
  if (v == null) return;
  const n = parseInt(v, 10);
  if (!(n >= 1 && n <= 60)) { toast('Taxi time must be 1–60 minutes'); return; }
  try { localStorage.setItem('fc.taxi.' + offBlockDepCode(), String(n)); } catch {}
  // A new taxi time moves the off-block alerts: let them fire afresh.
  try { resetCtotAlertState(); } catch {}
  paintOffBlock();
  toast(`Taxi-out at ${code}: ${n} min`);
});
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

  // Off-block alerts sit relative to the CTOT too: target off-block is
  // CTOT − taxi-out (see offBlockTimes).
  const taxi = taxiMinutes(offBlockDepCode());
  const thresholds = [
    { key: 'OFB-5', when: -(taxi + 5), label: 'Off-block in 5 minutes' },
    { key: 'OFB',   when: -taxi,       label: 'Off-block now for the CTOT' },
    { key: 'T-20', when: -20, label: 'CTOT in 20 minutes' },
    { key: 'T-10', when: -10, label: 'CTOT in 10 minutes' },
    { key: 'T0',   when:   0, label: 'CTOT now' },
  // A CTOT alert landing on the same minute as an off-block one (taxi 15 →
  // both at T−20) would buzz twice; the off-block one says more.
  ].filter((t, i, all) => t.key.startsWith('OFB')
    || !all.some(o => o.key.startsWith('OFB') && o.when === t.when));
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
      : 'Enable CTOT alerts (off-block, 20 / 10 / now)';
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
  const useArr = !!leg.arr_date;
  const d = useArr ? leg.arr_date : leg.dep_date;
  const t = useArr ? leg.arr_time : leg.dep_time;
  const y = useArr ? leg.arr_year : leg.dep_year;
  const ts = legTs(d, t, y, now.getTime());
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
  const routeEl = $('leg-sum-txt');
  if (!routeEl) return;
  syncChipTag(routeEl, '.leg-past-tag', 'leg-past-tag', 'PAST', past);
  syncChipTag(routeEl, '.leg-next-tag', 'leg-next-tag', '', isNext);
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
['hdr-tail', 'hdr-flight', 'hdr-ctot', 'hdr-fltime'].forEach(id => {
  const el = $(id);
  if (!el) return;
  el.addEventListener('focus', () => {
    setTimeout(() => { try { el.select(); el.setSelectionRange(0, el.value.length); } catch {} }, 0);
  });
});

function syncHeaderInputs() {
  const data = storage.getCurrent().dataCard;
  const tail = $('hdr-tail');
  const flt  = $('hdr-flight');
  const ctot = $('hdr-ctot');
  const ftm  = $('hdr-fltime');
  if (ftm  && document.activeElement !== ftm)  ftm.value  = data.flight_time || '';
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
// Header flight-time box — the same field as the Flight group's "Flight time"
// cell, shown twice. Typing here writes storage and repaints the data-card
// cell; typing there comes back through dataCard.setOnChange → syncHeaderInputs.
// Neither path re-renders the card, so whichever box has focus keeps it.
// ✎ in the Data card head: arrange the groups (data-card.js edit mode).
$('data-edit').addEventListener('click', () => {
  const on = !dataCard.isEditing();
  dataCard.setEditing(on);
  $('data-edit').setAttribute('aria-pressed', String(on));
});
dataCard.setOnEditDone(() => $('data-edit').setAttribute('aria-pressed', 'false'));

$('hdr-fltime').addEventListener('input', () => {
  const el = $('hdr-fltime');
  const formatted = formatHHMM(el.value);
  if (el.value !== formatted) {
    el.value = formatted;
    try { el.setSelectionRange(formatted.length, formatted.length); } catch {}
  }
  storage.setDataField('flight_time', formatted);
  try { dataCard.paintCell(dataBody, 'flight_time'); } catch (err) { console.warn('cell paint failed', err); }
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
    pickLeg(existingIdx).then(() => toast(`Switched to ELY${digits}`));
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

// Same roll-in rule as data-card.js formatHHMM: the newest four digits.
function formatHHMM(raw) {
  const digits = String(raw || '').replace(/\D/g, '').slice(-4);
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
  'clear-flight':    () => openClearSheet(),
  'checklist-tab':   () => checklistTab(),
  'checklist-close': () => setChecklistOpen(false),
  'checklist-float': () => setChecklistFloat(!$('card-checklist').classList.contains('is-float')),
  'checklist-edit':  () => doChecklistEditToggle(),
  'checklist-print': () => openPrintSheet(),
  'radar':           () => navigator.onLine === false ? toast('Radar needs internet') : doRadar(),
  'asu':             () => doAirspeedUnreliable(),
  'systems':         () => doSystems(),
  'ftl':             () => openFtl(),
  'fdp-chip':        () => openFtl(),
  'pa-toggle':       () => speeches.open(),
  'settings':        () => openSettingsSheet(),
  'leg-prev':        () => pickLeg(storage.getLegIndex() - 1),
  // "Now" is the pilot asking for the current leg: no hold afterwards.
  'leg-now':         () => { manualLegPickAt = 0; return applyLeg(pickLegForNow()); },
  'route-info':      () => openRouteInfo(),
  'logbook':         () => openLogbook(),
  'mynotes':         () => openMyNotes(),
  'leg-next':        () => pickLeg(storage.getLegIndex() + 1),
  'ctot-bell':       () => { try { onBellTap(); } catch (err) { console.warn('bell tap failed', err); } },
};
document.addEventListener('click', (e) => {
  const th = e.target.closest('[data-theme-set]');
  if (th) { e.preventDefault(); setTheme(th.dataset.themeSet); return; }
  const ph = e.target.closest('[data-phase-set]');
  if (ph) { e.preventDefault(); setPhase(ph.dataset.phaseSet); return; }
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const fn = TOP_ACTIONS[btn.dataset.action];
  if (!fn) return;
  e.preventDefault();
  try { fn(e, btn); } catch (err) { console.warn('top action failed', btn.dataset.action, err); }
}, true);

// ---------- Clear this flight ----------
// The one place the main screen erases anything: ↻ only ever means refresh.
// Everything is ticked except "the rest", which is the old full reset — it
// also takes actual times and G, so it has to be asked for.
function openClearSheet() {
  const rows = [
    ...dataCard.FIELDS.filter(g => g.resettable).map(g => ({ id: g.id, name: g.group, on: true })),
    { id: 'ticks', name: 'Checklist ticks', on: true },
    { id: 'all', name: 'Everything else (times, G)', on: false },
  ];
  $('clear-rows').innerHTML = rows.map(r => `<label class="clear-row">
      <input type="checkbox" data-clear="${r.id}"${r.on ? ' checked' : ''} />
      <span>${escapeHtml(r.name)}</span></label>`).join('');
  showOverlay('clear-overlay');
}
async function doClearFlight() {
  const picked = [...$('clear-rows').querySelectorAll('[data-clear]:checked')].map(i => i.dataset.clear);
  if (!picked.length) { hideOverlay('clear-overlay'); return; }
  if (picked.includes('all')) {
    storage.clearDataCard();
    // Re-apply the active leg so flight #, tail, dep/arr, crew etc. come back.
    if (storage.getLegs().length) await applyLeg(storage.getLegIndex());
    else { renderAll(); syncHeaderInputs(); }
  } else {
    for (const g of dataCard.FIELDS) {
      if (picked.includes(g.id)) for (const c of g.cells) storage.setDataField(c.key, '');
    }
    dataCard.render(dataBody);
  }
  if (picked.includes('ticks') || picked.includes('all')) {
    storage.resetTicks();
    checklist.resetOverrides();
    checklist.render(checklistBody);
  }
  speeches.notifyDataChange();
  hideOverlay('clear-overlay');
  toast('Cleared');
}
$('clear-close').addEventListener('click', () => hideOverlay('clear-overlay'));
$('clear-go').addEventListener('click', doClearFlight);
$('clear-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'clear-overlay') hideOverlay('clear-overlay');
});
// ---------- Print: kneeboard cards ----------
// The whole feature lives in modules/print.js (card markup + config); this is
// just the sheet's wiring. Loaded on demand — printing is a once-a-trip
// action, no reason to carry it through every boot.
let printMod = null;
async function openPrintSheet() {
  try {
    printMod = printMod || await import('./modules/print.js?v=262');
  } catch (err) {
    console.warn('print module failed to load', err);
    toast('Print unavailable — check connection');
    return;
  }
  showOverlay('print-overlay');
  paintPrintSheet();
}

function paintPrintSheet() {
  if (!printMod) return;
  const cfg = printMod.getConfig();
  const byId = new Map(printMod.FIELDS.map(f => [f.id, f]));

  // Field list: drag the grip to reorder, type in the name to retitle the box,
  // eye button to leave it off the card.
  const list = $('print-fields');
  const DIV = printMod.DIVIDER;
  list.innerHTML = cfg.order.map((entry, i) => {
    // A divider is itself draggable: everything above it prints on the row
    // above, everything below on the next one.
    if (entry === DIV) {
      return `<div class="print-div" data-key="${DIV}" data-idx="${i}">
        <span class="print-grip" data-print-grip="div" aria-hidden="true">⠿</span>
        <span class="print-div-line" aria-hidden="true"></span>
        <span class="print-div-tag">new line</span>
        <span class="print-div-line" aria-hidden="true"></span>
        <button type="button" class="print-fbtn" data-print-deldiv="${i}"
                title="Remove this line break" aria-label="Remove this line break">✕</button>
      </div>`;
    }
    // A custom box has no entry in FIELDS — its saved label is what makes it
    // real. Gating on byId alone hid custom boxes from this list entirely,
    // even though they printed on the card.
    if (!byId.has(entry) && !(cfg.labels && cfg.labels[entry])) return '';
    const off = cfg.off.includes(entry);
    const label = printMod.labelFor(entry, cfg);
    return `<div class="print-frow${off ? ' is-off' : ''}" data-key="${entry}">
      <span class="print-grip" data-print-grip="${entry}" aria-hidden="true">⠿</span>
      <input class="print-fname" type="text" value="${escapeHtmlSimple(label)}"
             data-print-label="${entry}" maxlength="24" autocomplete="off"
             autocapitalize="characters" spellcheck="false"
             aria-label="Label for this box" />
      <button type="button" class="print-fbtn" data-print-toggle="${entry}"
              aria-pressed="${off ? 'false' : 'true'}"
              title="${off ? 'Leave off the card' : 'On the card'}"
              aria-label="${off ? 'Add to card' : 'Remove from card'}">${off ? '◻︎' : '◉'}</button>
      <button type="button" class="print-fbtn is-del" data-print-delbox="${entry}"
              title="Delete this box" aria-label="Delete this box">✕</button>
    </div>`;
  }).join('') +
  `<button type="button" id="print-adddiv" class="print-adddiv">+ line break</button>`;

  const sizePct = Math.round((Number(cfg.textScale) || 1) * 100);
  $('print-textsize').value = String(sizePct);
  $('print-textsize-out').textContent = sizePct + '%';
  const clipMm = Math.round(Number(cfg.clipMm) || 0);
  $('print-clip').value = String(clipMm);
  $('print-clip-out').textContent = clipMm + 'mm';
  const edgeMm = Math.round(Number(cfg.edgeMm ?? 5));
  $('print-edge').value = String(edgeMm);
  $('print-edge-out').textContent = edgeMm + 'mm';
  $('print-checklist').checked = cfg.checklist;
  $('print-blank').checked     = cfg.blank;
  $('print-both').checked      = cfg.bothSides;

  paintPrintPreview(cfg);
}

// Render the whole A4 sheet, then scale it to fit the preview column. Scaling
// (not a separate small layout) is what keeps preview and paper identical.
//
// This used to preview a single card, which meant the two upside-down cards —
// the half that actually goes wrong — were the one thing you could never see
// before committing paper to it. Now the preview is the page.
function paintPrintPreview(cfg) {
  // Any layout change makes a PDF built earlier out of date — drop it, so the
  // "tap to share" button can never hand over cards that no longer match.
  if (pdfReady) { pdfReady = null; resetPdfButton(); }
  const host = $('print-preview');
  // Always one sheet: the back side is the same card again, so a second page
  // in the preview would just be a taller picture of the same information.
  host.innerHTML = printMod.sheetsHtml({ ...cfg, bothSides: false });
  const sheet = host.firstElementChild;
  if (!sheet) return;
  requestAnimationFrame(() => {
    const avail = host.clientWidth - 20;          // minus .print-preview padding
    const natural = sheet.offsetWidth || 1;
    // Fit the height as well as the width. A full A4 at 1:1 is ~1120px tall,
    // which on a desktop is wide enough not to need scaling but tall enough to
    // push the Print button off the dialog — and the point of showing the
    // whole page is seeing all four cards at once.
    const maxH = Math.max(320, Math.round(window.innerHeight * 0.66));
    const naturalH = sheet.offsetHeight || 1;
    const scale = Math.min(1, avail / natural, maxH / naturalH);
    sheet.style.transform = `scale(${scale})`;
    // A scaled element still reserves its unscaled box, so pull the host's
    // height back in or the sheet grows a large empty gap underneath.
    host.style.height = (sheet.offsetHeight * scale + 20) + 'px';
  });
}

$('print-close').addEventListener('click', () => hideOverlay('print-overlay'));
$('print-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'print-overlay') hideOverlay('print-overlay');
});
$('print-fields').addEventListener('click', (e) => {
  const tg = e.target.closest('[data-print-toggle]');
  if (tg) { printMod.toggleField(tg.dataset.printToggle); paintPrintSheet(); return; }
  const rm = e.target.closest('[data-print-deldiv]');
  if (rm) { printMod.removeDividerAt(Number(rm.dataset.printDeldiv)); paintPrintSheet(); return; }
  if (e.target.closest('#print-adddiv')) { printMod.addDivider(); paintPrintSheet(); return; }
  const del = e.target.closest('[data-print-delbox]');
  if (del) { printMod.removeBox(del.dataset.printDelbox); paintPrintSheet(); }
});
$('print-addbox').addEventListener('click', () => { printMod.addBox('NEW BOX'); paintPrintSheet(); });

// ---- Tabs: the top band vs the checklist itself ----
let printTab = 'top';
function showPrintTab(tab) {
  printTab = tab === 'checklist' ? 'checklist' : 'top';
  const isCl = printTab === 'checklist';
  $('print-tab-top').classList.toggle('is-active', !isCl);
  $('print-tab-cl').classList.toggle('is-active', isCl);
  $('print-pane-top').classList.toggle('hidden', isCl);
  $('print-pane-cl').classList.toggle('hidden', !isCl);
  if (isCl) paintPrintChecklist();
}
$('print-tab-top').addEventListener('click', () => showPrintTab('top'));
$('print-tab-cl').addEventListener('click',  () => showPrintTab('checklist'));

// ---- Checklist editor (second tab) ----
// A FLAT list of section headings and items. That shape is what makes the drag
// meaningful: an item belongs to whichever heading sits above it, so dragging
// it past a heading moves it into that section. Rebuilt into the template on
// release by rebuildTemplateFromDom.
function paintPrintChecklist() {
  const tpl = storage.getTemplate();
  const secs = (tpl && Array.isArray(tpl.sections)) ? tpl.sections : [];
  const rows = [];
  for (const sec of secs) {
    rows.push(`<div class="print-frow print-clsec" data-key="s:${sec.id}">
      <span class="print-grip" data-print-grip="s" aria-hidden="true">⠿</span>
      <input class="print-fname" type="text" value="${escapeHtmlSimple(sec.name)}"
             data-cl-sec="${sec.id}" maxlength="40" autocomplete="off" spellcheck="false"
             aria-label="Section name" />
      <button type="button" class="print-fbtn is-del" data-cl-delsec="${sec.id}"
              title="Delete section" aria-label="Delete section">✕</button>
    </div>`);
    for (const it of (sec.items || [])) {
      rows.push(`<div class="print-frow print-clitem" data-key="i:${it.id}">
        <span class="print-grip" data-print-grip="i" aria-hidden="true">⠿</span>
        <input class="print-fname" type="text" value="${escapeHtmlSimple(it.label)}"
               data-cl-item="${it.id}" maxlength="60" autocomplete="off" spellcheck="false"
               aria-label="Item text" />
        <button type="button" class="print-fbtn is-del" data-cl-delitem="${it.id}"
                title="Delete item" aria-label="Delete item">✕</button>
      </div>`);
    }
  }
  $('print-cl-list').innerHTML = rows.join('') ||
    `<p class="muted small">No checklist yet — add a section to start.</p>`;
  paintPrintPreview(printMod.getConfig());
}

// Walk the flat DOM order and rewrite the template from it.
function rebuildTemplateFromDom() {
  const tpl = storage.getTemplate();
  const secs = (tpl && Array.isArray(tpl.sections)) ? tpl.sections : [];
  const secById  = new Map(secs.map(s => [s.id, s]));
  const itemById = new Map();
  for (const s of secs) for (const it of (s.items || [])) itemById.set(it.id, it);

  const next = [];
  let current = null;
  for (const el of $('print-cl-list').querySelectorAll('.print-frow')) {
    const [kind, id] = String(el.dataset.key || '').split(':');
    if (kind === 's') {
      const sec = secById.get(id);
      if (!sec) continue;
      current = { ...sec, items: [] };
      next.push(current);
    } else if (kind === 'i') {
      const it = itemById.get(id);
      if (!it) continue;
      // An item dragged above every heading has nowhere to live; keep it in
      // the first section rather than dropping it on the floor.
      if (!current) { current = { ...(secs[0] || { id: 's0', name: 'Checklist' }), items: [] }; next.push(current); }
      current.items.push(it);
    }
  }
  if (next.length) storage.setTemplate({ ...tpl, sections: next });
}

$('print-cl-list').addEventListener('input', (e) => {
  const sec = e.target.closest('[data-cl-sec]');
  const it  = e.target.closest('[data-cl-item]');
  if (!sec && !it) return;
  if (sec) storage.renameSection(sec.dataset.clSec, sec.value);
  else     storage.renameItem(it.dataset.clItem, it.value);
  paintPrintPreview(printMod.getConfig());
  // The card on the main screen is the same checklist — repaint it too, or it
  // keeps showing the old wording until something else forces a render. Safe
  // on every keystroke: the focused input lives in the overlay, not the card.
  refreshChecklistCard();
});
$('print-cl-list').addEventListener('click', (e) => {
  const ds = e.target.closest('[data-cl-delsec]');
  if (ds) {
    if (!confirm('Delete this section and every item in it?')) return;
    storage.deleteSection(ds.dataset.clDelsec); paintPrintChecklist(); refreshChecklistCard(); return;
  }
  const di = e.target.closest('[data-cl-delitem]');
  if (di) { storage.deleteItem(di.dataset.clDelitem); paintPrintChecklist(); refreshChecklistCard(); }
});
$('print-addsec').addEventListener('click', () => {
  const name = prompt('Section name', 'New section');
  if (!name || !name.trim()) return;
  storage.addSection(name.trim());
  paintPrintChecklist(); refreshChecklistCard();
});
$('print-additem').addEventListener('click', () => {
  const secs = storage.getTemplate()?.sections || [];
  if (!secs.length) { toast('Add a section first'); return; }
  const label = prompt('Item text', 'New item');
  if (!label || !label.trim()) return;
  // Goes into the last section — the one being worked on at the bottom.
  storage.addItem(secs[secs.length - 1].id, label.trim());
  paintPrintChecklist(); refreshChecklistCard();
});
// The card on the main screen shows the same checklist, so keep it in step.
function refreshChecklistCard() {
  try { checklist.render(checklistBody); } catch (err) { console.warn('checklist repaint failed', err); }
}
// Retitle a box. Repaint only the PREVIEW on each keystroke — a full
// paintPrintSheet would rebuild the list and blow away the focused input.
$('print-fields').addEventListener('input', (e) => {
  const inp = e.target.closest('[data-print-label]');
  if (!inp) return;
  printMod.setLabel(inp.dataset.printLabel, inp.value);
  paintPrintPreview(printMod.getConfig());
});

// ---- Drag a row to reorder ----
// Pointer events, not HTML5 drag-and-drop: DnD is unreliable under iOS Safari
// touch, and this is an iPad-first app. The dragged row follows the finger
// while its neighbours shuffle underneath; the order is committed on release.
let dragState = null;
let dragList = null;
['print-fields', 'print-cl-list'].forEach(listId => {
$(listId).addEventListener('pointerdown', (e) => {
  const grip = e.target.closest('[data-print-grip]');
  if (!grip) return;
  const row = grip.closest('.print-frow, .print-div');
  if (!row) return;
  dragList = $(listId);
  e.preventDefault();
  try { grip.setPointerCapture(e.pointerId); } catch {}
  dragState = { row, grip, startY: e.clientY, dy: 0 };
  row.classList.add('is-dragging');
  // Lift it out of flow visually but keep its slot, so the list doesn't jump.
  row.style.position = 'relative';
  row.style.zIndex = '5';
});
$(listId).addEventListener('pointermove', (e) => {
  if (!dragState) return;
  e.preventDefault();
  const { row } = dragState;
  dragState.dy = e.clientY - dragState.startY;
  row.style.transform = `translateY(${dragState.dy}px)`;
  // Swap with whichever sibling's midpoint the pointer has crossed.
  const rows = [...dragList.querySelectorAll('.print-frow, .print-div')];
  for (const other of rows) {
    if (other === row) continue;
    const r = other.getBoundingClientRect();
    const mid = r.top + r.height / 2;
    const movingDown = dragState.dy > 0;
    if (movingDown && e.clientY > mid && other.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_PRECEDING) {
      other.after(row);
      dragState.startY = e.clientY; dragState.dy = 0;
      row.style.transform = '';
      break;
    }
    if (!movingDown && e.clientY < mid && other.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING) {
      other.before(row);
      dragState.startY = e.clientY; dragState.dy = 0;
      row.style.transform = '';
      break;
    }
  }
});
function endFieldDrag() {
  if (!dragState) return;
  const { row } = dragState;
  row.classList.remove('is-dragging');
  row.style.transform = ''; row.style.position = ''; row.style.zIndex = '';
  dragState = null;
  if (dragList && dragList.id === 'print-cl-list') {
    rebuildTemplateFromDom();
    dragList = null;
    paintPrintChecklist();
    refreshChecklistCard();
    return;
  }
  const entries = [...$('print-fields').querySelectorAll('.print-frow, .print-div')]
    .map(r => r.dataset.key);
  dragList = null;
  printMod.setOrder(entries);
  paintPrintSheet();
}
$(listId).addEventListener('pointerup', endFieldDrag);
$(listId).addEventListener('pointercancel', endFieldDrag);
});
['checklist', 'blank', 'both'].forEach(k => {
  const key = k === 'both' ? 'bothSides' : k;
  $('print-' + k).addEventListener('change', () => { printMod.toggleFlag(key); paintPrintSheet(); });
});
// Text size — repaint only the preview while dragging, so the slider keeps
// the thumb under the finger instead of being rebuilt mid-gesture.
$('print-textsize').addEventListener('input', () => {
  const pct = Number($('print-textsize').value) || 100;
  $('print-textsize-out').textContent = pct + '%';
  printMod.setTextScale(pct / 100);
  paintPrintPreview(printMod.getConfig());
});

// Both margins live on the SHEET, not the card. They used to change only the
// readout because the preview was a single card and had nowhere to show them;
// now that the preview IS the sheet, both repaint it.
$('print-edge').addEventListener('input', () => {
  const mm = Number($('print-edge').value) || 0;
  $('print-edge-out').textContent = mm + 'mm';
  paintPrintPreview(printMod.setEdgeMm(mm));
});
$('print-clip').addEventListener('input', () => {
  const mm = Number($('print-clip').value) || 0;
  $('print-clip-out').textContent = mm + 'mm';
  paintPrintPreview(printMod.setClipMm(mm));
});

$('print-go').addEventListener('click', () => {
  if (!printMod) return;
  // Close first: the overlay is display:none in print CSS anyway, but leaving
  // it up over the print dialog is confusing on iPad.
  hideOverlay('print-overlay');
  // Only speak up when the dialog demonstrably failed to open. The earlier
  // version asserted "home-screen apps can't print" to every home-screen user
  // without checking — wrong for anyone it was working for.
  printMod.print().then((opened) => {
    if (opened) return;
    // Bring the sheet back so the working route is right there, rather than
    // leaving the pilot with a toast and a closed dialog.
    showOverlay('print-overlay');
    toast('The print dialog didn\u2019t open \u2014 use \u201cShare as PDF\u201d');
  });
});

// Share as PDF. Building the PDF takes a moment, and iOS only lets a page
// open the share sheet straight after a tap — so if the build outlasts that
// window the share is refused (NotAllowedError). Keep the finished PDF and
// turn the button into a one-tap share: that second tap is fresh permission.
function resetPdfButton(label = 'Share as PDF') {
  const b = $('print-pdf');
  b.disabled = false;
  b.textContent = label;
}
$('print-pdf').addEventListener('click', async () => {
  if (!printMod) return;
  const btn = $('print-pdf');
  if (btn.disabled) return;          // a build is already running

  // A PDF is already built: this tap exists only to give iOS a fresh gesture,
  // so call the share sheet before ANY await. sharePdf() reaches
  // navigator.share() synchronously.
  if (pdfReady && pdfModule) {
    const bytes = pdfReady;
    pdfReady = null;
    btn.disabled = true;
    btn.textContent = 'Opening share sheet\u2026';
    pdfModule.sharePdf(bytes).then(
      () => resetPdfButton(),
      (err) => {
        resetPdfButton();
        if (err?.name !== 'AbortError') toast(err?.message || 'Couldn\u2019t share the PDF');
      });
    return;
  }

  // Feedback first, before any await: the very first tap also has to fetch
  // the renderer, and a button that sits unchanged for seconds gets tapped
  // again.
  btn.disabled = true;
  btn.textContent = 'Preparing PDF\u2026';
  let pdfMod;
  try {
    pdfMod = pdfModule = pdfModule || await import('./modules/print-pdf.js?v=262');
  } catch {
    resetPdfButton();
    toast('PDF unavailable \u2014 check connection');
    return;
  }
  let bytes;
  try {
    bytes = await pdfMod.buildCardsPdf(printMod.sheetsHtml(printMod.getConfig()));
  } catch (err) {
    console.warn('PDF build failed', err);
    resetPdfButton();
    toast(err?.message || 'Couldn\u2019t make the PDF');
    return;
  }
  try {
    await pdfMod.sharePdf(bytes);
    resetPdfButton();
  } catch (err) {
    if (err?.name === 'AbortError') { resetPdfButton(); return; }      // sheet closed
    if (err?.name === 'NotAllowedError') {                              // tap went stale
      pdfReady = bytes;
      resetPdfButton('PDF ready \u2014 tap to share');
      return;
    }
    resetPdfButton();
    toast(err?.message || 'Couldn\u2019t share the PDF');
  }
});

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
// Track this tail on Flightradar24.
//
// This used to open the in-house Airline Radar PWA. It points at FR24 while
// that app's keyless ADS-B feeds are unreliable — a tracker that sometimes has
// no aircraft is worse than one that always works, even if the latter is
// someone else's site. Switching back is a one-line change: rebuild the
// ../airline-radar-pwa/ URL with ?reg= (and the roster's ?sta=, which FR24
// doesn't need because it carries its own schedules).
function doRadar() {
  const tail = storage.getCurrent().dataCard.tail || $('hdr-tail').value;
  const reg = normaliseRegistration(tail);
  if (!reg) { toast('Set tail # first'); return; }
  // FR24's per-aircraft page is /data/aircraft/<reg>, lower-case and keeping
  // the dash: 4X-EHE → 4x-ehe. It shows the live position when airborne and
  // that airframe's recent flights when it isn't.
  const url = 'https://www.flightradar24.com/data/aircraft/'
    + encodeURIComponent(reg.toLowerCase());
  window.open(url, '_blank', 'noopener,noreferrer');
}
// ---------- Airspeed Unreliable (the QRH app next door) ----------
//
// Opens the Airspeed Unreliable quick-reference already set up for the flight
// on the card, so a non-normal doesn't start with two dropdowns.
//
// Variant comes from the airframe. Across 492 logged sectors the 4X fleet maps
// cleanly by registration block — EK is a -800, EH a -900 — and an imported
// sector also carries the type string outright. ED/ER are 787s and EC a 777,
// none of which this QRH covers, so those open the app without a variant and
// let the pilot choose rather than being shown the wrong aeroplane's numbers.
function asuVariant(leg, card) {
  const type = String((card && card.ac_type) || (leg && leg.ac_type) || '');
  if (/737\s*-?\s*8/.test(type)) return '800';
  if (/737\s*-?\s*9/.test(type)) return '900';
  const reg = normaliseRegistration((card && card.tail) || (leg && leg.tail) || '');
  const m = /^4X-E([A-Z])/.exec(reg);
  if (!m) return '';
  if (m[1] === 'K') return '800';
  if (m[1] === 'H') return '900';
  return '';
}

async function doAirspeedUnreliable() {
  // The airport table is lazy-loaded (the logbook pulls it in). Without this
  // the very first tap would quietly drop the altitude.
  try { await ensureLbAirports(); } catch { /* fall through without an altitude */ }
  const card = storage.getCurrent().dataCard || {};
  const leg  = storage.getLeg() || {};
  const params = new URLSearchParams();
  const v = asuVariant(leg, card);
  if (v) params.set('v', v);
  // Departure field elevation: the tables are indexed by airport altitude, and
  // the one airport we can be sure about on the ground is where we're leaving
  // from. Not every airport in the table carries an elevation, and the app is
  // explicit that an absent one just means "leave the picker alone".
  const dep = String(card.dep || leg.dep || '').trim().toUpperCase();
  if (dep && lbAirports) {
    const ap = lbAirports.lookup(dep);
    if (ap && Number.isFinite(ap.elev)) params.set('alt', String(Math.round(ap.elev)));
  }
  const q = params.toString();
  openEmbedded('../' + (q ? '?' + q : ''), 'Airspeed Unreliable',
    [v ? `737-${v}` : '', params.get('alt') ? `${dep} ${params.get('alt')} ft` : ''].filter(Boolean).join(' · '));
}

// 737 NG Inside — the systems explorer, a sibling app on the same site. Saved
// for offline the first time it's opened here (its own worker caches it).
function doSystems() {
  openEmbedded('../b737-systems-pwa/', '737 NG Inside', '');
}

// A sibling app shown inside Flight Card, full screen, with Done to come
// back. Inside, it uses the copy saved in Flight Card's own storage — a new
// window (the old way) is a separate browser on iOS, where it was never
// saved, so it failed offline.
function openEmbedded(url, title, note) {
  const frame = $('embed-frame');
  $('embed-title').textContent = title;
  $('embed-note').textContent = note || '';
  frame.title = title;
  frame.src = url;
  showOverlay('embed-overlay');
}
$('embed-done')?.addEventListener('click', () => hideOverlay('embed-overlay'));

// "•••" menu: close it once something in it is chosen, or on a tap
// anywhere else (it's a native <details>, which otherwise stays open).
document.addEventListener('click', (e) => {
  const menu = $('more-menu');
  if (!menu || !menu.open) return;
  if (e.target.closest('.more-item') || !e.target.closest('#more-menu')) menu.open = false;
});

// ---------- Offline ----------
// A small "Offline" pill by the clock whenever there's no connection, so a
// blank or old figure is never a mystery. Tap it for what still works.
function paintNet() {
  const pill = $('net-pill');
  if (!pill) return;
  const off = navigator.onLine === false;
  pill.hidden = !off;
  document.body.classList.toggle('is-offline', off);
}
window.addEventListener('online', paintNet);
window.addEventListener('offline', paintNet);
paintNet();
$('net-pill')?.addEventListener('click', () => toast('No internet — the card, checklist, PA, ASU and Route info run from what was saved; weather shows the last report with its age.', 4200));

// The ASU app's own service worker, registered from here so its pages and
// QRH tables are stored in Flight Card's storage (a Home-Screen app on iOS
// has its own). Only where the ASU app sits one level up — the deployed site
// and the suite dev server — never on a Flight-Card-only server.
function registerAsuWorker() {
  if (!('serviceWorker' in navigator) || !/\/flight-card-pwa\//.test(location.pathname)) return null;
  return navigator.serviceWorker.register('../sw.js', { scope: '../' }).catch(() => null);
}

function openSettingsSheet() {
  showOverlay('settings-overlay');
  try { paintCalendarSection(); } catch (err) { console.warn('cal paint skipped', err); }
  try { paintSensorsPanel(); }   catch (err) { console.warn('sensors paint skipped', err); }
  try { paintSocialSection(); }  catch (err) { console.warn('social paint skipped', err); }
  try { paintSectorsSection(); } catch (err) { console.warn('sectors paint skipped', err); }
  paintSettingsStatus().catch(err => console.warn('settings status skipped', err));
}

// Each Settings row says how it stands, so nothing has to be opened to find out.
async function paintSettingsStatus() {
  const put = (id, text) => { const el = $('set-st-' + id); if (el) el.textContent = text; };
  const ago = (ms) => {
    const m = Math.round((Date.now() - ms) / 60000);
    return m < 2 ? 'just now' : m < 90 ? `${m} min ago` : m < 2160 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
  };
  const cal = await import('./modules/calendar.js?v=262');
  const at = cal.getLastSyncAt();
  put('calendar', !cal.isConfigured() ? 'Not set up' : at ? `Synced ${ago(at)}` : 'Not synced yet');
  await paintSensorsPanel();
  const sensor = (name) => document.querySelector(`[data-sensor="${name}"] .sensor-state`)?.textContent.trim() || '';
  put('sensors', `GPS ${sensor('geolocation')} · Motion ${sensor('motion')}`);
  // A count, not the whole list — it's all inside.
  try {
    const r = (await import('./modules/route-info.js?v=262')).getCountryRules();
    const n = r.exclude.length, f = Object.keys(r.penalty).length;
    put('route', `${n} excluded · ${f} factor${f === 1 ? '' : 's'}`);
  } catch { put('route', ''); }
  put('lbcal', $('lbpush-url')?.value ? 'On' : 'Off');
  const last = Number(localStorage.getItem('fc.social.lastSync') || 0);
  put('social', !(localStorage.getItem('fc.social.feedUrl') || '').trim() ? 'Off' : last ? `Updated ${ago(last)}` : 'On');
  paintBackupSection();
}

// ---- Social-notes feed settings ----
function paintSocialSection() {
  const input = $('social-url');
  if (input && document.activeElement !== input) {
    input.value = localStorage.getItem('fc.social.feedUrl') || '';
  }
  const status = $('social-sync-status');
  if (status) {
    const url  = localStorage.getItem('fc.social.feedUrl') || '';
    const last = Number(localStorage.getItem('fc.social.lastSync') || 0);
    status.textContent = !url ? 'No feed configured.'
      : last ? `Last synced ${relDate(last)}.`
             : 'Feed set — not synced yet.';
  }
}
$('social-url').addEventListener('input', () => {
  const v = $('social-url').value.trim();
  if (v) localStorage.setItem('fc.social.feedUrl', v);
  else   localStorage.removeItem('fc.social.feedUrl');
  // Reset the throttle so the new URL syncs on the next check.
  localStorage.removeItem('fc.social.lastSync');
});
// ---------- Header actions ----------
// theme-toggle, new-flight, share-toggle, pa-toggle, radar-btn → routed via
// data-action delegate above. The remaining overlay close + roster modal
// handlers stay direct since they live inside overlays that get re-rendered.
$('newflight-close').addEventListener('click', () => hideOverlay('newflight-overlay'));
$('newflight-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'newflight-overlay') hideOverlay('newflight-overlay');
});
$('newflight-reset').addEventListener('click', () => {
  hideOverlay('newflight-overlay');
  openClearSheet();
});

$('newflight-blank').addEventListener('click', async () => {
  // Append a fresh empty leg and jump to it so the pilot can enter a flight
  // by hand (tail, route, crew, V-speeds) with nothing pre-filled.
  const idx = storage.addBlankLeg();
  hideOverlay('newflight-overlay');
  await applyLeg(idx);
  checklist.resetOverrides();
  // Focus the flight-number field so typing starts immediately.
  const flt = $('hdr-flight');
  if (flt) setTimeout(() => flt.focus(), 60);
  toast('Blank flight added — enter details');
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
    const { parseRoster } = await import('./modules/roster.js?v=262');
    const parsed = parseRoster(text);
    if (!parsed || !parsed.flights?.length) {
      // Not a roster — maybe the slot message (ACARS SAM, dispatch text).
      const { parseFmcText } = await import('./modules/ocr.js?v=262');
      const ctot = parseFmcText(text).ctot;
      if (ctot) {
        storage.setDataField('ctot', ctot);
        syncHeaderInputs();
        try { updateCtotColor(); } catch {}
        try { resetCtotAlertState(); } catch {}
        speeches.notifyDataChange();
        hideOverlay('roster-overlay');
        toast(`CTOT ${ctot}Z set`);
        return;
      }
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
  const { getCalendarUrl, getLastSyncAt } = await import('./modules/calendar.js?v=262');
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
  // Logbook auto-push panel — URL + last-push status.
  try {
    const lp = await import('./modules/logbook-push.js?v=262');
    const urlInput = $('lbpush-url');
    if (urlInput) urlInput.value = lp.subscribeUrls().https;
    paintLbPushStatus(lp.lastPushedAt());
  } catch (err) { console.warn('logbook-push paint failed', err); }
}
function paintLbPushStatus(at, errText = '') {
  const el = $('lbpush-status');
  if (!el) return;
  el.classList.remove('is-err', 'is-ok');
  if (errText) { el.classList.add('is-err'); el.textContent = errText; return; }
  el.textContent = at
    ? 'Last pushed ' + new Date(at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })
    : 'Not pushed yet';
}
$('lbpush-copy').addEventListener('click', async () => {
  try {
    const lp = await import('./modules/logbook-push.js?v=262');
    // Copy the https form — iOS Settings' "Add Subscribed Calendar" wants
    // a URL it can paste; webcal:// only helps as a tappable link.
    await navigator.clipboard.writeText(lp.subscribeUrls().https);
    toast('Link copied — paste it in Settings → Calendar → Accounts');
  } catch (err) {
    console.warn('copy failed', err);
    toast('Copy failed — long-press the URL to copy manually');
  }
});
$('cal-url').addEventListener('input', async () => {
  try {
    const { setCalendarUrl } = await import('./modules/calendar.js?v=262');
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
  if (calSyncRunning) return false;
  const status = $('cal-status');
  const btn    = $('cal-sync');
  if (source === 'manual') {
    if (status) { status.classList.remove('is-err', 'is-ok'); status.textContent = 'Syncing…'; }
    if (btn) btn.disabled = true;
  }
  calSyncRunning = true;
  try {
    const cal = await import('./modules/calendar.js?v=262');
    // Save current input first in case the user just edited but didn't blur.
    if (source === 'manual') cal.setCalendarUrl($('cal-url').value);
    // NOT `source` — this function's own parameter is called `source`, and a
    // const of the same name inside this block puts the parameter in its
    // temporal dead zone for the whole block, so the `source === 'manual'`
    // check above it throws "Cannot access 'source' before initialization"
    // and every sync dies. Valid syntax, so node --check cannot see it.
    const { events, flights, duties, phones, source: feedSource, ageSec } = await cal.syncFromCalendar();
    // 'stale' means Google refused and the proxy served its stored copy.
    const fromCopy = feedSource === 'stale'
      ? ` · from a stored copy${ageSec > 60 ? ' ' + Math.round(ageSec / 60) + ' min old' : ''}`
      : '';
    // Duties first: a calendar with sims and standbys but no flights this
    // month is still worth syncing — it used to count as "nothing found".
    const dutySync = storage.syncDuties(duties || []);
    if (!flights.length) {
      renderHistory();
      if (source === 'manual') {
        if (!(duties || []).length) {
          throw new Error(`No flights or duties found in ${events} calendar event${events === 1 ? '' : 's'}`);
        }
        if (status) {
          status.classList.add('is-ok');
          status.textContent = `${duties.length} dut${duties.length === 1 ? 'y' : 'ies'}, no flights${fromCopy}`;
        }
      }
      return dutySync.added > 0 || dutySync.removed > 0;
    }
    // Authoritative sync: append/merge incoming, then prune ONLY future
    // legs missing from the duty calendar. Past flown legs and manually-
    // entered legs are always kept. Nothing is ever pushed to the calendar.
    // The leg on screen, by identity — the sync re-sorts and re-points the
    // selection (to the newest / last-merged leg), so find it again after.
    const viewIdOf = (l) => l ? [l.flight, l.dep_date, l.dep_year, l.dep, l.arr].map(v => String(v ?? '')).join('|') : '';
    const viewing = viewIdOf(storage.getLegs()[storage.getLegIndex()]);
    const { index: syncIdx, added, replaced, pruned } =
      storage.syncFromCalendar(flights);
    let newIdx = syncIdx;
    const keep = holdingManualLeg() && viewing
      ? storage.getLegs().findIndex(l => viewIdOf(l) === viewing) : -1;
    if (keep >= 0) newIdx = keep;
    // Calendar phones go into the global crew registry — calendar wins on
    // every sync, matching the Phase 2.1 always-overwrite rule.
    if (phones && typeof phones === 'object') {
      for (const [canonical, phone] of Object.entries(phones)) {
        if (phone) storage.setCrewPhone(canonical, phone);
      }
    }
    await applyLeg(newIdx);
    renderHistory();
    const dutyNote = dutySync.total
      ? ` · ${dutySync.total} dut${dutySync.total === 1 ? 'y' : 'ies'}${dutySync.added ? ` (${dutySync.added} new)` : ''}`
      : '';
    const summary = syncSummary({ added, replaced, pruned }) + dutyNote;
    if (source === 'manual') {
      if (status) {
        status.classList.add('is-ok');
        status.textContent = `${summary} · ${events} event${events === 1 ? '' : 's'}${fromCopy}`;
      }
      toast(summary);
    } else if (added || replaced || pruned) {
      toast(summary + ' (auto-sync)');
    }
    // After every sync — manual or auto — jump to whichever leg's
    // dep → arr + 20 min window contains "now". The cooldown is reset
    // here so the post-sync jump always fires regardless of when the
    // last boot-jump happened.
    // ...unless the pilot picked a leg in the last 30 minutes (see pickLeg).
    try {
      if (!holdingManualLeg()) {
        storage.setLastBootJumpAt(0);
        maybeAutoJumpToCurrentLeg();
      }
    } catch (err) { console.warn('post-sync jump skipped', err); }
    return true;
  } catch (err) {
    if (source === 'manual' && status) {
      status.classList.add('is-err');
      status.textContent = err?.message || String(err);
    }
    console.warn(`calendar ${source} sync failed`, err);
    return false;
  } finally {
    calSyncRunning = false;
    if (source === 'manual' && btn) btn.disabled = false;
  }
}

// ---------- Header ↻ : reload AND refresh every remote source ----------
// #hard-reload is deliberately a plain <a href="./"> so it still navigates
// when JS is wedged — which means we must NOT preventDefault it to run the
// syncs first: the navigation would cancel them mid-flight. Instead the tap
// leaves a flag and the freshly-booted page picks it up (below), so the
// reload stays 100% native AND the syncs run against the new code.
const SYNC_AFTER_RELOAD_KEY = 'fc.syncAfterReload';
$('hard-reload')?.addEventListener('pointerdown', () => {
  try { localStorage.setItem(SYNC_AFTER_RELOAD_KEY, String(Date.now())); } catch {}
});

function consumeSyncAfterReload() {
  let ts = 0;
  try {
    ts = Number(localStorage.getItem(SYNC_AFTER_RELOAD_KEY) || 0);
    localStorage.removeItem(SYNC_AFTER_RELOAD_KEY);
  } catch {}
  // Honour only a flag from the reload that just happened — one left behind
  // by a crash must not trigger a surprise sync days later.
  if (!ts || Date.now() - ts > 2 * 60 * 1000) return;
  runFullSync();
}

// Calendar → social notes → logbook push, each isolated so one failure can't
// stop the others. Only sources that are actually configured are reported.
async function runFullSync({ quiet = false } = {}) {
  if (!quiet) toast('Refreshing…');
  const done = [];
  try {
    const { isConfigured } = await import('./modules/calendar.js?v=262');
    if (isConfigured() && await runCalendarSync('auto')) done.push('calendar');
  } catch (err) { console.warn('refresh: calendar sync failed', err); }
  try {
    if (await maybeSyncSocialNotes(true)) done.push('notes');
  } catch (err) { console.warn('refresh: social sync failed', err); }
  try {
    const lp = await import('./modules/logbook-push.js?v=262');
    const res = await lp.pushNow({ force: true });
    if (res?.ok && !res.skipped) done.push('logbook');
  } catch (err) { console.warn('refresh: logbook push failed', err); }
  try { await paintTlvBoard(true); if ($('leg-board') && !$('leg-board').hidden) done.push('TLV board'); } catch {}
  try { await dataCard.refreshMetar(dataBody, { force: true }); done.push('weather'); } catch {}
  // Route info (diversion weather + NOTAMs) for this flight, unless it's
  // already flown — a past leg's NOTAMs are no use.
  try {
    const leg = storage.getLegs()[storage.getLegIndex()] || null;
    const std = leg ? legTs(leg.dep_date, leg.dep_time, leg.dep_year) : NaN;
    if (leg && leg.dep && leg.arr && Number.isFinite(std) && Date.now() < std + 20 * 3600000) {
      const ru = await import('./modules/route-ui.js?v=262');
      ru.wire();
      await ru.ensureSaved();
      if (await ru.refresh(false)) done.push('route weather');
    }
  } catch (err) { console.warn('refresh: route info failed', err); }
  try { paintOffBlock(); } catch {}
  try { paintReadyLine(); } catch {}
  try { if (document.body.dataset.phase === 'before') await paintBeforeWx(storage.getLegs()[storage.getLegIndex()] || null, true); } catch {}
  toast(done.length ? `Updated ${done.join(' · ')}` : 'Already up to date');
}

// ---------- Pull to refresh ----------
// Pull the page down from the very top and let go: the same full refresh as
// the header reload — calendar (times, crew, actual off/on-block), notes,
// TLV board, METAR, route weather and NOTAMs — without reloading the page.
// iOS Home-Screen apps have no pull-to-refresh of their own. Not while a
// window is open over the card, nor when the pull starts on a field or a
// drag grip.
(function wirePullRefresh() {
  const ARM = 64, MAX = 96, REST = 60;   // px of pull; REST = where the badge sits while spinning
  let y0 = null, x0 = 0, pull = 0, active = false, busy = false;
  const el = () => $('ptr');
  // Badge position: `h` px of pull below the header's bottom edge.
  const place = (h, { settle = false } = {}) => {
    const p = el(); if (!p) return;
    p.classList.toggle('is-settling', settle);
    p.style.transform = `translateY(${h > 0 ? h - 44 : -56}px)`;
    p.style.opacity = h > 0 ? String(Math.min(1, h / 28)) : '0';
  };
  const paint = (h) => {
    const p = el(); if (!p) return;
    p.classList.toggle('is-armed', h >= ARM);
    const arc = p.querySelector('.ptr-arc');
    const fill = Math.min(1, h / ARM) * 80;
    if (arc) arc.style.strokeDasharray = `${fill} ${100 - fill}`;
    const svg = p.querySelector('svg'); if (svg) svg.style.transform = `rotate(${Math.round(h * 3)}deg)`;
    place(h);
  };
  const reset = () => {
    const p = el(); if (!p) return;
    place(0, { settle: true });
    setTimeout(() => {
      p.classList.remove('is-armed', 'is-busy', 'is-done');
      const arc = p.querySelector('.ptr-arc'); if (arc) arc.style.strokeDasharray = '';
      const svg = p.querySelector('svg'); if (svg) svg.style.transform = '';
    }, 260);
  };
  const blocked = (t) => !!(document.querySelector('.overlay:not(.hidden)')
    || $('more-menu')?.open
    || t.closest('.checklist-float')
    || t.closest('input, textarea, select, [contenteditable="true"], [data-group-grip], .data-grip'));
  document.addEventListener('touchstart', (e) => {
    y0 = null;
    if (busy || e.touches.length !== 1 || window.scrollY > 0 || blocked(e.target)) return;
    y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; pull = 0; active = false;
    const hdr = document.querySelector('.app-top');
    const p = el(); if (p && hdr) p.style.setProperty('--ptr-top', Math.round(hdr.getBoundingClientRect().bottom) + 'px');
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    const dy = e.touches[0].clientY - y0, dx = e.touches[0].clientX - x0;
    if (!active) {
      // Up or sideways is ordinary scrolling / swiping: not ours.
      if (dy < 0 || Math.abs(dx) > Math.max(6, dy) || window.scrollY > 0) { y0 = null; return; }
      if (dy === 0) return;
      // Claimed from the first downward move — iOS won't let a rubber-band
      // bounce that has already started be cancelled later.
      e.preventDefault();
      if (dy < 8) return;
      active = true;
      el()?.classList.remove('is-settling');
    }
    e.preventDefault();
    pull = Math.min(MAX, Math.max(0, dy - 8) * 0.5);
    paint(pull);
  }, { passive: false });
  const end = async () => {
    if (y0 == null) return;
    y0 = null;
    if (!active) return;
    active = false;
    if (pull < ARM) { reset(); return; }
    if (navigator.onLine === false) { toast('No internet — nothing to refresh'); reset(); return; }
    busy = true;
    const p = el();
    if (p) {
      p.classList.add('is-busy');
      p.querySelector('.ptr-arc').style.strokeDasharray = '';
      p.querySelector('svg').style.transform = '';
    }
    place(REST, { settle: true });
    // Spin for at least a moment, so a quick refresh still reads as one.
    const t0 = Date.now();
    try { await runFullSync({ quiet: true }); } catch (err) { console.warn('pull refresh failed', err); }
    await new Promise(r => setTimeout(r, Math.max(0, 700 - (Date.now() - t0))));
    if (p) { p.classList.remove('is-busy'); p.classList.add('is-done'); }
    await new Promise(r => setTimeout(r, 650));
    busy = false;
    reset();
  };
  document.addEventListener('touchend', end, { passive: true });
  document.addEventListener('touchcancel', end, { passive: true });
})();

// Auto-refresh: fires the same sync 3 hours before any upcoming leg's
// dep_time, with a 60-min cooldown so the same window doesn't sync
// repeatedly. Runs on every 10-min interval tick + once on app load +
// once on visibility-change (so coming back to the app after hours away
// catches up).
const AUTO_SYNC_WINDOW_MS   = 3 * 60 * 60 * 1000;   // 3h pre-departure
const AUTO_SYNC_COOLDOWN_MS = 60 * 60 * 1000;       // at most once / hr
async function maybeAutoSyncCalendar() {
  try {
    const { isConfigured, getLastSyncAt } = await import('./modules/calendar.js?v=262');
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
  return legTs(leg?.dep_date, leg?.dep_time, leg?.dep_year);
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
// The airport board moves faster than the roster: repaint on the same tick
// (its own 5-minute cache decides whether that actually fetches).
setInterval(() => {
  try { paintTlvBoard(); } catch {}
  try { dataCard.refreshMetar(dataBody); } catch {}
  try { routeAutoUpdate(); } catch {}
  try { paintPhase(); } catch {}
}, 10 * 60 * 1000);
setTimeout(() => { try { routeAutoUpdate(); } catch {} }, 6 * 1000);

// ---------- Route info (modules/route-ui.js) ----------
// Loaded on demand; the auto-update only does anything from an hour before
// departure to arrival, so the import is cheap the rest of the time.
function openRouteInfo(focus = '') { setPhase('air', focus); }
// The notes popup's "Diversion" tab: this airport in Route info. Arrived
// from Route info's "Notes" tab? Then back to that same flight (it may be
// an old one from the logbook), not the leg on the main screen.
let routeReturnLeg = null;
// Route info open UNDERNEATH (the notes were opened from it): close the
// notes and go back down to it, on this airport's card. Otherwise open Route
// info ON TOP and leave the notes beneath — closing Route info then comes
// straight back to them. Close both and everything is closed.
$('airport-route')?.addEventListener('click', async () => {
  const code = airportNoteFor;
  const leg = routeReturnLeg;
  try {
    const ru = await import('./modules/route-ui.js?v=262');
    ru.wire();
    if (!$('route-overlay').classList.contains('hidden')) {
      flushAirportNotes();
      hideOverlay('airport-overlay');
      ru.focusAirport(code);
      return;
    }
    await ru.open(leg || null, { focus: code });
    raiseOverlay('route-overlay');
  } catch (err) { console.warn('route info failed', err); }
});
// Route info's "Notes" tab → this airport's notes: on top of Route info, or
// (back) Route info has just closed and the notes beneath show this airport.
window.addEventListener('fc:airport-notes', async (e) => {
  const { code, leg, back } = e.detail || {};
  if (!code) return;
  if (back) flushAirportNotes();
  await showAirportInfo(code);
  routeReturnLeg = leg || null;
  if (!back) raiseOverlay('airport-overlay');
});

// In the air with GPS (the take-off / landing detector armed and airborne):
// a chip in the flight strip naming the airport quickest to reach — tap for
// its diversion card. Refreshed every 30 s from the detector's last fix.
let nearPrevFix = null;
async function updateNearChip() {
  const el = $('leg-near');
  if (!el) return;
  const hide = () => { if (!el.hidden) el.hidden = true; };
  if (!gpsActive) return hide();
  let gps;
  try { ({ gps } = await loadSensorMods()); } catch { return hide(); }
  const st = gps.getState(), fix = gps.getLastFix && gps.getLastFix();
  if (!st || st.phase !== 'airborne' || !fix || Date.now() - fix.ts > 90 * 1000) return hide();
  let trk = fix.heading != null && (fix.speedMps || 0) > 20 ? fix.heading : null;
  if (trk == null && nearPrevFix) {
    const R = Math.PI / 180, dl = (fix.lon - nearPrevFix.lon) * R;
    const y = Math.sin(dl) * Math.cos(fix.lat * R), x = Math.cos(nearPrevFix.lat * R) * Math.sin(fix.lat * R) - Math.sin(nearPrevFix.lat * R) * Math.cos(fix.lat * R) * Math.cos(dl);
    trk = (Math.atan2(y, x) / R + 360) % 360;
  }
  nearPrevFix = fix;
  const g = { lat: fix.lat, lon: fix.lon, altFt: (fix.altM || 0) * 3.28084, gs: (fix.speedMps || 0) * 1.94384, trk: trk ?? 0, airborne: true };
  try {
    const ru = await import('./modules/route-ui.js?v=262');
    const leg = storage.getLegs()[storage.getLegIndex()] || null;
    const n = await ru.nearestNow(leg, g);
    if (!n) return hide();
    el.innerHTML = `Nearest <b>${escapeHtml(n.icao)}</b> ≈${Math.round(n.min)}′ <span class="ri-score ri-b-${n.band}">${n.score}</span>`;
    el.dataset.icao = n.icao;
    el.hidden = false;
  } catch { hide(); }
}
$('leg-near')?.addEventListener('click', (e) => openRouteInfo(e.currentTarget.dataset.icao || ''));
setInterval(() => { try { updateNearChip(); } catch {} try { ftlEtaTick().catch(() => {}); } catch {} }, 30 * 1000);
async function routeAutoUpdate() {
  if (navigator.onLine === false) return;
  const leg = storage.getLegs()[storage.getLegIndex()] || null;
  const std = leg ? legTs(leg.dep_date, leg.dep_time, leg.dep_year) : NaN;
  if (!Number.isFinite(std) || Date.now() < std - 12 * 3600000 || Date.now() > std + 20 * 3600000) return;
  const ru = await import('./modules/route-ui.js?v=262');
  ru.wire();
  await ru.autoUpdate();
  paintReadyLine();
}

// ---------- Ready for flight ----------
// One line instead of a list to check: what's saved for this flight and how
// old the weather is. NOTAMs are named until they've really been checked, so
// the line never reads as more than it knows.
async function paintReadyLine() {
  const el = $('ready-line');
  if (!el) return;
  const seq = (paintReadyLine.seq = (paintReadyLine.seq || 0) + 1);
  const leg = storage.getLegs()[storage.getLegIndex()] || null;
  const now = Date.now();
  const std = leg ? legTs(leg.dep_date, leg.dep_time, leg.dep_year) : NaN;
  const sta = leg ? legTs(leg.arr_date, leg.arr_time, leg.arr_year || leg.dep_year) : NaN;
  const end = Number.isFinite(sta) ? sta : std + 12 * 3600000;
  if (!leg || !leg.dep || !leg.arr || !Number.isFinite(std) || now < std - 12 * 3600000 || now > end) {
    el.hidden = true;
    return;
  }
  let r = null;
  try {
    const ru = await import('./modules/route-ui.js?v=262');
    r = await ru.readiness(leg);
  } catch (err) { console.warn('readiness skipped', err); }
  if (seq !== paintReadyLine.seq) return;
  if (!r) { el.hidden = true; return; }
  const offline = navigator.onLine === false;
  const min = r.wxAt ? Math.round((now - r.wxAt) / 60000) : Infinity;
  const age = min < 2 ? 'just updated' : min < 90 ? `${min} min old` : `${Math.round(min / 60)} h old`;
  const missing = [!r.db && 'airport data', !r.asu && 'ASU', ...r.noWx.map(code => `${code} weather`)].filter(Boolean);
  const wxOk = min <= 60;
  const ok = wxOk && !missing.length;
  const head = ok ? 'Ready for flight'
    : offline ? 'Offline'
    : min === Infinity || missing.length ? 'Preparing…' : 'Updating…';
  const parts = [
    r.wxAt ? `route weather ${age}` : 'no route weather saved',
    missing.length ? `${missing.join(', ')} not saved` : '',
    r.notams === 'ok' ? 'NOTAMs checked' : 'NOTAMs not checked',
  ].filter(Boolean);
  el.innerHTML = `<b>${head}</b> · ${escapeHtml(parts.join(' · '))}`;
  el.className = `ready-line ${ok ? 'is-ok' : offline ? 'is-bad' : 'is-warn'}`;
  el.hidden = false;
}
window.addEventListener('online',  () => { try { routeAutoUpdate(); paintReadyLine(); } catch {} });
window.addEventListener('offline', () => { try { paintReadyLine(); } catch {} });
setInterval(() => { try { paintReadyLine(); paintPhase(); paintFdpChip(); } catch {} }, 60 * 1000);

// Settings → Route info: the rules, as two plain text fields. Each entry is
// a country — by name ("Turkey") or code ("TR") — or an airport by ICAO
// ("LCLK"); shown back as names with codes, so it reads as it applies.
(function wireDivCountries() {
  const ex = $('div-exclude'), pen = $('div-penalty');
  if (!ex || !pen) return;
  let names = null;                              // code → country name
  const lib = async () => {
    const ri = await import('./modules/route-info.js?v=262');
    if (!names) { try { names = (await ri.loadDb()).countries || {}; } catch { names = {}; } }
    return ri;
  };
  const show = (k) => names[k] ? `${names[k]} (${k})` : k;
  // "Turkey -2, EG -2, LCLK +1" → [['TR', -2], ['EG', -2], ['LCLK', 1]]
  const parse = (text, withNum) => {
    const byName = new Map(Object.entries(names).map(([k, v]) => [v.toUpperCase(), k]));
    const out = [], bad = [];
    for (let part of String(text || '').split(/[,;\n]+/)) {
      part = part.trim();
      if (!part) continue;
      let num = null;
      if (withNum) {
        const m = /([+-]?\d+(?:\.\d+)?)\s*$/.exec(part);
        if (!m) { bad.push(part); continue; }
        num = Number(m[1]); part = part.slice(0, m.index).trim();
      }
      // "Turkey (TR)" as shown back, or a bare name / code.
      const paren = /\(([A-Z]{2,4})\)\s*$/i.exec(part);
      const word = (paren ? paren[1] : part).toUpperCase();
      const code = byName.get(word) || (/^[A-Z]{2}$/.test(word) && names[word] ? word : /^[A-Z]{4}$/.test(word) ? word : null);
      if (code) out.push([code, num]); else bad.push(part);
    }
    return { out, bad };
  };
  const load = async () => {
    const ri = await lib();
    const r = ri.getCountryRules();
    ex.value = r.exclude.map(show).join(', ');
    pen.value = Object.entries(r.penalty).map(([k, v]) => `${show(k)} ${v > 0 ? '+' : ''}${v}`).join(', ');
    fitRules();
  };
  const save = async () => {
    const ri = await lib();
    const e = parse(ex.value, false), p = parse(pen.value, true);
    const penalty = {};
    for (const [k, v] of p.out) penalty[k] = v;
    ri.setCountryRules({ exclude: [...new Set(e.out.map(([k]) => k))], penalty });
    const bad = [...e.bad, ...p.bad];
    toast(bad.length ? `Saved — not understood: ${bad.join(', ')}` : 'Diversion rules saved');
    load();
  };
  // Tall enough to show every entry (and again once the section is open —
  // closed, it measures nothing).
  const fitRules = () => { for (const t of [ex, pen]) { if (!t.offsetParent) continue; t.style.height = 'auto'; t.style.height = t.scrollHeight + 2 + 'px'; } };
  ex.addEventListener('input', fitRules);
  pen.addEventListener('input', fitRules);
  ex.closest('details')?.addEventListener('toggle', fitRules);
  document.addEventListener('click', () => setTimeout(fitRules, 50));
  ex.addEventListener('change', save);
  pen.addEventListener('change', save);
  load();
})();
// calendar auto-sync runs from the consolidated module-level visibilitychange
// listener defined below (alongside the GPS re-arm).

// ---------- Backup (modules/backup.js) ----------
// Everything in one file, sent by the share sheet to iCloud Drive or Mail;
// restore shows what a file holds first, then replaces or adds what's
// missing, with this iPad's state kept aside so a restore can be undone.
let backupPicked = null;
function backupAgo(ms) {
  const d = Math.floor((Date.now() - ms) / 86400000);
  return d < 1 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
}
async function paintBackupSection() {
  const bk = await import('./modules/backup.js?v=262');
  const l = bk.last();
  const txt = l ? `Last backup ${backupAgo(l.at)} · ${l.legs} legs` : 'Never backed up';
  $('backup-last').textContent = txt;
  const st = $('set-st-backup'); if (st) st.textContent = l ? `Last ${backupAgo(l.at)}` : 'Never';
  $('backup-undo').hidden = !(await bk.safety());
}
async function backupNow() {
  const bk = await import('./modules/backup.js?v=262');
  const b = bk.snapshot();
  const json = JSON.stringify(b);
  const file = new File([json], bk.filename(b), { type: 'application/json' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Flight Card backup', text: file.name });
      bk.markDone(b);
      toast('Backed up');
    } else {
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url; a.download = file.name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      bk.markDone(b);
      toast('Saved to Downloads');
    }
  } catch (err) {
    if (err?.name !== 'AbortError') toast('Backup failed: ' + (err?.message || err));
  }
  paintBackupNudge();
  paintBackupSection();
}
$('backup-now').addEventListener('click', backupNow);
$('backup-pick').addEventListener('change', async (e) => {
  const f = e.target.files?.[0];
  e.target.value = '';
  if (!f) return;
  const bk = await import('./modules/backup.js?v=262');
  try { backupPicked = bk.parse(await f.text()); }
  catch (err) { toast(err.message || 'Not a backup file'); return; }
  if (backupPicked.exp) { paintExportImport(f.name); return; }
  const c = backupPicked.counts;
  const when = backupPicked.at ? new Date(backupPicked.at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'an older export';
  const box = $('backup-preview');
  box.innerHTML = `<b>${escapeHtml(f.name)}</b>
    <div class="muted small">Made ${escapeHtml(when)}</div>
    <ul class="backup-counts">
      <li><b>${c.legs}</b> legs${c.lastFlight ? `, last ${escapeHtml(c.lastFlight)}` : ''}</li>
      <li><b>${c.duties}</b> duties · <b>${c.crew}</b> crew</li>
      <li><b>${c.notes}</b> notes · <b>${c.airportNotes}</b> airport notes · <b>${c.speeches}</b> PAs</li>
      ${backupPicked.old ? '<li class="muted">Older export: the main data only, no settings.</li>' : ''}
    </ul>
    <div class="settings-row-btns">
      <button type="button" class="btn danger" data-restore="replace">Replace everything</button>
      <button type="button" class="btn primary" data-restore="merge">Add what's missing</button>
      <button type="button" class="btn" data-restore="cancel">Cancel</button>
    </div>
    <div class="muted small">Replace: this iPad becomes the backup (new iPad, reinstall). Add: keeps everything here and adds the flights and notes it doesn't have. Either way, this iPad's data is kept aside first, so it can be undone.</div>`;
  box.hidden = false;
});
$('backup-preview').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-restore]');
  if (!b || !backupPicked) return;
  const mode = b.dataset.restore;
  if (mode === 'cancel') { $('backup-preview').hidden = true; backupPicked = null; return; }
  if (mode === 'add-export') {
    const bk = await import('./modules/backup.js?v=262');
    try {
      await bk.saveSafety();
      const a = storage.mergeExport(backupPicked.parts);
      const ex = await import('./modules/export.js?v=262');
      toast(`Added: ${ex.summary(a) || 'nothing new — all already here'} — reloading…`);
      hideOverlay('settings-overlay');
      setTimeout(() => location.reload(), 1200);
    } catch (err) { toast('Import failed: ' + (err?.message || err)); }
    return;
  }
  if (mode === 'replace' && !confirm('Replace everything on this iPad with this backup?')) return;
  const bk = await import('./modules/backup.js?v=262');
  try {
    await bk.saveSafety();
    if (mode === 'replace') bk.restoreReplace(backupPicked);
    else {
      const a = bk.restoreMerge(backupPicked);
      toast(`Added ${a.legs || 0} legs, ${a.notes || 0} notes, ${a.airportNotes || 0} airport notes — reloading…`);
    }
    if (mode === 'replace') toast('Restored — reloading…');
    hideOverlay('settings-overlay');
    setTimeout(() => location.reload(), 900);
  } catch (err) {
    toast('Restore failed: ' + (err?.message || err));
  }
});
// An Export file picked in Restore: what's in it, and one way in — added.
async function paintExportImport(name) {
  const ex = await import('./modules/export.js?v=262');
  const when = backupPicked.at ? new Date(backupPicked.at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  const box = $('backup-preview');
  box.innerHTML = `<b>${escapeHtml(name)}</b>
    <div class="muted small">Exported ${escapeHtml(when)}</div>
    <ul class="backup-counts"><li>${escapeHtml(ex.summary(backupPicked.counts || {}) || 'Empty')}</li></ul>
    <div class="settings-row-btns">
      <button type="button" class="btn primary" data-restore="add-export">Add to this iPad</button>
      <button type="button" class="btn" data-restore="cancel">Cancel</button>
    </div>
    <div class="muted small">Only adds. A note that's already here with other text gets the new text under a divider; flights already here are left as they are. This iPad's data is kept aside first, so it can be undone.</div>`;
  box.hidden = false;
}

// ---------- Export: a file of just what's ticked ----------
let exportSel = null, exportInv = null, exportQ = '', exportPickOpen = false;
async function openExport() {
  const ex = await import('./modules/export.js?v=262');
  exportInv = ex.inventory();
  exportSel = { notes: [], airportNotes: false, crew: false, phones: false, speeches: false, past: false, future: false, flights: [] };
  exportQ = ''; exportPickOpen = false;
  showOverlay('export-overlay'); raiseOverlay('export-overlay');
  paintExport();
}
function exportFlightRow(f) {
  const l = f.leg;
  const d = String(l.dep_date || '');
  const yr = l.dep_year ? '.' + String(l.dep_year).slice(-2) : '';
  return `<label class="ex-flight"><input type="checkbox" data-ex-flight="${escapeHtml(f.id)}" ${exportSel.flights.includes(f.id) ? 'checked' : ''}>
      <span class="ex-f-d">${escapeHtml(d + yr)}</span><b>${escapeHtml(displayFlight(l.flight) || l.flight || '—')}</b>
      <span class="ex-f-r">${escapeHtml(l.dep || '')} → ${escapeHtml(l.arr || '')}</span></label>`;
}
function exportPickList() {
  const q = exportQ.trim().toLowerCase();
  const list = exportInv.flights.filter(f => !q || `${f.leg.flight} ${f.leg.dep} ${f.leg.arr} ${f.leg.dep_date} ${f.leg.tail || ''}`.toLowerCase().includes(q));
  return list.slice(0, 60).map(exportFlightRow).join('') + (list.length > 60 ? `<p class="muted small">${list.length - 60} more — search to narrow.</p>` : '')
    + (list.length ? '' : '<p class="muted small">No flights match.</p>');
}
function paintExport() {
  const inv = exportInv, s = exportSel;
  const row = (attr, on, label, n, sub = '') => `<label class="ex-row"><input type="checkbox" ${attr} ${on ? 'checked' : ''} ${n === 0 ? 'disabled' : ''}>
      <span class="ex-l">${label}${sub ? `<small>${sub}</small>` : ''}</span><span class="ex-n">${n}</span></label>`;
  const allNotes = inv.notes.length && s.notes.length === inv.notes.length;
  $('export-body').innerHTML = `
    <div class="ex-group"><div class="ex-h">Notes</div>
      ${row('data-ex="notes-all"', allNotes, 'All Notes tabs', inv.notes.length)}
      <div class="ex-sub">${inv.notes.map(n => `<label class="ex-chip${s.notes.includes(n.id) ? ' is-on' : ''}"><input type="checkbox" data-ex-note="${escapeHtml(n.id)}" ${s.notes.includes(n.id) ? 'checked' : ''}>${escapeHtml(n.name)}</label>`).join('')}</div>
      ${row('data-ex="airportNotes"', s.airportNotes, 'Airport notes', inv.airportNotes, 'your notes and Social notes per airport')}
    </div>
    <div class="ex-group"><div class="ex-h">Crew</div>
      ${row('data-ex="crew"', s.crew, 'Crew notes &amp; colours', inv.crew, 'with nicknames')}
      ${s.crew ? row('data-ex="phones"', s.phones, 'Include phone numbers', inv.crew) : ''}
    </div>
    <div class="ex-group"><div class="ex-h">PA</div>
      ${row('data-ex="speeches"', s.speeches, 'PA announcements', inv.speeches)}
    </div>
    <div class="ex-group"><div class="ex-h">Flights</div>
      ${row('data-ex="past"', s.past, 'Past flights', inv.past, 'the logbook')}
      ${row('data-ex="future"', s.future, 'Future flights', inv.future, 'from the roster')}
      <button type="button" class="ex-pick-btn" data-ex-pick>${exportPickOpen ? 'Hide' : 'Choose specific flights…'}${s.flights.length ? ` · ${s.flights.length} chosen` : ''}</button>
      ${exportPickOpen ? `<div class="ex-pick">
        <input id="export-q" class="ex-q" type="search" placeholder="Flight, airport, date, tail" value="${escapeHtml(exportQ)}" autocomplete="off" autocorrect="off" spellcheck="false">
        <div id="export-flights" class="ex-flights">${exportPickList()}</div></div>` : ''}
    </div>`;
  paintExportSum();
}
async function paintExportSum() {
  const ex = await import('./modules/export.js?v=262');
  const x = ex.build(exportSel);
  const sum = ex.summary(x.counts);
  $('export-sum').textContent = sum || 'Tick what to export';
  $('export-go').disabled = !sum;
}
$('export-open')?.addEventListener('click', () => { openExport().catch(err => toast('Export failed: ' + (err?.message || err))); });
$('export-close')?.addEventListener('click', () => hideOverlay('export-overlay'));
$('export-overlay')?.addEventListener('click', (e) => {
  if (e.target.id === 'export-overlay') { hideOverlay('export-overlay'); return; }
  if (e.target.closest('[data-ex-pick]')) { exportPickOpen = !exportPickOpen; paintExport(); if (exportPickOpen) $('export-q')?.focus(); }
});
$('export-overlay')?.addEventListener('change', (e) => {
  const t = e.target, s = exportSel;
  if (!s) return;
  if (t.dataset.ex === 'notes-all') s.notes = t.checked ? exportInv.notes.map(n => n.id) : [];
  else if (t.dataset.ex) s[t.dataset.ex] = t.checked;
  else if (t.dataset.exNote) s.notes = t.checked ? [...s.notes, t.dataset.exNote] : s.notes.filter(x => x !== t.dataset.exNote);
  else if (t.dataset.exFlight) {
    s.flights = t.checked ? [...s.flights, t.dataset.exFlight] : s.flights.filter(x => x !== t.dataset.exFlight);
    const b = document.querySelector('[data-ex-pick]');
    if (b) b.textContent = `Hide${s.flights.length ? ` · ${s.flights.length} chosen` : ''}`;
    paintExportSum();
    return;
  }
  if (t.dataset.ex === 'crew' && !t.checked) s.phones = false;
  paintExport();
});
$('export-overlay')?.addEventListener('input', (e) => {
  if (e.target.id === 'export-q') { exportQ = e.target.value; $('export-flights').innerHTML = exportPickList(); }
});
$('export-go')?.addEventListener('click', async () => {
  const ex = await import('./modules/export.js?v=262');
  const x = ex.build(exportSel);
  const file = new File([JSON.stringify(x)], ex.filename(x), { type: 'application/json' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Flight Card export', text: ex.summary(x.counts) });
      toast('Exported');
    } else {
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url; a.download = file.name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast('Saved to Downloads');
    }
    hideOverlay('export-overlay');
  } catch (err) {
    if (err?.name !== 'AbortError') toast('Export failed: ' + (err?.message || err));
  }
});

$('backup-undo').addEventListener('click', async () => {
  const bk = await import('./modules/backup.js?v=262');
  const s = await bk.safety();
  if (!s || !confirm(`Put this iPad back as it was before the last restore (${s.counts.legs} legs)?`)) return;
  bk.restoreReplace(s);
  toast('Back as it was — reloading…');
  setTimeout(() => location.reload(), 900);
});
// The reminder: on the Brief, never in the air or over a window.
async function paintBackupNudge() {
  const el = $('backup-nudge');
  if (!el) return;
  try {
    const bk = await import('./modules/backup.js?v=262');
    const d = bk.due();
    const busy = document.querySelector('.overlay:not(.hidden)') || legPhase().phase === 'air';
    if (!d || busy) { el.hidden = true; return; }
    $('backup-nudge-txt').textContent = d.why === 'never' ? 'This iPad has never been backed up.'
      : d.why === 'days' ? `No backup for ${d.days} days.` : `${d.legs} new legs since the last backup.`;
    el.hidden = false;
  } catch { el.hidden = true; }
}
$('backup-nudge').addEventListener('click', async (e) => {
  if (e.target.closest('[data-backup-now]')) { backupNow(); return; }
  if (e.target.closest('[data-backup-later]')) {
    const bk = await import('./modules/backup.js?v=262');
    bk.snooze(3);
    $('backup-nudge').hidden = true;
  }
});
setTimeout(() => { try { paintBackupNudge(); } catch {} }, 8000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') setTimeout(() => { try { paintBackupNudge(); } catch {} }, 3000);
});

// Logbook .ics export — every stored leg as one VEVENT. Same Share Sheet
// flow as the AirDrop JSON button above.
$('logbook-export-btn').addEventListener('click', () => {
  const row = $('logbook-export-row');
  row.hidden = !row.hidden;
  $('logbook-export-btn').setAttribute('aria-expanded', String(!row.hidden));
});
async function exportLogbook(ext, type, build) {
  const lb = await import('./modules/logbook.js?v=262');
  const legs = lb.allStoredLegs();
  if (!legs.length) { toast('No flights to export yet'); return; }
  const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const filename = `flightcard-logbook-${ymd}.${ext}`;
  const blob = new Blob([build(lb, legs)], { type });
  const file = new File([blob], filename, { type });
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
  toast(`Saved ${legs.length} flight${legs.length === 1 ? '' : 's'}`);
}
$('logbook-csv').addEventListener('click', () => exportLogbook('csv', 'text/csv', (lb, legs) => lb.buildCsv(legs)));
$('logbook-export').addEventListener('click', () => exportLogbook('ics', 'text/calendar', (lb, legs) => lb.buildIcs(legs)));

// ---------- Analytics overlay (read-only, computed from stored legs) ----------
// null = all time. Defaults to this year, which is what the panel always
// showed — the difference is that it is now a choice rather than a hard-wire.
let anYear = new Date().getUTCFullYear();
// The search's picked terms ({ type, value }), all of which a flight must
// match. Kept across repaints and year changes; cleared one chip at a time.
let anFilters = [];
let anIndex = null;          // analytics.searchIndex() — the suggestion pool
let anCity = null;           // airports.cityName, for suggestion labels
let anShowAll = false;       // result list expanded past its first rows

async function paintAnalytics() {
  const body = $('analytics-body');
  const keepScroll = body.closest('.ocr-sheet')?.scrollTop || 0;
  body.innerHTML = '<p class="muted small" style="padding:18px 4px;">Crunching…</p>';
  try {
    const an = await import('./modules/analytics.js?v=262');
    const airports = await import('./modules/airports.js?v=262');
    const world = await import('./modules/worldmap.js?v=262');
    const data = an.snapshot(anYear, anFilters);
    data.routeLegs = an.flownRoutes(data.pool);
    data.heatFrom = an.heatFrom;
    anIndex = an.searchIndex(an.allLegs());
    anCity = airports.cityName;
    body.innerHTML = renderAnalytics(data, {
      cityName: airports.cityName, displayCrew: storage.displayCrew, airports, world,
    });
    const sheet = body.closest('.ocr-sheet');
    if (sheet && keepScroll) sheet.scrollTop = keepScroll;
  } catch (err) {
    console.warn('analytics render failed', err);
    body.innerHTML = `<p class="muted small">Couldn't compute analytics: ${err?.message || err}</p>`;
  }
}

$('analytics-open').addEventListener('click', async () => {
  hideOverlay('logbook-overlay');
  showOverlay('analytics-overlay');
  await paintAnalytics();
});

// Year picker — delegated, because the panel is rebuilt on every change.
$('analytics-body').addEventListener('click', (e) => {
  const pick = e.target.closest('[data-an-year]');
  if (!pick) return;
  const v = pick.dataset.anYear;
  anYear = v === 'all' ? null : Number(v);
  anShowAll = false;
  paintAnalytics();
});

// ---------- Analytics search ----------
const AN_TYPE_LABEL = { crew: 'Crew', dest: 'Destination', aircraft: 'Aircraft', flight: 'Flight', text: 'Contains' };
function anTermLabel(type, value) {
  if (type === 'crew') return storage.displayCrew(value) || value;
  if (type === 'dest') { const c = anCity && anCity(value); return c ? `${value} · ${c}` : value; }
  if (type === 'flight') return displayFlight(value);
  return value;
}
// Suggestions for what's typed: each kind of term, best first — a name that
// STARTS with the text beats one that merely contains it, then the most
// flown. A nickname or a city counts as a hit too ("dub" finds DUB · Dublin).
function anSuggestions(q) {
  const t = q.trim().toUpperCase();
  if (!t || !anIndex) return [];
  const out = [];
  for (const type of ['crew', 'dest', 'aircraft', 'flight']) {
    for (const [value, n] of anIndex[type]) {
      if (anFilters.some(f => f.type === type && f.value === value)) continue;
      const label = anTermLabel(type, value);
      const hay = `${value} ${label}`.toUpperCase();
      const at = hay.indexOf(t);
      if (at < 0) continue;
      const starts = at === 0 || /[\s·-]/.test(hay[at - 1]);
      out.push({ type, value, label, n, rank: (starts ? 0 : 1) });
    }
  }
  out.sort((a, b) => a.rank - b.rank || b.n - a.n);
  return out.slice(0, 8);
}
function paintAnSuggestions() {
  const q = $('an-q'), box = $('an-sugg');
  if (!q || !box) return;
  const list = anSuggestions(q.value);
  box.innerHTML = list.map(s => `
    <button type="button" class="an-sugg-row" data-an-pick="${escapeAttr(s.type)}" data-an-value="${escapeAttr(s.value)}">
      <span class="an-sugg-type">${escapeHtml(AN_TYPE_LABEL[s.type])}</span>
      <span class="an-sugg-label">${escapeHtml(s.label)}</span>
      <span class="an-sugg-n">${s.n}</span>
    </button>`).join('')
    + (q.value.trim() ? `<button type="button" class="an-sugg-row is-text" data-an-pick="text" data-an-value="${escapeAttr(q.value.trim())}">
        <span class="an-sugg-type">Search</span><span class="an-sugg-label">“${escapeHtml(q.value.trim())}” anywhere</span></button>` : '');
  box.classList.toggle('hidden', !q.value.trim());
}
function anAddFilter(type, value) {
  const v = String(value || '').trim();
  if (!v) return;
  if (!anFilters.some(f => f.type === type && f.value === v)) anFilters.push({ type, value: v });
  anShowAll = false;
  paintAnalytics();
}
$('analytics-body').addEventListener('input', (e) => {
  if (e.target.id === 'an-q') paintAnSuggestions();
});
$('analytics-body').addEventListener('keydown', (e) => {
  if (e.target.id !== 'an-q') return;
  if (e.key === 'Enter') {
    e.preventDefault();
    // Enter takes the top suggestion — usually what was meant — or, with
    // none, searches the typed text everywhere.
    const top = anSuggestions(e.target.value)[0];
    if (top) anAddFilter(top.type, top.value); else anAddFilter('text', e.target.value);
  } else if (e.key === 'Escape') {
    e.target.value = ''; paintAnSuggestions();
  }
});
$('analytics-body').addEventListener('click', (e) => {
  const pick = e.target.closest('[data-an-pick]');
  if (pick) { anAddFilter(pick.dataset.anPick, pick.dataset.anValue); return; }
  const un = e.target.closest('[data-an-unpick]');
  if (un) {
    anFilters.splice(Number(un.dataset.anUnpick), 1);
    anShowAll = false;
    paintAnalytics();
    return;
  }
  if (e.target.closest('#an-clear')) { anFilters = []; anShowAll = false; paintAnalytics(); return; }
  if (e.target.closest('#an-more')) { anShowAll = true; paintAnalytics(); return; }
  // A result row opens that flight in the logbook, expanded.
  const row = e.target.closest('[data-an-open]');
  if (row) { hideOverlay('analytics-overlay'); openLogbook(row.dataset.anOpen); }
});
$('analytics-close').addEventListener('click', () => hideOverlay('analytics-overlay'));
$('analytics-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'analytics-overlay') hideOverlay('analytics-overlay');
});

// ---------- In-app Logbook overlay (Phase 14) ----------
// Read-only list of every stored leg, newest first. Reuses logbook.js's
// allStoredLegs() so the source-of-truth stays consistent with the .ics
// export. Tap a row → switch active leg via applyLeg + close the overlay.
// focusKey (an lbKeyOf string) opens the logbook with that flight already
// expanded and scrolled to — how the History card hands a past flight over
// for editing.
async function openLogbook(focusKey = '') {
  showOverlay('logbook-overlay');
  const body = $('logbook-body');
  body.innerHTML = '<p class="lb-empty">Loading…</p>';
  try {
    const lb = await import('./modules/logbook.js?v=262');
    const legs = (lb.allStoredLegs() || []).slice().reverse(); // newest first
    await ensureLbAirports();
    // Past duties only: the logbook is what happened.
    const now = Date.now();
    const duties = storage.getDuties().filter(d => (d.end || d.start) < now);
    body.innerHTML = renderLogbookList(legs, duties);
    wireLogbookRows(body);   // guarded — see the `wired` flag inside
    lbApplySearch();
    if (focusKey) {
      const row = [...body.querySelectorAll('.lb-row')]
        .find(r => lbKeyOf({ flight: r.dataset.flight, dep_date: r.dataset.depDate,
                             dep: r.dataset.dep, arr: r.dataset.arr,
                             dep_year: r.dataset.depYear }) === focusKey);
      if (row) {
        row.parentElement.querySelector('.lb-detail')?.classList.remove('hidden');
        row.setAttribute('aria-expanded', 'true');
        row.scrollIntoView({ block: 'center' });
      }
    }
  } catch (err) {
    console.warn('logbook view failed', err);
    body.innerHTML = '<p class="lb-empty">Couldn\'t load the logbook.</p>';
  }
}
$('logbook-close').addEventListener('click', () => hideOverlay('logbook-overlay'));
$('duty-close').addEventListener('click', () => hideOverlay('duty-overlay'));
$('duty-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'duty-overlay') hideOverlay('duty-overlay');
});
$('logbook-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'logbook-overlay') hideOverlay('logbook-overlay');
});

// ---------- Flight time limits (OM A 7.2) ----------
// From the ••• menu for now. modules/ftl.js does the sums; this paints them.
// ftlIdx / ftlOpts (declared at the top) hold the duty shown and any
// pilot-count, rest-class or acclimation the pilot set by hand for it.
async function openFtl() {
  ftlIdx = null; ftlOpts = {};
  showOverlay('ftl-overlay'); raiseOverlay('ftl-overlay');
  $('ftl-body').innerHTML = '<p class="lb-empty">Working it out…</p>';
  await paintFtl();
}
async function paintFtl() {
  const body = $('ftl-body');
  try {
    const ftl = await import('./modules/ftl.js?v=262');
    if (ftlMode === 'calc') { body.innerHTML = ftlModeSwitch() + renderFtlCalc(ftl); paintFtlCalcOut(ftl); return; }
    let lonOf = null;
    try {
      const ri = await import('./modules/route-info.js?v=262');
      const db = await ri.loadDb();
      lonOf = (c) => ri.findAirport(db, c)?.lon;
    } catch {}
    const r = ftl.evaluate({
      legs: storage.everyLeg(), duties: storage.getDuties(),
      activeLeg: storage.getLegs()[storage.getLegIndex()],
      idx: ftlIdx, opts: { ...ftlOpts, lonOf, extOf: ftlExtOf, etaOf: ftlEtaOf }, taxiOf: taxiMinutes,
    });
    ftlIdx = r.empty ? null : r.i;
    ftlShown = r.empty ? null : r.fdp;
    body.innerHTML = ftlModeSwitch() + (r.empty
      ? '<p class="lb-empty">No flights stored yet — sync the calendar or add a roster first.</p>'
      : renderFtl(ftl, r));
  } catch (err) {
    console.warn('ftl failed', err);
    body.innerHTML = '<p class="lb-empty">Couldn\'t work out the limits.</p>';
  }
}
// Extensions taken, by duty report time: { reportMs: minutes } on this device.
function ftlExts() { try { return JSON.parse(localStorage.getItem('fc.ftl.ext') || '{}') || {}; } catch { return {}; } }
// GPS on-blocks estimates, by leg: { lbKey: { on, at } } on this device, so
// the estimate outlives the app being closed again. Written by ftlEtaTick.
function ftlEtas() { try { return JSON.parse(localStorage.getItem('fc.ftl.eta') || '{}') || {}; } catch { return {}; } }
function ftlEtaOf(leg) { const e = ftlEtas()[lbKeyOf(leg)]; return e && Number.isFinite(e.on) ? e.on : NaN; }
// Airborne with a fresh fix: where along the route are we, so when will we
// be on blocks. Runs with the nearest-airport chip, every 30 s.
async function ftlEtaTick() {
  if (!gpsActive) return;
  const { gps } = await loadSensorMods();
  const st = gps.getState(), fix = gps.getLastFix && gps.getLastFix();
  if (!st || st.phase !== 'airborne' || !fix || Date.now() - fix.ts > 90 * 1000) return;
  const leg = storage.getLeg();
  if (!leg || !leg.dep || !leg.arr) return;
  const [ftl, ri, plan] = await Promise.all([import('./modules/ftl.js?v=262'), import('./modules/route-info.js?v=262'), import('./modules/plan-route.js?v=262')]);
  // Only a real GPS position — not a Wi-Fi guess kilometres out.
  if (!plan.goodFix(fix.accM)) return;
  const db = await ri.loadDb();
  const a = ri.findAirport(db, leg.dep), b = ri.findAirport(db, leg.arr);
  if (!a || !b) return;
  const t = ftl.legTimes([leg])[0];
  if (!t) return;
  const filed = plan.getPlan(leg);
  const on = ftl.etaFromFix(t, fix, a, b, Date.now(), filed ? plan.progress(filed.pts, fix) : null);
  if (!Number.isFinite(on)) return;
  const all = ftlEtas();
  all[lbKeyOf(leg)] = { on, at: Date.now() };
  for (const k of Object.keys(all)) if (all[k].at < Date.now() - 3 * 86400000) delete all[k];
  try { localStorage.setItem('fc.ftl.eta', JSON.stringify(all)); } catch {}
  paintFdpChip();
  if (!$('ftl-overlay').classList.contains('hidden')) paintFtl();
}
function ftlExtOf(fdp) { return ftlExts()[fdp.report] || 0; }
function ftlSetExt(fdp, min) {
  const all = ftlExts();
  if (min > 0) all[fdp.report] = min; else delete all[fdp.report];
  // Keep only the last 60 days.
  for (const k of Object.keys(all)) if (Number(k) < Date.now() - 60 * 86400000) delete all[k];
  try { localStorage.setItem('fc.ftl.ext', JSON.stringify(all)); } catch {}
}
function ftlH(h) {
  if (h == null || !Number.isFinite(h)) return '—';
  const m = Math.round(Math.abs(h) * 60);
  return `${h < 0 ? '−' : ''}${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}
// UTC or the device's local time, for every clock time on the sheet — the
// pilot's choice, kept on this device. Durations are the same either way.
function ftlLocal() { try { return localStorage.getItem('fc.ftl.tz') === 'local'; } catch { return false; } }
function ftlTzName() {
  try { return new Intl.DateTimeFormat('en-GB', { timeZoneName: 'short' }).formatToParts(new Date()).find(p => p.type === 'timeZoneName')?.value || 'local'; } catch { return 'local'; }
}
function ftlZ(ms) {
  const d = new Date(ms), loc = ftlLocal();
  const h = loc ? d.getHours() : d.getUTCHours(), m = loc ? d.getMinutes() : d.getUTCMinutes();
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}${loc ? ' LT' : 'Z'}`;
}
function ftlDay(ms) {
  const d = new Date(ms), loc = ftlLocal();
  return `${String(loc ? d.getDate() : d.getUTCDate()).padStart(2, '0')}.${String((loc ? d.getMonth() : d.getUTCMonth()) + 1).padStart(2, '0')}`;
}
// Margin left against a limit: green with an hour to spare, amber inside
// the hour, red past it.
function ftlSpare(left) { return left < 0 ? `${ftlH(-left)} over` : `${ftlH(left)} spare`; }
function ftlTone(left) { return left < 0 ? 'is-bad' : left < 1 ? 'is-warn' : 'is-good'; }
function ftlRow(label, value, tone = '', sub = '') {
  return `<div class="ftl-row"><span>${esc(label)}${sub ? `<small>${esc(sub)}</small>` : ''}</span><b class="${tone}">${value}</b></div>`;
}
function renderFtl(ftl, r) {
  const { fdp, lim, rest, cum, ltts } = r;
  const first = fdp.legs[0].leg;
  const route = [first.dep, ...fdp.legs.map(l => l.leg.arr)].map(c => esc(c || '—')).join('–');
  const now = Date.now();
  const state = fdp.flown ? 'flown' : now >= fdp.report ? 'on duty' : 'planned';
  const nav = `<div class="ftl-nav">
      <button type="button" class="btn icon-btn" data-ftl-step="-1" ${r.i ? '' : 'disabled'} aria-label="Previous duty">◀</button>
      <div class="ftl-nav-mid"><b>${ftlDay(fdp.report)}</b> ${route}<small>${state} · duty ${r.i + 1} of ${r.fdps.length}</small></div>
      <button type="button" class="btn icon-btn" data-ftl-step="1" ${r.i < r.fdps.length - 1 ? '' : 'disabled'} aria-label="Next duty">▶</button>
    </div>`;

  const ftUsed = (fdp.flown ? fdp.ft : fdp.plannedFt) / 3600000;
  const table = lim.augmented
    ? `Table C · ${lim.pilots} pilots · class ${lim.restClass} rest${ftlOpts.restClass ? '' : fdp.restClass === 1 ? ' (787/777)' : ' (737)'}`
    : `Table B · ${fdp.segments} segment${fdp.segments === 1 ? '' : 's'}`;
  const warns = [];
  if (lim.tooManySegments) warns.push(`Augmented duty is limited to ${ftl.AUG_MAX_SEGMENTS} segments.`);
  if (lim.plannedFdp > lim.maxFdp) warns.push('The planned FDP is over the limit.');
  if (fdp.plannedFt / 3600000 > lim.maxFt) warns.push('The planned flight time is over the limit.');
  const live = r.live && !fdp.flown
    ? `<div class="ftl-live ${ftlTone(r.live.left)}">On duty ${ftlH(r.live.elapsed)} · ${r.live.left < 0 ? `${ftlH(-r.live.left)} over the limit` : `${ftlH(r.live.left)} to the limit`}</div>` : '';
  const vs = (attr, vals, on, label) => `<div class="ftl-ctl"><span>${label}</span><div class="view-switch">${vals.map(([v, t]) =>
    `<button type="button" class="vs-btn${v === on ? ' is-on' : ''}" ${attr}="${v}">${t}</button>`).join('')}</div></div>`;
  const ctls = `<div class="ftl-ctls">
      ${vs('data-ftl-pilots', [[2, '2'], [3, '3'], [4, '4']], lim.pilots, 'Pilots')}
      ${vs('data-ftl-ext', [[0, 'None'], [30, '0:30'], [60, '1:00'], [90, '1:30'], [120, '2:00']], Math.round(lim.extH * 60), 'Extension')}
      ${lim.extH > 0.5 ? '<p class="ftl-note">Over 30 min: only once before 30 h free from duty, and reported to the CAAI.</p>' : ''}
      ${lim.augmented ? vs('data-ftl-class', [[1, 'Class 1'], [2, 'Class 2'], [3, 'Class 3']], lim.restClass, 'Rest facility') : ''}
      <label class="ftl-ctl ftl-check"><input type="checkbox" data-ftl-accl ${lim.notAccl ? 'checked' : ''}> Not acclimated to the departure station (−0:30)</label>
    </div>`;
  // Planned (or flown) against the max for this duty as set above — pilots,
  // rest facility, acclimation — and what's spare.
  const projFdp = (r.proj.end - fdp.report) / 3600000;
  const showProj = !fdp.flown && r.live && r.proj.basis !== 'schedule';
  const cmpRow = (label, used, max, sub = '') => {
    const left = max - used;
    return `<div class="ftl-cmp-row"><span>${esc(label)}${sub ? `<small>${esc(sub)}</small>` : ''}</span><b>${ftlH(used)}</b><b>${ftlH(max)}</b><b class="${ftlTone(left)}">${left < 0 ? '−' : ''}${ftlH(Math.abs(left))}</b></div>`;
  };
  const cmp = `<div class="ftl-cmp">
      <div class="ftl-cmp-row ftl-cmp-head"><span></span><span>${fdp.flown ? 'Actual' : 'Planned'}</span><span>Max</span><span>Spare</span></div>
      ${cmpRow('FDP', lim.actualFdp ?? lim.plannedFdp, lim.maxFdp, lim.notAccl ? 'not acclimated −0:30' : '')}
      ${showProj ? cmpRow('FDP as it goes', projFdp, lim.maxFdp, `ends ≈ ${ftlZ(r.proj.end)} · from ${r.proj.basis}`) : ''}
      ${!fdp.flown && r.live && r.proj.basis === 'schedule' ? '<p class="ftl-note">On schedule until GPS sees the flight — open the app once airborne and it works out the landing from where you are.</p>' : ''}
      ${cmpRow('Flight time', ftUsed, lim.maxFt, lim.augmented ? `${lim.pilots} pilots` : 'Table A')}
    </div>`;
  const fdpCard = `<div class="an-card">
      <h4>Flight duty period</h4>
      <div class="an-big">${ftlH(lim.maxFdp)}${lim.extH ? `<small class="ftl-ext-tag">incl. +${ftlH(lim.extH)} ext</small>` : ''}</div>
      <div class="an-big-sub">Max FDP · ${table} · report ${israelHmSafe(ftl, fdp.report)} Israel</div>
      ${live}
      <div class="ftl-rows">
        ${ftlRow('Report', ftlZ(fdp.report), '', `STD − ${ftl.REPORT_MIN}′`)}
        ${ftlRow('Latest on-blocks', ftlZ(lim.limit), '', 'report + max FDP')}
        ${lim.extH < ftl.EXT_MAX_H ? ftlRow('With full extension', ftlZ(lim.limitExt), '', '+2:00, PIC and FOO') : ''}
      </div>
      ${cmp}
      ${warns.map(w => `<p class="ftl-warn">${esc(w)}</p>`).join('')}
      ${ctls}
    </div>`;

  const legRows = fdp.legs.map((l, k) => {
    const t = ltts[k];
    const timeTxt = l.flown ? `${ftlZ(l.start)}–${ftlZ(l.end)}` : `${ftlZ(l.std)}–${ftlZ(l.sta)}`;
    const late = !l.flown && (l.std + t.taxi * 60000) > t.ltt;
    return `<div class="ftl-leg">
        <span><b>${esc(displayFlight(l.leg.flight) || l.leg.flight || '—')}</b> ${esc(l.leg.dep || '')}–${esc(l.leg.arr || '')}<small>${l.flown ? 'block' : 'sched'} ${timeTxt}</small></span>
        <span class="ftl-ltt ${l.flown ? '' : late ? 'is-bad' : ''}">${l.flown ? '<small>flown</small>' : `LTT <b>${ftlZ(t.ltt)}</b><small>ext ${ftlZ(t.lttExt)} · taxi ${t.taxi}′</small>`}</span>
      </div>`;
  }).join('');
  // What was actually flown, typed in when it's known before the calendar
  // has it — a shorter flight than planned shortens the FDP. Stored in the
  // leg's own actual fields, so the logbook and everything else agree, and
  // the calendar's figures replace them when they come.
  const loc = ftlLocal();
  const actRows = fdp.legs.map((l, k) => {
    const d = l.leg.dataCard || {};
    const off = ftlNearMs(d.off_block, l.std, false), on = ftlNearMs(d.on_block, l.sta, false);
    const tko = Number(d.takeoff_at) > 0 ? Number(d.takeoff_at) : NaN;
    const any = [off, on, tko].some(Number.isFinite);
    const inp = (key, ms, label) => `<label class="ftl-act-f"><span>${label}</span><input class="ftl-in" type="time" data-ftl-act="${key}" data-k="${k}" value="${esc(ftlHmOf(ms, loc))}"></label>`;
    return `<div class="ftl-act-leg">
        <div class="ftl-act-h"><b>${esc(displayFlight(l.leg.flight) || l.leg.flight || '—')}</b> ${esc(l.leg.dep || '')}–${esc(l.leg.arr || '')}
          <small>sched ${ftlZ(l.std)}–${ftlZ(l.sta)}</small>
          ${any ? `<button type="button" class="ftl-act-clr" data-ftl-act-clear="${k}">Clear</button>` : ''}</div>
        <div class="ftl-act-row">${inp('off_block', off, 'Off block')}${inp('takeoff', tko, 'Take-off')}${inp('on_block', on, 'On block')}</div>
      </div>`;
  }).join('');
  const actCard = `<div class="an-card">
      <h4>Actual times <small class="ftl-act-tz">${loc ? esc(ftlTzName()) : 'UTC'}</small></h4>
      ${actRows}
      <p class="ftl-note">Type in what was flown — the FDP, latest take-off and rest follow it. On block counts first, then take-off (+ flight time), then off block (+ block time). The calendar's actual times replace these when they arrive.</p>
    </div>`;
  const lttCard = `<div class="an-card">
      <h4>Latest take-off</h4>
      ${legRows}
      <p class="ftl-note">Keeps the rest of the duty on its scheduled block and ground times. Notify's LTT is the official one.</p>
    </div>`;

  const restRows = [];
  if (rest.before == null) restRows.push(ftlRow('Rest before this duty', '—', '', 'no earlier duty stored'));
  else restRows.push(ftlRow('Rest before this duty', ftlH(rest.before), ftlTone(rest.before - ftl.MIN_REST_H), `min ${ftl.MIN_REST_H}:00 from release`));
  restRows.push(ftlRow('Longest free, past 168 h', ftlH(rest.free168), ftlTone(rest.free168 - ftl.FREE_IN_168_H), `min ${ftl.FREE_IN_168_H}:00`));
  restRows.push(ftlRow('Released', ftlZ(fdp.release), '', `on-blocks + ${ftl.POST_FLIGHT_MIN}′`));
  restRows.push(ftlRow('Earliest next report', `${ftlDay(rest.earliestNext)} ${ftlZ(rest.earliestNext)}`, '', `release + ${ftl.MIN_REST_H}:00`));
  if (rest.next) restRows.push(ftlRow('Next duty report', `${ftlDay(rest.next.report)} ${ftlZ(rest.next.report)}`, ftlTone(rest.after - ftl.MIN_REST_H), `${ftlH(rest.after)} rest`));
  const restCard = `<div class="an-card"><h4>Rest</h4><div class="ftl-rows">${restRows.join('')}</div></div>`;

  const bars = cum.map(c => {
    const pct = Math.min(100, Math.max(0, c.used / c.max * 100));
    const tone = c.left < 0 ? 'is-bad' : pct >= 90 ? 'is-warn' : '';
    return `<div class="an-bar-row ftl-bar ${tone}">
        <span class="an-bar-label">${esc(c.label)}<span class="an-bar-sub">${esc(c.span)} · max ${c.max}</span></span>
        <div class="an-bar-track"><div class="an-bar-fill" style="width:${pct.toFixed(1)}%"></div></div>
        <span class="an-bar-count">${ftlH(c.used)}</span>
      </div>`;
  }).join('');
  const short = r.since && r.since > fdp.end - 365 * 86400000;
  const cumCard = `<div class="an-card">
      <h4>Cumulative, to the end of this duty</h4>
      <div class="an-bars">${bars}</div>
      <p class="ftl-note">${short ? `Stored flights start ${ftlDay(r.since)}.${new Date(r.since).getUTCFullYear()}, so longer windows may read low. Import the sector CSV in the Logbook to fill them. ` : ''}Your own deadhead sectors aren't stored, so they're not counted.</p>
    </div>`;

  return nav + fdpCard + actCard + lttCard + restCard + cumCard + renderFtlTables(ftl, lim) +
    `<p class="ftl-note ftl-foot">A planning aid from ${esc(ftl.OMA_REV)}. Crew Assignment, OCC and Notify are the authority.</p>`;
}
// "HH:MM" (UTC, or the device's time when loc) as the moment nearest ref.
function ftlNearMs(hm, ref, loc) {
  const t = /^(\d{1,2}):(\d{2})$/.exec(String(hm || '').trim());
  if (!t || !Number.isFinite(ref)) return NaN;
  const d = new Date(ref);
  let ms = loc ? new Date(d.getFullYear(), d.getMonth(), d.getDate(), +t[1], +t[2]).getTime()
    : Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), +t[1], +t[2]);
  if (ms - ref > 43200000) ms -= 86400000;
  else if (ref - ms > 43200000) ms += 86400000;
  return ms;
}
function ftlSetActual(l, key, ms) {
  if (key === 'takeoff') storage.setStoredLegField(l.leg, 'takeoff_at', Number.isFinite(ms) ? ms : '');
  else storage.setStoredLegField(l.leg, key, Number.isFinite(ms) ? ftlHmOf(ms, false) : '');
}
function israelHmSafe(ftl, ms) { try { return ftl.israelHm(ms); } catch { return '—'; } }
// The OM A tables, the cell in use marked.
function renderFtlTables(ftl, lim) {
  const span = (a, b) => `${String(a).padStart(2, '0')}:00–${String(b).padStart(2, '0')}:59`;
  const num = (v) => String(v).replace('.5', '½');
  const tb = ftl.TABLE_B.map(([a, b, vals], i) => `<tr><th>${span(a, b)}</th>${vals.map((v, j) =>
    `<td class="${!lim.augmented && i === lim.row && j === lim.col ? 'is-on' : ''}">${num(v)}</td>`).join('')}</tr>`).join('');
  const tc = ftl.TABLE_C.map(([a, b, vals], i) => `<tr><th>${span(a, b)}</th>${vals.map((v, j) =>
    `<td class="${lim.augmented && i === lim.row && j === lim.col ? 'is-on' : ''}">${num(v)}</td>`).join('')}</tr>`).join('');
  const ta = ftl.TABLE_A.map(([a, b, v]) => `<tr><th>${span(a, b)}</th><td class="${!lim.augmented && lim.hour >= a && lim.hour <= b ? 'is-on' : ''}">${v}</td></tr>`).join('');
  return `<details class="an-card ftl-rules">
      <summary><h4>OM A tables and rules</h4></summary>
      <p class="ftl-cap">Table B · max FDP, 2 pilots · report hour (Israel) × segments</p>
      <div class="ftl-scroll"><table class="ftl-tbl"><tr><th></th><th>1</th><th>2</th><th>3</th><th>4</th><th>5</th><th>6</th><th>7+</th></tr>${tb}</table></div>
      <p class="ftl-cap">Table A · max flight time, 2 pilots</p>
      <table class="ftl-tbl ftl-tbl-a">${ta}</table>
      <p class="ftl-cap">Table C · max FDP, augmented (3 segments at most) · rest class × pilots</p>
      <div class="ftl-scroll"><table class="ftl-tbl"><tr><th></th><th>1·3</th><th>1·4</th><th>2·3</th><th>2·4</th><th>3·3</th><th>3·4</th></tr>${tc}</table></div>
      <p class="ftl-cap">Augmented flight time: 13 h with 3 pilots, 17 h with 4. The 737 with business class is class 3 (first business row); without it, no rest facility.</p>
      <ul class="ftl-list">
        <li>Not acclimated to the departure station: max FDP 30 min less.</li>
        <li>Report 60 min before STD on the 737, at Tel Aviv and outstations. Post-flight duty 15 min. Deadhead duty starts 20 min before STD, and it isn't a segment.</li>
        <li>Rest before an FDP: 10 h from release, with 8 h sleep opportunity. 30 h free in any 168 h. After more than 60° of longitude and 168 h away: 56 h at base, with 3 physiological nights.</li>
        <li>Cumulative: flight time 100 h in 672 h and 1,000 h in 365 days; FDP 60 h in 168 h and 190 h in 672 h.</li>
        <li>Extension, unforeseen circumstances, before take-off: up to 2 h with PIC and FOO. More than 30 min only once before 30 h free. Cumulative FDP limits still apply. Over 30 min is reported to the CAAI.</li>
        <li>After take-off: as far as needed to land safely at destination or alternate.</li>
        <li>Short-call reserve: RAP up to 14 h; RAP + FDP no more than Table B + 4 h or 16 h, whichever is less.</li>
        <li>Up to 3 consecutive nights into the WOCL (02:00–05:59) freely; up to 5 with a 2 h sleep opportunity in suitable accommodation.</li>
      </ul>
    </details>`;
}

// ---------- Flight time limits: calculator ----------
// Any duty typed in by hand — a flight duty, airport standby or soft (home,
// short-call) standby — to work out the options before they happen. Kept
// on this device between visits.
function ftlModeSwitch() {
  const loc = ftlLocal();
  return `<div class="ftl-top">
      <div class="view-switch ftl-mode">
        <button type="button" class="vs-btn${ftlMode === 'mine' ? ' is-on' : ''}" data-ftl-mode="mine">Your duties</button>
        <button type="button" class="vs-btn${ftlMode === 'calc' ? ' is-on' : ''}" data-ftl-mode="calc">Calculator</button>
      </div>
      <div class="view-switch ftl-mode" title="Times in UTC or this device's local time (${esc(ftlTzName())})">
        <button type="button" class="vs-btn${loc ? '' : ' is-on'}" data-ftl-tz="utc">UTC</button>
        <button type="button" class="vs-btn${loc ? ' is-on' : ''}" data-ftl-tz="local">Local</button>
      </div>
    </div>`;
}
// The calculator keeps its times in UTC; in Local they're shown and typed
// in the device's zone. hm/date of an instant in the zone in use:
function ftlHmOf(ms, loc) {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  return `${String(loc ? d.getHours() : d.getUTCHours()).padStart(2, '0')}:${String(loc ? d.getMinutes() : d.getUTCMinutes()).padStart(2, '0')}`;
}
function ftlDateOf(ms, loc) {
  const d = new Date(ms);
  return loc
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    : d.toISOString().slice(0, 10);
}
// The stored (UTC) calculator times as instants: report, standby start (up to
// a day before it), last on-blocks (after it).
function ftlCalcTimes(c) {
  const at = (hm) => { const t = /^(\d{1,2}):(\d{2})$/.exec(hm || ''), d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(c.date || '');
    return t && d ? Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2]) : NaN; };
  const report = at(c.report);
  let rap = at(c.rapStart), last = at(c.lastOn);
  if (rap > report) rap -= 86400000;
  while (last <= report) last += 86400000;
  return { report, rap, last };
}
function ftlCalcState() {
  let c = null;
  try { c = JSON.parse(localStorage.getItem('fc.ftl.calc') || 'null'); } catch {}
  const now = new Date();
  const hm = (d) => `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  return {
    type: 'flight', date: now.toISOString().slice(0, 10), report: hm(now), rapStart: hm(new Date(now - 2 * 3600000)),
    lastOn: '', sectors: 2, pilots: 2, restClass: 3, notAccl: false, extMin: 0, ...(c || {}),
  };
}
function ftlCalcSave(c) { try { localStorage.setItem('fc.ftl.calc', JSON.stringify(c)); } catch {} }
function renderFtlCalc(ftl) {
  const c = ftlCalcState();
  const vs = (attr, vals, on, label) => `<div class="ftl-ctl"><span>${label}</span><div class="view-switch">${vals.map(([v, t]) =>
    `<button type="button" class="vs-btn${String(v) === String(on) ? ' is-on' : ''}" ${attr}="${v}">${t}</button>`).join('')}</div></div>`;
  const loc = ftlLocal(), tz = loc ? ftlTzName() : 'UTC';
  const t = ftlCalcTimes(c);
  const shown = { report: ftlHmOf(t.report, loc), rapStart: ftlHmOf(t.rap, loc), lastOn: c.lastOn ? ftlHmOf(t.last, loc) : '' };
  const dateShown = Number.isFinite(t.report) ? ftlDateOf(t.report, loc) : c.date;
  const time = (key, label, sub = '') => `<label class="ftl-ctl"><span>${label}${sub ? `<small>${sub}</small>` : ''}</span><input class="ftl-in" type="time" data-ftl-calc="${key}" value="${esc(shown[key] || '')}"></label>`;
  const aug = c.pilots >= 3;
  return `<div class="an-card ftl-calc">
      <h4>Your duty</h4>
      <div class="ftl-ctls ftl-ctls-first">
        ${vs('data-ftl-ctype', [['flight', 'Flight duty'], ['airport', 'Standby'], ['short', 'Soft standby']], c.type, 'Duty')}
        <label class="ftl-ctl"><span>Date<small>${esc(tz)}</small></span><input class="ftl-in" type="date" data-ftl-calc="date" value="${esc(dateShown)}"></label>
        ${c.type === 'short' ? time('rapStart', 'Standby starts', `${esc(tz)} · at home, short call`) : ''}
        ${c.type === 'airport' ? time('report', 'Standby starts', `${esc(tz)} · at the airport — the FDP starts here`) : time('report', 'Report', c.type === 'short' ? `${esc(tz)} · after the call` : `${esc(tz)} · STD − 60′ on the 737`)}
        ${vs('data-ftl-csec', [[1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5'], [6, '6'], [7, '7+']], c.sectors, 'Sectors')}
        ${vs('data-ftl-cpil', [[2, '2'], [3, '3'], [4, '4']], c.pilots, 'Pilots')}
        ${aug ? vs('data-ftl-ccls', [[1, 'Class 1'], [2, 'Class 2'], [3, 'Class 3']], c.restClass, 'Rest facility') : ''}
        ${vs('data-ftl-cext', [[0, 'None'], [30, '0:30'], [60, '1:00'], [90, '1:30'], [120, '2:00']], c.extMin, 'Extension')}
        ${time('lastOn', 'Last on-blocks', `${esc(tz)} · optional, for what's spare`)}
        <label class="ftl-ctl ftl-check"><input type="checkbox" data-ftl-calc="notAccl" ${c.notAccl ? 'checked' : ''}> Not acclimated to the departure station (−0:30)</label>
      </div>
    </div>
    <div id="ftl-calc-out"></div>`;
}
function paintFtlCalcOut(ftl) {
  const out = $('ftl-calc-out');
  if (!out) return;
  const c = ftlCalcState();
  const r = ftl.manualLimits(c);
  if (!r) { out.innerHTML = '<p class="lb-empty">Enter a date and a report time.</p>'; return; }
  const { lim } = r;
  const dz = (ms) => `${ftlDay(ms)} ${ftlZ(ms)}`;
  const table = lim.augmented ? `Table C · ${lim.pilots} pilots · class ${lim.restClass} rest` : `Table B · ${c.sectors} sector${c.sectors == 1 ? '' : 's'}`;
  const rows = [
    ftlRow('Max FDP', ftlH(lim.maxFdp), '', lim.extH ? `incl. +${ftlH(lim.extH)} extension` : table),
    ftlRow('Max flight time', ftlH(lim.maxFt), '', lim.augmented ? `${lim.pilots} pilots` : 'Table A'),
    ftlRow('Report', dz(r.report), '', `${israelHmSafe(ftl, r.report)} Israel`),
  ];
  if (r.rap != null) {
    rows.push(ftlRow('Standby must end by', dz(r.rapEnd), '', `start + 14:00`));
    rows.push(ftlRow('Standby + FDP limit', ftlH(r.combined + lim.extH), '', lim.augmented ? 'Table C + 4:00' : 'Table B + 4:00, 16:00 at most'));
  }
  rows.push(ftlRow('Latest on-blocks', dz(r.end), r.binding === 'rap' ? 'is-warn' : '',
    r.rap == null ? 'report + max FDP' : r.binding === 'rap' ? 'set by standby + FDP' : 'set by the FDP'));
  if (r.latestExt > r.end) rows.push(ftlRow('With full extension', dz(r.latestExt), '', '+2:00, PIC and FOO'));
  if (r.lastOn != null) {
    rows.push(ftlRow('Spare', `${r.spare < 0 ? '−' : ''}${ftlH(Math.abs(r.spare))}`, ftlTone(r.spare), `last on-blocks ${ftlZ(r.lastOn)}`));
    rows.push(ftlRow('Earliest next report', dz(r.nextReport), '', `release ${ftlZ(r.release)} + 10:00`));
  }
  out.innerHTML = `<div class="an-card">
      <h4>Limits</h4>
      <div class="an-big">${ftlH((r.end - r.report) / 3600000)}</div>
      <div class="an-big-sub">from report to latest on-blocks · ${esc(table)}</div>
      <div class="ftl-rows">${rows.join('')}</div>
      ${r.warns.map(w => `<p class="ftl-note">${esc(w)}</p>`).join('')}
    </div>
    <p class="ftl-note ftl-foot">Standby is airport reserve, soft standby is short-call reserve (OM A 7.2.12).</p>`;
}
$('ftl-close').addEventListener('click', () => hideOverlay('ftl-overlay'));
$('ftl-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'ftl-overlay') { hideOverlay('ftl-overlay'); return; }
  const tzb = e.target.closest('[data-ftl-tz]');
  if (tzb) { try { localStorage.setItem('fc.ftl.tz', tzb.dataset.ftlTz); } catch {} paintFtl(); paintFdpChip(); return; }
  const mode = e.target.closest('[data-ftl-mode]');
  if (mode) { ftlMode = mode.dataset.ftlMode; paintFtl(); return; }
  const cb = e.target.closest('[data-ftl-ctype],[data-ftl-csec],[data-ftl-cpil],[data-ftl-ccls],[data-ftl-cext]');
  if (cb) {
    const c = ftlCalcState(), d = cb.dataset;
    if (d.ftlCtype) c.type = d.ftlCtype;
    if (d.ftlCsec) c.sectors = Number(d.ftlCsec);
    if (d.ftlCpil) c.pilots = Number(d.ftlCpil);
    if (d.ftlCcls) c.restClass = Number(d.ftlCcls);
    if (d.ftlCext) c.extMin = Number(d.ftlCext);
    ftlCalcSave(c); paintFtl(); return;
  }
  const clr = e.target.closest('[data-ftl-act-clear]');
  if (clr && ftlShown) {
    const l = ftlShown.legs[Number(clr.dataset.ftlActClear)];
    if (l) { for (const k of ['off_block', 'takeoff', 'on_block']) ftlSetActual(l, k, NaN); paintFtl(); paintFdpChip(); }
    return;
  }
  const step = e.target.closest('[data-ftl-step]');
  if (step) { ftlIdx = (ftlIdx || 0) + Number(step.dataset.ftlStep); ftlOpts = {}; paintFtl(); return; }
  const p = e.target.closest('[data-ftl-pilots]');
  if (p) { ftlOpts.pilots = Number(p.dataset.ftlPilots); paintFtl(); return; }
  const c = e.target.closest('[data-ftl-class]');
  if (c) { ftlOpts.restClass = Number(c.dataset.ftlClass); paintFtl(); return; }
  const x = e.target.closest('[data-ftl-ext]');
  if (x && ftlShown) { ftlSetExt(ftlShown, Number(x.dataset.ftlExt)); paintFtl(); paintFdpChip(); }
});
// Typed fields recompute the results only, so the field keeps its focus.
function ftlCalcInput(e) {
  const k = e.target.dataset && e.target.dataset.ftlCalc;
  if (!k) return false;
  const c = ftlCalcState();
  if (k === 'notAccl') c.notAccl = e.target.checked;
  else {
    // Read the whole set as shown (UTC or local) and store it back as UTC.
    const loc = ftlLocal(), val = (key) => document.querySelector(`[data-ftl-calc="${key}"]`)?.value || '';
    const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(val('date'));
    const at = (hm) => { const t = /^(\d{1,2}):(\d{2})$/.exec(hm); if (!t || !dm) return NaN;
      return loc ? new Date(+dm[1], +dm[2] - 1, +dm[3], +t[1], +t[2]).getTime() : Date.UTC(+dm[1], +dm[2] - 1, +dm[3], +t[1], +t[2]); };
    const report = at(val('report'));
    if (Number.isFinite(report)) {
      let rap = at(val('rapStart')), last = at(val('lastOn'));
      if (rap > report) rap -= 86400000;
      while (last <= report) last += 86400000;
      c.date = ftlDateOf(report, false);
      c.report = ftlHmOf(report, false);
      if (Number.isFinite(rap)) c.rapStart = ftlHmOf(rap, false);
      c.lastOn = Number.isFinite(last) ? ftlHmOf(last, false) : '';
    } else if (dm) c.date = val('date');
  }
  ftlCalcSave(c);
  import('./modules/ftl.js?v=262').then(paintFtlCalcOut).catch(() => {});
  return true;
}
$('ftl-overlay').addEventListener('input', ftlCalcInput);
$('ftl-overlay').addEventListener('change', (e) => {
  if (ftlCalcInput(e)) return;
  if (e.target.matches('[data-ftl-accl]')) { ftlOpts.notAcclimated = e.target.checked; paintFtl(); }
  const act = e.target.closest('[data-ftl-act]');
  if (act && ftlShown) {
    const l = ftlShown.legs[Number(act.dataset.k)];
    if (!l) return;
    const key = act.dataset.ftlAct;
    ftlSetActual(l, key, act.value ? ftlNearMs(act.value, key === 'on_block' ? l.sta : l.std, ftlLocal()) : NaN);
    paintFtl(); paintFdpChip();
  }
});

function lbMonthKey(leg) {
  const dm = String(leg.dep_date || '').split('.');
  if (dm.length !== 2) return 'Unknown date';
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const monthIdx = parseInt(dm[1], 10) - 1;
  if (!(monthIdx >= 0 && monthIdx < 12)) return 'Unknown date';
  // Same past-biased resolution the logbook filters and sorts with: a leg
  // stored without dep_year is one already flown, so a 7-month-old flight
  // belongs under LAST February, not next February. Using the forward-rolling
  // guess here filed those rows a year ahead of where they sorted.
  const year = leg.dep_year || yearPast(leg.dep_date);
  if (year == null) return 'Unknown date';
  return `${monthNames[monthIdx]} ${year}`;
}

// A past duty as a logbook row: same date block as a flight, its badge and
// title instead of a route, and no expandable detail — tapping opens the
// duty sheet.
function lbDutyRowHtml(d) {
  const k = DUTY_KINDS[d.kind] || DUTY_KINDS.other;
  const w = dutyWhen(d);
  // Timed duties print their LOCAL date (that's the day they happened);
  // all-day ones are already a calendar date.
  const [day, mon, yy] = d.allDay
    ? [...String(d.dep_date).split('.'), String(d.dep_year).slice(-2)]
    : localDayLabel(d.start).split('.');
  const q = [dutyTitle(d), k.badge, d.kind, `${day}.${mon}.${yy}`, `${day}.${mon}`, lbMonthWords(Number(mon))].join(' ').toLowerCase();
  return `<div class="lb-item lb-duty-item" data-q="${esc(q)}">
      <button type="button" class="lb-row lb-duty" data-duty-uid="${esc(d.uid)}">
        <span class="lb-date"><span class="lb-day">${esc(day || '—')}</span>${esc(`${mon || ''}.${yy || ''}`)}</span>
        <span class="lb-mid">
          <div class="lb-flight"><span class="duty-badge" data-kind="${esc(d.kind)}">${esc(k.badge)}</span> ${esc(dutyTitle(d))}</div>
          <div class="lb-route">${esc(w.time)}</div>
        </span>
      </button>
    </div>`;
}

function renderLogbookList(legs, duties = []) {
  buildLbProcMemory(legs);
  lbLegIndex.clear();
  for (const leg of legs) lbLegIndex.set(lbKeyOf(leg), leg);
  if (!legs.length && !duties.length) {
    return '<p class="lb-empty">No legs stored yet. Sync your duty calendar or paste a roster from Settings.</p>';
  }
  // Active leg in fc.state.current — for highlighting the row the user
  // currently has open in the data card.
  const activeIdx = storage.getLegIndex();
  const activeLeg = (storage.getLegs() || [])[activeIdx];
  const activeKey = activeLeg ? lbKeyOf(activeLeg) : '';
  let lastMonth = '';
  const parts = [];
  // Flights and past duties in one newest-first timeline.
  const items = [
    ...legs.map(leg => ({ leg, t: legSortTs(leg) || 0 })),
    ...duties.map(duty => ({ duty, t: duty.start })),
  ].sort((a, b) => b.t - a.t);
  for (const it of items) {
    if (it.duty) {
      const monthH = lbMonthKey(it.duty);
      if (monthH !== lastMonth) {
        parts.push(`<div class="lb-month-h">${esc(monthH)}</div>`);
        lastMonth = monthH;
      }
      parts.push(lbDutyRowHtml(it.duty));
      continue;
    }
    const leg = it.leg;
    const monthH = lbMonthKey(leg);
    if (monthH !== lastMonth) {
      parts.push(`<div class="lb-month-h">${esc(monthH)}</div>`);
      lastMonth = monthH;
    }
    const dm = String(leg.dep_date || '').split('.');
    const day = dm[0] || '—';
    // "09.26" under the day: the month heading above has the year, but a row
    // read on its own (or scrolled past its heading) didn't.
    const yr = leg.dep_date ? (leg.dep_year || yearPast(leg.dep_date)) : '';
    const mon = (dm[1] || '') + (yr ? '.' + String(yr).slice(-2) : '');
    // displayFlight already prepends the ELY callsign — don't double-stamp.
    const flight = leg.flight ? displayFlight(leg.flight) : 'Flight';
    const route = (leg.dep && leg.arr) ? `${leg.dep} → ${leg.arr}` : '—';
    const time = (leg.dep_time && leg.arr_time) ? `${leg.dep_time}–${leg.arr_time}Z` : '';
    const d = leg.dataCard || {};
    const actual = d.actual_block_time || d.actual_flight_time || d.block_time || leg.flight_time || '';
    const toR  = String(d.to_role  || '').toUpperCase();
    const ldgR = String(d.ldg_role || '').toUpperCase();
    const pa = legPlanActual(leg);
    // Four fixed slots (empty when unknown), so every row's tags stand in
    // the same columns down the list.
    const tags = [
      toR  ? `<span class="lb-tag ${toR === 'PF' ? 'is-pf' : toR === 'PM' ? 'is-pm' : ''}">T/O ${toR}</span>` : '',
      ldgR ? `<span class="lb-tag ${ldgR === 'PF' ? 'is-pf' : ldgR === 'PM' ? 'is-pm' : ''}">LDG ${ldgR}</span>` : '',
      actual ? `<span class="lb-tag lb-tag-time">${esc(actual)}</span>` : '',
      pa.obtDelta != null
        ? `<span class="lb-tag lb-delay ${planTone(pa.obtDelta)}" title="Off-block vs schedule">${fmtDelta(pa.obtDelta)}</span>` : '',
    ].map(t => t || '<span class="lb-tag-slot"></span>').join('');
    const key = lbKeyOf(leg);
    const isActive = key === activeKey;
    const ident = `data-flight="${esc(leg.flight || '')}"
              data-dep-date="${esc(leg.dep_date || '')}"
              data-dep="${esc(leg.dep || '')}"
              data-arr="${esc(leg.arr || '')}"
              data-dep-year="${esc(leg.dep_year || '')}"`;
    // SID / STAR shown on the collapsed row too — the point of logging them is
    // being able to scan the column, not to open every flight.
    const proc = [
      d.sid  ? `<span class="lb-proc">SID ${esc(d.sid)}</span>`   : '',
      d.star ? `<span class="lb-proc">STAR ${esc(d.star)}</span>` : '',
    ].filter(Boolean).join('');
    parts.push(`
      <div class="lb-item" data-q="${esc(lbSearchText(leg))}">
      <button type="button" class="lb-row${isActive ? ' is-active' : ''}" ${ident}
              aria-expanded="false">
        <span class="lb-date"><span class="lb-day">${esc(day)}</span>${esc(mon)}</span>
        <span class="lb-mid">
          <div class="lb-flight">${esc(flight)}</div>
          <div class="lb-route">${esc(route)}${time ? '  ·  ' + esc(time) : ''}</div>
          ${(() => { const c = lbCities(leg); return c ? `<div class="lb-cities">${c}</div>` : ''; })()}
          ${proc ? `<div class="lb-procs">${proc}</div>` : ''}
        </span>
        <span class="lb-tags">${tags}</span>
      </button>
      <div class="lb-detail hidden" ${ident}>
        ${lbRouteMap(leg)}
        <div class="lb-detail-times">
          <span class="lb-time"><b>Aircraft</b>${leg.tail ? esc(leg.tail) : '—'}${d.ac_type ? `<small>${esc(d.ac_type)}</small>` : ''}</span>
          <span class="lb-time"><b>Scheduled</b>${esc(d.block_time || leg.flight_time || '—')}</span>
          <span class="lb-time"><b>Block</b>${esc(d.actual_block_time || '—')}${
            d.actual_block_time && d.off_block && d.on_block ? `<small>${esc(d.off_block)}–${esc(d.on_block)}Z</small>` : ''}</span>
          <label class="lb-time lb-time-edit"><b>Airborne</b>
            <input type="text" value="${esc(d.actual_flight_time || '')}" data-lb-actual="1" ${ident}
                   inputmode="numeric" maxlength="5" placeholder="—"
                   autocomplete="off" spellcheck="false" aria-label="Airborne time, take-off to landing" />
          </label>
        </div>
        ${lbTimelineHtml(leg)}
        ${lbRoleHtml(leg, ident)}
        <div class="lb-detail-crew">${lbCrewHtml(leg, ident)}</div>
        <div class="lb-detail-proc">
          <label class="lb-field">
            <span>SID</span>
            <input type="text" value="${esc(d.sid || '')}" data-lb-proc="sid" ${ident}
                   list="lb-sid-${esc(leg.dep || 'x')}"
                   autocomplete="off" autocapitalize="characters" spellcheck="false"
                   maxlength="16" placeholder="—" aria-label="SID flown" />
            ${lbProcDatalist('sid', leg.dep)}
          </label>
          <label class="lb-field">
            <span>STAR</span>
            <input type="text" value="${esc(d.star || '')}" data-lb-proc="star" ${ident}
                   list="lb-star-${esc(leg.arr || 'x')}"
                   autocomplete="off" autocapitalize="characters" spellcheck="false"
                   maxlength="16" placeholder="—" aria-label="STAR flown" />
            ${lbProcDatalist('star', leg.arr)}
          </label>
        </div>
        <div class="lb-actions">
          <button type="button" class="btn lb-open" ${ident}>Open this leg</button>
          <button type="button" class="btn lb-routeinfo" ${ident}>Route info</button>
        </div>
      </div>
      </div>
    `);
  }
  return parts.join('');
}

// Airport table for the logbook: city names and coordinates for the route map.
// Loaded once when the logbook opens; until it resolves the rows simply show
// codes, which is what they showed before.
let lbAirports = null;
let lbWorld = null;
// identity string → leg, populated as the list renders. Lets the SID / STAR
// inputs repaint their own row's map live; without it the labels only appeared
// the next time the logbook was opened.
const lbLegIndex = new Map();
// A function declaration, not a const arrow: renderHistory() runs during boot,
// a thousand lines before this point in the module body, and a const binding
// would still be in its temporal dead zone — which throws a ReferenceError
// that halts evaluation of everything after it.
function lbKeyOf(o) {
  return [o.flight, o.dep_date, o.dep, o.arr, o.dep_year]
    .map(v => String(v == null ? '' : v)).join('|');
}
async function ensureLbAirports() {
  try {
    if (!lbAirports) lbAirports = await import('./modules/airports.js?v=262');
    if (!lbWorld)    lbWorld    = await import('./modules/worldmap.js?v=262');
  } catch (err) { console.warn('map data unavailable', err); }
  return lbAirports;
}

// "TLV → AMS" is what a pilot reads; the cities are what makes a logbook
// readable months later. Shown under the codes, never instead of them.
// ---------- Logbook search ----------
// Every row carries what it can be found by (data-q, lower case): the date
// written the ways a pilot types it, flight number, airports (both codes and
// the city), tail and type, every crew name, SID / STAR. Words typed are
// all required, in any order: "kolan 2025", "ekc vie".
const LB_MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
function lbMonthWords(m) { const n = LB_MONTHS[m - 1]; return n ? `${n} ${n.slice(0, 3)}` : ''; }
function lbSearchText(leg) {
  const d = leg.dataCard || {};
  const [dd, mm] = String(leg.dep_date || '').split('.');
  const yr = String(leg.dep_year || (leg.dep_date ? yearPast(leg.dep_date) : '') || '');
  const digits = String(leg.flight || '').replace(/\D/g, '').replace(/^0+/, '');
  const ap = (c) => {
    const a = lbAirports && lbAirports.lookup(c);
    return a ? `${c} ${a.iata} ${a.icao} ${a.city} ${a.name}` : String(c || '');
  };
  const tail = String(leg.tail || d.tail || '');
  const crew = CREW_KEYS.concat('dh').map(k => leg[k] || d[k] || '').filter(Boolean)
    .map(n => `${n} ${storage.displayCrew ? storage.displayCrew(n) : ''}`);
  return [
    leg.dep_date, dd && mm ? `${dd}.${mm}.${yr.slice(-2)} ${dd}.${mm}.${yr} ${dd}/${mm} ${dd}/${mm}/${yr}` : '', yr, lbMonthWords(Number(mm)),
    digits, `ly${digits} ely${digits} ly ${digits}`, displayFlight(leg.flight),
    ap(leg.dep), ap(leg.arr), `${leg.dep}-${leg.arr} ${leg.dep}${leg.arr}`,
    tail, tail.replace(/[^A-Za-z0-9]/g, ''), d.ac_type,
    ...crew, d.sid, d.star,
  ].filter(Boolean).join(' ').toLowerCase();
}
function lbApplySearch() {
  const body = $('logbook-body'), inp = $('logbook-search');
  if (!body || !inp) return;
  const words = inp.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  let shown = 0, total = 0, head = null, headHas = false;
  const closeHead = () => { if (head) head.hidden = !headHas; };
  for (const el of body.children) {
    if (el.classList.contains('lb-month-h')) { closeHead(); head = el; headHas = false; continue; }
    if (!el.classList.contains('lb-item')) continue;
    total++;
    const q = el.dataset.q || '';
    const ok = words.every(w => q.includes(w));
    el.hidden = !ok;
    if (ok) { shown++; headHas = true; }
  }
  closeHead();
  const n = $('logbook-search-n');
  if (n) n.textContent = words.length ? `${shown} of ${total}` : '';
  $('logbook-search-clear')?.toggleAttribute('hidden', !inp.value);
  let none = body.querySelector('.lb-search-none');
  if (words.length && !shown) {
    if (!none) { none = document.createElement('p'); none.className = 'lb-empty lb-search-none'; body.appendChild(none); }
    none.textContent = 'Nothing matches — try a flight number, date (05.11), tail, crew name or airport.';
  } else none?.remove();
}
$('logbook-search')?.addEventListener('input', lbApplySearch);
$('logbook-search-clear')?.addEventListener('click', () => { const i = $('logbook-search'); i.value = ''; lbApplySearch(); i.focus(); });

function lbCities(leg) {
  if (!lbAirports) return '';
  const a = lbAirports.cityName(leg.dep) || '';
  const b = lbAirports.cityName(leg.arr) || '';
  if (!a && !b) return '';
  if (a === b) return esc(a);
  const up = (x) => String(x).toUpperCase();
  // cityName falls back to the code itself when it doesn't know the airport;
  // showing "TLV → TLV" under "TLV → AMS" would just be noise.
  if (up(a) === up(leg.dep || '') && up(b) === up(leg.arr || '')) return '';
  return `${esc(a)} → ${esc(b)}`;
}

// Signed minute difference for display: +12, −3, ±0.
function fmtDelta(n) {
  if (n == null) return '';
  return n === 0 ? '±0' : (n > 0 ? '+' : '−') + Math.abs(n);
}
// Plan against what actually happened, for the logbook's expanded row:
// off-block, take-off, landing, in-block — scheduled beside actual with the
// difference coloured early / on time / late (planTone). Rows with nothing
// known are left out; with no actuals at all the block is omitted.
function lbTimelineHtml(leg) {
  const pa = legPlanActual(leg);
  const has = [pa.obt, pa.ibt, pa.takeoff, pa.landing, pa.ctot].some(Number.isFinite);
  if (!has) return '';
  const hm = (ms) => Number.isFinite(ms) ? new Date(ms).toISOString().slice(11, 16) : '';
  const row = (label, plan, act, delta) => (Number.isFinite(plan) || Number.isFinite(act)) ? `
      <span class="lb-tl-k">${label}</span>
      <span class="lb-tl-p">${hm(plan)}</span>
      <span class="lb-tl-a">${hm(act) || '—'}</span>
      <span class="lb-tl-d ${planTone(delta)}">${fmtDelta(delta)}</span>` : '';
  return `<div class="lb-tl" aria-label="Times, UTC: plan against actual">
      <span class="lb-tl-h">UTC</span><span class="lb-tl-h">Plan</span><span class="lb-tl-h">Actual</span><span class="lb-tl-h">Diff</span>
      ${row('CTOT', NaN, pa.ctot, null)}
      ${row('Off-block', pa.std, pa.obt, pa.obtDelta)}
      ${row('Take-off', NaN, pa.takeoff, null)}
      ${row('Landing', NaN, pa.landing, null)}
      ${row('In-block', pa.sta, pa.ibt, pa.ibtDelta)}
    </div>`;
}

// A small map of the leg — the coastline behind it, the two airports, and the
// track between them. Land comes from modules/worldmap.js (embedded Natural
// Earth), so this works with no network, which is the point.
//
// The SID / STAR are LABELLED at their airport, not drawn. Procedure geometry
// is proprietary (Jeppesen / LIDO / state AIP) and there is no free, keyless
// source for it — and an invented track on a flight deck is worse than none.
function lbRouteMap(leg) {
  if (!lbAirports || !lbWorld) return '';
  const A = lbAirports.lookup(leg.dep), B = lbAirports.lookup(leg.arr);
  if (!A || !B || !Number.isFinite(A.lat) || !Number.isFinite(B.lat)) return '';
  const d = leg.dataCard || {};
  const W = 320, H = 180;
  // The route as actually flown: the great circle, not a decorative arc.
  // TLV→NRT runs up over Central Asia, and a map that shows that reads right
  // to a pilot; a symmetric curve between the two pins never does.
  const gc = greatCircle(A, B, 72);
  const pts = gc.pts;
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const [lon, lat] of pts) {
    if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
  }
  // ONE scale both ways. The old frame fitted longitude and latitude to the
  // box separately — TLV-NRT was 157° wide but 12° tall, squeezed into the
  // same 280×150, so the land came out stretched seven times over. Here a
  // degree of longitude is drawn cos(latitude) as wide as a degree of
  // latitude (true shapes around the route's middle), the route gets a
  // margin, and the frame then grows in whichever direction the box needs.
  const cLat0 = (minLat + maxLat) / 2;
  const k = Math.cos(Math.max(-60, Math.min(60, cLat0)) * Math.PI / 180);
  let spanX = Math.max((maxLon - minLon) * k * 1.35, 7);   // in equator-degrees
  let spanY = Math.max((maxLat - minLat) * 1.35 + 3, 5);   // +3°: room for labels
  if (spanX / spanY > W / H) spanY = spanX * H / W; else spanX = spanY * W / H;
  let cLat = cLat0;
  spanY = Math.min(spanY, 150);
  if (cLat + spanY / 2 > 84)  cLat = 84 - spanY / 2;
  if (cLat - spanY / 2 < -84) cLat = -84 + spanY / 2;
  const view = { cLon: (minLon + maxLon) / 2, cLat, spanLon: spanX / k, spanLat: spanY };
  const proj = lbWorld.projector({ x0: 0, y0: 0, w: W, h: H, ...view });
  // Land, drawn again one world over when the frame crosses the date line.
  let land = lbWorld.landPaths(proj, view);
  for (const shift of [-360, 360]) {
    const v2 = { ...view, cLon: view.cLon + shift };
    if (Math.abs(v2.cLon) - v2.spanLon / 2 > 180) continue;
    const p2 = { x: (lon) => proj.x(lon - shift), y: proj.y };
    land = land.concat(lbWorld.landPaths(p2, v2));
  }
  const landSvg = land.map(dd => `<path d="${dd}" class="lb-land"/>`).join('');
  const xy = pts.map(([lon, lat]) => [proj.x(lon), proj.y(lat)]);
  const track = 'M' + xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L');
  const [ax, ay] = xy[0], [bx, by] = xy[xy.length - 1];
  // Direction chevron at the middle of the track.
  const mi = Math.floor(xy.length / 2);
  const [p0x, p0y] = xy[Math.max(0, mi - 2)], [p1x, p1y] = xy[Math.min(xy.length - 1, mi + 2)];
  const ang = Math.atan2(p1y - p0y, p1x - p0x) * 180 / Math.PI;
  const [mx, my] = xy[mi];
  const arrow = gc.nm > 60
    ? `<path d="M-4,-3.5 L3,0 L-4,3.5" class="lb-dir" transform="translate(${mx.toFixed(1)},${my.toFixed(1)}) rotate(${ang.toFixed(1)})"/>`
    : '';
  // Labels stay inside the frame: flipped below a pin that sits near the top,
  // nudged in from the side edges.
  const clampX = (x) => Math.max(16, Math.min(W - 16, x));
  const lbl = (txt, x, y) => {
    const above = y > 16;
    return `<text x="${clampX(x).toFixed(1)}" y="${(above ? y - 7 : y + 13).toFixed(1)}" class="lb-pin-lbl">${esc(txt)}</text>`;
  };
  const proc = (txt, x, y) => txt
    ? `<text x="${clampX(x).toFixed(1)}" y="${Math.min(H - 4, y + (y > 16 ? 13 : 23)).toFixed(1)}" class="lb-proc-lbl">${esc(txt)}</text>` : '';
  const nm = Math.round(gc.nm);
  return `<svg class="lb-map" viewBox="0 0 ${W} ${H}" role="img"
       aria-label="Route ${esc(leg.dep || '')} to ${esc(leg.arr || '')}, ${nm} nautical miles">
    <rect x="0" y="0" width="${W}" height="${H}" class="lb-sea"/>
    ${landSvg}
    <path d="${track}" class="lb-track"/>
    ${arrow}
    <circle cx="${ax.toFixed(1)}" cy="${ay.toFixed(1)}" r="3.5" class="lb-pin"/>
    <circle cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="3.5" class="lb-pin lb-pin-arr"/>
    ${lbl(leg.dep || '', ax, ay)}${lbl(leg.arr || '', bx, by)}
    ${proc(d.sid, ax, ay)}${proc(d.star, bx, by)}
    ${nm > 0 ? `<text x="${W - 8}" y="${H - 8}" class="lb-dist">${nm.toLocaleString('en-US')} nm</text>` : ''}
  </svg>`;
}

// Points along the great circle A→B as [lon, lat], longitudes unwrapped so a
// route over the date line stays one continuous line (lon may pass ±180).
function greatCircle(A, B, n) {
  const R = Math.PI / 180;
  const f1 = A.lat * R, l1 = A.lon * R, f2 = B.lat * R, l2 = B.lon * R;
  const dist = 2 * Math.asin(Math.sqrt(
    Math.sin((f2 - f1) / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin((l2 - l1) / 2) ** 2));
  if (!(dist > 1e-7)) return { pts: [[A.lon, A.lat], [B.lon, B.lat]], nm: 0 };
  const pts = [];
  let prev = null;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = Math.sin((1 - t) * dist) / Math.sin(dist), b = Math.sin(t * dist) / Math.sin(dist);
    const x = a * Math.cos(f1) * Math.cos(l1) + b * Math.cos(f2) * Math.cos(l2);
    const y = a * Math.cos(f1) * Math.sin(l1) + b * Math.cos(f2) * Math.sin(l2);
    const z = a * Math.sin(f1) + b * Math.sin(f2);
    let lon = Math.atan2(y, x) / R;
    const lat = Math.atan2(z, Math.hypot(x, y)) / R;
    if (prev != null) { while (lon - prev > 180) lon -= 360; while (lon - prev < -180) lon += 360; }
    prev = lon;
    pts.push([lon, lat]);
  }
  return { pts, nm: dist * 3440.065 };
}

// Procedures you have already recorded at this airport. The app cannot know
// which SID you were cleared for — that geometry is proprietary and there is no
// free source — but it does know every one you have logged here before, and
// after a few trips that list is usually where the answer already is.
let lbProcMemory = null;
function buildLbProcMemory(legs) {
  const mem = { sid: new Map(), star: new Map() };
  for (const leg of legs) {
    const d = leg.dataCard || {};
    if (d.sid && leg.dep) {
      const k = String(leg.dep).toUpperCase();
      if (!mem.sid.has(k)) mem.sid.set(k, new Set());
      mem.sid.get(k).add(String(d.sid).toUpperCase());
    }
    if (d.star && leg.arr) {
      const k = String(leg.arr).toUpperCase();
      if (!mem.star.has(k)) mem.star.set(k, new Set());
      mem.star.get(k).add(String(d.star).toUpperCase());
    }
  }
  lbProcMemory = mem;
}
function lbProcDatalist(kind, code) {
  const key = String(code || '').toUpperCase();
  const set = lbProcMemory && lbProcMemory[kind] && lbProcMemory[kind].get(key);
  if (!set || !set.size) return '';
  const opts = [...set].sort().map(v => `<option value="${esc(v)}"></option>`).join('');
  return `<datalist id="lb-${kind}-${esc(code || 'x')}">${opts}</datalist>`;
}

// Crew as flown, with role labels. Same slots the data card carries; blanks
// are skipped and a name repeated across slots is only listed once.
// Crew, editable in place. A backfilled sector carries whoever the export
// named, but exports are wrong sometimes and the roster only ever knew the
// two seats — so every slot is a field, not a label. Which slots show is
// crew.js's slotsToShow: CPT and FO, everything filled, one free slot of each
// rank and one free cabin slot to add someone, and Deadhead.
function lbCrewHtml(leg, ident) {
  const d = leg.dataCard || {};
  const val = (k) => String(leg[k] || d[k] || '').trim();
  const field = (key, value) => `
    <label class="lb-crew-edit${key === 'dh' ? ' lb-crew-dh' : ''}">
      <b>${esc(crewShort(key, k => !!val(k)))}</b>
      <input type="text" value="${esc(value)}" data-lb-crew="${esc(key)}" ${ident}
             placeholder="${key === 'dh' ? 'deadhead crew, comma-separated' : '—'}"
             autocomplete="off" spellcheck="false"
             aria-label="${esc(crewLabel(key, k => !!val(k)))} for this flight" />
    </label>`;
  return slotsToShow(k => !!val(k)).map(k => field(k, val(k))).join('');
}

// PF / PM for this flight's take-off and landing. Tapping the selected one
// clears it back to unknown — an empty role is honest, a guessed one is not.
function lbRoleHtml(leg, ident) {
  const d = leg.dataCard || {};
  const pair = (key, label) => {
    const cur = String(d[key] || '').toUpperCase();
    const btn = (role) => `
      <button type="button" class="lb-role-btn${cur === role ? ' is-on' : ''}"
              data-lb-role="${esc(key)}" data-role-val="${role}" ${ident}
              aria-pressed="${cur === role}">${role}</button>`;
    return `<span class="lb-role-set"><b>${esc(label)}</b>${btn('PF')}${btn('PM')}</span>`;
  };
  return `<div class="lb-detail-roles">${pair('to_role', 'T/O')}${pair('ldg_role', 'LDG')}</div>`;
}

// #logbook-body survives between openings (only its innerHTML is replaced), so
// binding here on every open stacked another set of listeners on the same
// element. Two listeners toggled a row open and straight shut again, three
// opened it, four shut it — which is why tapping a flight worked on some
// openings and appeared dead on others. Bind once.
let lbWired = false;
function wireLogbookRows(body) {
  if (lbWired) return;
  lbWired = true;
  const identOf = (el) => ({
    flight:   el.dataset.flight   || '',
    dep_date: el.dataset.depDate  || '',
    dep:      el.dataset.dep      || '',
    arr:      el.dataset.arr      || '',
    dep_year: el.dataset.depYear  || '',
  });

  body.addEventListener('click', (e) => {
    // "Open this leg" — the old tap behaviour, now explicit so a plain tap can
    // expand the flight instead of navigating away from the logbook.
    const open = e.target.closest('.lb-open');
    if (open) {
      e.preventDefault();
      const id = identOf(open);
      const legs = storage.getLegs() || [];
      const idx = legs.findIndex(l =>
        String(l.flight || '') === id.flight &&
        String(l.dep_date || '') === id.dep_date &&
        String(l.dep || '') === id.dep &&
        String(l.arr || '') === id.arr &&
        (!id.dep_year || !l.dep_year || String(l.dep_year) === id.dep_year));
      if (idx >= 0) { hideOverlay('logbook-overlay'); pickLeg(idx); }
      // Historical flights live in fc.state.history and can't be made active.
      else toast('From a previous duty — view only');
      return;
    }
    // Route info for THIS flight — including ones from earlier duties or the
    // CSV backfill, which can't become the active leg.
    const routeBtn = e.target.closest('.lb-routeinfo');
    if (routeBtn) {
      e.preventDefault();
      const id = identOf(routeBtn);
      const leg = storage.everyLeg().find(l =>
        String(l.flight || '') === id.flight &&
        String(l.dep_date || '') === id.dep_date &&
        String(l.dep || '') === id.dep &&
        String(l.arr || '') === id.arr &&
        (!id.dep_year || !l.dep_year || String(l.dep_year) === id.dep_year));
      if (!leg) { toast('Flight not found'); return; }
      hideOverlay('logbook-overlay');
      import('./modules/route-ui.js?v=262').then(ru => { ru.wire(); return ru.open(leg); })
        .catch(err => { console.warn('route info failed', err); toast('Route info failed to load'); });
      return;
    }
    const dutyRow = e.target.closest('[data-duty-uid]');
    if (dutyRow) { e.preventDefault(); showDuty(dutyRow.dataset.dutyUid); return; }
    const row = e.target.closest('.lb-row');
    if (!row) return;
    e.preventDefault();
    const detail = row.parentElement?.querySelector('.lb-detail');
    if (!detail) return;
    const nowOpen = detail.classList.contains('hidden');
    detail.classList.toggle('hidden', !nowOpen);
    row.setAttribute('aria-expanded', nowOpen ? 'true' : 'false');
  }, { once: false });

  // Actual flight time, typed straight into the row — the value is measured by
  // GPS when the app is running through the landing, but a leg flown with the
  // app closed has nothing to measure, so it has to be typeable.
  body.addEventListener('input', (e) => {
    const act = e.target.closest('[data-lb-actual]');
    if (!act) return;
    const v = dataCard.formatHHMM(act.value);
    if (act.value !== v) {
      act.value = v;
      try { act.setSelectionRange(v.length, v.length); } catch {}
    }
    storage.setStoredLegField(identOf(act), 'actual_flight_time', v);
    const leg = lbLegIndex.get(lbKeyOf(identOf(act)));
    if (leg) {
      leg.dataCard = leg.dataCard || {};
      if (v) leg.dataCard.actual_flight_time = v; else delete leg.dataCard.actual_flight_time;
    }
  });

  // Crew typed straight into the row. Same write path as the actual time, so
  // it reaches a backfilled sector or an archived duty, not just the open leg.
  body.addEventListener('input', (e) => {
    const inp = e.target.closest('[data-lb-crew]');
    if (!inp) return;
    const key = inp.dataset.lbCrew;
    const value = inp.value.trim();
    const id = identOf(inp);
    storage.setStoredLegField(id, key, value);
    const leg = lbLegIndex.get(lbKeyOf(id));
    if (!leg) return;
    leg.dataCard = leg.dataCard || {};
    if (value) { leg.dataCard[key] = value; leg[key] = value; }
    else { delete leg.dataCard[key]; delete leg[key]; }
  });

  // PF / PM. Tapping the role that's already set clears it — the field is
  // meaningfully empty for a sector whose export never recorded who flew.
  body.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-lb-role]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();          // don't collapse the row we're editing
    const key = btn.dataset.lbRole;
    const want = btn.dataset.roleVal;
    const id = identOf(btn);
    const on = btn.classList.contains('is-on');
    const value = on ? '' : want;
    storage.setStoredLegField(id, key, value);
    const leg = lbLegIndex.get(lbKeyOf(id));
    if (leg) {
      leg.dataCard = leg.dataCard || {};
      if (value) leg.dataCard[key] = value; else delete leg.dataCard[key];
    }
    // Repaint this pair, then the collapsed row's tags so the change shows
    // without reopening the logbook.
    const set = btn.closest('.lb-role-set');
    set?.querySelectorAll('[data-lb-role]').forEach((b) => {
      const isOn = !!value && b.dataset.roleVal === value;
      b.classList.toggle('is-on', isOn);
      b.setAttribute('aria-pressed', String(isOn));
    });
    const item = btn.closest('.lb-item');
    const tags = item?.querySelector('.lb-tags');
    if (tags && leg) {
      const d = leg.dataCard || {};
      const pill = (v, label) => {
        const r = String(v || '').toUpperCase();
        return r ? `<span class="lb-tag ${r === 'PF' ? 'is-pf' : 'is-pm'}">${label} ${r}</span>` : '';
      };
      const actual = d.actual_block_time || d.actual_flight_time || d.block_time || leg.flight_time || '';
      const pa = legPlanActual(leg);
      tags.innerHTML = [
        pill(d.to_role, 'T/O'), pill(d.ldg_role, 'LDG'),
        actual ? `<span class="lb-tag">${esc(actual)}</span>` : '',
        pa.obtDelta != null
          ? `<span class="lb-tag lb-delay ${planTone(pa.obtDelta)}" title="Off-block vs schedule">${fmtDelta(pa.obtDelta)}</span>` : '',
      ].filter(Boolean).join('');
    }
  });

  // SID / STAR typed straight into the row. Writes to that leg wherever it
  // lives — the active duty or history — not just the currently open one.
  body.addEventListener('input', (e) => {
    const inp = e.target.closest('[data-lb-proc]');
    if (!inp) return;
    const value = inp.value.toUpperCase();
    if (inp.value !== value) inp.value = value;
    const id = identOf(inp);
    storage.setStoredLegField(id, inp.dataset.lbProc, value);
    // Repaint just this row: the map's procedure labels and the codes on the
    // collapsed row both read from the leg we've only now changed.
    const leg = lbLegIndex.get(lbKeyOf(id));
    if (!leg) return;
    leg.dataCard = leg.dataCard || {};
    if (value) leg.dataCard[inp.dataset.lbProc] = value;
    else delete leg.dataCard[inp.dataset.lbProc];
    const item = inp.closest('.lb-item');
    const svg = item?.querySelector('.lb-map');
    if (svg) {
      const tpl = document.createElement('template');
      tpl.innerHTML = lbRouteMap(leg);
      if (tpl.content.firstElementChild) svg.replaceWith(tpl.content.firstElementChild);
    }
    const mid = item?.querySelector('.lb-mid');
    if (mid) {
      const d = leg.dataCard;
      const html = [
        d.sid  ? `<span class="lb-proc">SID ${esc(d.sid)}</span>`   : '',
        d.star ? `<span class="lb-proc">STAR ${esc(d.star)}</span>` : '',
      ].filter(Boolean).join('');
      let procs = mid.querySelector('.lb-procs');
      if (html && !procs) {
        procs = document.createElement('div');
        procs.className = 'lb-procs';
        mid.appendChild(procs);
      }
      if (procs) { procs.innerHTML = html; procs.classList.toggle('hidden', !html); }
    }
  });
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

// Compact "how long ago" for the analytics sub-labels. Past only.
// today / yesterday / N days / N wks / N mo / N yr — plus the absolute
// date once it's over a year so "last 2023" reads clearly.
function relDate(ts) {
  if (!Number.isFinite(ts)) return '';
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days < 0)  return 'today';
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14)  return `${days} days ago`;
  if (days < 60)  return `${Math.round(days / 7)} wks ago`;
  if (days < 365) return `${Math.round(days / 30)} mo ago`;
  const d = new Date(ts);
  const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()];
  return `${mon} ${d.getUTCFullYear()}`;
}

// Every route ever flown, on one world map. Brightness and thickness carry two
// things at once: how OFTEN a route is flown, and how RECENTLY — a line you
// flew last week glows, one from two years ago is a faint trace. Same idea as
// a training heat map, and it reads at a glance without a legend to decode.
// Held between renders so the date sliders can rebuild the map cheaply.
let anMapCtx = null;

function heatSvgInner(heat, airports, world, W, H) {
  const view = { cLon: 10, cLat: 25, spanLon: 360, spanLat: 180 };
  const proj = world.projector({ x0: 0, y0: 0, w: W, h: H, ...view });
  const land = world.landPaths(proj).map(d => `<path d="${d}" class="an-land"/>`).join('');
  const now = Date.now();
  const maxCount = Math.max(...heat.map(h => h.count), 1);
  const YEAR = 365 * 24 * 3600 * 1000;
  const seen = new Map();
  const lines = [];
  for (const h of heat) {
    const A = airports.lookup(h.dep), B = airports.lookup(h.arr);
    if (!A || !B || !Number.isFinite(A.lat) || !Number.isFinite(B.lat)) continue;
    const ax = proj.x(A.lon), ay = proj.y(A.lat);
    const bx = proj.x(B.lon), by = proj.y(B.lat);
    seen.set(h.dep, [ax, ay]); seen.set(h.arr, [bx, by]);
    const freq = h.count / maxCount;
    const age  = h.lastTs ? Math.min(1, (now - h.lastTs) / (2 * YEAR)) : 1;
    const heatv = Math.max(0.12, 0.45 * freq + 0.55 * (1 - age));
    const wdt = (0.7 + 2.6 * freq).toFixed(2);
    const mx = (ax + bx) / 2, my = (ay + by) / 2 - Math.abs(bx - ax) * 0.13;
    lines.push(`<path d="M${ax.toFixed(1)},${ay.toFixed(1)} Q${mx.toFixed(1)},${my.toFixed(1)} ${bx.toFixed(1)},${by.toFixed(1)}"
      class="an-route" style="stroke-width:${wdt};opacity:${heatv.toFixed(2)}"/>`);
  }
  const dots = [...seen.values()]
    .map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.8" class="an-dot"/>`).join('');
  return `<rect x="0" y="0" width="${W}" height="${H}" class="an-sea"/>${land}${lines.join('')}${dots}`;
}

const AN_DAY = 24 * 3600 * 1000;
const anDayLabel = (ts) => {
  const d = new Date(ts);
  return `${String(d.getUTCDate()).padStart(2,'0')}/${String(d.getUTCMonth()+1).padStart(2,'0')}/${String(d.getUTCFullYear()).slice(2)}`;
};

function renderRouteHeatMap(airports, world, routeLegs, year = null, heatFrom) {
  if (!airports || !world) return '';
  const W = 720, H = 360;
  const now = Date.now();
  // The scale is the period the year picker chose: 1 Jan → 31 Dec of that
  // year (→ today for the current one), or first flight on record → today
  // for all time. It used to span everything whatever the picker said, so
  // a 2024 view still drew 2019's routes on a seven-year slider.
  let legs = (routeLegs || []).filter(r => r.ts > 0);
  let first, end;
  if (year != null) {
    first = Date.UTC(year, 0, 1);
    end = Math.min(Date.UTC(year + 1, 0, 1) - 1, now);
    legs = legs.filter(r => r.ts >= first && r.ts <= end);
  } else {
    first = legs.length ? Math.min(...legs.map(r => r.ts)) : now;
    end = now;
  }
  const heat = heatFrom(legs);
  if (!heat.length) return '';
  const days = Math.max(1, Math.ceil((end - first) / AN_DAY));
  anMapCtx = { airports, world, W, H, first, end, days, legs };
  const wholeLabel = year != null ? `All of ${year}` : 'All time';
  return `
    <section class="an-card an-map-card">
      <h4>Where I fly</h4>
      <svg id="an-map" class="an-map" viewBox="0 0 ${W} ${H}" role="img"
           aria-label="World map of routes flown, brighter where flown more often and more recently">
        ${heatSvgInner(heat, airports, world, W, H)}
      </svg>
      <div class="an-range">
        <!-- ONE scale, two handles: both inputs share a single track, so the
             span between them reads as the window rather than as two unrelated
             sliders. The inputs themselves are pointer-transparent; only their
             thumbs take touches, which is what lets the two overlap. -->
        <div class="an-scale">
          <div class="an-scale-track"></div>
          <div class="an-scale-fill" id="an-scale-fill"></div>
          <input type="range" id="an-from" min="0" max="${days}" step="1" value="0"
                 aria-label="Window start" />
          <input type="range" id="an-to" min="0" max="${days}" step="1" value="${days}"
                 aria-label="Window end" />
        </div>
        <div class="an-scale-ends">
          <output id="an-from-out">${anDayLabel(first)}</output>
          <button type="button" id="an-range-all" class="an-range-all">${wholeLabel}</button>
          <output id="an-to-out">${anDayLabel(end)}</output>
        </div>
      </div>
      <p id="an-map-key" class="an-map-key muted small">
        ${heat.length} route${heat.length === 1 ? '' : 's'} · brighter and thicker = flown more often and more recently
      </p>
    </section>`;
}

// Redraw the map for whatever window the two sliders describe. Only the SVG's
// contents and the key line change — the sliders themselves are left alone so
// dragging stays smooth.
async function repaintAnMap() {
  if (!anMapCtx) return;
  const { airports, world, W, H, first, end, days, legs } = anMapCtx;
  const fromEl = $('an-from'), toEl = $('an-to');
  let a = Number(fromEl.value), b = Number(toEl.value);
  if (a > b) { [a, b] = [b, a]; }        // crossed handles read as a range, not an empty one
  const fromTs = first + a * AN_DAY;
  const toTs   = first + b * AN_DAY + AN_DAY - 1;
  $('an-from-out').textContent = anDayLabel(fromTs);
  $('an-to-out').textContent   = anDayLabel(Math.min(toTs, end));
  const fill = $('an-scale-fill');
  if (fill) {
    fill.style.left  = (a / days * 100).toFixed(2) + '%';
    fill.style.right = (100 - b / days * 100).toFixed(2) + '%';
  }
  const inRange = legs.filter(r => r.ts >= fromTs && r.ts <= toTs);
  try {
    const an = await import('./modules/analytics.js?v=262');
    const heat = an.heatFrom(inRange);
    $('an-map').innerHTML = heatSvgInner(heat, airports, world, W, H);
    $('an-map-key').textContent = heat.length
      ? `${heat.length} route${heat.length === 1 ? '' : 's'} · ${inRange.length} flight${inRange.length === 1 ? '' : 's'} in this window`
      : 'No flights in this window';
  } catch (err) { console.warn('map repaint failed', err); }
}

// Delegated: the analytics body is re-rendered wholesale each time it opens,
// so binding to the inputs directly would go stale.
$('analytics-body').addEventListener('input', (e) => {
  if (e.target.id === 'an-from' || e.target.id === 'an-to') repaintAnMap();
});
$('analytics-body').addEventListener('click', (e) => {
  if (!e.target.closest('#an-range-all')) return;
  const f = $('an-from'), t = $('an-to');
  if (!f || !t) return;
  f.value = f.min; t.value = t.max;
  repaintAnMap();
});

// On-time card: off-block and in-block against the schedule (see
// analytics.punctuality). Two tiles, same shape as the landing-G split.
function renderPunctuality(p, scope) {
  if (!p || (!p.dep && !p.arr)) return '';
  const tile = (x, label) => x ? `
      <div class="an-g-tile">
        <div class="an-g-role">${label}</div>
        <div class="an-g-num">${x.onPct}%</div>
        <div class="an-g-count">on time · ${x.a15Pct}% within 15′</div>
        <div class="an-g-count">avg <span class="an-punct-avg ${planTone(x.avg)}">${fmtDelta(x.avg)} min</span> · ${x.n} flight${x.n === 1 ? '' : 's'}</div>
      </div>` : `
      <div class="an-g-tile"><div class="an-g-role">${label}</div><div class="an-g-num">—</div><div class="an-g-count">No actual times</div></div>`;
  return `
    <div class="an-card">
      <h4>On time (${scope})</h4>
      <div class="an-g-split">${tile(p.dep, 'Off-block')}${tile(p.arr, 'In-block')}</div>
      <div class="an-big-sub">against the roster's STD / STA — on time is within 5 min</div>
    </div>`;
}

function renderAnalytics(data, { cityName, displayCrew, airports, world }) {
  if (!data.legCount) {
    return `
      <p class="muted small" style="padding:18px 4px;">
        No legs stored yet. Once your calendar syncs or you paste a roster, your
        analytics appear here.
      </p>`;
  }
  const heatMap = renderRouteHeatMap(airports, world, data.routeLegs || [], data.year, data.heatFrom);
  // Scope label used by every card heading, so it is never ambiguous whether a
  // number is year-to-date or a career total — or only the searched flights.
  const filters = data.filters || [];
  const scope = (data.year == null ? 'all time' : String(data.year)) + (filters.length ? ' · search' : '');
  const chips = filters.map((f, i) => `
    <span class="an-chip">
      <span class="an-chip-type">${escapeHtml(AN_TYPE_LABEL[f.type] || '')}</span>
      ${escapeHtml(anTermLabel(f.type, f.value))}
      <button type="button" class="an-chip-x" data-an-unpick="${i}" aria-label="Remove ${escapeAttr(f.value)}">✕</button>
    </span>`).join('');
  const search = `
    <div class="an-search">
      <label class="an-search-field">
        <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="M13 13l4.5 4.5"/></svg>
        <input id="an-q" type="search" enterkeyhint="search" autocomplete="off" autocorrect="off"
               spellcheck="false" placeholder="Crew, destination, aircraft, flight"
               aria-label="Search flights by crew, destination, aircraft or flight number" />
      </label>
      <div id="an-sugg" class="an-sugg hidden" role="listbox"></div>
      ${chips ? `<div class="an-chips">${chips}<button type="button" id="an-clear" class="an-clear">Clear</button></div>` : ''}
    </div>`;
  // The flights behind the numbers, when a search is on: tap one to open it.
  let results = '';
  if (filters.length) {
    const m = data.matches || [];
    const shown = anShowAll ? m : m.slice(0, 12);
    const rows = shown.map(leg => {
      const d = leg.dataCard || {};
      const time = d.actual_block_time || d.block_time || leg.flight_time || '';
      const crew = [leg.cpt || d.cpt, leg.fo || d.fo].filter(Boolean).map(n => storage.displayCrew(n) || n).join(' · ');
      return `<button type="button" class="an-result" data-an-open="${escapeAttr(lbKeyOf(leg))}">
          <span class="an-result-date">${escapeHtml(legDateLabel(leg.dep_date, leg.dep_year))}</span>
          <span class="an-result-mid">
            <span class="an-result-top">${escapeHtml(leg.flight ? displayFlight(leg.flight) : 'Flight')} · ${escapeHtml(leg.dep || '—')} → ${escapeHtml(leg.arr || '—')}</span>
            <span class="an-result-sub">${escapeHtml([leg.tail || d.tail, crew].filter(Boolean).join(' · '))}</span>
          </span>
          <span class="an-result-time">${escapeHtml(time)}</span>
        </button>`;
    }).join('');
    results = `
      <div class="an-card">
        <h4>${m.length} flight${m.length === 1 ? '' : 's'} (${scope.replace(' · search', '')})</h4>
        ${m.length ? `<div class="an-results">${rows}</div>` : `<p class="an-empty">No flights match${data.year != null ? ` in ${data.year} — try All time` : ''}.</p>`}
        ${m.length > shown.length ? `<button type="button" id="an-more" class="an-more">Show all ${m.length}</button>` : ''}
      </div>`;
  }
  const years = Array.isArray(data.years) ? data.years : [];
  const yearPicker = `
    <div class="an-years" role="group" aria-label="Period">
      <button type="button" class="an-year${data.year == null ? ' is-on' : ''}" data-an-year="all">All time</button>
      ${years.map(y =>
        `<button type="button" class="an-year${data.year === y ? ' is-on' : ''}" data-an-year="${y}">${y}</button>`
      ).join('')}
    </div>`;
  // Top destinations — sub-label carries the city + when I last flew there.
  const lastDest = data.lastDest || {};
  const topRows = data.top.map(d => {
    const city = cityName(d.icao) || '';
    const last = lastDest[d.icao] ? relDate(lastDest[d.icao]) : '';
    const sub = [city, last && `last ${last}`].filter(Boolean).join(' · ');
    return { label: d.icao, sub, count: d.count };
  });
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
  // Sub-label shows when I last flew with them.
  const lastCrew = data.lastCrew || {};
  const crewRows = data.crew.map(c => {
    const last = lastCrew[c.name] ? relDate(lastCrew[c.name]) : '';
    return {
      label: displayCrew(c.name) || c.name,
      sub:   last ? `last ${last}` : '',
      count: c.count,
    };
  });

  return `
    ${yearPicker}
    ${search}
    ${results}
    ${heatMap}
    <div class="an-card">
      <h4>Top destinations (${scope})</h4>
      ${renderBars(topRows, { emptyMsg: 'No non-home arrivals yet this year.' })}
    </div>
    <div class="an-card">
      <h4>Nights away from home (${scope})</h4>
      <div class="an-big">${data.nights}</div>
      <div class="an-big-sub">distinct calendar days with at least one non-TLV leg</div>
    </div>
    <div class="an-card">
      <h4>Hours flown (${scope})</h4>
      <div class="an-big">${esc(data.hours.totalLabel)}</div>
      <div class="an-big-sub">block hours — actual off-block → on-block where known, else scheduled</div>
      ${tailChips ? `<div class="an-tails">${tailChips}</div>` : ''}
    </div>
    ${renderPunctuality(data.punct, scope)}
    <div class="an-card">
      <h4>Landing G — PF vs PM (${scope})</h4>
      ${gContent}
    </div>
    <div class="an-card">
      <h4>Most flown with (${scope})</h4>
      ${renderBars(crewRows, { emptyMsg: 'No crew on file yet for this year.' })}
    </div>
  `;
}

// ---------- Backfill logbook from a sector CSV ----------
// Everything flown before this app existed only exists in the crew portal's
// sector export. Loading one backfills years of logbook and insights in a
// single pick. See modules/sectors-csv.js for the column mapping.

function paintSectorsSection() {
  const status = $('sectors-status');
  const clear  = $('sectors-clear');
  if (!status) return;
  const n = (storage.getImportedLegs() || []).length;
  if (!n) {
    status.textContent = '';
    if (clear) clear.hidden = true;
    return;
  }
  const legs = storage.getImportedLegs();
  status.textContent = `${n} imported sector${n === 1 ? '' : 's'} in your logbook`
    + `${legs[0]?.dep_year ? ` — ${legs[0].dep_year} to ${legs.at(-1).dep_year}` : ''}.`;
  if (clear) clear.hidden = false;
}

const fmtDay = (ms) => new Date(ms).toLocaleDateString(undefined,
  { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

$('sectors-csv').addEventListener('change', async (e) => {
  const f = e.target.files?.[0];
  e.target.value = '';   // allow re-picking the same file later
  if (!f) return;
  const status = $('sectors-status');
  if (status) status.textContent = `Reading ${f.name}…`;
  try {
    const text = await f.text();
    const { parseSectors } = await import('./modules/sectors-csv.js?v=262');
    const res = parseSectors(text);
    const span = (res.from && res.to) ? `\n${fmtDay(res.from)} → ${fmtDay(res.to)}` : '';
    const dh = res.skippedDeadhead
      ? `\n${res.skippedDeadhead} deadhead sector${res.skippedDeadhead === 1 ? '' : 's'} left out — you were a passenger.`
      : '';
    const who = res.owner ? `\nRead as ${res.owner}'s logbook.` : '';
    const rs = res.rescheduled
      ? `\n${res.rescheduled} flight${res.rescheduled === 1 ? ' was' : 's were'} listed twice (rescheduled) — the one that flew is kept.` : '';
    if (!confirm(`${res.legs.length} sectors found in ${f.name}.${span}${dh}${rs}${who}\n\nAdd them to your logbook?`)) {
      if (status) status.textContent = 'Cancelled.';
      return;
    }
    if (status) status.textContent = 'Importing…';
    const { added, updated } = storage.addImportedLegs(res.legs);
    // Force the write now rather than on the next idle flush: this is a lot of
    // data and the user may well close the app straight after.
    storage.flush?.();
    const bits = [];
    if (added)   bits.push(`${added} added`);
    if (updated) bits.push(`${updated} filled in`);
    if (!bits.length) bits.push('nothing new — already in your logbook');
    if (status) status.textContent = `${f.name}: ${bits.join(', ')}.`;
    toast(`Logbook backfilled — ${bits.join(', ')}`);
    paintSectorsSection();
    // The logbook overlay caches nothing, but analytics + the crew list read
    // live state, so anything already on screen needs a repaint.
    try { if (!$('analytics-overlay')?.classList.contains('hidden')) paintAnalytics(); } catch {}
  } catch (err) {
    console.warn('sector CSV import failed', err);
    const msg = err?.message || String(err);
    if (status) status.textContent = `Couldn't read that file: ${msg}`;
    toast('Import failed: ' + msg);
  }
});

$('sectors-clear').addEventListener('click', () => {
  const n = (storage.getImportedLegs() || []).length;
  if (!n) return;
  if (!confirm(`Remove ${n} imported sector${n === 1 ? '' : 's'} from your logbook?\n\n`
    + 'Flights that were already in the app keep the details the import filled in — '
    + 'those are yours now and stay.')) return;
  storage.clearImportedLegs();
  storage.flush?.();
  paintSectorsSection();
  toast(`Removed ${n} imported sector${n === 1 ? '' : 's'}`);
});

// ---------- Tail quick-track ----------
// Three-letter input (e.g. "EHE") is treated as an Israeli-fleet registration
// suffix and prefixed with "4X-". Anything else passes through untouched.
function normaliseRegistration(raw) {
  const s = String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!s) return '';
  if (/^[A-Z]{3}$/.test(s)) return '4X-' + s;
  return s;
}
// radar-btn is routed via the top-level click dispatch (data-action="radar");
// logic in doRadar() above.
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
  if (!gpsMod) gpsMod = await import('./modules/gps.js?v=262');
  if (!gMod)   gMod   = await import('./modules/g.js?v=262');
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
  if (d.actual_flight_time) lines.push(`Airborne: ${d.actual_flight_time}`);
  if (d.actual_block_time)  lines.push(`Actual block: ${d.actual_block_time}`);
  if (d.block_time)         lines.push(`Scheduled block: ${d.block_time}`);
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
  // +3 h: a delayed flight still gets GPS (take-off, landing, the FDP
  // estimate) when the app is opened late in the air.
  const arr = Date.parse(arrIso) + 3 * 3600 * 1000;
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
      try { paintPhase(); } catch {}
      setTimeout(() => { try { updateNearChip(); ftlEtaTick().catch(() => {}); } catch {} }, 5000);
    } else if (kind === 'landed') {
      const peak = g.peakG(payload.landing_at, 10);
      g.stop();
      if (peak != null) {
        storage.setDataField('max_g', peak.toFixed(2));
      }
      dataCard.render(dataBody);
      showLandingScore(peak, storage.getLeg());
      gpsActive = false;
      try { paintPhase(); paintFdpChip(); } catch {}
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
  // Route info's METARs / TAFs: top them up on every return to the app
  // (from 12 h before departure), so they're on the device before the
  // connection goes.
  try { routeAutoUpdate(); } catch (err) { console.warn('route prefetch skipped', err); }
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
let wxLetterHow = '';      // 'live' (from D-ATIS / ACARS) | 'manual' (a chip) | ''

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
$('wx-src-altn').addEventListener('click', () => switchWxSource('altn'));
// OTHER: one tap shows the airport typed there before (no keyboard); with
// none typed yet, the box opens for typing. Tapping it again while it's on
// selects the code, ready to type another. What's on screen is never the
// previous source's airport under the Other heading.
const wxCodeOk = (c) => /^[A-Z0-9]{3,4}$/.test(c);
function wxOtherPrompt() {
  paintWx({ icao: '—', letter: '', metar: null, taf: null, datis: null, ts: 0 });
  $('wx-datis-text').textContent = 'Type an airport (ICAO or IATA) in Other';
}
document.querySelector('.wx-src-custom').addEventListener('click', (e) => {
  if (e.target.closest('.wx-src-refresh')) return;
  const inp = $('wx-src-custom-input');
  if (wxSource !== 'custom') {
    e.preventDefault();
    wxSource = 'custom';
    inp.value = wxCustomCode;
    paintWxSrcRow();
    if (wxCodeOk(wxCustomCode)) loadWx({ force: false });
    else { wxOtherPrompt(); inp.focus(); }
    return;
  }
  // Already on Other: ready to type a new one.
  if (e.target !== inp) e.preventDefault();
  inp.focus();
  try { inp.select(); } catch {}
});
let wxTypeT = 0;
$('wx-src-custom-input').addEventListener('input', () => {
  const inp = $('wx-src-custom-input');
  wxCustomCode = inp.value.trim().toUpperCase();
  if (wxSource !== 'custom') { wxSource = 'custom'; paintWxSrcRow(); }
  clearTimeout(wxTypeT);
  if (!wxCustomCode) { wxOtherPrompt(); return; }
  // A moment's pause so "LEM" isn't fetched on the way to "LEMD"; a 3- or
  // 4-letter code then loads.
  if (wxCodeOk(wxCustomCode)) wxTypeT = setTimeout(() => loadWx({ force: false }), wxCustomCode.length === 4 ? 150 : 700);
});
$('wx-src-custom-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault(); clearTimeout(wxTypeT);
    if (wxCodeOk(wxCustomCode)) loadWx({ force: true });
    e.target.blur();
  }
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
  if (src === 'altn' && $('wx-src-altn').disabled) return;
  if (src === 'custom' && !wxCodeOk(wxCustomCode)) { wxSource = 'custom'; paintWxSrcRow(); wxOtherPrompt(); $('wx-src-custom-input').focus(); return; }
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
  clearTimeout(wxTypeT);
  wxSource = src;
  paintWxSrcRow();
  if (src !== 'custom') loadWx({ force: false });
}

function paintWxSrcRow() {
  const d = storage.getCurrent().dataCard;
  $('wx-src-dep-code').textContent = (d.dep || '—').toString().toUpperCase();
  $('wx-src-arr-code').textContent = (d.arr || '—').toString().toUpperCase();
  $('wx-src-dep').classList.toggle('on', wxSource === 'dep');
  $('wx-src-arr').classList.toggle('on', wxSource === 'arr');
  const altn = wxAltnCode();
  $('wx-src-altn-code').textContent = altn || '—';
  $('wx-src-altn').classList.toggle('on', wxSource === 'altn');
  $('wx-src-altn').disabled = !altn;
  document.querySelector('.wx-src-custom')?.classList.toggle('on', wxSource === 'custom');
  // Disable Dep / Arr buttons when the underlying field is empty so the user
  // gets immediate feedback that there's nothing to fetch there yet.
  $('wx-src-dep').disabled = !d.dep;
  $('wx-src-arr').disabled = !d.arr;
}

// The alternate chosen for this destination (Brief → + Alternate).
function wxAltnCode() {
  const arr = (storage.getCurrent().dataCard.arr || '').toString().toUpperCase();
  return arr ? String(altnFor(arr) || '').toUpperCase() : '';
}
function resolveWxCode() {
  const d = storage.getCurrent().dataCard;
  if (wxSource === 'arr')    return (d.arr || '').toString().toUpperCase();
  if (wxSource === 'altn')   return wxAltnCode();
  if (wxSource === 'custom') return wxCustomCode.toUpperCase();
  return (d.dep || '').toString().toUpperCase();
}

// Opened on the alternate: looking at it never makes it the ATIS airport.
let wxFromAltn = false;
// atisOnly: opened from a place already showing the METAR and TAF (the
// Brief's airport tiles, a Route info card) — the window is the ATIS alone,
// as tall as the screen allows.
async function openWx(end = '', code = '', { atisOnly = false } = {}) {
  wxFromAltn = end === 'altn';
  $('wx-overlay').classList.toggle('wx-atis-only', atisOnly);
  $('wx-label').textContent = atisOnly ? 'ATIS' : 'Weather';
  const d = storage.getCurrent().dataCard;
  // Pick a default source: whichever matches the sticky atis_icao first, so
  // re-opening the popup lands on the airport the user last looked at. If
  // nothing matches, fall back to dep → arr → custom.
  const sticky = (d.atis_icao || '').toString().toUpperCase();
  const depCode = (d.dep || '').toString().toUpperCase();
  const arrCode = (d.arr || '').toString().toUpperCase();
  if (end === 'dep' || end === 'arr') wxSource = end;
  else if (end === 'altn' && code && code.toUpperCase() === wxAltnCode()) wxSource = 'altn';
  else if (end === 'altn' && code) { wxSource = 'custom'; wxCustomCode = code; }
  else if (sticky && sticky === depCode) wxSource = 'dep';
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
  // The alternate (or an airport looked up from Route info) is only looked
  // at: it never becomes the flight's ATIS.
  if (code && wxSource !== 'altn' && !(wxFromAltn && wxSource === 'custom')) {
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
  $('ad-full')?.remove();
  adStopGps();
  if (wxRefreshTimer) { clearInterval(wxRefreshTimer); wxRefreshTimer = null; }
}

async function loadWx(opts) {
  const code = resolveWxCode();
  if (!code || code.length < 3) {
    paintWx({ icao: code || '—', letter: '', metar: null, taf: null, datis: null, ts: 0 });
    return;
  }
  // Another airport: clear the last one's at once — its ATIS mustn't sit
  // under the new code while the new one loads.
  if ($('wx-icao').textContent !== code) {
    paintWx({ icao: code, letter: '', metar: null, taf: null, datis: null, ts: 0 });
    $('wx-datis-text').textContent = 'Loading…';
  }
  const refreshBtn = $('wx-refresh');
  refreshBtn.disabled = true;
  refreshBtn.textContent = '…';
  try {
    const { fetchWx, extractLetter, extractText, pickAtis } = await import('./modules/wx.js?v=262');
    const res = await fetchWx(code, opts);
    // Moved on to another airport meanwhile: this answer is old news.
    if (resolveWxCode() !== code) return;
    if (!res) {
      paintWx({ icao: code, letter: '', metar: null, taf: null, datis: null, ts: 0 });
      return;
    }
    // Departure ATIS for the departure; arrival ATIS for the destination,
    // the alternate or any airport typed in.
    const prefer = wxSource === 'dep' ? 'dep' : 'arr';
    const liveLetter = extractLetter(res.datis, prefer);
    // The popup shows whichever letter D-ATIS just returned (or the existing
    // card letter when source=Dep and no live letter yet). The data card's
    // ATIS chip isn't written here — closeWx() commits whatever source the
    // popup was last on so the chip flips on close, not on every refresh.
    // The live letter always wins, so a refresh shows the current one. A
    // letter picked by hand is kept only for the airport it was picked at
    // (Madrid's Y never shows on Tel Aviv) and only while there's no live one.
    const card = storage.getCurrent().dataCard;
    const mine = card.atis && String(card.atis_icao || '').toUpperCase() === res.icao ? card.atis : '';
    const letter = liveLetter || mine || '';
    wxLetterHow = liveLetter ? 'live' : letter ? 'manual' : '';
    paintWx({
      icao: res.icao,
      letter,
      metar: res.metar,
      taf:   res.taf,
      datis: res.datis,
      ts: res.ts,
      datisText: extractText(res.datis, prefer),
      datisPick: pickAtis(res.datis, prefer),
    });
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.textContent = '↻';
  }
}

function paintWx({ icao, letter, metar, taf, datis, ts, datisText, datisPick }) {
  wxDisplayLetter = letter || '';
  if (!letter) wxLetterHow = '';
  paintLetterHow();
  const wxLetterEl = $('wx-letter');
  wxLetterEl.textContent = letter || '—';
  // Open in front of you, so it's being read: green live / blue by hand, not
  // the main screen's red "new letter".
  wxLetterEl.classList.toggle('is-unread', false);
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
  colourWxPopup(icao, metar, taf, datisText, datisPick?.letter || datisPick?.code || letter);
  // Which ATIS, and for one heard over ACARS, how old: it's only as new as
  // the last aircraft that asked for it.
  const srcEl = $('wx-datis-src');
  if (srcEl) {
    const p = datisText ? datisPick : null;
    const kind = p ? ({ arr: 'ARR', dep: 'DEP' }[p.type] || '') : '';
    let txt = [kind, p?.letter || p?.code || ''].filter(Boolean).join(' ');
    // How long ago it was issued: the time written at its top (0632Z),
    // else when ACARS carried it.
    const issued = datisText ? atisIssuedMs(datisText, p?.at || Date.now()) : NaN;
    const at = Number.isFinite(issued) ? issued : p?.src === 'acars' ? p.at : NaN;
    const min = Number.isFinite(at) ? Math.max(0, Math.round((Date.now() - at) / 60000)) : null;
    if (min != null) {
      const z = new Date(at).toISOString().slice(11, 16).replace(':', '') + 'Z';
      txt += `${txt ? ' · ' : ''}${z} · ${min < 60 ? min + ' min' : Math.floor(min / 60) + ' h ' + String(min % 60).padStart(2, '0')} ago${p?.src === 'acars' ? ' · ACARS' : ''}`;
    }
    srcEl.textContent = txt;
    // Over an hour old orange, over two red — the label, the text's edge
    // and the letter, so a stale ATIS can't pass for a fresh one.
    const age = min == null ? '' : min >= 120 ? 'red' : min >= 60 ? 'amber' : '';
    srcEl.classList.toggle('is-old', age === 'amber');
    srcEl.classList.toggle('is-stale', age === 'red');
    datisEl.classList.toggle('is-old', age === 'amber');
    datisEl.classList.toggle('is-stale', age === 'red');
    $('wx-letter').classList.toggle('is-old', age === 'amber' && !!letter);
    $('wx-letter').classList.toggle('is-stale', age === 'red' && !!letter);
  }
}

// The issue time an ATIS gives near its top ("0632Z LLBG ARR INFO D"),
// placed on the day nearest `ref` (ms); NaN if it gives none.
function atisIssuedMs(text, ref) {
  const m = /\b([01]\d|2[0-3])([0-5]\d)Z\b/.exec(String(text).slice(0, 160));
  if (!m) return NaN;
  const d = new Date(ref);
  let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), +m[1], +m[2]);
  if (t - ref > 3 * 3600e3) t -= 86400e3;
  return t;
}
// METAR, TAF and ATIS coloured by the Route card's rules (route-ui.js):
// green good, yellow marginal, orange below CAT I, red hazard / closed —
// with runway surface, RWYCC and braking action in the ATIS too.
async function colourWxPopup(icao, metar, taf, atis, atisLetter = '') {
  let c;
  const d = storage.getCurrent().dataCard;
  const end = wxSource === 'custom'
    ? (icao === String(d.dep || '').toUpperCase() ? 'dep' : icao === String(d.arr || '').toUpperCase() ? 'arr' : '')
    : wxSource;
  const when = await wxTimeFor(end);
  if ($('wx-icao').textContent !== icao) return;
  $('wx-when').textContent = wxTimeText(when);
  const items = [];
  try { c = await (await import('./modules/route-ui.js?v=262')).colouredWx(icao, { metar: metar || '', taf: taf || '', atis: atis || '', eta: when.ms, letter: atisLetter, items }); }
  catch { return; }
  if ($('wx-icao').textContent !== icao) return;      // moved on meanwhile
  if (metar) $('wx-metar-text').innerHTML = c.metar;
  if (taf && $('wx-taf-text')) $('wx-taf-text').innerHTML = c.taf;
  if (atis) $('wx-datis-text').innerHTML = c.atis;
  wxRwArgs = { icao, atis: atis || '', metar: metar || '', end: end === 'dep' ? 'dep' : 'arr' };
  paintAtisDiagram(icao, atis ? items : []);
}

// The diagram's wind: a wind sign (north up, like the drawing) with the
// direction and strength — from the ATIS, else the METAR — and, once a
// runway has been tapped on the diagram, that runway's LDA and head / tail /
// crosswind. The ATIS's runway in use carries a ★ on the drawing.
let wxRwArgs = null;
const wxRwSel = new Map();          // ICAO → runway end tapped on the diagram
async function paintAdWind() {
  const wrap = document.querySelector('#wx-atis-diagram .wx-ad-wrap');
  if (!wrap || !wxRwArgs) return;
  const a = wxRwArgs;
  let info = null, ru = null;
  try { ru = await import('./modules/route-ui.js?v=262'); info = await ru.atisWindInfo(a.icao, a); } catch {}
  if (wxRwArgs !== a || !info) return;
  const sel = wxRwSel.get(a.icao) || '';
  // The drawing: chosen runway lit, the ATIS's runway in use outlined.
  for (const g of wrap.querySelectorAll('.ad-end')) {
    g.classList.toggle('is-sel', g.dataset.adRw === sel);
    g.classList.toggle('is-inuse', g.dataset.adRw === info.inUse);
    const e = info.ends.find(x => x.id.replace(/[-\s]/g, '') === g.dataset.adRw);
    const lda = g.querySelector('.ad-lda');
    if (lda) lda.textContent = e ? `LDA ${Math.round(e.lda).toLocaleString('en-US')}` : '';
  }
  wrap.querySelector('svg')?.dispatchEvent(new Event('ad-relayout'));
  const selEnd = wrap.querySelector(`.ad-end[data-ad-rw="${CSS.escape(sel)}"]`);
  for (const p of wrap.querySelectorAll('.ad-rw path')) p.classList.toggle('is-sel', !!selEnd && p.dataset.adRwy === selEnd.dataset.adRwy);
  const w = info.w;
  let box = wrap.querySelector('.ad-wind');
  if (!box) { wrap.insertAdjacentHTML('beforeend', '<div class="ad-wind"></div>'); box = wrap.querySelector('.ad-wind'); }
  // The wind as a barb (north up, like the drawing) and its numbers; then,
  // once a runway is tapped, its LDA and HW / TW and XW.
  const sign = w && w.wdir != null && (w.wspd || w.wgst) ? ru.windBarbSvg(w.wdir, w.wspd || 0, w.wgst) : '';
  const wTxt = !w ? '—' : !(w.wspd || w.wgst) ? 'Calm' : `${w.wdir == null ? 'VRB' : String(w.wdir).padStart(3, '0') + '°T'}/${w.wspd}${w.wgst ? 'G' + w.wgst : ''}`;
  box.innerHTML = `<div class="ad-wind-h">${sign}<b>${wTxt}</b></div>` + (sel ? ru.rwyWindHtml(info, sel) : '');
}
$('wx-overlay').addEventListener('click', (e) => {
  const g = e.target.closest('#wx-atis-diagram .ad-end[data-ad-rw]');
  if (!g || !wxRwArgs) return;
  const id = g.dataset.adRw;
  if (wxRwSel.get(wxRwArgs.icao) === id) wxRwSel.delete(wxRwArgs.icao); else wxRwSel.set(wxRwArgs.icao, id);
  paintAdWind();
});

// Closures / ILS faults in the ATIS: the airport drawn with them marked —
// below the text, or beside it on an iPad — with where you are on it (GPS)
// and ⤢ for the whole airport full screen.
let adState = null;          // { geo, items, ad, icao } of the diagram on show
let adWatch = null;          // geolocation watch while a diagram is open
let adFix = null;            // last position for it
async function paintAtisDiagram(icao, items) {
  const box = $('wx-atis-diagram');
  if (!box) return;
  const sec = box.closest('.wx-sec-atis');
  // Always: the whole airport, closures or not.
  box.hidden = false;
  sec?.classList.add('has-diagram');
  box.innerHTML = '<div class="wx-ad-note">Drawing the airport… the first time at an airport can take up to a minute</div>';
  let geo = null, ad;
  try {
    const [ri, ad0] = await Promise.all([import('./modules/route-info.js?v=262'), import('./modules/atis-diagram.js?v=262')]);
    ad = ad0;
    const ap = ri.findAirport(await ri.loadDb(), icao);
    if (ap) geo = await ad.airportGeo(ap.icao, ap.lat, ap.lon);
  } catch {}
  if ($('wx-icao').textContent !== icao) return;
  if (!geo || !ad) { box.innerHTML = `<div class="wx-ad-note">${navigator.onLine === false ? 'No internet — the airport diagram loads the first time online' : 'No airport diagram for ' + escapeHtml(icao) + ' right now'}</div>`; return; }
  adState = { geo, items, ad, icao };
  const d = ad.diagram(geo, items, { whole: true });
  adState.at = d.at;
  box.innerHTML = `<div class="wx-ad-wrap">${d.svg}<div class="wx-ad-btns">
      <button type="button" data-ad-zoom="in" aria-label="Zoom in">+</button><button type="button" data-ad-zoom="out" aria-label="Zoom out">−</button>
      <button type="button" class="wx-ad-full" data-ad-full aria-label="Whole airport, full screen" title="Whole airport, full screen">⤢</button></div></div>`
    + `<div class="wx-ad-note">${items.length ? 'Tap a closure here or in the text · ' : ''}OpenStreetMap${d.missing.length ? ` · not on the map: ${escapeHtml(d.missing.join(', '))}` : ''}</div>`;
  const svg = box.querySelector('svg'), vb = svg.viewBox.baseVal;
  adWireZoom(svg, vb.width, vb.height);
  paintAdWind();
  adStartGps();
  adPaintMe();
}
// Where you are, on every diagram showing (the window's and the full screen).
function adPaintMe() {
  if (!adState) return;
  for (const svg of document.querySelectorAll('#wx-overlay .atis-diagram')) {
    const g = svg.querySelector('.ad-me');
    const at = svg.closest('#ad-full') ? adState.fullAt : adState.at;
    const p = adFix && at ? at(adFix.lat, adFix.lon) : null;
    if (g) g.innerHTML = p ? `<g transform="translate(${p[0].toFixed(1)},${p[1].toFixed(1)})"><circle class="ad-me-acc" r="12"/><circle class="ad-me-dot" r="6"/></g>` : '';
  }
}
async function adStartGps() {
  if (adWatch != null || !navigator.geolocation) return;
  // Only when location is already allowed — never a prompt out of nowhere.
  let ok = false;
  try { ok = (await navigator.permissions.query({ name: 'geolocation' })).state === 'granted'; } catch {}
  try { const g = await import('./modules/gps.js?v=262'); ok = ok || (await g.cachedPermission()) === 'granted'; } catch {}
  if (!ok || adWatch != null) return;
  adWatch = navigator.geolocation.watchPosition((p) => {
    if (!(p.coords.accuracy <= 1000)) return;
    adFix = { lat: p.coords.latitude, lon: p.coords.longitude };
    adPaintMe();
  }, () => {}, { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 });
}
function adStopGps() { if (adWatch != null) { try { navigator.geolocation.clearWatch(adWatch); } catch {} adWatch = null; } }
// ⤢: the whole airport, every taxiway, full screen; pinch / drag / + − to
// look closer. Taps on closures light them in the text too.
function adOpenFull() {
  if (!adState) return;
  $('ad-full')?.remove();
  const W = Math.round(window.innerWidth), H = Math.round(window.innerHeight - 64);
  const d = adState.ad.diagram(adState.geo, adState.items, { whole: true, W, H });
  adState.fullAt = d.at;
  $('wx-overlay').insertAdjacentHTML('beforeend', `<div id="ad-full" class="ad-full" role="dialog" aria-label="Airport diagram">
      <div class="ad-full-h"><b>${escapeHtml(adState.icao)}</b> <span class="muted">closures from the ATIS · OpenStreetMap</span>
        <span class="ad-full-z"><button type="button" data-ad-zoom="in" aria-label="Zoom in">+</button><button type="button" data-ad-zoom="out" aria-label="Zoom out">−</button></span>
        <button type="button" class="btn icon-btn" data-ad-close aria-label="Close">✕</button></div>
      <div class="ad-full-body">${d.svg}</div></div>`);
  // Keep any lit closure lit.
  const lit = document.querySelector('#wx-datis-text [data-atis-ref].is-hl')?.dataset.atisRef;
  if (lit) document.querySelectorAll(`#ad-full [data-atis-ref="${CSS.escape(lit)}"]`).forEach(x => x.classList.add('is-hl'));
  adWireZoom($('ad-full').querySelector('svg'), W, H);
  adPaintMe();
}
function adWireZoom(svg, W, H) {
  let v = { x: 0, y: 0, w: W, h: H };
  // Names stay one size on screen however far in (--ad-k, app.css).
  // Drawing units per screen pixel, so names stay one size on screen —
  // in the small box, full screen, and however far in.
  const set = () => {
    svg.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`);
    const px = svg.getBoundingClientRect().width || W;
    svg.style.setProperty('--ad-k', (Math.max(v.w / px, v.h / (svg.getBoundingClientRect().height || H))).toFixed(3));
    svg.classList.toggle('is-zoomed', v.w / W < 0.5);
    declutter();
  };
  // Names that would overlap: the runways' and closures' are placed first,
  // then taxiway names wherever there's room — redone at every zoom, so
  // more of them appear the further in you go.
  let dcT = 0;
  const declutter = () => {
    cancelAnimationFrame(dcT);
    dcT = requestAnimationFrame(() => {
      const placed = [];
      const fits = (r) => !placed.some(p => r.left < p.right + 2 && r.right > p.left - 2 && r.top < p.bottom + 1 && r.bottom > p.top - 1);
      // Runway numbers first. Two runway ends close together (LLBG's 21 and
      // 26) would sit on each other: each box steps further out along its own
      // runway until it's clear — runways part, so a little way out they do.
      const union = (a, b) => ({ left: Math.min(a.left, b.left), right: Math.max(a.right, b.right), top: Math.min(a.top, b.top), bottom: Math.max(a.bottom, b.bottom), width: 1 });
      // Spots tried in turn, like the In flight diagram: just past the end,
      // then to either side of the runway, then a little further out — and
      // only where it stays on the visible map.
      const view = svg.getBoundingClientRect();
      const onMap = (r) => r.left >= view.left && r.right <= view.right && r.top >= view.top && r.bottom <= view.bottom;
      const SPOTS = [[20, 0], [20, 22], [20, -22], [38, 0], [38, 22], [38, -22], [56, 0]];
      for (const k of svg.querySelectorAll('.ad-endk')) {
        const sign = k.classList.contains('ad-out-n') ? -1 : 1;
        const box = k.querySelector('.ad-idbox'), lda = k.querySelector('.ad-lda');
        const at = ([o, sd]) => {
          k.style.setProperty('--ad-o', sign * o + 'px');
          k.style.setProperty('--ad-s', sd + 'px');
          const b = box.getBoundingClientRect();
          if (!b.width) return null;
          const l = lda && lda.textContent ? lda.getBoundingClientRect() : null;
          return l && l.width ? union(b, l) : b;
        };
        let r = null, firstOnMap = null;
        for (const sp of SPOTS) {
          const q = at(sp);
          if (!q) break;
          if (!onMap(q)) continue;
          firstOnMap = firstOnMap || sp;
          if (fits(q)) { r = q; break; }
        }
        // Nowhere clear: the first spot on the map (overlap beats vanishing).
        if (!r) r = at(firstOnMap || SPOTS[0]);
        if (r) placed.push(r);
      }
      for (const t of svg.querySelectorAll('.ad-mark text')) {
        t.classList.remove('ad-hide');
        const r = t.getBoundingClientRect();
        if (!r.width) continue;
        if (fits(r) || t.closest('.is-hl')) placed.push(r); else t.classList.add('ad-hide');
      }
      const zoomed = svg.classList.contains('is-zoomed');
      for (const t of svg.querySelectorAll('.ad-twl text')) {
        t.classList.remove('ad-off');
        if (!zoomed) continue;
        const r = t.getBoundingClientRect();
        if (r.width && fits(r)) placed.push(r); else t.classList.add('ad-off');
      }
    });
  };
  // The view takes the box's shape (centred where it was), so a tall or
  // wide pane shows more airport rather than empty bands.
  const fitBox = () => {
    const r = svg.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const cx = v.x + v.w / 2, cy = v.y + v.h / 2, a = r.height / r.width;
    if (v.h / v.w < a) v = { x: v.x, w: v.w, h: v.w * a, y: cy - v.w * a / 2 };
    else v = { y: v.y, h: v.h, w: v.h / a, x: cx - v.h / a / 2 };
    set();
  };
  requestAnimationFrame(fitBox);
  new ResizeObserver(() => fitBox()).observe(svg);
  // Labels changed (the LDAs filled in): space them again.
  svg.addEventListener('ad-relayout', () => declutter());
  const zoom = (f, cx = v.x + v.w / 2, cy = v.y + v.h / 2) => {
    const a = v.h / v.w, w = Math.max(W / 16, Math.min(Math.max(W, H / a), v.w * f)), h = w * a;
    v = { x: cx - (cx - v.x) * w / v.w, y: cy - (cy - v.y) * h / v.h, w, h };
    set();
  };
  // The + − of whichever box this drawing is in (the window's or full screen).
  (svg.closest('.ad-full') || svg.closest('.wx-ad-wrap'))?.addEventListener('click', (e) => {
    const z = e.target.closest('[data-ad-zoom]');
    if (z) { e.stopPropagation(); zoom(z.dataset.adZoom === 'in' ? 0.6 : 1 / 0.6); }
  });
  const pts = new Map();
  let start = null, dragging = false;
  const toSvg = (cx, cy) => { const r = svg.getBoundingClientRect(); return { x: v.x + (cx - r.left) / r.width * v.w, y: v.y + (cy - r.top) / r.height * v.h }; };
  svg.addEventListener('pointerdown', (e) => { pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); dragging = pts.size > 1; start = { v: { ...v }, pts: new Map([...pts].map(([k, p]) => [k, { ...p }])) }; });
  svg.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId) || !start) return;
    const p0 = start.pts.get(e.pointerId);
    // A tap that wanders a little is still a tap (it lights a closure).
    if (!dragging && p0 && Math.hypot(e.clientX - p0.x, e.clientY - p0.y) < 6) return;
    if (!dragging) { dragging = true; try { svg.setPointerCapture(e.pointerId); } catch {} }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const r = svg.getBoundingClientRect();
    const [a, b] = [...pts.values()], [a0, b0] = [...start.pts.values()];
    if (b && b0) {
      const f = Math.hypot(a0.x - b0.x, a0.y - b0.y) / Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      v = { ...start.v }; const m = toSvg((a0.x + b0.x) / 2, (a0.y + b0.y) / 2); zoom(f, m.x, m.y);
    } else if (a0) {
      v = { ...start.v, x: start.v.x - (a.x - a0.x) / r.width * start.v.w, y: start.v.y - (a.y - a0.y) / r.height * start.v.h }; set();
    }
  });
  const up = (e) => { pts.delete(e.pointerId); if (!pts.size) dragging = false; start = pts.size ? { v: { ...v }, pts: new Map([...pts].map(([k, p]) => [k, { ...p }])) } : null; };
  svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
  svg.addEventListener('wheel', (e) => { e.preventDefault(); const m = toSvg(e.clientX, e.clientY); zoom(Math.exp(e.deltaY * 0.002), m.x, m.y); }, { passive: false });
}
$('wx-overlay').addEventListener('click', (e) => {
  if (e.target.closest('[data-ad-full]')) { adOpenFull(); return; }
  if (e.target.closest('[data-ad-close]')) { $('ad-full')?.remove(); }
});
// After the automatic ATIS fetch: each airport's diagram (runways and
// taxiways) fetched now, quietly, so it's ready — and there offline in the
// air — when the ATIS window is opened.
async function prewarmAtisDiagrams(wx) {
  try {
    const [ri, ad] = await Promise.all([import('./modules/route-info.js?v=262'), import('./modules/atis-diagram.js?v=262')]);
    const db = await ri.loadDb();
    for (const code of atisAirports()) {
      const ap = ri.findAirport(db, code);
      if (ap) await ad.airportGeo(ap.icao, ap.lat, ap.lon);
    }
  } catch {}
}
// Tap a closure in the text or on the diagram: it lights up in both.
$('wx-overlay').addEventListener('click', (e) => {
  const r = e.target.closest('[data-atis-ref]');
  if (!r) return;
  const key = r.dataset.atisRef;
  const on = !r.classList.contains('is-hl');
  document.querySelectorAll('#wx-overlay [data-atis-ref].is-hl').forEach(x => x.classList.remove('is-hl'));
  if (!on) return;
  document.querySelectorAll('#wx-overlay [data-atis-ref]').forEach(x => {
    if (x.dataset.atisRef !== key) return;
    x.classList.add('is-hl');
    if (x.closest('svg')) { x.parentNode.appendChild(x); x.querySelector('text')?.classList.remove('ad-hide'); }      // on top, name showing
  });
  // Bring the other one into view: the words when the diagram was tapped.
  if (r.closest('svg')) document.querySelector(`#wx-datis-text [data-atis-ref="${CSS.escape(key)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
});

// "ATIS ›" on a Route info airport card: the ATIS window on that airport.
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-atis-open]');
  if (!b) return;
  e.preventDefault();
  openWx(b.dataset.atisEnd || 'altn', b.dataset.atisOpen, { atisOnly: true });
  raiseOverlay('wx-overlay');
});

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
        storage.setDataField('atis_icao', resolveWxCode());
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

// Green = read from the live ATIS; blue = picked by hand.
function paintLetterHow() {
  const el = $('wx-letter');
  el.classList.toggle('is-live', wxLetterHow === 'live');
  el.classList.toggle('is-manual', wxLetterHow === 'manual');
  $('wx-letter-how').textContent = wxLetterHow === 'live' ? 'Live' : wxLetterHow === 'manual' ? 'By hand' : 'Tap to set';
}
function paintWxLetter(letter) {
  wxDisplayLetter = letter || '';
  wxLetterHow = letter ? 'manual' : '';
  paintLetterHow();
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

dataCard.setOnChange((key) => {
  // flight_time is mirrored in the header box, so it syncs like tail/flight/ctot.
  if (key === 'tail' || key === 'flight' || key === 'ctot' || key === 'flight_time') syncHeaderInputs();
  // Keep the wx popup's source codes in sync with whatever the user types
  if ((key === 'dep' || key === 'arr') && !document.getElementById('wx-overlay').classList.contains('hidden')) {
    paintWxSrcRow();
  }
  // The METAR cell's label and body track the dep airport, so repaint it
  // when dep changes. Surgical swap avoids stealing focus from the dep
  // input mid-type.
  if (key === 'dep') {
    dataCard.paintMetar(dataBody);
    // A typed departure gets its METAR fetched once typing settles.
    clearTimeout(metarTypeTimer);
    metarTypeTimer = setTimeout(() => { try { dataCard.refreshMetar(dataBody); } catch {} }, 800);
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
  else if (action === 'note') import('./modules/crew-notes.js?v=262').then(m => m.open(name)).catch(err => console.warn('crew notes failed', err));
});

// A note or colour changed in the crew notes window: the Brief's names follow.
window.addEventListener('fc:crew-changed', () => dataCard.render(dataBody));

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
  const note = storage.getCrew(name)?.note || '';
  const noteHtml = note ? `<p class="crewlog-note" dir="auto">${escapeHtmlSimple(note)}</p>` : '';
  if (!legs.length) {
    body.innerHTML = `${noteHtml}<p class="muted small crewlog-empty">No prior flights with ${escapeHtmlSimple(disp)} yet.</p>`;
  } else {
    const rows = legs.map(leg => {
      const d = leg.dataCard || {};
      const ely   = leg.flight ? `ELY${escapeHtmlSimple(leg.flight)}` : '—';
      const route = (leg.dep && leg.arr)
        ? `${escapeHtmlSimple(leg.dep)} → ${escapeHtmlSimple(leg.arr)}`
        : '—';
      const date  = leg.dep_date ? escapeHtmlSimple(legDateLabel(leg.dep_date, leg.dep_year)) : '';
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
    body.innerHTML = `${noteHtml}
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

// ---------- Airport info popup ----------
// Opens from the tappable Dep / Arr codes in the leg-switcher route. Shows
// the ICAO + city name, every past flight that arrived there (crew + date),
// and a persistent per-airport notes box.
let airportNoteFor = '';      // ICAO whose notes the editors are bound to
async function showAirportInfo(icao) {
  const k = String(icao || '').trim().toUpperCase();
  if (!k) return;
  routeReturnLeg = null;      // opened afresh: "Diversion" means the main-screen leg
  // Bind + load the notes and open the sheet SYNCHRONOUSLY first, so typing
  // works instantly even while the city lookup import resolves below.
  airportNoteFor = k;
  brush = null; brushHist = { undo: [], redo: [] };
  setNoteHtml(storage.getAirportNote(k));
  setSocialHtml(storage.getAirportSocial(k));
  paintSocialHint();
  showAptTab(aptActiveTab);
  $('airport-title').textContent = k;
  $('airport-city').textContent = '…';
  showOverlay('airport-overlay');

  // Show BOTH codes — IATA · ICAO (e.g. "TLV · LLBG") — plus the city.
  let city = '', codes = k;
  try {
    const { lookup } = await import('./modules/airports.js?v=262');
    const a = lookup(k);
    if (a) {
      city = a.city || '';
      const pair = [...new Set([a.iata, a.icao].filter(Boolean))];
      if (pair.length) codes = pair.join(' · ');
    }
  } catch {}
  $('airport-title').textContent = codes;
  $('airport-city').textContent = city || 'Airport';

  const legs = storage.allLegsToAirport(k);
  const body = $('airport-body');
  if (!legs.length) {
    body.innerHTML = `<p class="muted small crewlog-empty">No past flights to ${escapeHtmlSimple(k)} yet.</p>`;
  } else {
    const CREW = CREW_KEYS;
    const rows = legs.map(leg => {
      const d = leg.dataCard || {};
      const ely   = leg.flight ? `ELY${escapeHtmlSimple(leg.flight)}` : '—';
      const route = (leg.dep && leg.arr)
        ? `${escapeHtmlSimple(leg.dep)} → ${escapeHtmlSimple(leg.arr)}` : '—';
      const date  = leg.dep_date ? escapeHtmlSimple(legDateLabel(leg.dep_date, leg.dep_year)) : '';
      // Compact crew line — nickname-aware, deduped, "you" excluded is fine
      // to keep since the pilot knows they were there.
      const names = [];
      const seen = new Set();
      for (const key of CREW) {
        const v = (leg[key] || d[key] || '').toString().trim();
        if (!v) continue;
        const disp = storage.displayCrew(v) || v;
        const up = disp.toUpperCase();
        if (seen.has(up)) continue;
        seen.add(up);
        names.push(escapeHtmlSimple(disp));
      }
      const crewLine = names.length
        ? `<span class="airport-crew">${names.join(' · ')}</span>` : '';
      // My PF/PM role on that leg — takeoff and landing shown separately.
      const toR  = String(d.to_role  || '').toUpperCase();
      const ldgR = String(d.ldg_role || '').toUpperCase();
      const roleLine = (toR || ldgR)
        ? `<span class="airport-role">T/O <b>${toR || '—'}</b> · LDG <b>${ldgR || '—'}</b></span>`
        : '';
      return `
        <div class="crewlog-row airport-row">
          <span class="crewlog-flight">${ely}</span>
          <span class="crewlog-route">${route}</span>
          <span class="crewlog-date">${date}</span>
          ${roleLine}
          ${crewLine}
        </div>`;
    }).join('');
    body.innerHTML = `${noteHtml}
      <p class="muted small crewlog-count">${legs.length} flight${legs.length === 1 ? '' : 's'} to ${escapeHtmlSimple(k)}</p>
      <div class="crewlog-list">${rows}</div>`;
  }

}

// ---- Personal note: rich text (bold / colours) + bidi ----
// The personal note is a contenteditable div, so its value is HTML rather
// than plain text. Everything that leaves or enters storage passes through
// sanitizeNoteHtml: an allowlist that keeps only inline emphasis, line
// structure and a text colour. Pastes are forced to plain text, so the only
// markup that can ever reach storage is what our own toolbar produced.
const NOTE_TAGS = new Set(['B','STRONG','I','EM','U','BR','DIV','P','SPAN','FONT','MARK']);
const HL_COLORS = /^(yellow|green|pink|blue)$/;
function sanitizeNoteHtml(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = String(html || '');       // inert: template content never runs
  const walk = (node) => {
    for (const child of [...node.children]) {
      if (child.tagName === 'SCRIPT' || child.tagName === 'STYLE') { child.remove(); continue; }
      walk(child);
      if (!NOTE_TAGS.has(child.tagName)) { child.replaceWith(...child.childNodes); continue; }
      // Keep only the handful of inline styles the toolbar can produce, then
      // drop every other attribute — that includes any on* handler or style
      // (position, background, url()…) a paste could otherwise smuggle in.
      const keep = {
        color: child.style?.color || (child.tagName === 'FONT' ? child.getAttribute('color') : '') || '',
        fontWeight: child.style?.fontWeight || '',
        fontStyle: child.style?.fontStyle || '',
        textDecoration: child.style?.textDecoration || '',
      };
      const hl = child.tagName === 'MARK' ? child.getAttribute('data-c') : '';
      for (const attr of [...child.attributes]) child.removeAttribute(attr.name);
      // A highlighter mark keeps its colour name and nothing else.
      if (child.tagName === 'MARK') {
        if (!HL_COLORS.test(hl || '')) { child.replaceWith(...child.childNodes); continue; }
        child.className = 'hl'; child.setAttribute('data-c', hl);
        continue;
      }
      if (keep.color && /^#[0-9a-f]{3,8}$|^rgba?\([\d\s,.%]+\)$|^[a-z]{3,20}$/i.test(keep.color)) {
        child.style.color = keep.color;
      }
      if (/^(bold|[1-9]00)$/i.test(keep.fontWeight))      child.style.fontWeight = keep.fontWeight;
      if (/^italic$/i.test(keep.fontStyle))               child.style.fontStyle = keep.fontStyle;
      if (/^underline$/i.test(keep.textDecoration))       child.style.textDecoration = keep.textDecoration;
    }
  };
  walk(tpl.content);
  return tpl.innerHTML;
}
// Notes saved before rich text existed are plain strings — render their
// newlines rather than collapsing them into one run-on line. Test for a real
// tag, not just a '<', so a legacy note saying "wind < 10kt" still keeps its
// line breaks instead of being mistaken for markup.
// (NOTE_HTML_RE is declared with the boot-time state near the top: the leg
// strip's Social-change dots read it on the first paint.)
function noteToHtml(stored) {
  const s = String(stored || '');
  if (!s) return '';
  if (!NOTE_HTML_RE.test(s)) return escapeHtmlSimple(s).replace(/\n/g, '<br>');
  return sanitizeNoteHtml(s);
}
// One reading direction for the whole note, from its main language. Each
// line used to pick its own (unicode-bidi: plaintext): in a mostly-Hebrew
// note, any line starting with a code or an English word ("RWY 12…") flipped
// to the left, and the text zig-zagged. Now a mostly-Hebrew note is
// right-to-left throughout — English runs still read in order inside it.
function noteDir(text) {
  const t = String(text || '');
  const heb = (t.match(/[\u0590-\u05FF]/g) || []).length;
  const lat = (t.match(/[A-Za-z]/g) || []).length;
  return heb > 0 && heb >= lat * 0.5 ? 'rtl' : 'ltr';
}
function setNoteDir(el) { if (el) el.setAttribute('dir', noteDir(el.textContent)); }

function setNoteHtml(stored) {
  const el = $('airport-notes');
  if (!el) return;
  el.innerHTML = noteToHtml(stored);
  setNoteDir(el);
  paintNoteEmpty();
}
// An "empty" contenteditable still holds <br> or an empty <div>, so :empty
// can't drive the placeholder — drive it off the text content instead.
function paintNoteEmpty() {
  const el = $('airport-notes');
  if (!el) return;
  el.classList.toggle('is-empty', !el.textContent.trim());
}
function currentNoteHtml() {
  const el = $('airport-notes');
  if (!el) return '';
  if (!el.textContent.trim()) return '';   // don't persist stray <br> as content
  return sanitizeNoteHtml(el.innerHTML);
}

// ---- Social note: rendered from the feed ----
// The same allowlist rendering as the personal note: the feed now carries
// the Apple Notes formatting. While a feed is configured the note is
// READ-ONLY — the app re-pulls the feed every hour and replaces the note
// wholesale, so anything typed here would vanish within the hour without a
// word. Edit the note in Apple Notes instead. With no feed (someone keeping
// their own notes here) it stays editable, as it always was.
function socialFeedSet() {
  return !!(localStorage.getItem('fc.social.feedUrl') || '').trim();
}
function setSocialHtml(stored, code = airportNoteFor) {
  const el = $('airport-social');
  if (!el) return;
  const s = String(stored || '');
  shownSocial = stored;
  const feed = socialFeedSet();
  // Synced notes are plain text now, which is what lets highlights be laid
  // over them by character position. A note still holding old HTML renders
  // as before, without highlights, until the next sync replaces it.
  el.innerHTML = (feed && s && !NOTE_HTML_RE.test(s)) ? hlRender(hlNorm(s), code) : noteToHtml(s);
  el.setAttribute('contenteditable', feed ? 'false' : 'true');
  el.classList.toggle('is-empty', !el.textContent.trim());
  setNoteDir(el);
  paintSocialChanged(code, s);
}

// ---- What changed since last time ----
// After a sync, a note that differs from what the pilot last acknowledged
// says so on top ("Changed 7 Nov 14:20 · 3 places"), and the new words show
// in orange, the removed ones struck through, until Got it. See
// modules/social-changes.js; this device only.
function socialChangeFor(code, text) {
  if (!socialFeedSet() || !text || NOTE_HTML_RE.test(text)) return null;
  const rec = socialChanges.get(code);
  return rec ? { rec, d: socialChanges.diff(rec.base, hlNorm(text)) } : null;
}
function paintSocialChanged(code = airportNoteFor, text = storage.getAirportSocial(code)) {
  const box = $('airport-social-changed');
  const ch = socialChangeFor(code, String(text || ''));
  $('apt-tab-social')?.classList.toggle('has-change', !!ch);
  if (!box) return;
  box.classList.toggle('hidden', !ch || aptActiveTab !== 'social');
  if (!ch) { box.innerHTML = ''; return; }
  const d = new Date(ch.rec.at);
  const when = `${d.getDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const n = socialChanges.places(ch.d);
  const what = !ch.rec.base ? 'New note' : `Changed${n ? ` in ${n} place${n === 1 ? '' : 's'}` : ''}`;
  box.innerHTML = `<button type="button" class="soc-changed-go" data-soc-jump>
      <span class="soc-changed-dot" aria-hidden="true"></span><b>${what}</b> <span class="muted">· ${when}</span></button>
    <button type="button" class="soc-changed-ok" data-soc-ack>Got it</button>`;
}
// The leg strip's airport codes get a dot while their Social note has news.
function paintSocialDots() {
  for (const id of ['leg-dep', 'leg-arr']) {
    const b = $(id);
    if (!b) continue;
    const code = b.dataset.airport || '';
    b.classList.toggle('has-soc-change', !!(code && socialChangeFor(code, storage.getAirportSocial(code))));
  }
}
$('airport-social-changed')?.addEventListener('click', (e) => {
  if (e.target.closest('[data-soc-jump]')) {
    const el = $('airport-social');
    const first = el?.querySelector('.soc-new, .soc-del');
    if (first) el.scrollTop = Math.max(0, first.offsetTop - el.offsetTop - 40);
    return;
  }
  if (!e.target.closest('[data-soc-ack]') || !airportNoteFor) return;
  // Every code holding this same note (it's stored under IATA and ICAO).
  const text = storage.getAirportSocial(airportNoteFor);
  const st = storage.getState().airportSocial || {};
  socialChanges.clear(Object.keys(st).filter(k => st[k] === text).concat(airportNoteFor));
  const el = $('airport-social'), top = el.scrollTop;
  setSocialHtml(text, airportNoteFor);
  el.scrollTop = top;
  paintSocialDots();
});

// ---- Social note highlights — THIS DEVICE ONLY ----
// Colour highlights over the synced notes. They never leave the device: not
// in the feed, not in Apple Notes, and kept in their own localStorage key, so
// not even in the AirDrop "sync everything" export.
//
// A sync replaces the note text wholesale, so a highlight can't live inside
// it. Each one is stored as the exact words plus a little text either side
// and the old position, and is found again in whatever the note now says.
// If those words have since been edited away in Notes the highlight simply
// doesn't show; it isn't forced onto the wrong text.
// The note's text as the page will hold it: the HTML parser turns CR LF and
// lone CR into LF, and the Mac sync's text from Apple Notes carries CR LF.
// Positions are taken on the page and applied to the stored text, so both
// must be this same text — they weren't, and every highlight was refused.
function hlNorm(t) { return String(t || '').replace(/\r\n?/g, '\n'); }
function hlAll() {
  try { return JSON.parse(localStorage.getItem(HL_KEY) || '{}') || {}; } catch { return {}; }
}
function hlFor(code) {
  const a = hlAll()[String(code || '').toUpperCase()];
  return Array.isArray(a) ? a : [];
}
function hlSave(code, list) {
  const all = hlAll();
  const k = String(code || '').toUpperCase();
  if (list.length) all[k] = list; else delete all[k];
  try { localStorage.setItem(HL_KEY, JSON.stringify(all)); } catch {}
}
// Where is this highlight in the note's current text? The occurrence whose
// surrounding text matches best wins; nearer the old position breaks ties.
function hlResolve(text, h) {
  if (!h || !h.exact) return null;
  const pre = h.prefix || '', suf = h.suffix || '';
  let best = null, bestScore = -Infinity;
  for (let i = text.indexOf(h.exact); i !== -1; i = text.indexOf(h.exact, i + 1)) {
    let score = 0;
    for (let k = 1; k <= pre.length && text[i - k] === pre[pre.length - k]; k++) score++;
    for (let k = 0; k < suf.length && text[i + h.exact.length + k] === suf[k]; k++) score++;
    score -= Math.abs(i - (h.pos || 0)) / 1e6;
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return best == null ? null : [best, best + h.exact.length];
}
function hlRender(text, code) {
  const ranges = [];
  for (const h of hlFor(code)) {
    const r = hlResolve(text, h);
    if (r) ranges.push({ s: r[0], e: r[1], c: h.color });
  }
  ranges.sort((a, b) => a.s - b.s);
  // Each character's highlight colour and whether it's new since Got it.
  const col = new Array(text.length).fill('');
  let at = 0;
  for (const r of ranges) {
    if (r.s < at) continue;                       // overlap: earlier one wins
    const c = /^(yellow|green|pink|blue)$/.test(r.c) ? r.c : 'yellow';
    for (let i = r.s; i < r.e; i++) col[i] = c;
    at = r.e;
  }
  const ch = socialChangeFor(code, text);
  const nw = new Uint8Array(text.length);
  const gone = new Map();
  if (ch) {
    for (const [s, e] of ch.d.ins) nw.fill(1, s, e);
    for (const x of ch.d.del) gone.set(x.at, x.text);
  }
  const piece = (str) => escapeHtmlSimple(str).replace(/\n/g, '<br>');
  // Removed words are drawn by CSS from data-t, so they're no part of the
  // note's text: highlight positions (hlOffset) still count true characters.
  const del = (t) => `<del class="soc-del" data-t="${escapeHtmlSimple(t)}"></del>`;
  let out = '';
  for (let i = 0; i < text.length;) {
    if (gone.has(i)) out += del(gone.get(i));
    let j = i + 1;
    while (j < text.length && col[j] === col[i] && nw[j] === nw[i] && !gone.has(j)) j++;
    let h = piece(text.slice(i, j));
    if (col[i]) h = `<mark class="hl" data-c="${col[i]}">${h}</mark>`;
    if (nw[i]) h = `<span class="soc-new">${h}</span>`;
    out += h;
    i = j;
  }
  if (gone.has(text.length)) out += del(gone.get(text.length));
  return out;
}
// Character offset of a DOM position inside the rendered note: its text, with
// each <br> counted as the newline it stands for — the same coordinates as
// the stored note text.
function hlOffset(root, node, offset) {
  const r = document.createRange();
  r.setStart(root, 0);
  r.setEnd(node, offset);
  const frag = r.cloneContents();
  return frag.textContent.length + frag.querySelectorAll('br').length;
}
// The rendered note's text in the stored note's coordinates (<br> = "\n").
function hlDomText(el) {
  let out = '';
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (n.nodeType === 3) out += n.textContent;
    else if (n.nodeName === 'BR') out += '\n';
  }
  return out;
}
function hlRangeOffsets(r) {
  const el = $('airport-social');
  if (!el || !r || r.collapsed) return null;
  if (!el.contains(r.startContainer) || !el.contains(r.endContainer)) return null;
  const s = hlOffset(el, r.startContainer, r.startOffset);
  const e = hlOffset(el, r.endContainer, r.endOffset);
  return e > s ? { s, e, code: airportNoteFor } : null;
}
// color: one of the four names, or '' to remove highlights under the selection.
function hlApply(color, range) {
  const code = airportNoteFor;
  // No feed: the note is the pilot's own, editable — mark it in place.
  if (!socialFeedSet()) {
    if (markSelection($('airport-social'), color, range) && code) storage.setAirportSocial(code, currentSocialHtml());
    return;
  }
  const text = hlNorm(storage.getAirportSocial(code));
  if (!text || NOTE_HTML_RE.test(text)) { toast('Sync the notes once more to highlight them'); return; }
  // Selection offsets are measured on the SCREEN and applied to the STORED
  // text, so the two must be the same text. If the note changed under the
  // view (a sync, an edit) the offsets would land on different words — mark
  // nothing rather than the wrong thing.
  const el0 = $('airport-social');
  if (hlDomText(el0) !== text) {
    setSocialHtml(text, code);
    toast('The note just updated \u2014 select the words again');
    return;
  }
  const pick = hlRangeOffsets(range);
  if (!pick) return;
  let { s, e } = pick;
  while (s < e && /\s/.test(text[s])) s++;          // don't highlight the edges' spaces
  while (e > s && /\s/.test(text[e - 1])) e--;
  if (e <= s) return;
  // Anything the new selection overlaps is replaced (or, for the eraser,
  // removed). Highlights that no longer resolve are kept, untouched.
  const list = hlFor(code).filter(h => {
    const r = hlResolve(text, h);
    return !r || r[1] <= s || r[0] >= e;
  });
  if (color) {
    list.push({
      exact: text.slice(s, e),
      prefix: text.slice(Math.max(0, s - 24), s),
      suffix: text.slice(e, e + 24),
      pos: s,
      color,
    });
  }
  hlSave(code, list);
  const el = $('airport-social');
  const top = el.scrollTop;
  setSocialHtml(text, code);
  el.scrollTop = top;
}
// Highlighter for a note held as HTML (the personal note, and a Social note
// with no feed): marks the selected words in a colour, or ('' ) clears marks
// under them. Marks always sit innermost, round one piece of text each, so a
// new colour over part of an old one just splits it. Positions are counted
// in text, not DOM nodes, so the work survives the splitting it does.
function markSelection(el, color, r) {
  if (!el || !r || r.collapsed) return false;
  if (!el.contains(r.startContainer) || !el.contains(r.endContainer)) return false;
  const texts = () => { const out = [], w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); for (let n = w.nextNode(); n; n = w.nextNode()) out.push(n); return out; };
  const offsetOf = (node, off) => {
    if (node.nodeType !== 3) {
      // An element boundary: count the text before child `off`.
      const pre = document.createRange(); pre.setStart(el, 0); pre.setEnd(node, off);
      return pre.toString().length;
    }
    let n = 0; for (const t of texts()) { if (t === node) return n + off; n += t.data.length; }
    return n;
  };
  let s = offsetOf(r.startContainer, r.startOffset), e = offsetOf(r.endContainer, r.endOffset);
  const all = texts().map(t => t.data).join('');
  while (s < e && /\s/.test(all[s])) s++;
  while (e > s && /\s/.test(all[e - 1])) e--;
  if (e <= s) return false;
  let at = 0;
  for (const t0 of texts()) {
    let t = t0;
    const a = at, b = at + t.data.length;
    at = b;
    if (b <= s || a >= e) continue;
    // Split off the parts outside [s, e).
    if (s > a) t = t.splitText(s - a);
    if (e < b) t.splitText(e - Math.max(a, s));
    const m = t.parentNode;
    if (m.nodeName === 'MARK' && el.contains(m) && m !== el) {
      // Lift the piece out of its old mark; what's left either side keeps it.
      const before = m.cloneNode(false), after = m.cloneNode(false);
      while (m.firstChild && m.firstChild !== t) before.appendChild(m.firstChild);
      if (m.firstChild === t) m.removeChild(t);
      while (m.firstChild) after.appendChild(m.firstChild);
      if (before.firstChild) m.parentNode.insertBefore(before, m);
      m.parentNode.insertBefore(t, m);
      if (after.firstChild) m.parentNode.insertBefore(after, m);
      m.remove();
    }
    if (color) {
      const mk = document.createElement('mark');
      mk.className = 'hl'; mk.setAttribute('data-c', color);
      t.parentNode.insertBefore(mk, t); mk.appendChild(t);
    }
  }
  el.normalize();
  return true;
}
function currentSocialHtml() {
  const el = $('airport-social');
  if (!el || !el.textContent.trim()) return '';
  return sanitizeNoteHtml(el.innerHTML);
}

// ---- Personal / Social tabs ----
let aptActiveTab = 'personal';
function showAptTab(tab) {
  aptActiveTab = tab === 'social' ? 'social' : 'personal';
  const isSocial = aptActiveTab === 'social';
  $('apt-tab-personal').classList.toggle('is-active', !isSocial);
  $('apt-tab-social').classList.toggle('is-active', isSocial);
  $('airport-notes').classList.toggle('hidden', isSocial);
  $('apt-fmt').classList.toggle('hidden', isSocial);
  $('airport-social').classList.toggle('hidden', !isSocial);
  $('airport-social-hint').classList.toggle('hidden', !isSocial);
  $('apt-hl').classList.toggle('hidden', !isSocial);
  paintSocialChanged();
  try { paintBrush(); } catch {}
  const hn = $('apt-hl').querySelector('.apt-hl-note');
  if (hn) hn.hidden = !socialFeedSet();   // synced notes: the marks stay on this iPad
}
function paintSocialHint() {
  const hint = $('airport-social-hint');
  const url = localStorage.getItem('fc.social.feedUrl') || '';
  if (!url) {
    hint.textContent = 'No feed set — these notes are yours to edit. Add a feed in Settings → Social notes to sync them from Apple Notes.';
  } else {
    const last = Number(localStorage.getItem('fc.social.lastSync') || 0);
    hint.textContent = last
      ? `From your Apple Notes · checked ${relDate(last)} · edit them in Notes, they sync here.`
      : 'Feed set — will sync on next check.';
  }
}
$('apt-tab-personal').addEventListener('click', () => showAptTab('personal'));
$('apt-tab-social').addEventListener('click', () => showAptTab('social'));

function flushAirportNotes() {
  if (!airportNoteFor) return;
  storage.setAirportNote(airportNoteFor, currentNoteHtml());
  if (!socialFeedSet()) storage.setAirportSocial(airportNoteFor, currentSocialHtml());
}

// Save on each keystroke — storage.setAirport* already debounces the actual
// localStorage write (scheduleWrite), and saving both fields independently
// avoids the cross-field timer race that a shared UI debounce introduced.
$('airport-notes').addEventListener('input', () => {
  paintNoteEmpty();
  // A new note takes its direction from its first words, then keeps it —
  // flipping mid-sentence would throw the caret around.
  const el = $('airport-notes');
  if (el.textContent.trim().length <= 24) setNoteDir(el);
  if (airportNoteFor) storage.setAirportNote(airportNoteFor, currentNoteHtml());
});
// Paste as PLAIN text. Keeps pasted web content from dragging in fonts,
// backgrounds and markup we'd only have to strip again, and means the
// sanitiser never has to face anything it didn't produce itself.
$('airport-notes').addEventListener('paste', (e) => {
  e.preventDefault();
  const text = (e.clipboardData || window.clipboardData)?.getData('text/plain') || '';
  if (text) document.execCommand('insertText', false, text);
});
// ---- Highlighter brush ----
// Pick a brush (a colour, or the eraser), then select words: they're marked
// as soon as the selection settles — no second tap. Tap the brush again to
// put it down. While a brush is up the note can't be typed in (no keyboard
// popping up mid-marking). ↶ / ↷ step back and forward through the marks
// made since the notes were opened. The same brush serves the airport notes
// and the Notes tab (myNote*), whichever is on screen.
function myNotesOpen() { return !$('mynotes-overlay').classList.contains('hidden'); }
// Which note the brush is working on: its history key.
function brushCtx() {
  if (myNotesOpen()) return 'my:' + myNoteId;
  return aptActiveTab === 'social' ? (socialFeedSet() ? 'social-hl' : 'social') : 'personal';
}
function brushNoteEl() {
  if (myNotesOpen()) return $('mynote-body');
  return aptActiveTab === 'social' ? $('airport-social') : $('airport-notes');
}
// The note's marks as they stand, to step back to.
function brushState() {
  const tab = brushCtx();
  if (tab.startsWith('my:')) return { tab, v: noteHtmlOf($('mynote-body')) };
  if (tab === 'personal') return { tab, v: currentNoteHtml() };
  return tab === 'social-hl' ? { tab, v: JSON.stringify(hlFor(airportNoteFor)) } : { tab, v: currentSocialHtml() };
}
function brushRestore(st) {
  if (st.tab.startsWith('my:')) {
    const id = st.tab.slice(3);
    storage.setMyNoteHtml(id, st.v);
    if (id === myNoteId) setMyNoteBody(st.v);
    paintBrush();
    return;
  }
  const code = airportNoteFor;
  if (!code) return;
  if (st.tab === 'personal') { storage.setAirportNote(code, st.v); setNoteHtml(st.v); }
  else if (st.tab === 'social') { storage.setAirportSocial(code, st.v); setSocialHtml(st.v, code); }
  else { hlSave(code, JSON.parse(st.v || '[]')); setSocialHtml(storage.getAirportSocial(code), code); }
  paintBrush();
}
function paintBrush() {
  document.querySelectorAll('button[data-brush]').forEach(b => {
    const on = b.dataset.brush === brush;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-pressed', String(on));
  });
  const ctx = brushCtx(), mine = (h) => h.tab === ctx;
  document.querySelectorAll('button[data-brush-undo]').forEach(b => { b.disabled = !brushHist.undo.some(mine); });
  document.querySelectorAll('button[data-brush-redo]').forEach(b => { b.disabled = !brushHist.redo.some(mine); });
  const pn = $('airport-notes'), so = $('airport-social'), my = $('mynote-body');
  pn.setAttribute('contenteditable', brush ? 'false' : 'true');
  my.setAttribute('contenteditable', brush ? 'false' : 'true');
  my.classList.toggle('is-brush', !!brush);
  if (!socialFeedSet()) so.setAttribute('contenteditable', brush ? 'false' : 'true');
  pn.classList.toggle('is-brush', !!brush);
  so.classList.toggle('is-brush', !!brush);
}
function setBrush(b) { brush = brush === b ? null : b; paintBrush(); }
// Paint the selection with the brush in hand.
function brushApply(range) {
  const el = brushNoteEl();
  if (!brush || !el || !range || range.collapsed || !el.contains(range.commonAncestorContainer)) return;
  const color = brush === 'erase' ? '' : brush;
  const before = brushState();
  if (myNotesOpen()) { if (markSelection(el, color, range)) storage.setMyNoteHtml(myNoteId, noteHtmlOf(el)); }
  else if (aptActiveTab === 'social') hlApply(color, range);
  else if (markSelection(el, color, range) && airportNoteFor) storage.setAirportNote(airportNoteFor, currentNoteHtml());
  const after = brushState();
  if (after.v !== before.v) { brushHist.undo.push(before); brushHist.redo = []; }
  paintBrush();
}
function brushStep(back) {
  const want = brushCtx();
  const from = back ? brushHist.undo : brushHist.redo, to = back ? brushHist.redo : brushHist.undo;
  let i = from.length - 1;
  while (i >= 0 && from[i].tab !== want) i--;
  if (i < 0) return;
  const [st] = from.splice(i, 1);
  to.push(brushState());
  brushRestore(st);
}
for (const bar of ['apt-hl', 'apt-fmt', 'mynote-fmt']) {
  $(bar).addEventListener('click', (e) => {
    const b = e.target.closest('button[data-brush]');
    if (b) { e.preventDefault(); setBrush(b.dataset.brush); return; }
    if (e.target.closest('[data-brush-undo]')) { e.preventDefault(); brushStep(true); return; }
    if (e.target.closest('[data-brush-redo]')) { e.preventDefault(); brushStep(false); }
  });
}
// Painting: with a brush in hand, drag a finger over the words — they light
// up as it goes and are marked when it lifts. It never goes through the
// iPad's own text selection (whose handles and menu fought the brush), so
// selecting, copying and pasting work as they always do with no brush up.
// Ends snap out to whole words.
function brushCaret(x, y) {
  if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(x, y);
    return r ? { node: r.startContainer, off: r.startOffset } : null;
  }
  const p = document.caretPositionFromPoint && document.caretPositionFromPoint(x, y);
  return p ? { node: p.offsetNode, off: p.offset } : null;
}
const WORDCH = /[\p{L}\p{N}'’\-\/]/u;
function brushRange(el, a, b) {
  if (!a || !b || !el.contains(a.node) || !el.contains(b.node)) return null;
  const r = document.createRange();
  try {
    r.setStart(a.node, a.off);
    if (r.comparePoint(b.node, b.off) < 0) { r.setStart(b.node, b.off); r.setEnd(a.node, a.off); }
    else r.setEnd(b.node, b.off);
  } catch { return null; }
  // Out to whole words.
  if (r.startContainer.nodeType === 3) {
    let o = r.startOffset; const t = r.startContainer.data;
    while (o > 0 && WORDCH.test(t[o - 1])) o--;
    r.setStart(r.startContainer, o);
  }
  if (r.endContainer.nodeType === 3) {
    let o = r.endOffset; const t = r.endContainer.data;
    while (o < t.length && WORDCH.test(t[o])) o++;
    r.setEnd(r.endContainer, o);
  }
  return r.collapsed ? null : r;
}
// The stroke so far, drawn with the CSS Custom Highlight API where the iPad
// has it (iOS 17.2+); without it the marks just appear on lifting.
function brushPreview(r) {
  if (!window.CSS || !CSS.highlights || typeof Highlight === 'undefined') return;
  CSS.highlights.delete('brush-stroke');
  if (r) CSS.highlights.set('brush-stroke', new Highlight(r));
  document.documentElement.dataset.brushStroke = brush || '';
}
let stroke = null;   // { el, a, id }
for (const id of ['airport-notes', 'airport-social', 'mynote-body']) {
  const el = $(id);
  // No long-press selection, no scrolling, no callout while painting.
  el.addEventListener('touchstart', (e) => { if (brush) e.preventDefault(); }, { passive: false });
  el.addEventListener('pointerdown', (e) => {
    if (!brush || e.button > 0) return;
    e.preventDefault();
    stroke = { el, a: brushCaret(e.clientX, e.clientY), id: e.pointerId };
    try { el.setPointerCapture(e.pointerId); } catch {}
  });
  el.addEventListener('pointermove', (e) => {
    if (!stroke || stroke.el !== el || e.pointerId !== stroke.id) return;
    e.preventDefault();
    brushPreview(brushRange(el, stroke.a, brushCaret(e.clientX, e.clientY)));
  });
  const end = (e, apply) => {
    if (!stroke || stroke.el !== el) return;
    const r = apply ? brushRange(el, stroke.a, brushCaret(e.clientX, e.clientY)) : null;
    stroke = null;
    brushPreview(null);
    if (r) brushApply(r);
  };
  el.addEventListener('pointerup', (e) => end(e, true));
  el.addEventListener('pointercancel', (e) => end(e, false));
}

// ---------- Notes tab: the pilot's own named notes ----------
// General notes, not tied to an airport — a radio, LVP, MEL, diversions.
// Named tabs like the PA, one editor like the airport notes, the same
// bold / italic / highlighter brush. Saved with everything else (fc.state).
function noteHtmlOf(el) { return el && el.textContent.trim() ? sanitizeNoteHtml(el.innerHTML) : ''; }
function setMyNoteBody(html) {
  const el = $('mynote-body');
  el.innerHTML = noteToHtml(html);
  setNoteDir(el);
  el.classList.toggle('is-empty', !el.textContent.trim());
}
function paintMyNotes() {
  const list = storage.getMyNotes();
  if (!list.some(n => n.id === myNoteId)) myNoteId = list[0]?.id || '';
  try { localStorage.setItem('fc.mynote', myNoteId); } catch {}
  const tabs = $('mynotes-tabs');
  tabs.classList.toggle('is-editing', myNotesEditing);
  tabs.innerHTML = list.map(n =>
    `<button type="button" class="pa-tab${n.id === myNoteId ? ' on' : ''}" data-mynote="${escapeHtml(n.id)}">${escapeHtml(n.name)}${
      myNotesEditing ? `<span class="mynote-x" data-mynote-del="${escapeHtml(n.id)}" role="button" aria-label="Delete ${escapeHtml(n.name)}">✕</span>` : ''}</button>`).join('')
    + (myNotesEditing ? '' : `<button type="button" class="pa-tab add" data-mynote-add aria-label="New note">＋</button>`);
  const b = $('mynotes-edit');
  b.textContent = myNotesEditing ? 'Done' : 'Edit';
  b.setAttribute('aria-pressed', String(myNotesEditing));
  b.hidden = !list.length;
  $('mynotes-edit-hint').hidden = !myNotesEditing;
  const n = storage.getMyNote(myNoteId);
  const listing = !!myNotesQuery() && myNotesShowResults;
  $('mynote-body').hidden = !n || listing;
  $('mynote-fmt').hidden = !n || listing;
  setMyNoteBody(n ? n.html : '');
  paintMyNotesSearch();
  paintBrush();
}
// ---- Search across the notes ----
// Typing lists the notes that match, each with its matches in context; a
// tap opens the note with every match marked (CSS Custom Highlight — the
// note itself is untouched) and the first one scrolled into view.
let myNotesShowResults = true;
function myNotesQuery() { return ($('mynotes-q')?.value || '').trim(); }
function noteText(html) {
  const t = document.createElement('template');
  t.innerHTML = noteToHtml(html).replace(/<br\s*\/?>/gi, '\n').replace(/<\/(div|p)>/gi, '\n');
  return t.content.textContent || '';
}
function findAll(text, q) {
  const out = [], hay = text.toLowerCase(), needle = q.toLowerCase();
  for (let i = hay.indexOf(needle); i !== -1 && out.length < 200; i = hay.indexOf(needle, i + needle.length)) out.push(i);
  return out;
}
function paintMyNotesSearch() {
  const q = myNotesQuery(), box = $('mynotes-results'), count = $('mynotes-qcount');
  if (window.CSS && CSS.highlights) CSS.highlights.delete('note-find');
  if (!q) { box.hidden = true; count.textContent = ''; return; }
  const hits = storage.getMyNotes().map(n => {
    const text = noteText(n.html), at = findAll(text, q);
    return { n, text, at, inName: n.name.toLowerCase().includes(q.toLowerCase()) };
  }).filter(h => h.at.length || h.inName);
  const total = hits.reduce((s, h) => s + h.at.length, 0);
  count.textContent = hits.length ? `${total} in ${hits.length} note${hits.length === 1 ? '' : 's'}` : 'No matches';
  if (myNotesShowResults) {
    const snip = (text, i) => {
      const a = Math.max(0, i - 40), b = Math.min(text.length, i + q.length + 60);
      return `${a ? '…' : ''}${escapeHtml(text.slice(a, i))}<mark class="find">${escapeHtml(text.slice(i, i + q.length))}</mark>${escapeHtml(text.slice(i + q.length, b))}${b < text.length ? '…' : ''}`.replace(/\n/g, ' · ');
    };
    box.innerHTML = hits.length ? hits.map(h => `<button type="button" class="mynotes-hit" data-hit="${escapeHtml(h.n.id)}">
        <span class="mynotes-hit-name">${escapeHtml(h.n.name)}<small>${h.at.length ? `${h.at.length} match${h.at.length === 1 ? '' : 'es'}` : 'name'}</small></span>
        ${h.at.slice(0, 3).map(i => `<span class="mynotes-hit-snip">${snip(h.text, i)}</span>`).join('')}
      </button>`).join('') : '<p class="muted small">Nothing in your notes matches that.</p>';
    box.hidden = false;
    return;
  }
  box.hidden = true;
  markMyNoteMatches(q);
}
// Every match in the open note, highlighted; the first one scrolled to.
function markMyNoteMatches(q) {
  if (!window.CSS || !CSS.highlights || typeof Highlight === 'undefined') return;
  const el = $('mynote-body'), ranges = [], needle = q.toLowerCase();
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let t = w.nextNode(); t; t = w.nextNode()) {
    const hay = t.data.toLowerCase();
    for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) {
      const r = document.createRange(); r.setStart(t, i); r.setEnd(t, i + needle.length); ranges.push(r);
    }
  }
  if (!ranges.length) return;
  CSS.highlights.set('note-find', new Highlight(...ranges));
  const top = ranges[0].getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
  el.scrollTo({ top: Math.max(0, top - 40), behavior: 'smooth' });
}
function renameMyNote(id) {
  const n = storage.getMyNote(id);
  const name = n && window.prompt('Rename note', n.name);
  if (name && name.trim()) { storage.renameMyNote(id, name); paintMyNotes(); }
}
function openMyNotes() {
  try { myNoteId = myNoteId || localStorage.getItem('fc.mynote') || ''; } catch {}
  myNotesEditing = false;
  $('mynotes-q').value = ''; myNotesShowResults = true;
  brush = null; brushHist = { undo: [], redo: [] };
  showOverlay('mynotes-overlay'); raiseOverlay('mynotes-overlay');
  paintMyNotes();
}
function closeMyNotes() {
  if (myNoteId) storage.setMyNoteHtml(myNoteId, noteHtmlOf($('mynote-body')));
  brush = null;
  hideOverlay('mynotes-overlay');
  paintBrush();
}
$('mynotes-close').addEventListener('click', closeMyNotes);
$('mynotes-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'mynotes-overlay') { closeMyNotes(); return; }
  const del = e.target.closest('[data-mynote-del]');
  if (del) {
    const n = storage.getMyNote(del.dataset.mynoteDel);
    if (n && window.confirm(`Delete the note "${n.name}"? This can't be undone.`)) {
      storage.deleteMyNote(n.id);
      if (myNoteId === n.id) myNoteId = '';
      if (!storage.getMyNotes().length) myNotesEditing = false;
      paintMyNotes();
    }
    return;
  }
  const t = e.target.closest('[data-mynote]');
  if (t) {
    if (tabPress.moved || tabPress.long) return;      // a drag or a long press, not a tap
    if (myNotesEditing) { renameMyNote(t.dataset.mynote); return; }
    if (myNoteId) storage.setMyNoteHtml(myNoteId, noteHtmlOf($('mynote-body')));
    myNoteId = t.dataset.mynote; myNotesShowResults = false; paintMyNotes(); return;
  }
  if (e.target.closest('[data-mynote-add]')) {
    const name = window.prompt('Name for the new note', '');
    if (name == null || !name.trim()) return;
    myNoteId = storage.addMyNote(name).id; paintMyNotes();
    $('mynote-body').focus();
  }
});
$('mynotes-q').addEventListener('input', () => { myNotesShowResults = true; paintMyNotes(); });
$('mynotes-q').addEventListener('focus', () => { if (myNotesQuery() && !myNotesShowResults) { myNotesShowResults = true; paintMyNotes(); } });
$('mynotes-q').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.target.value = ''; myNotesShowResults = true; paintMyNotes(); } });
$('mynotes-results').addEventListener('click', (e) => {
  const h = e.target.closest('[data-hit]');
  if (!h) return;
  if (myNoteId) storage.setMyNoteHtml(myNoteId, noteHtmlOf($('mynote-body')));
  myNoteId = h.dataset.hit;
  myNotesShowResults = false;
  $('mynotes-q').blur();
  paintMyNotes();
});
// Import a notes file. This iPad's data is kept aside first (Settings →
// Backup → Undo the last restore puts it back).
$('mynotes-file').addEventListener('change', async (e) => {
  const f = e.target.files?.[0];
  e.target.value = '';
  if (!f) return;
  let pack;
  try { pack = JSON.parse(await f.text()); } catch { toast("That file isn't readable"); return; }
  if (!pack || pack.app !== 'flightcard-notes' || !Array.isArray(pack.notes)) { toast("That isn't a notes file"); return; }
  const names = pack.notes.map(n => n.name).join(', ');
  if (!confirm(`Add ${pack.notes.length} notes from "${pack.title || f.name}"?\n\n${names}\n\nTabs with the same name get the new text added below yours; nothing is replaced.`)) return;
  try { const bk = await import('./modules/backup.js?v=262'); await bk.saveSafety(); } catch {}
  if (myNoteId) storage.setMyNoteHtml(myNoteId, noteHtmlOf($('mynote-body')));
  const r = storage.importMyNotes(pack.notes, pack.divider || `<b>— ${escapeHtml(pack.title || 'Imported')} —</b>`);
  myNotesEditing = false;
  paintMyNotes();
  toast(`${r.added} new tab${r.added === 1 ? '' : 's'}, ${r.appended} added to existing`);
});
$('mynotes-edit').addEventListener('click', () => {
  if (myNoteId) storage.setMyNoteHtml(myNoteId, noteHtmlOf($('mynote-body')));
  myNotesEditing = !myNotesEditing;
  paintMyNotes();
});
// Tabs: a long press renames (any time). In Edit, a tab lifts and follows the
// finger exactly; its neighbours glide aside as it passes them (FLIP: measure,
// move in the DOM, animate each from where it was), and on release it settles
// into its new place. The order is saved then.
const tabPress = { el: null, id: 0, x: 0, y: 0, gx: 0, gy: 0, moved: false, long: false, timer: 0 };
const GLIDE = { duration: 260, easing: 'cubic-bezier(0.25, 1, 0.5, 1)' };
// Put the dragged tab under the finger, wherever its slot now is.
function tabFollow(t, x, y) {
  t.style.translate = '';
  const r = t.getBoundingClientRect();
  t.style.translate = `${x - tabPress.gx - r.left}px ${y - tabPress.gy - r.top}px`;
}
$('mynotes-tabs').addEventListener('pointerdown', (e) => {
  const t = e.target.closest('[data-mynote]');
  if (!t || e.target.closest('[data-mynote-del]')) return;
  const r = t.getBoundingClientRect();
  Object.assign(tabPress, { el: t, id: e.pointerId, x: e.clientX, y: e.clientY,
    gx: e.clientX - r.left, gy: e.clientY - r.top, moved: false, long: false });
  clearTimeout(tabPress.timer);
  tabPress.timer = setTimeout(() => {
    if (tabPress.el !== t || tabPress.moved) return;
    tabPress.long = true;
    renameMyNote(t.dataset.mynote);
  }, 550);
  if (myNotesEditing) { e.preventDefault(); try { t.setPointerCapture(e.pointerId); } catch {} }
});
$('mynotes-tabs').addEventListener('pointermove', (e) => {
  const t = tabPress.el;
  if (!t || e.pointerId !== tabPress.id) return;
  if (!tabPress.moved && Math.hypot(e.clientX - tabPress.x, e.clientY - tabPress.y) < 6) return;
  if (!tabPress.moved) { tabPress.moved = true; clearTimeout(tabPress.timer); if (myNotesEditing) t.classList.add('is-dragging'); }
  if (!myNotesEditing) return;
  e.preventDefault();
  // Crossing the middle of a neighbour swaps places with it.
  const others = [...$('mynotes-tabs').querySelectorAll('[data-mynote]')].filter(o => o !== t);
  const over = others.find(o => {
    const r = o.getBoundingClientRect();
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  });
  if (over) {
    const r = over.getBoundingClientRect();
    const before = e.clientX < r.left + r.width / 2;
    const ref = before ? over : over.nextSibling;
    if (ref !== t && t.nextSibling !== ref) {
      const was = new Map(others.map(o => [o, o.getBoundingClientRect()]));
      over.parentNode.insertBefore(t, ref);
      for (const o of others) {
        const a = was.get(o), b = o.getBoundingClientRect();
        const dx = a.left - b.left, dy = a.top - b.top;
        if (dx || dy) o.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], GLIDE);
      }
    }
  }
  tabFollow(t, e.clientX, e.clientY);
});
function tabPressEnd() {
  const t = tabPress.el;
  clearTimeout(tabPress.timer);
  if (t && tabPress.moved && myNotesEditing) {
    // Settle: from under the finger into the slot.
    const from = t.style.translate || '0px 0px';
    t.style.translate = '';
    t.classList.remove('is-dragging');
    t.animate([{ translate: from, scale: '1.08' }, { translate: '0px 0px', scale: '1' }], { duration: 300, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' });
    storage.orderMyNotes([...$('mynotes-tabs').querySelectorAll('[data-mynote]')].map(o => o.dataset.mynote));
  }
  tabPress.el = null;
  // The click after a drag or long press still sees moved / long; clear after it.
  setTimeout(() => { tabPress.moved = false; tabPress.long = false; }, 0);
}
$('mynotes-tabs').addEventListener('pointerup', tabPressEnd);
$('mynotes-tabs').addEventListener('pointercancel', tabPressEnd);
$('mynote-body').addEventListener('input', () => {
  const el = $('mynote-body');
  el.classList.toggle('is-empty', !el.textContent.trim());
  if (el.textContent.trim().length <= 24) setNoteDir(el);
  if (myNoteId) storage.setMyNoteHtml(myNoteId, noteHtmlOf(el));
  if (myNotesQuery() && !myNotesShowResults && window.CSS && CSS.highlights) { CSS.highlights.delete('note-find'); }
});
// Paste as plain text, like the airport notes.
$('mynote-body').addEventListener('paste', (e) => {
  e.preventDefault();
  const text = (e.clipboardData || window.clipboardData)?.getData('text/plain') || '';
  if (text) document.execCommand('insertText', false, text);
});
$('mynote-fmt').addEventListener('pointerdown', (e) => {
  const btn = e.target.closest('[data-my-fmt]');
  if (!btn) return;
  e.preventDefault();
  if (brush) setBrush(brush);
  const el = $('mynote-body');
  el.focus();
  try {
    document.execCommand('styleWithCSS', false, false);
    document.execCommand(btn.dataset.myFmt, false, null);
  } catch (err) { console.warn('note format failed', err); }
  if (myNoteId) storage.setMyNoteHtml(myNoteId, noteHtmlOf(el));
});

// Notes full screen, remembered between openings.
function setNotesFull(on) {
  $('airport-overlay').classList.toggle('notes-full', on);
  const b = $('apt-full');
  b.setAttribute('aria-pressed', String(on));
  b.textContent = on ? '⤡' : '⤢';
  b.title = on ? 'Exit full screen' : 'Full screen';
  b.setAttribute('aria-label', on ? 'Exit full screen' : 'Show notes full screen');
  try { localStorage.setItem('fc.notes.full', on ? '1' : '0'); } catch {}
}
$('apt-full').addEventListener('click', () =>
  setNotesFull(!$('airport-overlay').classList.contains('notes-full')));
try { if (localStorage.getItem('fc.notes.full') === '1') setNotesFull(true); } catch {}

// Formatting bar. pointerdown + preventDefault so the button never steals
// focus from the editor — execCommand needs the selection to still be live.
$('apt-fmt').addEventListener('pointerdown', (e) => {
  const btn = e.target.closest('[data-apt-fmt]');
  if (!btn) return;
  e.preventDefault();
  const el = $('airport-notes');
  if (brush) setBrush(brush);        // typing formats: put the brush down
  el.focus();
  try {
    // Plain <b>/<i> elements: semantic, and they survive the sanitiser
    // without depending on style parsing.
    document.execCommand('styleWithCSS', false, false);
    document.execCommand(btn.dataset.aptFmt, false, null);
  } catch (err) { console.warn('note format failed', err); }
  paintNoteEmpty();
  if (airportNoteFor) storage.setAirportNote(airportNoteFor, currentNoteHtml());
});
$('airport-social').addEventListener('input', () => {
  const el = $('airport-social');
  el.classList.toggle('is-empty', !el.textContent.trim());
  if (airportNoteFor && !socialFeedSet()) storage.setAirportSocial(airportNoteFor, currentSocialHtml());
});
$('airport-close').addEventListener('click', () => {
  flushAirportNotes();
  hideOverlay('airport-overlay');
});
$('airport-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'airport-overlay') {
    flushAirportNotes();
    hideOverlay('airport-overlay');
  }
});

// ---- Social-notes feed sync ----
// If a feed URL is configured (Settings → Social notes), keep the Social
// notes in step with it. The feed is published by the pilot's Mac
// (mac-tools/social-notes-sync.sh reads the Apple Notes folder and pushes to
// the worker); the PWA can't read Notes itself.
//
// This used to pull at most once a WEEK, and only at cold start or on an
// airport tap — on an iPad, where the app is resumed far more often than
// launched, a change could take days to show. It now checks on launch and
// every time the app returns to the foreground, at most every 15 minutes.
// The feed is ~500 KB, so the check is the worker's tiny .ver fingerprint;
// the notes themselves download only when the fingerprint changes. A feed
// hosted elsewhere has no fingerprint, so it is fetched whole, hourly.
async function maybeSyncSocialNotes(force = false) {
  const url = (localStorage.getItem('fc.social.feedUrl') || '').trim();
  if (!url) return false;
  const verUrl = /\/social\/[0-9a-f-]{36}\.json(\?.*)?$/i.test(url)
    ? url.replace(/\.json(\?.*)?$/i, '.ver') : '';
  const every = verUrl ? 15 * 60 * 1000 : 60 * 60 * 1000;
  const lastCheck = Number(localStorage.getItem('fc.social.lastCheck') || 0);
  if (!force && Date.now() - lastCheck < every) return false;
  localStorage.setItem('fc.social.lastCheck', String(Date.now()));
  let ver = '';
  if (verUrl) {
    try {
      const r = await fetch(verUrl, { cache: 'no-store' });
      if (r.ok) ver = (await r.text()).trim();
    } catch { /* offline: fall through, the full fetch will fail quietly too */ }
    if (!force && ver && ver === localStorage.getItem('fc.social.ver')) {
      // Unchanged — the notes on this device ARE current, so say so. Leaving
      // lastSync alone made the hint read "synced 3 days ago" and look broken.
      localStorage.setItem('fc.social.lastSync', String(Date.now()));
      if (airportNoteFor && !$('airport-overlay').classList.contains('hidden')) paintSocialHint();
      return false;
    }
  }
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return false;
    const data = await res.json();
    if (data && typeof data === 'object') {
      // Notes may be titled by IATA (TLV) or ICAO (LLBG); legs look them up
      // by IATA. Store each note under BOTH codes so it matches whichever
      // the leg uses. airports.lookup resolves the pair.
      let expanded = data;
      try {
        const { lookup } = await import('./modules/airports.js?v=262');
        expanded = {};
        for (const [code, val] of Object.entries(data)) {
          const a = lookup(code);
          const keys = a ? [a.iata, a.icao, code] : [code];
          for (const key of keys) if (key) expanded[String(key).toUpperCase()] = val;
        }
      } catch {}
      const before = { ...(storage.getState().airportSocial || {}) };
      storage.setAirportSocialAll(expanded);
      socialChanges.record(before, storage.getState().airportSocial, t => NOTE_HTML_RE.test(t));
      paintSocialDots();
      localStorage.setItem('fc.social.lastSync', String(Date.now()));
      if (ver) localStorage.setItem('fc.social.ver', ver);
      // If the popup is open, refresh the visible social note — only when it
      // really changed: redrawing it wipes a selection the pilot is making.
      if (airportNoteFor && !$('airport-overlay').classList.contains('hidden')) {
        const now = storage.getAirportSocial(airportNoteFor);
        if (now !== shownSocial) setSocialHtml(now, airportNoteFor);
        paintSocialHint();
      }
      return true;
    }
  } catch (err) { console.warn('social feed sync failed', err); }
  return false;
}
// Kick a check shortly after boot (off the critical path) and whenever the
// app returns to the foreground. The comment here always promised the second
// one; it was never wired up, which mattered most on iPad, where the app is
// resumed from the background far more often than it is launched.
setTimeout(() => { try { maybeSyncSocialNotes(); } catch {} }, 6_000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { try { maybeSyncSocialNotes(); } catch {} }
});

// Delegated tap handler for the Dep / Arr airport buttons in the leg
// switcher (their data-airport is set dynamically on each render).
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-airport]');
  if (!btn) return;
  const code = btn.dataset.airport;
  if (code) { e.preventDefault(); showAirportInfo(code); try { maybeSyncSocialNotes(); } catch {} }
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
    const { ocrImage } = await import('./modules/ocr.js?v=262');
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
  const { parseRoster } = await import('./modules/roster.js?v=262');
  const roster = parseRoster(text);
  if (roster) {
    await applyRoster(roster);
    // Keep the paste-text panel open so the user can paste another roster
    // (or edit / re-parse the current one) without re-opening the sheet.
    const details = document.querySelector('.ocr-paste');
    if (details) details.open = true;
    return;
  }
  const { parseFmcText, buildReviewFields } = await import('./modules/ocr.js?v=262');
  const parsed = parseFmcText(text);
  $('ocr-progress').classList.add('hidden');
  // dep / arr deliberately excluded — the roster already sets them and a
  // takeoff-perf screenshot shouldn't overwrite the route.
  const headline = ['ctot','v1','vr','v2','n1','flaps','trip_fuel','block_fuel','sob_total','atis','tail','flight'];
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
  let aircraftChange = null;   // { from, to } when the OPT tail ≠ current tail
  if (out.tail) {
    const t = String(out.tail).toUpperCase().replace(/\s+/g, '');
    headerBag.tail = /^[A-Z]{3}$/.test(t) ? '4X-' + t : t;
    // Aircraft swap check: OPT was run for a different tail than the leg's.
    // A frequent real event (aircraft change after roster) worth flagging
    // loudly so the pilot notices the perf numbers are for a new jet.
    const curTail = String(storage.getCurrent().dataCard.tail || '').toUpperCase().trim();
    if (curTail && curTail !== headerBag.tail) {
      aircraftChange = { from: curTail, to: headerBag.tail };
    }
    delete out.tail;
  }
  if (out.flight) {
    headerBag.flight = String(out.flight).toUpperCase();
    delete out.flight;
  }
  if (Object.keys(headerBag).length) storage.setDataBulk(headerBag);
  // CTOT goes through the same path as typing it in the header: pinned
  // against calendar syncs, and the countdown starts afresh.
  let ctotApplied = 0;
  if (out.ctot) {
    const c = formatHHMM(String(out.ctot).replace(/[^\d]/g, ''));
    delete out.ctot;
    if (/^\d\d:\d\d$/.test(c)) {
      storage.setDataField('ctot', c);
      try { updateCtotColor(); } catch {}
      try { resetCtotAlertState(); } catch {}
      ctotApplied = 1;
    }
  }
  const totalApplied = Object.keys(headerBag).length + Object.keys(out).length + ctotApplied;
  dataCard.applyExternal(out, dataBody);
  syncHeaderInputs();
  speeches.notifyDataChange();
  hideOverlay('ocr-overlay');
  if (aircraftChange) {
    // Announce + flash the tail field so the swap can't slip by unnoticed.
    toast(`✈ Aircraft changed: ${aircraftChange.from} → ${aircraftChange.to}`, 4200);
    const tailEl = $('hdr-tail');
    if (tailEl) {
      tailEl.classList.remove('aircraft-changed');
      // reflow so the animation restarts even on a repeat swap
      void tailEl.offsetWidth;
      tailEl.classList.add('aircraft-changed');
      setTimeout(() => tailEl.classList.remove('aircraft-changed'), 6000);
    }
  } else {
    toast(`Applied ${totalApplied} field${totalApplied === 1 ? '' : 's'}`);
  }
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
// Every flown leg that ISN'T in the current duty — the CSV backfill plus any
// archived duty record — newest first. This is the pilot's actual history;
// current.legs is just the trip they're on.
function pastLegsForHistory() {
  const now = Date.now();
  const inDuty = new Set(storage.getLegs());
  return storage.everyLeg()
    .filter(leg => !inDuty.has(leg))
    .filter(leg => {
      const ts = legTs(leg.dep_date, leg.dep_time, leg.dep_year, now);
      return !Number.isFinite(ts) || ts <= now;
    })
    .sort((a, b) => (legTs(b.dep_date, b.dep_time, b.dep_year, now) || 0)
                  - (legTs(a.dep_date, a.dep_time, a.dep_year, now) || 0));
}

function histRowHtml(leg, { idx = null, active = false } = {}) {
  const id = [leg.tail, leg.flight ? 'LY' + leg.flight : ''].filter(Boolean).join(' · ') || 'Flight';
  const route = (leg.dep && leg.arr) ? `${leg.dep} → ${leg.arr}` : '';
  // Every row carries a date, and it shows the YEAR — the list is sorted by
  // it, so when the order looks wrong the date is the thing you need to see.
  // A leg with no date at all says so instead of rendering blank: those sort
  // to the end, and a silent gap makes that look like a bug rather than
  // missing data.
  let when = 'no date', dateless = true;
  if (leg.dep_date) {
    when = `${legDateLabel(leg.dep_date, leg.dep_year)}${leg.dep_time ? '  ' + leg.dep_time + 'Z' : ''}`;
    dateless = false;
  }
  const d = leg.dataCard || {};
  const roles = [
    d.to_role  ? `T/O ${esc(String(d.to_role).toUpperCase())}`  : '',
    d.ldg_role ? `LDG ${esc(String(d.ldg_role).toUpperCase())}` : '',
  ].filter(Boolean).join(' · ');
  const time = d.actual_block_time || d.actual_flight_time || leg.flight_time || d.block_time || '';
  const where = idx == null
    ? `data-past-key="${escapeAttr(lbKeyOf(leg))}"`
    : `data-leg-idx="${idx}"`;
  const del = idx == null ? '' :
    `<button type="button" class="hi-del" data-leg-del="${idx}" title="Delete this flight" aria-label="Delete this flight">🗑</button>`;
  return `<div class="history-item${active ? ' active' : ''}${idx == null ? ' is-past' : ''}" ${where}>
      <div class="hi-top">
        <span class="hi-id">${escapeHtml(id)}</span>
        <span class="hi-date${dateless ? ' is-dateless' : ''}">${escapeHtml(when)}</span>
        ${del}
      </div>
      <div class="hi-line">${escapeHtml(route)}${time ? ' · ' + escapeHtml(time) : ''}${roles ? ' · ' + roles : ''}</div>
    </div>`;
}

// ---- Duties in History / logbook ----
// A non-flight calendar event (duties.js). Ground events are scheduled in
// local time, so they print local, marked LT — flights keep their Z.
// Function declarations, not const arrows: renderHistory() runs during boot,
// long before this point in the module body, and a const would still be in
// its temporal dead zone — the boot-time ReferenceError that has frozen this
// app before.
function pad2(n) { return String(n).padStart(2, '0'); }
function localDayLabel(ms) {
  const d = new Date(ms);
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${String(d.getFullYear()).slice(-2)}`;
}
function localHm(ms) { const d = new Date(ms); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
function dutyWhen(duty) {
  if (duty.allDay) {
    // DTEND of an all-day event is the day AFTER the last one.
    const days = Math.max(1, Math.round((duty.end - duty.start) / 86400000));
    const first = legDateLabel(duty.dep_date, duty.dep_year);
    if (days === 1) return { date: first, time: 'All day' };
    const last = new Date(duty.start + (days - 1) * 86400000);
    return { date: first, time: `to ${pad2(last.getUTCDate())}.${pad2(last.getUTCMonth() + 1)} · ${days} days` };
  }
  const mins = Math.round((duty.end - duty.start) / 60000);
  const dur = mins > 0 ? ` · ${Math.floor(mins / 60)}:${pad2(mins % 60)}` : '';
  return { date: `${localDayLabel(duty.start)} ${localHm(duty.start)} LT`,
           time: `${localHm(duty.start)}–${localHm(duty.end)} LT${dur}` };
}
// A title that's only a roster code ("X", "VAC_FLD", "DUMMY R TLV") reads
// better as its plain meaning; a descriptive title is kept as written.
function dutyTitle(duty) {
  const k = DUTY_KINDS[duty.kind] || DUTY_KINDS.other;
  const t = String(duty.title || '').trim();
  const codeOnly = !t || /^[A-Z0-9_]{1,10}$/.test(t) || (duty.kind === 'standby' && /^DUMMY\b/.test(t));
  return codeOnly ? (duty.label || k.label) : t;
}
function dutyRowHtml(duty) {
  const k = DUTY_KINDS[duty.kind] || DUTY_KINDS.other;
  const w = dutyWhen(duty);
  const title = dutyTitle(duty);
  const sub = (title === k.label || title === duty.label) ? w.time : `${k.label} · ${w.time}`;
  return `<div class="history-item is-duty" data-duty-uid="${escapeAttr(duty.uid)}">
      <div class="hi-top">
        <span class="duty-badge" data-kind="${escapeAttr(duty.kind)}">${escapeHtml(k.badge)}</span>
        <span class="hi-id">${escapeHtml(title)}</span>
        <span class="hi-date">${escapeHtml(w.date)}</span>
      </div>
      <div class="hi-line">${escapeHtml(sub)}</div>
    </div>`;
}
function showDuty(uid) {
  const duty = storage.getDuties().find(d => d.uid === uid);
  if (!duty) return;
  const k = DUTY_KINDS[duty.kind] || DUTY_KINDS.other;
  const w = dutyWhen(duty);
  $('duty-badge').textContent = k.badge;
  $('duty-badge').dataset.kind = duty.kind;
  $('duty-kind').textContent = k.label;
  $('duty-title').textContent = String(duty.title || k.label);
  const utc = duty.allDay ? '' :
    ` (${new Date(duty.start).toISOString().slice(11, 16)}–${new Date(duty.end).toISOString().slice(11, 16)}Z)`;
  $('duty-when').textContent = `${w.date.replace(/ \d\d:\d\d LT$/, '')} · ${w.time}${utc}`;
  $('duty-notes').textContent = duty.notes || '';
  $('duty-notes').classList.toggle('hidden', !duty.notes);
  showOverlay('duty-overlay');
}
// legTs needs a time; a leg that has a date but no time (hand-entered, or
// an import without one) came back null and sank to the bottom of a list
// sorted by time, out of date order. Fall back to the start of its day.
function legSortTs(leg) {
  const now = Date.now();
  const t = legTs(leg.dep_date, leg.dep_time, leg.dep_year, now);
  if (Number.isFinite(t)) return t;
  return leg.dep_date ? legTs(leg.dep_date, '00:00', leg.dep_year, now) : NaN;
}

function renderHistory() {
  const legs = storage.getLegs();
  const activeIdx = storage.getLegIndex();
  const past = pastLegsForHistory();
  // Duties sit in the same timeline as the flights. Anything from the start
  // of the current trip onward goes up top with its legs (in date order);
  // older ones join the past list.
  const now = Date.now();
  const tripStart = legs.reduce((m, l) => {
    const t = legSortTs(l);
    return Number.isFinite(t) ? Math.min(m, t) : m;
  }, now);
  const duties = storage.getDuties();
  const dutiesUp = duties.filter(d => d.start >= tripStart || (d.end || d.start) >= now);
  const dutiesPast = duties.filter(d => !dutiesUp.includes(d)).sort((a, b) => b.start - a.start);
  if (!legs.length && !past.length && !duties.length) {
    historyBody.innerHTML = `<div class="history-empty">No flights yet. Tap the new-flight button → Paste roster.</div>`;
    return;
  }
  const pastAll = [
    ...past.map(leg => ({ t: legSortTs(leg) || 0, html: () => histRowHtml(leg) })),
    ...dutiesPast.map(d => ({ t: d.start, html: () => dutyRowHtml(d) })),
  ].sort((a, b) => b.t - a.t);
  const shown = histShowAllPast ? pastAll : pastAll.slice(0, HIST_PAST_PAGE);
  const pastHtml = pastAll.length ? `
    <div class="hi-sep">Past · ${pastAll.length}</div>
    ${shown.map(x => x.html()).join('')}
    ${pastAll.length > shown.length
        ? `<button type="button" class="hi-more" data-hist-more="1">Show all ${pastAll.length}</button>`
        : ''}` : '';
  // Legs keep their own order (that IS the leg switcher's order); each duty
  // is slotted in before the first leg that departs after it.
  const upHtml = [];
  const queue = dutiesUp.slice().sort((a, b) => a.start - b.start);
  legs.forEach((leg, i) => {
    const t = legSortTs(leg);
    while (queue.length && Number.isFinite(t) && queue[0].start <= t) upHtml.push(dutyRowHtml(queue.shift()));
    upHtml.push(histRowHtml(leg, { idx: i, active: i === activeIdx }));
  });
  for (const d of queue) upHtml.push(dutyRowHtml(d));
  historyBody.innerHTML = upHtml.join('') + pastHtml;

  historyBody.querySelectorAll('.history-item').forEach(el => {
    el.addEventListener('click', async (e) => {
      if (e.target.closest('[data-leg-del]')) return;
      // A past flight isn't part of the current duty, so it can't become the
      // active leg without dragging seven years into the leg switcher. Open
      // the logbook on it instead — that's where crew, actual time and PF/PM
      // are editable.
      if (el.dataset.pastKey) { await openLogbook(el.dataset.pastKey); return; }
      if (el.dataset.dutyUid) { showDuty(el.dataset.dutyUid); return; }
      const i = parseInt(el.dataset.legIdx, 10);
      await pickLeg(i);
      renderHistory();
    });
  });
  historyBody.querySelector('[data-hist-more]')?.addEventListener('click', () => {
    histShowAllPast = true;
    renderHistory();
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

// Every leg date shown anywhere: dd.mm.yy, always with the year. The leg's
// own stored year when it has one; a legacy leg without one is history, so
// it resolves into the past (yearPast) — the same rule the logbook sorts by,
// so a row's printed year can never disagree with where it sits.
function legDateLabel(ddmm, year) {
  if (!ddmm) return '';
  const y = year || yearPast(ddmm);
  return y ? `${ddmm}.${String(y).slice(-2)}` : ddmm;
}

function fmtDateShort(ts) {
  const d = new Date(ts);
  return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${String(d.getFullYear()).slice(-2)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------- Helpers ----------
function escapeAttr(s) { return String(s).replace(/"/g, '&quot;'); }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch]);
}
