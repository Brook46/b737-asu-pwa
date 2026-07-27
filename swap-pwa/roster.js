// roster.js — read-only view of the roster the Duty Calendar app imported.
//
// The two apps are separate PWAs at separate URLs, but they are served from the
// same origin, so they share localStorage. This module is the ONLY place that
// knows about the calendar's storage format; everything else in the swap app
// talks to these helpers.
//
// Deliberately read-only: the swap app never writes 'duty-cal:*'. The roster
// belongs to the calendar app.

export const ROSTER_KEY = 'duty-cal:events';
export const CALENDAR_URL = '../duty-cal-pwa/';

/**
 * Kinds that still leave the pilot free to pick up another flight that day.
 *
 * Note the inversion: this is an allow-list, so any kind we do NOT recognise
 * counts as blocking. If the calendar app adds a new duty category, the worst
 * case is that the pilot looks busier than they are — never that we advertise
 * them as available while they are on standby, leave or reserve duty.
 */
const NON_BLOCKING = new Set(['pickup', 'driveHome', 'restEnd', 'note', 'custom']);

export const blocksAvailability = kind => !NON_BLOCKING.has(kind);

/** A duty a pilot can actually trade away. */
export const isTradable = e => e.kind === 'flight';

/** Read + revive the roster. Dates are ISO strings in localStorage. */
export function loadRoster() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(ROSTER_KEY)); } catch { /* corrupt or absent */ }
  const evs = raw?.events || [];
  return evs
    .map(e => ({ ...e, start: new Date(e.start), end: new Date(e.end) }))
    .filter(e => !isNaN(e.start) && !isNaN(e.end))
    .sort((a, b) => a.start - b.start);
}

export const rosterById = roster => new Map(roster.map(e => [e.id, e]));

/** Every day the pilot already has something rostered. */
export function busyDays(roster) {
  return new Set(roster.filter(e => blocksAvailability(e.kind)).map(e => e.dayKey));
}

/** Flight duties, most recent first, for the "pick a duty" list. */
export function tradableDuties(roster) {
  return roster.filter(isTradable).slice().reverse();
}

/** Pilot name, if the calendar captured one from the PDF. */
export function rosterOwner() {
  try {
    const raw = JSON.parse(localStorage.getItem(ROSTER_KEY));
    return raw?.period?.name || '';
  } catch { return ''; }
}

export function ymd(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
