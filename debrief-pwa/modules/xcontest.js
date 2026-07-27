// xcontest.js — import flights from XContest by date and country.
//
// ⚠️ UNVERIFIED AGAINST THE LIVE API. Read this before trusting it.
//
// XContest has no open API. Their robots.txt disallows the flight-search and
// track-download paths, /api/data/ rejects external callers, and the flight
// list is rendered client-side — so scraping is both forbidden and brittle,
// and this module does not attempt it.
//
// What exists is XContest's partner API on api.xcontest.org, which requires a
// key. The host answers (nginx), but the request and response contracts are not
// publicly documented, so the mapping below is written defensively rather than
// against a spec I could test:
//
//   • SEARCH_PATHS lists candidate endpoints; the first that returns JSON wins.
//   • readFlights() accepts any of the common envelope shapes.
//   • readFlight() looks for a pilot name, distance and IGC link under the
//     field names these APIs conventionally use.
//
// When you have a key and their docs, expect to adjust exactly two things:
// SEARCH_PATHS and readFlight(). Everything else — the UI, the proxy, the
// import pipeline — is already exercised and does not care about the shape.
//
// The key is stored on this device only (same pattern as the OpenAIP and Windy
// keys in Sky Monkeys) and is forwarded per request by the Worker, never stored
// server-side.

import { pref, setPref } from './store.js';

/** The suite's existing Cloudflare Worker; see flight-card-pwa/cloudflare-worker/. */
const WORKER_BASE = 'https://b737-asu-pwa.alonbrookstein.workers.dev';

/** Candidate search endpoints, tried in order until one returns JSON. */
const SEARCH_PATHS = [
  (q) => `/api/flights?date=${q.date}&country=${q.country}&limit=${q.limit}`,
  (q) => `/v1/flights?date=${q.date}&country=${q.country}&limit=${q.limit}`,
  (q) => `/flights?date=${q.date}&country=${q.country}&limit=${q.limit}`,
];

const TIMEOUT_MS = 15000;

// ── key handling ────────────────────────────────────────────────────────────

export const getKey = () => pref('xcKey', '');
export const setKey = (k) => setPref('xcKey', (k || '').trim());
export const hasKey = () => !!getKey();

// ── search ──────────────────────────────────────────────────────────────────

/**
 * @param {{date:string, country:string, limit?:number}} query
 *        date is ISO `YYYY-MM-DD`; country is an ISO-3166 alpha-2 code.
 * @returns {Promise<{flights:Array, endpoint:string}>}
 * @throws {Error} with a message meant to be shown to the pilot
 */
export async function searchFlights(query) {
  const key = getKey();
  if (!key) throw new Error('Add your XContest API key first.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(query.date || '')) throw new Error('Pick a date.');

  const q = { date: query.date, country: query.country || '', limit: query.limit || 50 };
  const errors = [];

  for (const build of SEARCH_PATHS) {
    const path = build(q);
    let res, body;
    try {
      res = await request(`${WORKER_BASE}/xc?path=${encodeURIComponent(path)}`, key);
      body = await res.text();
    } catch (err) {
      errors.push(`${path}: ${err.message}`);
      continue;
    }

    if (res.status === 401 || res.status === 403) {
      throw new Error('XContest rejected the key (401/403). Check it is valid and has flight-search access.');
    }
    if (!res.ok) { errors.push(`${path}: HTTP ${res.status}`); continue; }

    let json;
    try { json = JSON.parse(body); } catch { errors.push(`${path}: not JSON`); continue; }

    const flights = readFlights(json);
    if (flights) return { flights, endpoint: path };
    errors.push(`${path}: no recognisable flight list`);
  }

  throw new Error(
    `No XContest endpoint answered with a flight list. Tried ${SEARCH_PATHS.length} paths — ` +
    `adjust SEARCH_PATHS/readFlight in modules/xcontest.js to match your API docs. (${errors[0] || 'no detail'})`);
}

function request(url, key) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  return fetch(url, { headers: { 'x-xc-key': key }, signal: ctrl.signal })
    .finally(() => clearTimeout(timer));
}

/** Pull the flight array out of whichever envelope the API uses. */
function readFlights(json) {
  const candidates = [json, json.data, json.items, json.flights, json.results,
    json.data && json.data.flights, json.data && json.data.items];
  for (const c of candidates) {
    if (Array.isArray(c) && c.length) return c.map(readFlight).filter(Boolean);
    if (Array.isArray(c)) return [];        // a real, empty result
  }
  return null;
}

