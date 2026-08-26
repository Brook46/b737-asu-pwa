// logbook.js — turn every stored leg into a subscribable .ics calendar so
// the pilot can pull a permanent flying record into Apple Calendar or
// Google Calendar.
//
// Public API:
//   buildIcs(legs, { displayCrew })  → string (full VCALENDAR document)
//
// Each leg becomes one VEVENT:
//   SUMMARY:      ELY27 TLV→VIE (PF/PM)
//   DTSTART/DTEND: dep / arr in UTC
//   DESCRIPTION:   compact multi-line block with tail, crew (with nicknames
//                  if displayCrew is supplied), block / actual / max G,
//                  ATIS letter snapshot
//
// All timestamps use the UTC "Z" form so consumers don't have to chase
// VTIMEZONE definitions. Year-of-dep is inferred from dep_date (dd.mm)
// with a 6-month rolling window — identical to the heuristic the leg
// switcher uses, so a leg added in Dec stays in the right year when read
// in Jan.

import * as storage from './storage.js?v=112';
import { dateTs } from './dates.js?v=112';

const PROD_ID  = '-//Flight Card//Logbook v1//EN';
const CAL_NAME = 'Flight Card Logbook';

function pad2(n) { return String(n | 0).padStart(2, '0'); }

// dd.mm + HH:MM (UTC) [+ the leg's real year when known] → Date, or null when
// a part is missing/malformed. Passing the year matters here more than
// anywhere: the logbook keeps flown legs forever, and the rolling-year guess
// in modules/dates.js is only correct within ~6 months — without it, every
// older flight got exported into the wrong calendar year.
function toUtcDate(ddmm, hhmm, year) {
  const ts = dateTs(ddmm, hhmm, year);
  return Number.isFinite(ts) ? new Date(ts) : null;
}

function fmtIcsTime(d) {
  if (!d) return '';
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}00Z`;
}

// RFC 5545 §3.3.11 — escape `\`, `;`, `,`, and newlines in text values.
function escIcs(s) {
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

// RFC 5545 §3.1 — content lines wrap at 75 octets; continuation lines start
// with a single space. We split on character boundaries (75 is a soft cap
// for ASCII-heavy data card values, which is fine here).
function fold(line) {
  if (line.length <= 75) return line;
  const out = [];
  let i = 0;
  while (i < line.length) {
    out.push((i === 0 ? '' : ' ') + line.slice(i, i + 75));
    i += 75;
  }
  return out.join('\r\n');
}

function uidFor(leg) {
  // Stable per-leg UID so re-imports update the existing event rather than
  // duplicating. Hashing: ELY###-dep-arr-dep_date-year.
  //
  // The YEAR is essential: without it the same flight on the same day/month in
  // two different years produced ONE uid, so a calendar subscribed to this feed
  // showed a single event and every earlier year silently vanished.
  const f = leg.flight || 'na';
  const d = (leg.dep_date || '').replace(/\./g, '');
  const y = leg.dep_year ? `-${leg.dep_year}` : '';
  return `flightcard-${f}-${leg.dep || 'XXX'}-${leg.arr || 'XXX'}-${d}${y}@brook46.github.io`;
}

function rolesTag(toRole, ldgRole) {
  const t = String(toRole || '').toUpperCase();
  const l = String(ldgRole || '').toUpperCase();
  if (!t && !l) return '';
  return ` (${t || '—'}/${l || '—'})`;
}

function describeLeg(leg, { displayCrew = (n) => n } = {}) {
  const d = leg.dataCard || {};
  const tail = leg.tail || d.tail || '';
  const block  = d.block_time   || leg.flight_time || '';
  const actual = d.actual_flight_time || '';
  const maxG   = d.max_g || '';
  const atis   = d.atis || '';
  const crewLines = [];
  for (const [role, key] of [['CPT','cpt'], ['FO','fo'], ['PU','cc1'],
                             ['CC2','cc2'], ['CC3','cc3'], ['CC4','cc4'], ['CC5','cc5']]) {
    const name = leg[key] || d[key] || '';
    if (name) crewLines.push(`${role}: ${displayCrew(name)}`);
  }
  const lines = [
    tail ? `Tail: ${tail}` : '',
    block ? `Block: ${block}` : '',
    actual ? `Actual: ${actual}` : '',
    maxG ? `Max G: ${maxG}` : '',
    atis ? `ATIS: ${atis}` : '',
    crewLines.length ? '' : '',  // spacer if crew follows
    ...crewLines,
  ].filter(Boolean);
  return lines.join('\n');
}

export function buildIcs(legs, opts = {}) {
  const displayCrew = opts.displayCrew || ((n) => storage.displayCrew(n));
  const dtstamp = fmtIcsTime(new Date());
  const out = [
    'BEGIN:VCALENDAR',
    `PRODID:${PROD_ID}`,
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escIcs(CAL_NAME)}`,
    `X-WR-CALDESC:${escIcs('Flight Card — every leg, with block / actual / crew.')}`,
  ];
  for (const leg of legs) {
    const dep = toUtcDate(leg.dep_date, leg.dep_time, leg.dep_year);
    // arr_year, not dep_year — an overnight leg can land in the next year.
    const arr = toUtcDate(leg.arr_date, leg.arr_time, leg.arr_year || leg.dep_year);
    if (!dep || !arr) continue;  // can't render an event without a window
    const flight = leg.flight ? `ELY${leg.flight}` : 'Flight';
    const route  = (leg.dep && leg.arr) ? ` ${leg.dep}→${leg.arr}` : '';
    const tag    = rolesTag((leg.dataCard || {}).to_role, (leg.dataCard || {}).ldg_role);
    const summary = `${flight}${route}${tag}`;
    const desc    = describeLeg(leg, { displayCrew });
    out.push('BEGIN:VEVENT');
    out.push(fold(`UID:${uidFor(leg)}`));
    out.push(`DTSTAMP:${dtstamp}`);
    out.push(`DTSTART:${fmtIcsTime(dep)}`);
    out.push(`DTEND:${fmtIcsTime(arr)}`);
    out.push(fold(`SUMMARY:${escIcs(summary)}`));
    if (desc) out.push(fold(`DESCRIPTION:${escIcs(desc)}`));
    out.push('END:VEVENT');
  }
  out.push('END:VCALENDAR');
  return out.join('\r\n');
}

// Convenience: every leg the user owns — current.legs[] + every leg inside
// history[]. Sorted by dep timestamp ascending so the calendar viewer
// reads naturally.
export function allStoredLegs() {
  const now = Date.now();
  const all = [];
  for (const leg of storage.getLegs() || []) all.push(leg);
  for (const flight of storage.getState().history || []) {
    for (const leg of flight.legs || []) all.push(leg);
  }
  // A logbook is flights already FLOWN — drop any leg whose scheduled
  // departure is still in the future so the calendar never publishes
  // upcoming duty. Undated legs (no dep_date) are kept: they can't be a
  // future event, and buildIcs skips them anyway for lack of a window.
  const flown = all.filter(leg => {
    const dep = toUtcDate(leg.dep_date, leg.dep_time, leg.dep_year)?.getTime();
    return dep == null || dep <= now;
  });
  flown.sort((a, b) => {
    const da = toUtcDate(a.dep_date, a.dep_time, a.dep_year)?.getTime() || 0;
    const db = toUtcDate(b.dep_date, b.dep_time, b.dep_year)?.getTime() || 0;
    return da - db;
  });
  return flown;
}
