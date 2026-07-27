// share.js — send a friend exactly what you're looking at.
//
// Two kinds of link, because they have very different privacy consequences:
//
//   view link   #v=<encoded state>
//               Camera, clock, sync mode, colour mode. Tiny, nothing leaves the
//               device. Only useful to someone who already has the same IGC
//               files loaded — "look at 13:42 from this angle".
//
//   full link   #s=<token>
//               The IGC files themselves, uploaded to the suite's Cloudflare
//               Worker KV under a random token, plus the view state. Anyone with
//               the link can replay the flights. This PUBLISHES the tracks, so
//               app.js asks before creating one.
//
// The token is a client-generated UUID and knowing it *is* the credential —
// the same trust model as the hosted logbook already in this Worker, and as
// Google's own "secret iCal address". Shares expire server-side after 90 days.
//
// A real IGC is 500–700 KB, so there is no putting the tracks in the URL: a
// 600 KB file survives neither a browser address bar nor a messaging app. The
// upload is what makes a full link possible at all.

const WORKER_BASE = 'https://b737-asu-pwa.alonbrookstein.workers.dev';

/** Refuse to upload more than this — four big flights, with headroom. */
const MAX_BUNDLE_BYTES = 6 * 1024 * 1024;
const TIMEOUT_MS = 30000;

/** Bumped if the encoded view shape ever changes, so old links stay readable. */
const VIEW_VERSION = 1;

// ── view state ──────────────────────────────────────────────────────────────

/**
 * Capture what the pilot is currently looking at.
 * @param {{timeline:any, colorMode:string, altMode:string, map:any, tracks:Array}} ctx
 */
export function captureView(ctx) {
  const { timeline, colorMode, altMode, map, tracks } = ctx;
  const view = {
    ver: VIEW_VERSION,
    t: Math.round(timeline.time),
    m: timeline.mode,
    c: colorMode,
    a: altMode,
    vis: tracks.filter((t) => t.visible !== false).map((t) => t.id),
  };
  if (map) {
    const c = map.getCenter();
    view.cam = {
      lng: +c.lng.toFixed(5),
      lat: +c.lat.toFixed(5),
      z: +map.getZoom().toFixed(2),
      p: +map.getPitch().toFixed(1),
      b: +map.getBearing().toFixed(1),
    };
  }
  return view;
}

/** URL-safe base64 of the JSON view — short enough for any messaging app. */
export function encodeView(view) {
  const json = JSON.stringify(view);
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeView(encoded) {
  try {
    const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
    const view = JSON.parse(new TextDecoder().decode(bytes));
    return view && typeof view === 'object' ? view : null;
  } catch {
    return null;
  }
}

/**
 * What did this page get opened with?
 * @returns {{token:string|null, view:object|null}}
 */
export function readHash() {
  const hash = location.hash.replace(/^#/, '');
  if (!hash) return { token: null, view: null };
  const params = new URLSearchParams(hash);
  const token = params.get('s');
  const v = params.get('v');
  return {
    token: token && /^[0-9a-f-]{36}$/i.test(token) ? token : null,
    view: v ? decodeView(v) : null,
  };
}

/** Drop the share parameters once consumed, so a reload doesn't re-import. */
export function clearHash() {
  try {
    history.replaceState(null, '', location.pathname + location.search);
  } catch { /* older WebView — harmless */ }
}

const baseUrl = () => location.origin + location.pathname;

/** A link that only moves the camera and clock. Nothing is uploaded. */
export function viewLink(view) {
  return `${baseUrl()}#v=${encodeView(view)}`;
}

// ── full share (uploads the tracks) ─────────────────────────────────────────

/**
 * Upload the loaded flights plus the view state, and return a link.
 *
 * @param {{tracks:Array, view:object, igcFor:(id:string)=>Promise<string>}} opts
 *        `igcFor` returns the raw IGC for a track id — the raw text is the
 *        source of truth in IndexedDB, so the share carries exactly what was
 *        loaded rather than anything re-serialised.
 * @returns {Promise<{url:string, token:string, bytes:number}>}
 */
export async function createShare(opts) {
  const { tracks, view, igcFor } = opts;
  if (!tracks.length) throw new Error('Nothing loaded to share.');

  const flights = [];
  for (const t of tracks) {
    const igc = await igcFor(t.id);
    if (!igc) throw new Error(`The original IGC for ${t.pilotName} is no longer stored on this device.`);
    flights.push({ id: t.id, pilotName: t.pilotName, color: t.color, fileName: t.fileName || '', igc });
  }

  const bundle = JSON.stringify({ ver: VIEW_VERSION, created: Date.now(), view, flights });
  const bytes = new Blob([bundle]).size;
  if (bytes > MAX_BUNDLE_BYTES) {
    throw new Error(`Too large to share (${(bytes / 1e6).toFixed(1)} MB). Hide a flight and try again.`);
  }

  const token = uuid();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${WORKER_BASE}/share/${token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: bundle,
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 160);
      if (res.status === 503) {
        throw new Error('Sharing storage is not configured on the Worker (KV binding missing).');
      }
      if (res.status === 404) {
        throw new Error('The Worker has no /share route yet — it needs redeploying.');
      }
      throw new Error(detail || `Upload failed (${res.status})`);
    }
  } finally {
    clearTimeout(timer);
  }

  return { url: `${baseUrl()}#s=${token}`, token, bytes };
}

/**
 * Fetch a shared bundle.
 * @returns {Promise<{view:object, flights:Array}>}
 */
export async function loadShare(token) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${WORKER_BASE}/share/${token}`, { signal: ctrl.signal });
    if (res.status === 404) throw new Error('That shared flight has expired or never existed.');
    if (!res.ok) throw new Error(`Could not load the shared flight (${res.status}).`);
    const bundle = await res.json();
    if (!bundle || !Array.isArray(bundle.flights) || !bundle.flights.length) {
      throw new Error('That share link contains no flights.');
    }
    return { view: bundle.view || null, flights: bundle.flights };
  } finally {
    clearTimeout(timer);
  }
}

/** RFC-4122 v4, from the platform CSPRNG where available. */
function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Put a link where the pilot can use it: the native share sheet if there is
 * one (the only thing that reliably works from a standalone iOS PWA), else the
 * clipboard.
 * @returns {Promise<'shared'|'copied'|'manual'>}
 */
export async function deliverLink(url, title) {
  if (navigator.share) {
    try {
      await navigator.share({ title: title || 'Flight debrief', url });
      return 'shared';
    } catch (err) {
      if (err && err.name === 'AbortError') return 'shared';
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    return 'manual';
  }
}

/** Was this app opened from a share link? Used to skip the normal restore. */
export const openedFromShare = () => {
  const { token, view } = readHash();
  return !!(token || view);
};
