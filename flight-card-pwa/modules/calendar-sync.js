// calendar-sync.js — fetch an iCal feed and apply the latest roster event.
//
// Designed around Google Calendar's "Secret address in iCal format", which
// ships Access-Control-Allow-Origin: * — so a single direct browser fetch
// works without any proxy or extra plumbing.

import * as storage from './storage.js';
import { parseIcs, latestRosterEvent } from './ical.js';
import { parseRoster } from './roster.js';

export function getConfig() { return storage.getCalendarConfig(); }
export function setConfig({ url }) { storage.setCalendarConfig({ url }); }

// webcal:// → https://
function normaliseUrl(u) {
  if (!u) return '';
  u = u.trim();
  if (/^webcal:\/\//i.test(u)) u = 'https://' + u.slice('webcal://'.length);
  return u;
}

export async function fetchIcs(rawUrl) {
  const url = normaliseUrl(rawUrl);
  if (!url) throw new Error('No URL configured');
  let res;
  try {
    res = await fetch(url, { method: 'GET', credentials: 'omit', cache: 'no-store' });
  } catch (err) {
    // Most likely cause when this throws: CORS. Google Calendar URLs don't
    // hit this; other providers (notably iCloud public calendars) do.
    throw new Error('Fetch failed (often a CORS-restricted calendar). Use a Google Calendar secret URL.');
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (text.indexOf('BEGIN:VCALENDAR') === -1) throw new Error('Response was not iCalendar');
  return text;
}

// Full pipeline: fetch → parse → pick roster event → roster.parseRoster.
// status: 'applied' | 'no-event' | 'fetched' | 'error'
export async function syncFromIcs(opts) {
  opts = opts || {};
  const cfg = storage.getCalendarConfig();
  if (!cfg.url) return { status: 'error', message: 'No calendar URL configured' };
  let text;
  try {
    text = await fetchIcs(cfg.url);
  } catch (err) {
    return { status: 'error', message: err?.message || String(err) };
  }
  let events;
  try {
    events = parseIcs(text);
  } catch (err) {
    return { status: 'error', message: 'iCal parse failed: ' + (err?.message || err) };
  }
  if (opts.testOnly) {
    return { status: 'fetched', message: `${events.length} events found`, eventCount: events.length };
  }
  const ev = latestRosterEvent(events);
  if (!ev) {
    return { status: 'no-event', message: 'No roster-shaped event in feed', eventCount: events.length };
  }
  const parsed = parseRoster(ev.description || ev.summary || '');
  if (!parsed) {
    return { status: 'no-event', message: 'Event found but could not be parsed', eventCount: events.length };
  }
  return { status: 'applied', message: `${parsed.flights.length} leg(s) applied`, eventCount: events.length, parsed };
}
