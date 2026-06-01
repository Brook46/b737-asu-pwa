// calendar-sync.js — Google Calendar via OAuth + Calendar API.
//
// Pipeline:
//   1. User pastes their Google Cloud OAuth Client ID + Calendar ID
//   2. signIn() opens the Google consent popup (via GIS), stores a 1h access
//      token in localStorage with its expiry timestamp
//   3. syncFromGoogle() calls the Calendar API with that bearer token, finds
//      the latest roster-shaped event, hands its description to parseRoster
//
// The token persists across app reloads. When it expires, we silently
// re-prompt on the next sync attempt.

import * as storage from './storage.js';
import { parseRoster } from './roster.js';

const SCOPE  = 'https://www.googleapis.com/auth/calendar.readonly';
const API    = 'https://www.googleapis.com/calendar/v3';
const MARKER_RE = [
  /\bSlip\s+details\b/i,
  /\bCockpit\s*:/i,
];

export function getConfig()    { return storage.getCalendarConfig(); }
export function setConfig(p)   { storage.setCalendarConfig(p); }
export function clearToken()   { storage.clearCalendarToken(); }

// Has a valid (non-expired) token in storage? Buffer 60s.
export function isSignedIn() {
  const cfg = storage.getCalendarConfig();
  return !!cfg.accessToken && cfg.tokenExpiry > (Date.now() / 1000 + 60);
}

// Build the OAuth URL and do a full-page redirect. Google sends the user back
// to the same page with #access_token=… in the URL fragment.
//
// We use redirect (not popup) because iOS Safari + Intelligent Tracking
// Prevention break the popup/postMessage flow and surface the failure as a
// confusing "Error 401: invalid_client".
export function signIn(clientIdOverride) {
  const cfg = storage.getCalendarConfig();
  const clientId = clientIdOverride || cfg.clientId;
  if (!clientId) throw new Error('No OAuth Client ID configured');

  // Redirect URI = the current page (origin + path, no hash, no query).
  const url = new URL(window.location.href);
  url.hash = '';
  url.search = '';
  const redirectUri = url.toString();

  // A short opaque state so we can recognise the redirect-back.
  const state = 'fc-' + Math.random().toString(36).slice(2, 10);
  try { sessionStorage.setItem('fc.oauth.state', state); } catch {}

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'token',
    scope: SCOPE,
    include_granted_scopes: 'true',
    prompt: 'consent',
    state,
  });
  window.location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + params.toString();
}

// Detect a return from the OAuth redirect. If a token is in the URL hash,
// store it and clean the URL. Returns true if a token was consumed.
export function consumeRedirectToken() {
  if (!window.location.hash || window.location.hash.length < 2) return false;
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const token = hash.get('access_token');
  if (!token) return false;
  const expiresIn = Number(hash.get('expires_in')) || 3600;
  const returnedState = hash.get('state');
  let expectedState = '';
  try { expectedState = sessionStorage.getItem('fc.oauth.state') || ''; } catch {}
  // Soft state check: if we have an expected state and it doesn't match, bail.
  if (expectedState && returnedState && expectedState !== returnedState) {
    console.warn('OAuth state mismatch — ignoring redirect token');
    return false;
  }
  storage.setCalendarConfig({
    accessToken: token,
    tokenExpiry: Math.floor(Date.now() / 1000) + expiresIn,
  });
  try { sessionStorage.removeItem('fc.oauth.state'); } catch {}
  // Strip the hash from the URL so a reload doesn't keep re-processing it.
  history.replaceState({}, '', window.location.pathname + window.location.search);
  return true;
}

// Clear the cached token (best-effort revoke via REST endpoint — no SDK needed).
export function signOut() {
  const cfg = storage.getCalendarConfig();
  if (cfg.accessToken) {
    fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(cfg.accessToken), {
      method: 'POST',
      mode: 'no-cors',
    }).catch(() => {});
  }
  storage.clearCalendarToken();
}

// Fetch events from the configured calendar around now (-1d → +14d) so we
// catch the upcoming roster, regardless of whether it's tagged for tomorrow
// or in three days.
async function fetchEvents(token, calendarId) {
  const now = new Date();
  const past   = new Date(now.getTime() - 24 * 3600 * 1000);
  const future = new Date(now.getTime() + 14 * 24 * 3600 * 1000);
  const url = `${API}/calendars/${encodeURIComponent(calendarId)}/events`
            + `?timeMin=${encodeURIComponent(past.toISOString())}`
            + `&timeMax=${encodeURIComponent(future.toISOString())}`
            + `&maxResults=50&singleEvents=true&orderBy=startTime`;
  const res = await fetch(url, {
    headers: { 'Authorization': 'Bearer ' + token },
    cache: 'no-store',
  });
  if (res.status === 401) throw Object.assign(new Error('Token expired'), { code: 'expired' });
  if (!res.ok) throw new Error(`Calendar API HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data.items) ? data.items : [];
}

function looksLikeRoster(text) {
  return text && MARKER_RE.some(re => re.test(text));
}

function pickRosterEvent(events) {
  if (!events.length) return null;
  const now = Date.now();
  const matches = events.filter(e =>
    looksLikeRoster(e.description) || looksLikeRoster(e.summary)
  );
  if (!matches.length) return null;
  // Prefer upcoming events (start >= now); among those, the soonest.
  const withStart = matches.map(e => {
    const s = e.start?.dateTime || e.start?.date || '';
    const t = Date.parse(s);
    return { ev: e, ts: Number.isFinite(t) ? t : 0 };
  });
  const upcoming = withStart.filter(x => x.ts >= now).sort((a, b) => a.ts - b.ts);
  if (upcoming.length) return upcoming[0].ev;
  const past = withStart.filter(x => x.ts && x.ts < now).sort((a, b) => b.ts - a.ts);
  if (past.length) return past[0].ev;
  return matches[0];
}

// Public: pull events from Google, find roster, return parsed flights.
// status: 'applied' | 'no-event' | 'needs-signin' | 'error'
export async function syncFromGoogle(opts) {
  opts = opts || {};
  const cfg = storage.getCalendarConfig();
  if (!cfg.clientId)            return { status: 'error', message: 'No OAuth Client ID configured' };
  if (!isSignedIn())            return { status: 'needs-signin', message: 'Sign in with Google to sync' };

  let events;
  try {
    events = await fetchEvents(cfg.accessToken, cfg.calendarId);
  } catch (err) {
    if (err.code === 'expired') {
      storage.clearCalendarToken();
      return { status: 'needs-signin', message: 'Session expired — sign in again' };
    }
    return { status: 'error', message: err?.message || String(err) };
  }

  if (opts.testOnly) {
    return { status: 'fetched', message: `${events.length} events in the next 14 days`, eventCount: events.length };
  }

  const ev = pickRosterEvent(events);
  if (!ev) {
    return { status: 'no-event', message: `No roster-shaped event found in ${events.length} events`, eventCount: events.length };
  }
  const parsed = parseRoster(ev.description || ev.summary || '');
  if (!parsed) {
    return { status: 'no-event', message: 'Event found but did not parse — check the Notes formatting', eventCount: events.length };
  }
  return { status: 'applied', message: `${parsed.flights.length} leg(s) applied from "${ev.summary || 'event'}"`, parsed };
}
