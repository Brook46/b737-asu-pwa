// config.js — shared, environment-level constants for Thermals.
//
// Nothing secret lives here (this file ships to the browser). API keys that
// are safe to expose client-side (map tiles) live here; everything sensitive
// (Twilio, HMAC secret) lives in the Cloudflare Worker as a `wrangler secret`.

// Base URL of the Cloudflare Worker that fronts the DayRoom Durable Object and
// the SMS verify endpoints. Override per-deploy. During `wrangler dev` this is
// typically http://localhost:8787.
export const API_BASE =
  localStorage.getItem('thermals.apiBase') ||
  'https://thermals.YOUR-SUBDOMAIN.workers.dev';

// WebSocket origin derived from API_BASE (http→ws, https→wss).
export function wsBase() {
  return API_BASE.replace(/^http/, 'ws');
}

// Map tiles. MapTiler gives the cleanest 3D-friendly basemap; its free tier is
// plenty for a flying crew. Drop a key here (or in localStorage 'thermals.maptilerKey')
// to use it. With no key we fall back to keyless OpenFreeMap vector tiles.
export const MAPTILER_KEY =
  localStorage.getItem('thermals.maptilerKey') || '';

// Terrain: AWS Terrarium-encoded elevation tiles — free, no key required.
export const TERRAIN_TILES =
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

// How often we push our own position to the room while it's changing.
export const LOCATION_THROTTLE_MS = 4000;

// Pilot state machine — the single source of truth for "what am I doing now".
export const STATES = {
  FLYING:      { id: 'FLYING',      label: 'Flying',        glyph: 'paraglider' },
  WALKING:     { id: 'WALKING',     label: 'On the ground', glyph: 'walk' },
  RETRIEVE:    { id: 'RETRIEVE',    label: 'Retrieve',      glyph: 'retrieve' },
  BUS:         { id: 'BUS',         label: 'On the bus',    glyph: 'bus' },
  HITCHHIKING: { id: 'HITCHHIKING', label: 'Need a ride',   glyph: 'thumb' },
  // Auto-only states (no manual button):
  DRIVING:     { id: 'DRIVING',     label: 'Driving',       glyph: 'car' },       // auto when >20 km/h on the ground
  HITCH_CAR:   { id: 'HITCH_CAR',   label: 'Got a ride',    glyph: 'hitchcar' },  // hitch-hiker who got picked up
  BEER:        { id: 'BEER',        label: 'Grabbing a beer', glyph: 'beer' },    // landed & still a while
};

// Buttons shown in the manual selector. Flying is now fully automatic (entered
// and left by height), so it's NOT a button — you can't change it by hand. The
// car / got-a-ride / beer states are auto-only too.
export const STATE_ORDER = ['WALKING', 'RETRIEVE', 'BUS', 'HITCHHIKING'];

// States the motion logic is allowed to switch between. Retrieve / bus stay put.
export const AUTO_STATES = ['FLYING', 'WALKING', 'DRIVING', 'BEER', 'HITCHHIKING', 'HITCH_CAR'];

// Flying is decided by height above ground (AGL):
export const FLY_AGL_M = 5;           // above this = airborne
export const FLY_CONFIRM_MS = 5000;   // …for 5 s → flying
export const LAND_AGL_M = 2;          // ~ground level
export const LAND_CONFIRM_MS = 60000; // ground + under 20 km/h for 1 min → landed

// Beer comes after you've sat still: 5 min if you haven't moved since opening
// the app, otherwise 30 min once you've stopped somewhere else.
export const BEER_FROM_START_MS = 5 * 60 * 1000;
export const BEER_AWAY_MS = 30 * 60 * 1000;

// Default per-pilot colours offered in the profile editor.
export const COLORS = [
  '#ff5252', '#ff9800', '#ffd600', '#7cb342',
  '#26a69a', '#29b6f6', '#5c6bc0', '#ab47bc', '#ec407a', '#8d6e63',
];

// The local-day room key, e.g. "2026-06-15". Pilots in the same calendar day
// share one Durable Object.
export function todayKey(d = new Date()) {
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}
