// app.js — Thermals bootstrap and orchestration.
//
// Onboarding gates, in order:
//   1. Location — the hard gate. No active share ⇒ you can't see the crew.
//   2. Sign-in  — phone + SMS code = identity (and your WhatsApp number).
//   3. Profile  — at least a nickname + colour before you appear on the map.
// Then we connect to today's room and the live map comes alive.

import { initTheme, toast, showOverlay, hideOverlay, esc, ago } from './modules/ui.js';
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
import * as xc from './modules/xc.js';
import * as elevation from './modules/elevation.js';

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
  const vario = vario2s(fix);
  myVario = vario;
  queryGround(fix);
  const agl = (fix.alt != null && myGround != null) ? fix.alt - myGround : null;
  recordFlight(fix);
  recordAlt(selfId || 'me', fix.alt, myGround);
  paintMe();
  if (connected) presence.sendPosition(
    { lat: fix.lat, lng: fix.lng, alt: fix.alt, heading: fix.heading, speed: fix.speed, vario, agl, xcKm: myXcKm },
    stateMod.getState(), stateMod.getSeats()
  );
  // Auto-switch flying / walking / driving from height (AGL) + speed.
  stateMod.applyAutoState({ speed: fix.speed, vrate: vario, agl });
  recomputeKing();
  updateCarBanner();
});

// Height above ground (AGL) needs the terrain elevation under me. Look it up
// from the DEM tiles, throttled to when I've moved or every 20s.
let myGround = null, lastGroundLL = null, lastGroundTs = 0;
async function queryGround(fix) {
  if (fix.alt == null) return;
  const now = Date.now();
  const moved = !lastGroundLL || (distKm(lastGroundLL, fix) ?? 9) > 0.1;
  if (!moved && now - lastGroundTs < 20000) return;
  lastGroundLL = { lat: fix.lat, lng: fix.lng }; lastGroundTs = now;
  const g = await elevation.groundElevation(fix.lat, fix.lng);
  if (g != null) myGround = g;
}

// Per-pilot altitude history for the flight-profile chart on the card.
const altHistory = new Map();   // id -> [{ ts, alt, ground }]
function recordAlt(id, alt, ground) {
  if (alt == null) return;
  let h = altHistory.get(id);
  if (!h) { h = []; altHistory.set(id, h); }
  const last = h[h.length - 1];
  if (last && Date.now() - last.ts < 2000) return;   // ~1 sample / 2s
  h.push({ ts: Date.now(), alt, ground: ground ?? null });
  if (h.length > 400) h.shift();
}

// ---------- King of the day: best 5-point air distance ----------
const myFlightPts = [];
let myXcKm = 0;
let kingId = null;
const MIN_KING_KM = 2;

// Log my position while flying, and rescore my best 5-point distance.
function recordFlight(fix) {
  if (stateMod.getState() !== 'FLYING' || fix.lat == null) return;
  const last = myFlightPts[myFlightPts.length - 1];
  if (last && Math.abs(last.lat - fix.lat) < 1e-5 && Math.abs(last.lng - fix.lng) < 1e-5) return;
  myFlightPts.push({ lat: fix.lat, lng: fix.lng });
  if (myFlightPts.length > 1200) myFlightPts.shift();
  myXcKm = xc.bestDistanceKm(myFlightPts);
}

// The pilot (me or anyone) with the highest score wears the crown — everyone
// computes the same winner from the broadcast scores.
function recomputeKing() {
  let best = MIN_KING_KM, id = null;
  for (const p of roster.all()) if ((p.xcKm || 0) > best) { best = p.xcKm; id = p.id; }
  const myId = selfId || 'me';
  if (myXcKm > best) { id = myId; }
  if (id !== kingId) {
    kingId = id;
    mapMod.setKing(kingId);
    mapMod.setMeKing(kingId === myId);
    roster.setKing(kingId);
  }
}