/**
 * Normalise one flight record. Tolerant by design — see the header note.
 * @returns {{id:string, pilotName:string, date:string, km:number,
 *            glider:string, site:string, igcUrl:string, pageUrl:string}|null}
 */
function readFlight(f) {
  if (!f || typeof f !== 'object') return null;
  const pick = (...keys) => {
    for (const k of keys) {
      const v = k.split('.').reduce((o, part) => (o == null ? o : o[part]), f);
      if (v !== undefined && v !== null && v !== '') return v;
    }
    return undefined;
  };

  const igcUrl = pick('igcUrl', 'igc', 'trackUrl', 'links.igc', 'links.track', '_links.igc');
  const pilotName = pick('pilotName', 'pilot.name', 'pilot.fullName', 'pilot', 'user.name', 'username');

  return {
    id: String(pick('id', 'flightId', 'uid', 'guid') ?? Math.random().toString(36).slice(2)),
    pilotName: typeof pilotName === 'string' ? pilotName : String(pilotName ?? 'Pilot'),
    date: String(pick('date', 'flightDate', 'takeoffTime', 'start') ?? '').slice(0, 10),
    km: Number(pick('distance', 'km', 'distanceKm', 'scoring.distance')) || 0,
    points: Number(pick('points', 'score', 'scoring.points')) || 0,
    glider: String(pick('glider', 'gliderName', 'wing', 'glider.name') ?? ''),
    site: String(pick('site', 'takeoff', 'launch', 'takeoff.name', 'site.name') ?? ''),
    igcUrl: typeof igcUrl === 'string' ? igcUrl : '',
    pageUrl: String(pick('url', 'link', 'detailUrl', 'links.self') ?? ''),
  };
}

// ── download ────────────────────────────────────────────────────────────────

/**
 * Fetch one flight's IGC text through the Worker (which host-locks the URL and
 * verifies it really is an IGC before returning it).
 * @param {{igcUrl:string, pilotName:string}} flight
 * @returns {Promise<string>} raw IGC
 */
export async function fetchIgc(flight) {
  if (!flight || !flight.igcUrl) {
    throw new Error(`No IGC link for ${flight ? flight.pilotName : 'that flight'} — the pilot may not have made the track public.`);
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${WORKER_BASE}/xcigc?url=${encodeURIComponent(flight.igcUrl)}`, { signal: ctrl.signal });
    const body = await res.text();
    if (!res.ok) throw new Error(body.slice(0, 140) || `HTTP ${res.status}`);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

/** Is the proxy reachable at all? Used to give a precise error, not a guess. */
export async function checkProxy() {
  try {
    const res = await fetch(`${WORKER_BASE}/healthz`);
    return res.ok;
  } catch {
    return false;
  }
}

// ── countries ───────────────────────────────────────────────────────────────

/** The flying countries worth putting at the top of a picker, then the rest. */
export const COUNTRIES = [
  { code: '', name: 'Any country' },
  { code: 'IL', name: 'Israel' },
  { code: 'IT', name: 'Italy' },
  { code: 'FR', name: 'France' },
  { code: 'ES', name: 'Spain' },
  { code: 'CH', name: 'Switzerland' },
  { code: 'AT', name: 'Austria' },
  { code: 'DE', name: 'Germany' },
  { code: 'SI', name: 'Slovenia' },
  { code: 'TR', name: 'Turkey' },
  { code: 'GR', name: 'Greece' },
  { code: 'PT', name: 'Portugal' },
  { code: 'BR', name: 'Brazil' },
  { code: 'ZA', name: 'South Africa' },
  { code: 'US', name: 'United States' },
  { code: 'CO', name: 'Colombia' },
  { code: 'MX', name: 'Mexico' },
  { code: 'IN', name: 'India' },
  { code: 'NP', name: 'Nepal' },
  { code: 'AU', name: 'Australia' },
  { code: 'NZ', name: 'New Zealand' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'PL', name: 'Poland' },
  { code: 'CZ', name: 'Czechia' },
  { code: 'RS', name: 'Serbia' },
  { code: 'BG', name: 'Bulgaria' },
  { code: 'MA', name: 'Morocco' },
];
