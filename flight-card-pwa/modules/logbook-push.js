// logbook-push.js — auto-publish the logbook .ics to the Cloudflare Worker
// so Apple/Google Calendar can subscribe to an always-fresh copy.
//
// Flow: storage.js dispatches 'fc:state-flushed' after every persisted
// write → schedulePush() debounces 30s → pushNow() rebuilds the ICS via
// logbook.js and POSTs it to WORKER_BASE/logbook/<token> — but ONLY when
// the calendar content actually changed (hash check below). The token is
// a client-generated UUID; knowing it is the credential, same trust model
// as Google's secret iCal address.
//
// iOS kills timers when the PWA backgrounds, so a pending debounce also
// flushes immediately on visibilitychange → hidden.
//
// Public API:
//   init()            → wire listeners + one-time legacy-key migration
//   getToken()        → the persisted UUID (created on first call)
//   subscribeUrls()   → { https, webcal } for the Settings sheet
//   pushNow()         → force a push; resolves { ok, skipped?, error?, bytes? }
//   lastPushedAt()    → ms epoch of the last successful push (0 = never)

import { WORKER_BASE } from './proxy.js';

const TOKEN_KEY  = 'fc.logbook.token';
const HASH_KEY   = 'fc.logbook.lastPushedHash';
const AT_KEY     = 'fc.logbook.lastPushedAt';
const LEGACY_KEY = 'fc.gcal.logbookUrl';   // dead Phase-7 field, cleaned in init()

const DEBOUNCE_MS = 30_000;
let pushTimer = null;
let pushing = false;

export function getToken() {
  let t = '';
  try { t = localStorage.getItem(TOKEN_KEY) || ''; } catch {}
  if (!t) {
    t = crypto.randomUUID();
    try { localStorage.setItem(TOKEN_KEY, t); } catch {}
  }
  return t;
}

export function subscribeUrls() {
  const https = `${WORKER_BASE}/logbook/${getToken()}.ics`;
  return { https, webcal: https.replace(/^https:/, 'webcal:') };
}

export function lastPushedAt() {
  try { return parseInt(localStorage.getItem(AT_KEY) || '0', 10) || 0; }
  catch { return 0; }
}

// Content hash with DTSTAMP lines stripped — buildIcs stamps every build
// with "now", so hashing the raw text would defeat the change check.
function icsHash(ics) {
  const stable = ics.replace(/^DTSTAMP:.*$/gm, '');
  let h = 0;
  for (let i = 0; i < stable.length; i++) {
    h = ((h << 5) - h + stable.charCodeAt(i)) | 0;
  }
  return `${stable.length}:${h}`;
}

export async function pushNow({ force = false } = {}) {
  if (pushing) return { ok: false, error: 'push already in flight' };
  pushing = true;
  try {
    const lb = await import('./logbook.js');
    const legs = lb.allStoredLegs();
    if (!legs.length) return { ok: true, skipped: 'no legs' };
    const ics = lb.buildIcs(legs);
    const hash = icsHash(ics);
    let prev = '';
    try { prev = localStorage.getItem(HASH_KEY) || ''; } catch {}
    if (!force && hash === prev) return { ok: true, skipped: 'unchanged' };

    const res = await fetch(`${WORKER_BASE}/logbook/${getToken()}`, {
      method: 'POST',
      headers: { 'content-type': 'text/calendar; charset=utf-8' },
      body: ics,
    });
    if (!res.ok) {
      const msg = res.status === 503
        ? 'Server storage not set up yet'
        : `Push failed (${res.status})`;
      console.warn('[fc] logbook push failed', res.status);
      return { ok: false, error: msg };
    }
    try {
      localStorage.setItem(HASH_KEY, hash);
      localStorage.setItem(AT_KEY, String(Date.now()));
    } catch {}
    const out = await res.json().catch(() => ({}));
    return { ok: true, bytes: out.bytes || ics.length };
  } catch (err) {
    console.warn('[fc] logbook push error', err);
    return { ok: false, error: 'Network error — will retry on next change' };
  } finally {
    pushing = false;
  }
}

export function schedulePush() {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { pushTimer = null; pushNow(); }, DEBOUNCE_MS);
}

export function init() {
  // Kill the dead Phase-7 "Logbook calendar (write)" URL — it was stored
  // but never used, and its Settings field is gone.
  try { localStorage.removeItem(LEGACY_KEY); } catch {}

  window.addEventListener('fc:state-flushed', schedulePush);

  // iOS suspends timers when the PWA backgrounds — flush any pending
  // debounce the moment the app hides so the edit isn't lost until the
  // next launch.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && pushTimer) {
      clearTimeout(pushTimer);
      pushTimer = null;
      pushNow();
    }
  });

  // Boot push: catches edits that happened right before the previous
  // session died. The hash check makes it a no-op when nothing changed.
  setTimeout(() => pushNow(), 8_000);
}