// Average climb/sink (m/s) over the last ~2 seconds of altitude samples — both
// the displayed vario and the signal that separates flight from level travel.
const altSamples = [];
function vario2s(fix) {
  if (fix.alt == null) return 0;
  altSamples.push({ ts: fix.ts, alt: fix.alt });
  const cutoff = fix.ts - 2500;
  while (altSamples.length > 1 && altSamples[0].ts < cutoff) altSamples.shift();
  const a = altSamples[0], b = altSamples[altSamples.length - 1];
  const dt = (b.ts - a.ts) / 1000;
  return dt > 0.3 ? (b.alt - a.alt) / dt : 0;
}

function startMapOnce() {
  if (mapStarted) return;
  mapStarted = true;
  const fix = geo.lastFix();
  const center = fix ? [fix.lng, fix.lat] : [8.0, 46.5];
  mapMod.initMap('map', center, (id) => roster.openCard(id));
  stateMod.renderSelector();
  keepAwake();
}

geo.start();

// Paint my own marker from the current fix + profile + state (+ seats + vario).
// When my SOS is active the icon becomes the distress glyph.
let myVario = 0;
function paintMe() {
  const fix = geo.lastFix();
  if (!fix || !mapStarted) return;
  const p = profile.getProfile();
  const glyphState = sosActive ? 'SOS' : stateMod.getState();
  mapMod.setMe(fix.lng, fix.lat, glyphState, p.color, p.nickname, stateMod.getSeats(), myVario);
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
  paintMe();                            // swap my icon to the distress glyph
  if (connected) presence.sendSOS(true);
  toast('🚨 SOS sent to everyone flying today', 4000);
}
function clearSos() {
  sosActive = false;
  sos.stopSiren();
  $('sos-btn')?.classList.remove('is-active');
  hideOverlay('sos-active');
  mapMod.setMeSOS(false);
  paintMe();                            // restore my normal state icon
  if (connected) presence.sendSOS(false);
  toast('SOS cleared');
}

$('sos-btn')?.addEventListener('click', () => (sosActive ? clearSos() : openSosCountdown()));
$('sos-cancel')?.addEventListener('click', cancelSosCountdown);
$('sos-now')?.addEventListener('click', activateSos);
$('sos-clear')?.addEventListener('click', clearSos);

// ---------- Free-seats picker ----------
// Reusable: pass the current count and what to do with the chosen number.
function openSeatsPicker(current, onPick) {
  const grid = $('seats-grid');
  if (!grid) return;
  grid.innerHTML = [0, 1, 2, 3, 4, 5, 6].map((n) =>
    `<button class="seat-opt${n === current ? ' is-on' : ''}" data-n="${n}">${n}</button>`).join('');
  grid.querySelectorAll('.seat-opt').forEach((b) => b.addEventListener('click', () => {
    hideOverlay('seats-picker');
    onPick(Number(b.dataset.n));
  }));
  showOverlay('seats-picker');
}
// Long-press Retrieve → set the seats I'm offering as the driver.
stateMod.setOnSeatsRequest(() => openSeatsPicker(stateMod.getSeats(), (n) => {
  stateMod.setState('RETRIEVE');
  stateMod.setSeats(n);
  toast(`Offering ${n} seat${n === 1 ? '' : 's'}`);
}));
$('seats-picker')?.addEventListener('click', (e) => { if (e.target.id === 'seats-picker') hideOverlay('seats-picker'); });

// ---------- Carpool: riders + drivers sharing a car ----------
// When you're moving alongside a Retrieve driver you're treated as being in
// their car, and anyone in that car can edit the free-seat count.
const CAR_DIST_KM = 0.08;   // within ~80 m = same car

function retrieveDrivers() {
  return roster.all().filter((p) => p.state === 'RETRIEVE' && p.lat != null)
    .map((p) => ({ id: p.id, nick: p.nickname, lat: p.lat, lng: p.lng, seats: p.seats || 0 }));
}

