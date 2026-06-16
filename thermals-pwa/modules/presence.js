// presence.js — WebSocket client to the DayRoom Durable Object.
//
// Responsibilities:
//   • connect to wss://…/room/:date with our session token
//   • send our location/state/profile (throttled) as they change
//   • receive the roster + diffs and surface them to subscribers
//   • auto-reconnect with backoff, and roll to the next day's room at midnight
//
// Messages (both directions) are JSON: { t: 'type', ... }.

import { wsBase, todayKey, LOCATION_THROTTLE_MS } from '../config.js';

let ws = null;
let token = null;
let roomDate = todayKey();
let backoff = 1000;
let lastSent = 0;
let pending = null;           // latest unsent {loc,state} payload
let throttleT = null;
let dayTimer = null;
let closedByUs = false;

const handlers = {
  self:   new Set(),   // (pilotId) => void       my own id, sent on join
  roster: new Set(),   // (pilotsArray) => void   full snapshot on join
  upsert: new Set(),   // (pilot) => void         one pilot changed
  remove: new Set(),   // (pilotId) => void       one pilot left
  chat:   new Set(),   // (message) => void
  sos:    new Set(),   // ({id,active,nick,color,lat,lng}) => void
  status: new Set(),   // ('open'|'closed'|'connecting') => void
};
export function on(type, fn) { handlers[type]?.add(fn); return () => handlers[type]?.delete(fn); }
function emit(type, arg) { handlers[type]?.forEach((fn) => fn(arg)); }

export function setToken(t) { token = t; }

export function connect() {
  if (!token) { console.warn('presence: no token yet'); return; }
  closedByUs = false;
  roomDate = todayKey();
  emit('status', 'connecting');
  const url = `${wsBase()}/room/${roomDate}?token=${encodeURIComponent(token)}`;
  ws = new WebSocket(url);

  ws.onopen = () => {
    backoff = 1000;
    emit('status', 'open');
    scheduleDayRollover();
  };
  ws.onmessage = (ev) => {
    let msg; try { msg = JSON.parse(ev.data); } catch { return; }
    switch (msg.t) {
      case 'self':   emit('self', msg.id); break;
      case 'roster': emit('roster', msg.pilots || []); break;
      case 'upsert': emit('upsert', msg.pilot); break;
      case 'remove': emit('remove', msg.id); break;
      case 'chat':   emit('chat', msg.msg); break;
      case 'chatlog': (msg.log || []).forEach((m) => emit('chat', m)); break;
      case 'sos':    emit('sos', msg); break;
    }
  };
  ws.onclose = () => {
    emit('status', 'closed');
    if (closedByUs) return;
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 15000);
  };
  ws.onerror = () => { try { ws.close(); } catch {} };
}

export function disconnect() {
  closedByUs = true;
  if (dayTimer) clearTimeout(dayTimer);
  if (ws) { try { ws.close(); } catch {} ws = null; }
}

function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

// Push our profile (called on join + whenever the profile changes).
export function sendProfile(profile) { send({ t: 'profile', profile }); }

// Push our location + state (+ free seats). Throttled so we don't spam the room
// while the GPS fires every second; the most recent sample always wins.
export function sendPosition(loc, state, seats) {
  pending = { t: 'loc', loc, state, seats };
  const now = Date.now();
  const wait = Math.max(0, LOCATION_THROTTLE_MS - (now - lastSent));
  if (wait === 0) flushPosition();
  else if (!throttleT) throttleT = setTimeout(flushPosition, wait);
}
function flushPosition() {
  throttleT = null;
  if (!pending) return;
  send(pending);
  pending = null;
  lastSent = Date.now();
}

// State changes are worth sending immediately (not throttled).
export function sendState(state, seats) { send({ t: 'state', state, seats }); }

export function sendChat(text, media) { send({ t: 'chat', text, media }); }

// Raise or clear an SOS. Broadcast to everyone in today's room immediately.
export function sendSOS(active) { send({ t: 'sos', active: !!active }); }

// Update the free seats on a car I'm riding in (the driver's record).
export function sendCarSeats(driverId, seats) { send({ t: 'carseats', driverId, seats }); }

// Reconnect into the new day's room shortly after local midnight.
function scheduleDayRollover() {
  if (dayTimer) clearTimeout(dayTimer);
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 30);
  dayTimer = setTimeout(() => { if (ws) ws.close(); /* onclose → reconnect → new todayKey */ },
    midnight - now);
}
