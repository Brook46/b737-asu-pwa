// app.js — Thermals bootstrap and orchestration.
//
// Onboarding gates, in order:
//   1. Location — the hard gate. No active share ⇒ you can't see the crew.
//   2. Sign-in  — phone + SMS code = identity (and your WhatsApp number).
//   3. Profile  — at least a nickname + colour before you appear on the map.
// Then we connect to today's room and the live map comes alive.

import { initTheme, toast, showOverlay, hideOverlay } from './modules/ui.js';
import { COLORS } from './config.js';
import * as geo from './modules/geo.js';
import * as mapMod from './modules/map.js';
import * as profile from './modules/profile.js';
import * as stateMod from './modules/state.js';
import * as auth from './modules/auth.js';
import * as presence from './modules/presence.js';
import * as roster from './modules/roster.js';
import * as chat from './modules/chat.js';
import * as sos from './modules/sos.js';
import * as crash from './modules/crash.js';

const $ = (id) => document.getElementById(id);
let mapStarted = false;
let connected = false;
let selfId = null;

initTheme();
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// ---------- Location gate ----------
geo.onGate((status) => {
  const gate = $('gate-location');
  if (status === 'granted') {
    hideOverlay('gate-location');
    startMapOnce();
    maybeAdvanceOnboarding();
  } else {
    // unsupported | denied | prompt → show the block screen with tailored copy.
    const msg = {
      denied: 'Location is blocked. Enable it for this site in your browser settings, then reload — you can\'t see the crew without sharing your own position.',
      prompt: 'Thermals shows you where everyone is flying today. To join, share your location.',
      unsupported: 'This device can\'t share location, so Thermals can\'t place you on the map.',
    }[status] || 'Share your location to see the crew.';
    $('gate-location-msg').textContent = msg;
    $('gate-location-retry').classList.toggle('hidden', status === 'unsupported');
    showOverlay('gate-location');
  }
});

$('gate-location-retry')?.addEventListener('click', () => geo.start());

// Feed every fix into the map + (if connected) the room.
geo.onFix((fix) => {
  if (!mapStarted) return;
  paintMe();
  if (connected) presence.sendPosition(
    { lat: fix.lat, lng: fix.lng, alt: fix.alt, heading: fix.heading, speed: fix.speed },
    stateMod.getState(), stateMod.getSeats()
  );
  // Auto-switch flying / walking / driving from speed + climb rate.
  stateMod.applyAutoState({ speed: fix.speed, vrate: verticalRate(fix) });
});

// Vertical speed (m/s) from successive altitude samples — the key signal that
// separates flight (climbing/sinking) from level ground travel.
let prevAlt = null, prevAltTs = null;
function verticalRate(fix) {
  if (fix.alt == null) return 0;
  let vr = 0;
  if (prevAlt != null && fix.ts > prevAltTs) vr = (fix.alt - prevAlt) / ((fix.ts - prevAltTs) / 1000);
  prevAlt = fix.alt; prevAltTs = fix.ts;
  return vr;
}

function startMapOnce() {
  if (mapStarted) return;
  mapStarted = true;
  const fix = geo.lastFix();
  const center = fix ? [fix.lng, fix.lat] : [8.0, 46.5];
  mapMod.initMap('map', center, (id) => roster.openCard(id));
  stateMod.renderSelector();
}

geo.start();

// Paint my own marker from the current fix + profile + state (+ seats).
function paintMe() {
  const fix = geo.lastFix();
  if (!fix || !mapStarted) return;
  const p = profile.getProfile();
  mapMod.setMe(fix.lng, fix.lat, stateMod.getState(), p.color, p.nickname, stateMod.getSeats());
}

// ---------- State selector ----------
stateMod.onState((s) => {
  paintMe();
  if (connected) presence.sendState(s, stateMod.getSeats());
});

// ---------- SOS ----------
// Press SOS → a 10-second countdown you can cancel (60s when auto-triggered by a
// detected crash). On activate: local siren + vibrate, and we broadcast distress
// + our location to everyone in today's room.
let sosCountTimer = null;
let sosCount = 0;
let sosActive = false;