// Which car am I in? My own if I'm the Retrieve driver, else the nearest
// Retrieve driver I'm riding with.
function myCar() {
  const myState = stateMod.getState();
  if (myState === 'RETRIEVE') return { id: selfId || 'me', mine: true, nick: 'You' };
  if (['FLYING', 'BUS'].includes(myState)) return null;
  const fix = geo.lastFix();
  if (!fix) return null;
  let best = null, bestD = CAR_DIST_KM;
  for (const d of retrieveDrivers()) {
    const dist = distKm(fix, d);
    if (dist != null && dist < bestD) { bestD = dist; best = d; }
  }
  return best ? { id: best.id, mine: false, nick: best.nick } : null;
}

function carSeats(car) { return car.mine ? stateMod.getSeats() : (roster.get(car.id)?.seats || 0); }

function passengersAboard() {
  const fix = geo.lastFix();
  if (!fix) return 0;
  return roster.all().filter((p) => p.lat != null
    && ['DRIVING', 'HITCH_CAR', 'HITCHHIKING', 'WALKING'].includes(p.state)
    && (distKm(fix, p) ?? 9) < CAR_DIST_KM).length;
}

let currentCar = null;
function updateCarBanner() {
  const car = myCar();
  currentCar = car;
  const banner = $('car-banner');
  if (!banner) return;
  if (!car) { banner.classList.add('hidden'); return; }
  const seats = carSeats(car);
  const who = car.mine ? `Your car · ${passengersAboard()} aboard` : `In ${car.nick}'s car`;
  banner.querySelector('.car-banner-text').textContent = `🚗 ${who} · ${seats} seat${seats === 1 ? '' : 's'} free`;
  banner.classList.remove('hidden');
}

// Any car member can set the vehicle's free seats. The driver edits their own;
// a passenger updates the driver's count (locally + a carseats message).
function setCarSeats(car, n) {
  if (car.mine) { stateMod.setState('RETRIEVE'); stateMod.setSeats(n); }
  else {
    const d = roster.get(car.id);
    if (d) { d.seats = n; applyPilot(d); }
    if (connected) presence.sendCarSeats(car.id, n);
  }
  toast(`Car: ${n} seat${n === 1 ? '' : 's'} free`);
  updateCarBanner();
}

$('car-edit')?.addEventListener('click', () => {
  const car = currentCar || myCar();
  if (car) openSeatsPicker(carSeats(car), (n) => setCarSeats(car, n));
});

// ---------- Parked cars (static, shared spots) ----------
const SPOTS_KEY = 'thermals.spots';
const spots = new Map();
let carPhotoData = null;

function loadSpots() {
  try { JSON.parse(localStorage.getItem(SPOTS_KEY) || '[]').forEach((s) => { spots.set(s.id, s); mapMod.upsertSpot(s, openSpot); }); }
  catch { /* ignore */ }
}
function saveSpots() { localStorage.setItem(SPOTS_KEY, JSON.stringify([...spots.values()])); }

$('drop-car')?.addEventListener('click', () => {
  if (!geo.lastFix()) return toast('Waiting for your location…');
  carPhotoData = null;
  $('car-note').value = '';
  $('car-photo-preview').innerHTML = '';
  showOverlay('overlay-car');
});
$('car-cancel')?.addEventListener('click', () => hideOverlay('overlay-car'));
$('car-photo-btn')?.addEventListener('click', () => $('car-photo').click());
$('car-photo')?.addEventListener('change', async () => {
  const f = $('car-photo').files?.[0];
  $('car-photo').value = '';
  if (!f) return;
  try { carPhotoData = await chat.compressImage(f); $('car-photo-preview').innerHTML = `<img class="car-photo" src="${carPhotoData}">`; }
  catch (err) { console.warn('car photo failed', err); }
});
$('car-save')?.addEventListener('click', () => {
  const fix = geo.lastFix();
  if (!fix) return;
  const s = {
    id: 'spot-' + Math.random().toString(36).slice(2, 8),
    lat: fix.lat, lng: fix.lng, note: ($('car-note').value || '').slice(0, 300),
    photo: carPhotoData, by: selfId || 'me', byNick: profile.getProfile().nickname || 'You', ts: Date.now(),
  };
  spots.set(s.id, s); saveSpots(); mapMod.upsertSpot(s, openSpot);
  if (connected) presence.sendSpotAdd(s);
  hideOverlay('overlay-car');
  toast('Car parked & shared with the crew');
});

