// calendar-sync.js — fetch an iCal feed and apply the latest roster event.
//
// Returns { status, message, eventCount?, leg? } from each call so the
// settings sheet can present results sensibly.

import * as storage from './storage.js';
import { parseIcs, latestRosterEvent } from './ical.js';
import { parseRoster } from './roster.js';

export function getConfig() { return storage.getCalendarConfig(); }
export function setConfig({ url, proxy }) { storage.setCalendarConfig({ url, proxy }); }

// Normalise webcal:// → https://
function normaliseUrl(u) {
  if (!u) return '';
  u = u.trim();
  if (/^webcal:\/\//i.test(u)) u = 'https://' + u.slice('webcal://'.length);
  return u;
}

// Try direct fetch first; if it throws (CORS or net), fall back to proxy.
export async function fetchIcs(rawUrl, proxyPrefix) {
  const url = normaliseUrl(rawUrl);
  if (!url) throw new Error('No URL configured');
  // First: direct
  try {
    const res = await fetch(url, { method: 'GET', credentials: 'omit', cache: 'no-store' });
    if (res.ok) {
      const text = await res.text();
      if (text && text.indexOf('BEGIN:VCALENDAR') !== -1) return text;
    }
  } catch { /* swallow and try proxy */ }
  // Fallback: proxy
  const proxy = (proxyPrefix || '').trim();
  if (!proxy) throw new Error('Direct fetch blocked and no proxy set');
  const proxied = proxy + encodeURIComponent(url);
  const res = await fetch(proxied, { method: 'GET', credentials: 'omit', cache: 'no-store' });
  if (!res.ok) throw new Error(`Proxy returned ${res.status}`);
  const text = await res.text();
  if (text.indexOf('BEGIN:VCALENDAR') === -1) throw new Error('Response was not iCalendar');
  return text;
}

// Full pipeline: fetch → parse → pick roster event → roster.parseRoster.
// Returns { status, message, eventCount, parsed? } — never throws to callers,
// always returns a structured result.
//
// status: 'applied' | 'no-event' | 'fetched' | 'error'
//   'applied'  — roster event found and parseRoster succeeded; parsed flights
//                are in the returned object (caller does applyRoster)
//   'no-event' — feed fetched, no roster-shaped event found
//   'fetched'  — feed fetched, but only for the Test button (don't apply)
//   'error'    — anything went wrong; message has the human text
export async function syncFromIcs(opts) {
  opts = opts || {};
  const cfg = storage.getCalendarConfig();
  if (!cfg.url) return { status: 'error', message: 'No calendar URL configured' };
  let text;
  try {
    text = await fetchIcs(cfg.url, cfg.proxy);
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

// Parse a local .ics file (e.g. from the file picker). Same pipeline; never throws.
export async function applyIcsText(text) {
  let events;
  try { events = parseIcs(text); }
  catch (err) { return { status: 'error', message: 'iCal parse failed: ' + (err?.message || err) }; }
  const ev = latestRosterEvent(events);
  if (!ev) return { status: 'no-event', message: 'No roster-shaped event found', eventCount: events.length };
  const parsed = parseRoster(ev.description || ev.summary || '');
  if (!parsed) return { status: 'no-event', message: 'Event found but could not be parsed', eventCount: events.length };
  return { status: 'applied', message: `${parsed.flights.length} leg(s) applied`, eventCount: events.length, parsed };
}