function openSosCountdown(seconds = 10, reason = '') {
  if (sosActive) return;
  sosCount = seconds;
  $('sos-reason').textContent = reason;
  $('sos-reason').classList.toggle('hidden', !reason);
  paintSosCount();
  showOverlay('sos-countdown');
  clearInterval(sosCountTimer);
  sosCountTimer = setInterval(() => {
    sosCount -= 1;
    paintSosCount();
    if (sosCount <= 0) activateSos();
  }, 1000);
}
function paintSosCount() { const el = $('sos-count'); if (el) el.textContent = String(Math.max(0, sosCount)); }
function cancelSosCountdown() { clearInterval(sosCountTimer); hideOverlay('sos-countdown'); }

// A detected impact starts the countdown with a full minute to cancel.
crash.onImpact(() => {
  sos.vibrate([600, 200, 600]);
  openSosCountdown(60, 'Possible crash detected — are you OK?');
});

function activateSos() {
  clearInterval(sosCountTimer);
  hideOverlay('sos-countdown');
  sosActive = true;
  sos.startSiren();
  sos.vibrate([400, 200, 400, 200, 400]);
  $('sos-btn')?.classList.add('is-active');
  showOverlay('sos-active');
  mapMod.setMeSOS(true);
  if (connected) presence.sendSOS(true);
  toast('🚨 SOS sent to everyone flying today', 4000);
}
function clearSos() {
  sosActive = false;
  sos.stopSiren();
  $('sos-btn')?.classList.remove('is-active');
  hideOverlay('sos-active');
  mapMod.setMeSOS(false);
  if (connected) presence.sendSOS(false);
  toast('SOS cleared');
}

$('sos-btn')?.addEventListener('click', () => (sosActive ? clearSos() : openSosCountdown()));
$('sos-cancel')?.addEventListener('click', cancelSosCountdown);
$('sos-now')?.addEventListener('click', activateSos);
$('sos-clear')?.addEventListener('click', clearSos);

// ---------- Free-seats picker (long-press Retrieve) ----------
stateMod.setOnSeatsRequest(() => {
  const grid = $('seats-grid');
  if (grid) {
    grid.innerHTML = [0, 1, 2, 3, 4, 5, 6].map((n) =>
      `<button class="seat-opt${n === stateMod.getSeats() ? ' is-on' : ''}" data-n="${n}">${n}</button>`).join('');
    grid.querySelectorAll('.seat-opt').forEach((b) => b.addEventListener('click', () => {
      stateMod.setState('RETRIEVE');
      stateMod.setSeats(Number(b.dataset.n));
      hideOverlay('seats-picker');
      toast(`Offering ${b.dataset.n} seat${b.dataset.n === '1' ? '' : 's'}`);
    }));
  }
  showOverlay('seats-picker');
});
$('seats-picker')?.addEventListener('click', (e) => { if (e.target.id === 'seats-picker') hideOverlay('seats-picker'); });

// ---------- Profile ----------
profile.renderEditor();
profile.onProfile((p) => {
  paintMe();
  if (connected) presence.sendProfile(p);
  maybeAdvanceOnboarding();
});

$('open-profile')?.addEventListener('click', () => showOverlay('overlay-profile'));
$('profile-done')?.addEventListener('click', () => {
  if (!profile.isComplete()) { toast('Pick a nickname first'); return; }
  hideOverlay('overlay-profile');
  maybeAdvanceOnboarding();
});

// ---------- Sign-in (WhatsApp number = identity) ----------
$('signin-go')?.addEventListener('click', async () => {
  const phone = $('signin-phone').value.trim();
  if (!phone) return toast('Enter your WhatsApp number');
  try {
    $('signin-go').disabled = true;
    await auth.signIn(phone);
    // Pre-fill the profile phone so your WhatsApp link works out of the box.
    if (!profile.getProfile().phone) profile.saveProfile({ phone });
    hideOverlay('gate-signin');
    maybeAdvanceOnboarding();
  } catch (e) { toast(e.message); }
  finally { $('signin-go').disabled = false; }
});

// Local map-only preview when the backend isn't configured yet. Marks the gate
// dismissed so the onboarding driver stops re-showing it.
$('signin-preview')?.addEventListener('click', () => {
  $('gate-signin')?.classList.add('preview-dismissed');
  hideOverlay('gate-signin');
  toast('Map preview — you won\'t appear to others until you sign in');
});

// ---------- Onboarding driver ----------
// Decide which gate to show next once any precondition changes.
function maybeAdvanceOnboarding() {
  if (!geo.lastFix()) return;                       // wait for location
  // Returning user: a saved profile means we never make them sign in again —
  // start a local session from their saved details and go straight to the map.
  if (profile.isComplete() && !auth.isSignedIn()) {
    auth.ensureLocalSession(profile.getProfile().phone);
  }
  if (!auth.isSignedIn()) {
    if (!previewMode()) showOverlay('gate-signin');
    return;
  }
  if (!profile.isComplete()) { showOverlay('overlay-profile'); return; }
  connectRoom();
}
function previewMode() { return $('gate-signin')?.classList.contains('preview-dismissed'); }

