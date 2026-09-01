// calendar.js — Google Calendar (secret iCal) → roster pipeline.
//
// Flow on each sync:
//   1. Fetch <WORKER_BASE>/ical?url=<secret iCal URL>
//   2. Walk VEVENT blocks, pull each event's DESCRIPTION text.
//   3. Run that text through parseRoster (already handles the
//      Cockpit / Slip details / Cabin slip format used by
//      ELALOrganizer's calendar events).
//   4. Collect every parsed flight across every VEVENT.
//   5. Hand the array to storage.appendLegs, which dedupes by flight #.
//
// We deliberately do NOT do anything clever with VEVENT timing on the
// PWA side — the description's "Slip details (UTC)" line is the source
// of truth for each leg's dep/arr times.

import { parseIcal } from './ical.js?v=123';
import { parseRoster } from './roster.js?v=123';
import { WORKER_BASE } from './proxy.js?v=123';

const URL_STORAGE_KEY        = 'fc.gcal.url';
const LAST_SYNC_STORAGE_KEY  = 'fc.gcal.lastSyncAt';

// Public API --------------------------------------------------------------

export function getCalendarUrl() {
  try { return localStorage.getItem(URL_STORAGE_KEY) || ''; }
  catch { return ''; }
}
export function setCalendarUrl(url) {
  try { localStorage.setItem(URL_STORAGE_KEY, String(url || '').trim()); }
  catch {}
}
// (The old "Logbook calendar (write)" URL field is gone — replaced by the
// hosted-.ics auto-push in modules/logbook-push.js. Its legacy localStorage
// key is cleaned up by logbook-push init().)
export function getLastSyncAt() {
  try {
    const v = localStorage.getItem(LAST_SYNC_STORAGE_KEY);
    return v ? parseInt(v, 10) : 0;
  } catch { return 0; }
}
export function isConfigured() {
  return !!WORKER_BASE && !!getCalendarUrl();
}

/**
 * Pull the iCal feed, parse it, and return the flat list of flights ready
 * for storage.appendLegs(). Caller is responsible for surfacing toast
 * messages + calling appendLegs. Throws on fetch / parse failure with a
 * user-readable message.
 */
// RFC 5545 DTSTART → ms. Handles the three shapes Google emits:
// "20260813T060000Z" (UTC), "20260813T090000" (floating/TZID) and
// "20260813" (all-day). We only need the DATE part to be right — it is just
// an anchor for picking the year of a "dd.mm", so a few hours of timezone
// slop is harmless.
function icalTs(dtstart) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?/.exec(String(dtstart || ''));
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 12), +(m[5] || 0), +(m[6] || 0));
}

export async function syncFromCalendar() {
  if (!WORKER_BASE) {
    throw new Error('Calendar proxy not configured — see cloudflare-worker/');
  }
  const ical = getCalendarUrl();
  if (!ical) throw new Error('No calendar URL set');

  const proxyUrl =
    WORKER_BASE.replace(/\/$/, '') + '/ical?url=' + encodeURIComponent(ical);

  let res;
  try {
    res = await fetch(proxyUrl, { cache: 'no-store' });
  } catch (err) {
    throw new Error('Calendar fetch failed: ' + (err?.message || err));
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Calendar fetch returned HTTP ${res.status}: ${body.slice(0, 80)}`);
  }

  const icsText = await res.text();
  const events = parseIcal(icsText);
  if (!events.length) return { events: 0, flights: [] };

  // Each VEVENT description is run through parseRoster. ELALOrganizer
  // includes the entire slip block per duty period, so one VEVENT usually
  // produces multiple flights (the trip pair, sometimes more).
  const allFlights = [];
  const allPhones = {}; // canonical name → E.164 phone; later events win
  for (const ev of events) {
    const body = ev.description || ev.summary || '';
    if (!body) continue;
    // The slip text inside a VEVENT dates its legs "dd.mm" with no year, but
    // the VEVENT itself has a DTSTART that does. Pass it down so legs get
    // stamped with the real year instead of a rolling-window guess that goes
    // wrong for anything more than ~6 months old — which is how flights from
    // different years ended up merged.
    const parsed = parseRoster(body, { anchorMs: icalTs(ev.dtstart) });
    if (parsed && parsed.flights?.length) allFlights.push(...parsed.flights);
    if (parsed && parsed.phones) Object.assign(allPhones, parsed.phones);
  }

  try { localStorage.setItem(LAST_SYNC_STORAGE_KEY, String(Date.now())); }
  catch {}

  return { events: events.length, flights: allFlights, phones: allPhones };
}
