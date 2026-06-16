// DayRoom — one Durable Object instance per calendar day.
// =======================================================
//
// Holds the live roster of pilots flying that day, each pilot's last
// location/state/profile, and a short rolling chat log. Uses the WebSocket
// **Hibernation API** (acceptWebSocket / webSocketMessage) so an idle room is
// evicted from memory and costs nothing until the next message arrives.
//
// Inbound WS messages (from a pilot): { t: 'profile'|'loc'|'state'|'chat', … }
// Outbound (broadcast):               { t: 'roster'|'upsert'|'remove'|'chat'|'chatlog', … }
//
// Persistence: pilots + chat live in DO storage so they survive hibernation.
// Each socket is tagged with its pilotId via serializeAttachment.

const CHAT_MAX = 200;
const STALE_MS = 1000 * 60 * 60 * 18; // drop pilots not seen in 18h

export class DayRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.pilots = null; // Map<id, pilot> — lazily hydrated
    this.chat = null;   // Array<msg>
  }

  async hydrate() {
    if (this.pilots) return;
    this.pilots = new Map(Object.entries((await this.state.storage.get('pilots')) || {}));
    this.chat = (await this.state.storage.get('chat')) || [];
    this.spots = new Map(Object.entries((await this.state.storage.get('spots')) || {}));
  }

  async fetch(request) {
    await this.hydrate();
    const url = new URL(request.url);
    const pilotId = request.headers.get('X-Pilot-Id');

    if (url.pathname.endsWith('/snapshot')) {
      return json({ pilots: [...this.pilots.values()] });
    }

    if (request.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      // Hibernatable accept; tag the socket so we know who it is on wake.
      this.state.acceptWebSocket(server);
      server.serializeAttachment({ pilotId });
      // Tell the joiner its own id, then the current roster + recent chat.
      server.send(JSON.stringify({ t: 'self', id: pilotId }));
      server.send(JSON.stringify({ t: 'roster', pilots: [...this.pilots.values()] }));
      if (this.spots.size) server.send(JSON.stringify({ t: 'spots', spots: [...this.spots.values()] }));
      if (this.chat.length) server.send(JSON.stringify({ t: 'chatlog', log: this.chat }));
      return new Response(null, { status: 101, webSocket: client });
    }

    return json({ error: 'expected websocket' }, 400);
  }

  async webSocketMessage(ws, raw) {
    await this.hydrate();
    const { pilotId } = ws.deserializeAttachment() || {};
    if (!pilotId) return;
    let msg; try { msg = JSON.parse(raw); } catch { return; }

    const p = this.pilots.get(pilotId) || { id: pilotId };

    switch (msg.t) {
      case 'profile':
        Object.assign(p, sanitizeProfile(msg.profile));
        p.id = pilotId; p.ts = Date.now();
        this.pilots.set(pilotId, p);
        await this.persistPilots();
        this.broadcast({ t: 'upsert', pilot: p });
        break;

      case 'loc': {
        const loc = msg.loc || {};
        p.lat = num(loc.lat); p.lng = num(loc.lng);
        p.alt = num(loc.alt); p.heading = num(loc.heading); p.speed = num(loc.speed);
        p.vario = num(loc.vario);
        if (loc.agl != null) p.agl = num(loc.agl);
        if (loc.xcKm != null) p.xcKm = num(loc.xcKm);
        if (msg.state) p.state = String(msg.state).slice(0, 16);
        if (msg.seats != null) p.seats = Math.min(8, Math.max(0, msg.seats | 0));
        p.ts = Date.now();
        this.pilots.set(pilotId, p);
        await this.persistPilots();
        this.broadcast({ t: 'upsert', pilot: p });
        break;
      }

      case 'state':
        p.state = String(msg.state || 'WALKING').slice(0, 16);
        if (msg.seats != null) p.seats = Math.min(8, Math.max(0, msg.seats | 0));
        p.ts = Date.now();
        this.pilots.set(pilotId, p);
        await this.persistPilots();
        this.broadcast({ t: 'upsert', pilot: p });
        break;

      case 'chat': {
        const text = String(msg.text || '').slice(0, 500).trim();
        const media = sanitizeMedia(msg.media);
        if (!text && !media) break;
        const base = { from: pilotId, nick: p.nickname || 'Pilot', color: p.color || '#9ab', ts: Date.now() };
        // Broadcast the full message (with media) to everyone live…
        this.broadcast({ t: 'chat', msg: { ...base, text, media } });
        // …but only persist a lightweight, text-only copy for late joiners so
        // the room's stored history can't balloon with base64 media.
        this.chat.push({ ...base, text: text || (media ? `[${media.type}]` : '') });
        if (this.chat.length > CHAT_MAX) this.chat.shift();
        await this.state.storage.put('chat', this.chat);
        break;
      }

      case 'carseats': {
        const driver = this.pilots.get(String(msg.driverId));
        // Only someone actually next to the driver (in the car) may edit seats.
        if (!driver || !nearby(p, driver, 0.12)) break;
        driver.seats = Math.min(8, Math.max(0, msg.seats | 0));
        driver.ts = Date.now();
        this.pilots.set(driver.id, driver);
        await this.persistPilots();
        this.broadcast({ t: 'upsert', pilot: driver });
        break;
      }

      case 'spot': {
        const s = msg.spot || {};
        if (s.id == null || s.lat == null) break;
        const clean = {
          id: String(s.id).slice(0, 40), lat: num(s.lat), lng: num(s.lng),
          note: String(s.note || '').slice(0, 300),
          photo: (typeof s.photo === 'string' && s.photo.startsWith('data:image/') && s.photo.length < 600000) ? s.photo : null,
          by: pilotId, byNick: String(s.byNick || p.nickname || 'Pilot').slice(0, 24), ts: Date.now(),
        };
        this.spots.set(clean.id, clean);
        await this.state.storage.put('spots', Object.fromEntries(this.spots));
        this.broadcast({ t: 'spot', spot: clean });
        break;
      }

      case 'spotgone': {
        const id = String(msg.id || '');
        const s = this.spots.get(id);
        if (s && (s.by === pilotId)) {            // only the owner removes it
          this.spots.delete(id);
          await this.state.storage.put('spots', Object.fromEntries(this.spots));
          this.broadcast({ t: 'spotgone', id });
        }
        break;
      }

      case 'sos': {
        p.sos = !!msg.active;
        p.ts = Date.now();
        this.pilots.set(pilotId, p);
        await this.persistPilots();
        // A dedicated distress event (drives the siren/alert on every client),
        // plus an upsert so the roster + marker reflect the flag.
        this.broadcast({ t: 'sos', id: pilotId, active: p.sos, nick: p.nickname || 'Pilot', color: p.color || '#ff5252', lat: p.lat, lng: p.lng });
        this.broadcast({ t: 'upsert', pilot: p });
        break;
      }
    }
  }

  async webSocketClose(ws) {
    await this.hydrate();
    const { pilotId } = ws.deserializeAttachment() || {};
    if (!pilotId) return;
    // Only fully remove if this pilot has no other open sockets (multi-tab).
    const stillHere = this.state.getWebSockets().some(
      (s) => s !== ws && (s.deserializeAttachment() || {}).pilotId === pilotId);
    if (!stillHere) {
      // Mark offline but keep the profile for the day; broadcast departure.
      this.broadcast({ t: 'remove', id: pilotId });
    }
  }

  async webSocketError(ws) { try { ws.close(); } catch {} }

  broadcast(obj) {
    const data = JSON.stringify(obj);
    for (const s of this.state.getWebSockets()) {
      try { s.send(data); } catch {}
    }
  }

  async persistPilots() {
    // Prune stale pilots opportunistically so the day's room stays tidy.
    const cutoff = Date.now() - STALE_MS;
    for (const [id, pl] of this.pilots) if ((pl.ts || 0) < cutoff) this.pilots.delete(id);
    await this.state.storage.put('pilots', Object.fromEntries(this.pilots));
  }
}

function sanitizeProfile(p = {}) {
  const s = (v, n) => String(v ?? '').slice(0, n);
  return {
    nickname: s(p.nickname, 24),
    color: /^#[0-9a-f]{3,8}$/i.test(p.color || '') ? p.color : '#26a69a',
    phone: s(p.phone, 24),
    bloodType: s(p.bloodType, 4),
    vehicle: s(p.vehicle, 80),
    emergency: s(p.emergency, 80),
    links: s(p.links, 300),
  };
}
function num(v) { return v == null || Number.isNaN(Number(v)) ? null : Number(v); }

// True when two pilots are within `km` of each other (haversine).
function nearby(a, b, km) {
  if (a?.lat == null || b?.lat == null) return false;
  const R = 6371, toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s)) <= km;
}

// Accept only small inline image/audio data URLs (≈1MB cap after base64).
function sanitizeMedia(m) {
  if (!m || typeof m.data !== 'string') return null;
  const okType = m.type === 'image' || m.type === 'audio';
  const okData = m.data.startsWith(`data:${m.type === 'image' ? 'image/' : 'audio/'}`);
  if (!okType || !okData || m.data.length > 1_400_000) return null;
  return { type: m.type, data: m.data };
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
}