// ---------- Connect to today's room ----------
function connectRoom() {
  if (connected || !auth.isSignedIn() || !profile.isComplete()) return;
  connected = true;
  selfId = null;

  roster.init({
    onVisibility: (id, visible) => mapMod.setPilotVisible(id, visible),
    onFocusPilot: (lng, lat) => mapMod.flyToPilot(lng, lat),
  });
  // Show my own message instantly (works offline too); the server echo for my id
  // is ignored so it isn't duplicated.
  const echoMine = (extra) => {
    const p = profile.getProfile();
    chat.add({ from: selfId || 'me', nick: p.nickname || 'You', color: p.color, ts: Date.now(), ...extra });
  };
  chat.init({
    onSendMessage: (t) => { echoMine({ text: t }); presence.sendChat(t); },
    onSendMedia: (media) => { echoMine({ media }); presence.sendChat('', media); },
    selfId,
  });

  presence.on('status', (s) => {
    $('conn-dot')?.setAttribute('data-status', s);
  });
  presence.on('self', (id) => { selfId = id; chat.setSelfId(id); });
  presence.on('roster', (list) => {
    const vis = list.filter((p) => !isMe(p)).map(decorate).filter(inRange);
    roster.setAll(vis);
    vis.forEach((p) => { if (!roster.isHidden(p.id)) mapMod.upsertPilot(p); });
  });
  presence.on('upsert', (p) => applyPilot(p));
  presence.on('remove', (id) => { roster.remove(id); mapMod.removePilot(id); });
  presence.on('chat', (m) => { if (selfId && m.from === selfId) return; chat.add(m); });
  presence.on('sos', (e) => {
    if (isMe(e)) return;
    if (e.active) {
      sos.alertBeep();
      sos.vibrate([200, 100, 200]);
      mapMod.setPilotVisible(e.id, true);      // distress always shows
      if (e.lng != null) mapMod.flyToPilot(e.lng, e.lat);
      toast(`🚨 ${e.nick || 'A pilot'} needs help!`, 6000);
    }
  });

  // Local-only session (backend not deployed): skip the live connection so we
  // don't loop trying to reach a server that isn't there. The app still works
  // on this device — you just won't see other pilots until the Worker is live.
  if (auth.isLocalSession()) {
    selfId = 'me';
    chat.setSelfId('me');
    $('conn-dot')?.setAttribute('data-status', 'closed');
    return;
  }

  presence.setToken(auth.getToken());
  presence.connect();

  // Push our identity + first position immediately.
  presence.sendProfile(profile.getProfile());
  const fix = geo.lastFix();
  if (fix) presence.sendPosition({ lat: fix.lat, lng: fix.lng, alt: fix.alt, heading: fix.heading, speed: fix.speed }, stateMod.getState());
}

