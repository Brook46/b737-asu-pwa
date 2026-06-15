// app.js — Thermals bootstrap and orchestration.
//
// Onboarding gates, in order:
//   1. Location — the hard gate. No active share ⇒ you can't see the crew.
//   2. Sign-in  — phone + SMS code = identity (and your WhatsApp number).
//   3. Profile  — at least a nickname + colour before you appear on the map.
// Then we connect to today's room and the live map comes alive.

import { initTheme, toast, showOverlay, hideOverlay } from './modules/ui.js';
import * as geo from './modules/geo.js';
import * as mapMod from './modules/map.js';
import * as profile from './modules/profile.js';
import * as stateMod from './modules/state.js';
import * as auth from './modules/auth.js';
import * as presence from './modules/presence.js';
import * as roster from './modules/roster.js';
import * as chat from './modules/chat.js';
import * as sos from './modules/sos.js';

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
  const p = profile.getProfile();
  mapMod.setMe(fix.lng, fix.lat, stateMod.getState(), p.color, p.nickname);
  if (connected) presence.sendPosition(
    { lat: fix.lat, lng: fix.lng, alt: fix.alt, heading: fix.heading, speed: fix.speed },
    stateMod.getState()
  );
  // Auto-switch FLYING ⇄ WALKING from motion (manual vehicle states stand).
  stateMod.applyAutoState(fix);
});

function startMapOnce() {
  if (mapStarted) return;
  mapStarted = true;
  const fix = geo.lastFix();
  const center = fix ? [fix.lng, fix.lat] : [8.0, 46.5];
  mapMod.initMap('map', center, (id) => roster.openCard(id));
  stateMod.renderSelector();
}

geo.start();

// ---------- State selector ----------
stateMod.onState((s) => {
  const fix = geo.lastFix();
  const p = profile.getProfile();
  if (fix) mapMod.setMe(fix.lng, fix.lat, s, p.color, p.nickname);
  if (connected) presence.sendState(s);
});

// ---------- SOS ----------
// Press SOS → a 10-second countdown you can cancel. On activate: local siren +
// vibrate, and we broadcast distress + our location to everyone in today's room.
let sosCountTimer = null;
let sosCount = 0;
let sosActive = false;

function openSosCountdown() {
  if (sosActive) return;
  sosCount = 10;
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

// ---------- Profile ----------
profile.renderEditor();
profile.onProfile((p) => {
  const fix = geo.lastFix();
  if (fix && mapStarted) mapMod.setMe(fix.lng, fix.lat, stateMod.getState(), p.color, p.nickname);
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
  chat.init({ onSendMessage: (t) => presence.sendChat(t), selfId });

  presence.on('status', (s) => {
    $('conn-dot')?.setAttribute('data-status', s);
  });
  presence.on('self', (id) => { selfId = id; chat.setSelfId(id); });
  presence.on('roster', (list) => roster.setAll(list.filter((p) => !isMe(p)).map(decorate)));
  presence.on('upsert', (p) => {
    if (isMe(p)) return;            // don't double-draw myself
    const d = decorate(p);
    roster.upsert(d);
    if (!roster.isHidden(d.id)) mapMod.upsertPilot(d);
  });
  presence.on('remove', (id) => { roster.remove(id); mapMod.removePilot(id); });
  presence.on('chat', (m) => chat.add(m));
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

  presence.setToken(auth.getToken());
  presence.connect();

  // Push our identity + first position immediately.
  presence.sendProfile(profile.getProfile());
  const fix = geo.lastFix();
  if (fix) presence.sendPosition({ lat: fix.lat, lng: fix.lng, alt: fix.alt, heading: fix.heading, speed: fix.speed }, stateMod.getState());
}

function decorate(p) { return { ...p }; }
function isMe(p) { return selfId && p.id === selfId; }

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
$('panel-toggle')?.addEventListener('click', () => {
  $('side-panel')?.classList.toggle('open');
});
$('recenter')?.addEventListener('click', () => mapMod.recenterMe());

// Kick off the onboarding check (location callback will re-drive it).
maybeAdvanceOnboarding();

// Dev seam: simulate a GPS fix for local testing without real location
// (e.g. headless preview). Harmless in production; only fires when called.
window.thermalsSimulate = (lat = 46.62, lng = 8.04, speed = 0) => {
  hideOverlay('gate-location');
  geo._injectFix({ lat, lng, speed });
};

// Dev seam: populate the roster, map, and chat with fake pilots exactly as the
// DayRoom would, to verify the crew panel / cards / chat UI without a backend.
window.thermalsDemo = () => {
  roster.init({
    onVisibility: (id, vis) => mapMod.setPilotVisible(id, vis),
    onFocusPilot: (lng, lat) => mapMod.flyToPilot(lng, lat),
  });
  chat.init({ onSendMessage: (t) => chat.add({ from: 'me', nick: 'You', color: '#ff5252', text: t, ts: Date.now() }), selfId: 'me' });
  const fakes = [
    { id: 'a', nickname: 'Sky Pirate', color: '#ffd600', state: 'FLYING', lat: 46.63, lng: 8.05, phone: '+972501112233', bloodType: 'A+', vehicle: 'White Transporter · 123-45', emergency: 'Dana 050-999', links: 'https://xcontest.org/skypirate', ts: Date.now() },
    { id: 'b', nickname: 'Ridge Runner', color: '#29b6f6', state: 'HITCHHIKING', lat: 46.61, lng: 8.02, phone: '+972502223344', bloodType: 'O−', vehicle: '', emergency: 'Yossi 052-888', links: '', ts: Date.now() - 120000 },
    { id: 'c', nickname: 'Cloud9', color: '#ab47bc', state: 'RETRIEVE', lat: 46.60, lng: 8.07, phone: '+972503334455', bloodType: 'B+', vehicle: 'Black Berlingo', emergency: '', links: '', ts: Date.now() - 600000 },
    { id: 'd', nickname: 'Featherfoot', color: '#7cb342', state: 'WALKING', lat: 46.625, lng: 8.03, phone: '+972504445566', bloodType: 'A−', vehicle: '', emergency: 'Noa 053-777', links: '', ts: Date.now() - 60000 },
  ];
  roster.setAll(fakes);
  fakes.forEach((p) => mapMod.upsertPilot(p));
  chat.add({ from: 'a', nick: 'Sky Pirate', color: '#ffd600', text: 'Climbing nicely over the ridge ☁️', ts: Date.now() - 90000 });
  chat.add({ from: 'b', nick: 'Ridge Runner', color: '#29b6f6', text: 'Landed at the LZ, anyone driving back?', ts: Date.now() - 30000 });
  document.getElementById('side-panel').classList.add('open');
  return 'demo loaded';
};
