// Build a minimal RFC5545 .ics from one or more events.
// Times are exported in "floating" local time (no TZ marker) — they appear in
// the calendar app at the same wall-clock time you saw in the PDF.

import { KINDS, labelOf } from './kinds.js';
import { radarExportUrl } from './radar.js';

function pad(n) { return String(n).padStart(2,'0'); }
function fmt(d) {
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
}
/** RFC5545 DATE value (no time) — used for all-day events. */
function fmtDate(d) {
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}`;
}
function isAllDayEvent(ev) {
  if (ev.allDay != null) return !!ev.allDay;
  return ev.start.getHours() === 0 && ev.start.getMinutes() === 0
      && (ev.end - ev.start) >= 24*60*60*1000 - 1000;
}
function esc(s) {
  return String(s).replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
}

export function eventToIcs(ev, note = '') {
  return wrapCal([vevent(ev, note)]);
}

export function eventsToIcs(events, notesMap = {}) {
  return wrapCal(events.map(ev => vevent(ev, notesMap[ev.id] || '')));
}

function wrapCal(veventBlocks) {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//duty-cal-pwa//EN',
    'CALSCALE:GREGORIAN',
    ...veventBlocks.flat(),
    'END:VCALENDAR',
  ].map(fold).join('\r\n');
}

/**
 * RFC5545 content lines are limited to 75 octets; longer ones must be folded
 * onto continuation lines starting with a space. Tracking URLs push
 * DESCRIPTION well past that, and some calendar importers do reject over-long
 * lines. Folding is done on code points so an emoji is never split in half.
 */
function fold(line) {
  const chars = Array.from(line);
  if (chars.length <= 72) return line;
  const parts = [chars.slice(0, 72).join('')];
  for (let i = 72; i < chars.length; i += 71) parts.push(' ' + chars.slice(i, i + 71).join(''));
  return parts.join('\r\n');
}

function vevent(ev, note) {
  const dt = fmt(new Date());
  // All-day duties export as DATE values so phones show them in the all-day
  // banner instead of a 24-hour block covering the whole day.
  const when = isAllDayEvent(ev)
    ? [`DTSTART;VALUE=DATE:${fmtDate(ev.start)}`, `DTEND;VALUE=DATE:${fmtDate(ev.end)}`]
    : [`DTSTART:${fmt(ev.start)}`, `DTEND:${fmt(ev.end)}`];

  // Flights carry a live-tracking link. URL: is what Apple and Google surface
  // as a tappable link on the event; the copy in DESCRIPTION is the fallback
  // for clients that ignore URL, and is what makes it visible in a shared
  // invite or a printed agenda.
  const track = radarExportUrl(ev);

  return [
    'BEGIN:VEVENT',
    `UID:${ev.id}@duty-cal-pwa`,
    `DTSTAMP:${dt}`,
    ...when,
    `SUMMARY:${esc(prettyTitle(ev))}`,
    `DESCRIPTION:${esc(buildDescription(ev, note, track))}`,
    ...(track ? [`URL;VALUE=URI:${track}`] : []),
    `CATEGORIES:${esc((KINDS[ev.kind]?.label || 'Duty').toUpperCase())}`,
    'END:VEVENT',
  ];
}

const TITLE_ICONS = {
  flight: '✈︎', pickup: '🚗', driveHome: '🏠', restEnd: '⏰',
  standby: '📟', ground: '🎓', vacation: '🌴', dayOff: '🛌', miluim: '🎖️', note: '📝',
};

function prettyTitle(ev) {
  const icon = TITLE_ICONS[ev.kind];
  const base = ev.kind === 'pickup'    ? 'Pickup'
             : ev.kind === 'driveHome' ? 'Drive home'
             : ev.kind === 'restEnd'   ? 'End of rest'
             : ev.title;
  return icon ? `${icon} ${base}` : base;
}

const DETAIL_LABELS = {
  flights: 'Flights', route: 'Route', legs: 'Legs', flightTime: 'Block time',
  airport: 'Pickup at', station: 'Station', roster: 'Roster code',
  restPeriod: 'Rest period', readyTime: 'Ready by', note: 'Note', from: 'From',
};

function buildDescription(ev, note, track) {
  const lines = [labelOf(ev)];
  const d = ev.details || {};
  for (const [k, v] of Object.entries(d)) {
    if (v == null || v === '') continue;
    lines.push(`${DETAIL_LABELS[k] || k}: ${v}`);
  }
  if (track) { lines.push(''); lines.push(`Track live: ${track}`); }
  if (note) { lines.push(''); lines.push('Notes:'); lines.push(note); }
  return lines.join('\n');
}

export function downloadIcs(filename, ics) {
  // Declare the charset: summaries carry → and emoji, and some importers
  // assume Latin-1 without it and mangle them.
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
}