function openSpot(id) {
  const s = spots.get(id);
  if (!s) return;
  const mine = s.by === (selfId || 'me');
  const box = $('spot-box');
  box.innerHTML = `
    <div class="overlay-head"><h2>🚗 Parked car</h2><button class="ghost" data-act="close">Close</button></div>
    <div class="spot-view">
      ${s.photo ? `<img class="car-photo" src="${s.photo}">` : ''}
      <p class="spot-note">${s.note ? esc(s.note) : '<i>No note left</i>'}</p>
      <p class="field-note">Parked by ${esc(s.byNick)} · ${ago(s.ts)} ago</p>
      <div class="card-actions">
        <a class="btn" href="https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}" target="_blank" rel="noopener">Directions</a>
        <button class="btn btn-primary" data-act="take">I'll take it</button>
        ${mine ? '<button class="btn" data-act="remove">Remove</button>' : ''}
      </div>
    </div>`;
  box.querySelector('[data-act="close"]').onclick = () => hideOverlay('overlay-spot');
  box.querySelector('[data-act="take"]').onclick = () => {
    stateMod.setState('RETRIEVE');
    removeSpot(s.id, true);
    hideOverlay('overlay-spot');
    toast(`You picked up ${s.byNick}'s car — you're on retrieve now`);
  };
  box.querySelector('[data-act="remove"]')?.addEventListener('click', () => { removeSpot(s.id, true); hideOverlay('overlay-spot'); });
  showOverlay('overlay-spot');
}

function removeSpot(id, broadcast) {
  spots.delete(id); saveSpots(); mapMod.removeSpot(id);
  if (broadcast && connected) presence.sendSpotRemove(id);
}

loadSpots();

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
  roster.setBarogramProvider(barogramSVG);
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
  presence.on('spot', (s) => { if (!s?.id) return; spots.set(s.id, s); saveSpots(); mapMod.upsertSpot(s, openSpot); });
  presence.on('spotgone', (id) => removeSpot(id, false));
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
  if (!inRange(d)) { roster.remove(d.id); mapMod.removePilot(d.id); recomputeKing(); return; }
  recordAlt(d.id, d.alt, d.agl != null ? d.alt - d.agl : null);
  roster.upsert(d);
  if (!roster.isHidden(d.id)) mapMod.upsertPilot(d);
  recomputeKing();
  updateCarBanner();
}

// Side-on flight profile: the altitude trace (blue) over the ground (brown),
// from the start of the recorded track. Returns an SVG string for the card.
function barogramSVG(id) {
  const h = altHistory.get(id);
  if (!h || h.length < 3) return '';
  const W = 280, H = 96, pad = 6;
  const alts = h.map((p) => p.alt);
  const grounds = h.map((p) => p.ground).filter((g) => g != null);
  const lo = Math.min(...alts, ...(grounds.length ? grounds : alts));
  const hi = Math.max(...alts);
  const range = Math.max(1, hi - lo);
  const x = (i) => pad + (i / (h.length - 1)) * (W - 2 * pad);
  const y = (v) => pad + (1 - (v - lo) / range) * (H - 2 * pad);
  const altLine = h.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.alt).toFixed(1)}`).join(' ');
  let ground = '';
  if (grounds.length) {
    const g = h.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.ground ?? lo).toFixed(1)}`).join(' ');
    ground = `<path d="${g} L${x(h.length - 1).toFixed(1)} ${H - pad} L${x(0).toFixed(1)} ${H - pad} Z" fill="#6b5b4a" opacity="0.45"/>`;
  }
  return `<svg class="barogram" viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none">
    ${ground}
    <path d="${altLine}" fill="none" stroke="#29b6f6" stroke-width="2" stroke-linejoin="round"/>
  </svg>`;
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

