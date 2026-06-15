// Sky Club — Worker entry: WhatsApp sign-in + session tokens + DayRoom routing.
// ===========================================================================
//
// Routes
//   POST /auth/whatsapp  { phone }          → returns { token } for that number
//   GET  /room/:date     (Upgrade: ws)      → joins the day's DayRoom DO
//   GET  /room/:date/snapshot               → REST roster for first paint
//   POST /room/:date/profile                → upsert profile (also via WS)
//   GET  / | /healthz                        → liveness
//
// Secrets (wrangler secret put):
//   SESSION_HMAC_SECRET                       (any long random string)
//
// Sign-in: keyless and free — the pilot's WhatsApp number *is* their identity
// (and their contact link). The number is hashed (SHA-256, truncated) into a
// stable pilot id; the session token is `pilotId.exp.HMAC` — stateless, no DB.
//
// This is trust-based (no OTP), which suits a small known crew where every
// field is already shared. To add real ownership proof later, put a WhatsApp
// Business webhook in front of authWhatsApp — nothing else needs to change.

export { DayRoom } from './day-room.js';

const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
    if (pathname === '/' || pathname === '/healthz') return cors(text('Thermals OK'));

    try {
      if (pathname === '/auth/whatsapp' && request.method === 'POST') return cors(await authWhatsApp(request, env));

      const room = pathname.match(/^\/room\/(\d{4}-\d{2}-\d{2})(\/.*)?$/);
      if (room) return handleRoom(request, env, url, room[1], room[2] || '');
    } catch (err) {
      return cors(json({ error: err.message || 'error' }, 500));
    }
    return cors(json({ error: 'not found' }, 404));
  },
};

// ---------- WhatsApp sign-in ----------

async function authWhatsApp(request, env) {
  const { phone } = await request.json();
  if (!validPhone(phone)) return json({ error: 'Enter a valid WhatsApp number' }, 400);
  const pilotId = await pilotIdFor(phone);
  const token = await signToken(pilotId, env.SESSION_HMAC_SECRET);
  return json({ token, pilotId });
}

// ---------- Room routing ----------

async function handleRoom(request, env, url, date, sub) {
  // Token comes via ?token= (WebSocket can't set headers) or Authorization.
  const token = url.searchParams.get('token') ||
    (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const pilotId = await verifyToken(token, env.SESSION_HMAC_SECRET);
  if (!pilotId) return cors(json({ error: 'unauthorized' }, 401));

  // One DO instance per date; forward the request with the pilot id attached.
  const id = env.DAY_ROOM.idFromName(date);
  const stub = env.DAY_ROOM.get(id);
  const fwd = new Request(url, request);
  fwd.headers.set('X-Pilot-Id', pilotId);
  const res = await stub.fetch(fwd);
  // WebSocket responses (status 101) pass through untouched.
  return res.webSocket ? res : cors(res);
}

// ---------- Tokens (stateless HMAC) ----------

async function pilotIdFor(phone) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('thermals:' + phone));
  return [...new Uint8Array(buf)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function signToken(pilotId, secret) {
  const exp = Date.now() + TOKEN_TTL_MS;
  const body = `${pilotId}.${exp}`;
  return `${body}.${await hmac(secret, body)}`;
}

async function verifyToken(token, secret) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [pilotId, exp, sig] = parts;
  if (Number(exp) < Date.now()) return null;
  const good = await hmac(secret, `${pilotId}.${exp}`);
  return timingSafeEqual(good, sig) ? pilotId : null;
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

// ---------- helpers ----------

function validPhone(p) { return typeof p === 'string' && /^\+?[1-9]\d{6,15}$/.test(p.replace(/[\s-]/g, '')); }
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
}
function text(s, status = 200) { return new Response(s, { status, headers: { 'content-type': 'text/plain' } }); }
function cors(res) {
  const h = new Headers(res.headers);
  h.set('Access-Control-Allow-Origin', '*');
  h.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  h.set('Access-Control-Allow-Headers', 'content-type,authorization');
  return new Response(res.body, { status: res.status, headers: h });
}