// Only pilots within RANGE_KM of me show up (an SOS always shows, any distance).
const RANGE_KM = 50;
function distKm(a, b) {
  if (a?.lat == null || b?.lat == null) return null;
  const R = 6371, toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
function decorate(p) {
  const me = geo.lastFix();
  const o = { ...p };
  o.distKm = distKm(me, p);
  return o;
}
function inRange(p) {
  if (p.sos) return true;
  if (p.distKm == null) return true;          // unknown distance → don't hide
  return p.distKm <= RANGE_KM;
}
function isMe(p) { return selfId && p.id === selfId; }

// Apply one incoming pilot: decorate, range-filter (SOS always shows), then
// reflect into the roster + map. Shared by live presence and the demo seed.
function applyPilot(raw) {
  if (isMe(raw)) return;
  const d = decorate(raw);
  if (!inRange(d)) { roster.remove(d.id); mapMod.removePilot(d.id); return; }
  roster.upsert(d);
  if (!roster.isHidden(d.id)) mapMod.upsertPilot(d);
}

// ---------- Panels (roster / chat tabs) ----------
function showPanel(name) {
  ['roster', 'chat'].forEach((n) => {
    $(`panel-${n}`)?.classList.toggle('hidden', n !== name);
    $(`tab-${n}`)?.classList.toggle('is-on', n === name);
  });
  if (name === 'chat') chat.clearUnread();
}
$('tab-roster')?.addEventListener('click', () => showPanel('roster'));
$('tab-chat')?.addEventListener('click', () => showPanel('chat'));
function closePanel() { $('side-panel')?.classList.remove('open'); }
$('panel-toggle')?.addEventListener('click', () => {
  const panel = $('side-panel');
  const opening = !panel.classList.contains('open');
  panel.classList.toggle('open');
  if (opening) showPanel('chat');     // the top-bar button is the chat button
});
$('panel-close')?.addEventListener('click', closePanel);
mapMod.onBackgroundClick(closePanel);     // tapping the map closes the panel
$('recenter')?.addEventListener('click', () => mapMod.recenterMe());
$('toggle-3d')?.addEventListener('click', () => {
  const on = mapMod.toggle3D();
  $('toggle-3d').classList.toggle('is-on', on);
  $('toggle-3d').textContent = on ? '2D' : '3D';
});

// Kick off the onboarding check (location callback will re-drive it).
maybeAdvanceOnboarding();

// Dev seam: simulate a GPS fix for local testing without real location
// (e.g. headless preview). Harmless in production; only fires when called.
window.thermalsSimulate = (lat = 46.62, lng = 8.04, speed = 0, alt = 1500) => {
  hideOverlay('gate-location');
  geo._injectFix({ lat, lng, speed, alt });
};

// Dev seam: populate the roster, map, and chat with fake pilots exactly as the
// DayRoom would, to verify the crew panel / cards / chat UI without a backend.
window.thermalsDemo = () => {
  roster.init({
    onVisibility: (id, vis) => mapMod.setPilotVisible(id, vis),
    onFocusPilot: (lng, lat) => mapMod.flyToPilot(lng, lat),
  });
  const demoEcho = (extra) => chat.add({ from: 'me', nick: 'You', color: '#ff5252', ts: Date.now(), ...extra });
  chat.init({
    onSendMessage: (t) => demoEcho({ text: t }),
    onSendMedia: (media) => demoEcho({ media }),
    selfId: 'me',
  });
  const fakes = [
    { id: 'a', nickname: 'Sky Pirate', color: '#ffd600', state: 'FLYING', lat: 46.63, lng: 8.05, phone: '+972501112233', bloodType: 'A+', vehicle: 'White Transporter · 123-45', emergency: 'Dana 050-999', links: 'https://xcontest.org/skypirate', ts: Date.now() },
    { id: 'b', nickname: 'Ridge Runner', color: '#29b6f6', state: 'HITCHHIKING', lat: 46.61, lng: 8.02, phone: '+972502223344', bloodType: 'O−', vehicle: '', emergency: 'Yossi 052-888', links: '', ts: Date.now() - 120000 },
    { id: 'c', nickname: 'Cloud9', color: '#ab47bc', state: 'RETRIEVE', lat: 46.60, lng: 8.07, phone: '+972503334455', bloodType: 'B+', vehicle: 'Black Berlingo', emergency: '', links: '', ts: Date.now() - 600000 },
    { id: 'd', nickname: 'Featherfoot', color: '#7cb342', state: 'WALKING', lat: 46.625, lng: 8.03, phone: '+972504445566', bloodType: 'A−', vehicle: '', emergency: 'Noa 053-777', links: '', ts: Date.now() - 60000 },
    // Far away (~300km) — should be filtered out by the 50km radius.
    { id: 'e', nickname: 'FarAway', color: '#888', state: 'FLYING', lat: 48.8, lng: 9.2, phone: '+972505556677', ts: Date.now() - 30000 },
  ];
  roster.setAll([]);
  fakes.forEach(applyPilot);
  chat.add({ from: 'a', nick: 'Sky Pirate', color: '#ffd600', text: 'Climbing nicely over the ridge ☁️', ts: Date.now() - 90000 });
  chat.add({ from: 'b', nick: 'Ridge Runner', color: '#29b6f6', text: 'Landed at the LZ, anyone driving back?', ts: Date.now() - 30000 });
  document.getElementById('side-panel').classList.add('open');
  return 'demo loaded';
};

// ---------- Crash detection toggle ----------
const CRASH_PREF = 'thermals.crash';
$('crash-toggle')?.addEventListener('change', async (e) => {
  if (e.target.checked) {
    const res = await crash.arm();
    if (res === 'on') { localStorage.setItem(CRASH_PREF, '1'); toast('Crash detection on'); }
    else { e.target.checked = false; toast(res === 'denied' ? 'Motion access denied' : 'Not supported on this device'); }
  } else { crash.disarm(); localStorage.removeItem(CRASH_PREF); toast('Crash detection off'); }
});
if (localStorage.getItem(CRASH_PREF)) {
  const t = $('crash-toggle'); if (t) t.checked = true;
  // iOS needs a gesture to (re)grant motion access — arm on the first tap.
  const armOnce = async () => { document.removeEventListener('pointerdown', armOnce); await crash.arm(); };
  document.addEventListener('pointerdown', armOnce, { once: true });
}

// ---------- Offline simulator ----------
// Spawns fake pilots through the very same applyPilot() path the live room uses,
// so it exercises markers, trails, roster, distance filtering, SOS, etc.
const simPilots = new Map();
let simMoveTimer = null;
const SIM_NAMES = ['Hawk', 'Breeze', 'Zephyr', 'Comet', 'Maverick', 'Falcon', 'Nimbus', 'Vortex', 'Kestrel', 'Drift'];
const SIM_STATES = ['FLYING', 'WALKING', 'DRIVING', 'HITCHHIKING', 'BEER'];
const rnd = (a) => a[Math.floor(Math.random() * a.length)];

function simBase() { return geo.lastFix() || { lat: 46.62, lng: 8.04 }; }
function simSpawn() {
  const f = simBase();
  const id = 'sim-' + Math.random().toString(36).slice(2, 7);
  const p = {
    id, nickname: rnd(SIM_NAMES), color: rnd(COLORS), state: rnd(SIM_STATES),
    lat: f.lat + (Math.random() - 0.5) * 0.06, lng: f.lng + (Math.random() - 0.5) * 0.06,
    phone: '+97250' + Math.floor(1000000 + Math.random() * 8999999),
    bloodType: rnd(['O+', 'A+', 'B+', 'O−']), vehicle: 'Sim van', emergency: 'Sim contact', ts: Date.now(),
  };
  simPilots.set(id, p);
  applyPilot(p);
  toast(`Added ${p.nickname}`);
}
function simMoveTick() {
  simPilots.forEach((p) => {
    p.lat += (Math.random() - 0.5) * 0.004;
    p.lng += (Math.random() - 0.5) * 0.004;
    p.ts = Date.now();
    applyPilot(p);
  });
}
function simToggleMove(btn) {
  if (simMoveTimer) { clearInterval(simMoveTimer); simMoveTimer = null; btn.textContent = '▶️ Start everyone moving'; }
  else { simMoveTimer = setInterval(simMoveTick, 1500); btn.textContent = '⏸ Stop moving'; }
}
function simSOS() {
  const arr = [...simPilots.values()];
  if (!arr.length) return toast('Add a fake pilot first');
  const p = rnd(arr);
  p.sos = true; p.ts = Date.now();
  applyPilot(p);
  sos.alertBeep(); sos.vibrate([200, 100, 200]);
  mapMod.setPilotVisible(p.id, true);
  if (p.lng != null) mapMod.flyToPilot(p.lng, p.lat);
  toast(`🚨 ${p.nickname} needs help!`, 6000);
}
function simRetrieve() {
  const arr = [...simPilots.values()];
  if (!arr.length) return toast('Add a fake pilot first');
  const p = arr[0];
  p.state = 'RETRIEVE'; p.seats = 3; p.sos = false; p.ts = Date.now();
  applyPilot(p);
  toast(`${p.nickname} offering 3 seats`);
}
function simClear() {
  simPilots.forEach((_, id) => { roster.remove(id); mapMod.removePilot(id); });
  simPilots.clear();
  if (simMoveTimer) { clearInterval(simMoveTimer); simMoveTimer = null; }
  toast('Cleared fake pilots');
}
$('open-sim')?.addEventListener('click', () => { hideOverlay('overlay-profile'); showOverlay('overlay-sim'); });
$('sim-done')?.addEventListener('click', () => hideOverlay('overlay-sim'));
$('sim-spawn')?.addEventListener('click', simSpawn);
$('sim-move')?.addEventListener('click', (e) => simToggleMove(e.currentTarget));
$('sim-sos')?.addEventListener('click', simSOS);
$('sim-retrieve')?.addEventListener('click', simRetrieve);
$('sim-crash')?.addEventListener('click', () => { hideOverlay('overlay-sim'); crash.simulateImpact(); });
$('sim-clear')?.addEventListener('click', simClear);