// ---------- Stay alive while open ----------
// A PWA can't track with the screen off (only a native app can), but a screen
// wake lock keeps GPS + the live link running while the app is open — e.g.
// mounted on your harness in flight. Re-acquire it on resume, and reconnect the
// room socket if it dropped while backgrounded.
let wakeLock = null;
async function keepAwake() {
  try {
    if ('wakeLock' in navigator && document.visibilityState === 'visible' && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener?.('release', () => { wakeLock = null; });
    }
  } catch { /* unsupported or denied */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    keepAwake();
    if (connected) presence.reconnectIfClosed();
  } else {
    wakeLock = null;   // the browser releases it when hidden
  }
});

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
  roster.setBarogramProvider(barogramSVG);
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
// Plausible telemetry per state so the card/list have something to show.
function simTele(state) {
  if (state === 'FLYING') { const agl = 300 + Math.random() * 1200; return { alt: 900 + agl, agl, speed: 7 + Math.random() * 5, vario: (Math.random() - 0.4) * 4, heading: Math.random() * 360 }; }
  if (state === 'DRIVING') return { alt: 600, agl: 5, speed: 10 + Math.random() * 8, vario: 0, heading: Math.random() * 360 };
  return { alt: 600, agl: 2, speed: Math.random() * 1.2, vario: 0, heading: Math.random() * 360 };
}
function simSpawn() {
  const f = simBase();
  const id = 'sim-' + Math.random().toString(36).slice(2, 7);
  const state = rnd(SIM_STATES);
  const p = {
    id, nickname: rnd(SIM_NAMES), color: rnd(COLORS), state,
    lat: f.lat + (Math.random() - 0.5) * 0.06, lng: f.lng + (Math.random() - 0.5) * 0.06,
    phone: '+97250' + Math.floor(1000000 + Math.random() * 8999999),
    bloodType: rnd(['O+', 'A+', 'B+', 'O−']), vehicle: 'Sim van', emergency: 'Sim contact',
    ...simTele(state), xcKm: state === 'FLYING' ? 3 + Math.random() * 70 : 0, ts: Date.now(),
  };
  simPilots.set(id, p);
  applyPilot(p);
  toast(`Added ${p.nickname}`);
}
function simMoveTick() {
  simPilots.forEach((p) => {
    p.lat += (Math.random() - 0.5) * 0.004;
    p.lng += (Math.random() - 0.5) * 0.004;
    if (p.state === 'FLYING') {
      p.vario = (Math.random() - 0.4) * 4;
      p.alt = Math.max(300, (p.alt || 1200) + p.vario * 1.5);
      p.agl = Math.max(20, (p.agl ?? 600) + p.vario * 1.5);
      p.heading = ((p.heading || 0) + (Math.random() - 0.5) * 40 + 360) % 360;
    }
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
$('sim-van')?.addEventListener('click', () => {
  const f = simBase();
  const id = 'sim-van-' + Math.random().toString(36).slice(2, 6);
  const p = { id, nickname: 'Retrieve ' + rnd(SIM_NAMES), color: '#ab47bc', state: 'RETRIEVE',
    lat: f.lat + 0.0002, lng: f.lng + 0.0002, seats: 3, phone: '+972509998877',
    bloodType: 'O+', vehicle: 'Sim van', ts: Date.now() };
  simPilots.set(id, p);
  applyPilot(p);
  hideOverlay('overlay-sim');
  toast('Retrieve van parked next to you — check the car banner');
});
$('sim-crash')?.addEventListener('click', () => { hideOverlay('overlay-sim'); crash.simulateImpact(); });
$('sim-clear')?.addEventListener('click', simClear);
