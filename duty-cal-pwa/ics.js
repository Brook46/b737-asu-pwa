// Build a minimal RFC5545 .ics from one or more events.
// Times are exported in "floating" local time (no TZ marker) — they appear in
// the calendar app at the same wall-clock time you saw in the PDF.

import { KINDS, labelOf } from './kinds.js';

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
    ...veventBlocks,
    'END:VCALENDAR',
  ].join('\r\n');
}

function vevent(ev, note) {
  const dt = fmt(new Date());
  // All-day duties export as DATE values so phones show them in the all-day
  // banner instead of a 24-hour block covering the whole day.
  const when = isAllDayEvent(ev)
    ? [`DTSTART;VALUE=DATE:${fmtDate(ev.start)}`, `DTEND;VALUE=DATE:${fmtDate(ev.end)}`]
    : [`DTSTART:${fmt(ev.start)}`, `DTEND:${fmt(ev.end)}`];
  return [
    'BEGIN:VEVENT',
    `UID:${ev.id}@duty-cal-pwa`,
    `DTSTAMP:${dt}`,
    ...when,
    `SUMMARY:${esc(prettyTitle(ev))}`,
    `DESCRIPTION:${esc(buildDescription(ev, note))}`,
    `CATEGORIES:${esc((KINDS[ev.kind]?.label || 'Duty').toUpperCase())}`,
    'END:VEVENT',
  ].join('\r\n');
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

function buildDescription(ev, note) {
  const lines = [labelOf(ev)];
  const d = ev.details || {};
  for (const [k, v] of Object.entries(d)) {
    if (v == null || v === '') continue;
    lines.push(`${k}: ${v}`);
  }
  if (note) { lines.push(''); lines.push('Notes:'); lines.push(note); }
  return lines.join('\n');
}

export function downloadIcs(filename, ics) {
  const blob = new Blob([ics], { type: 'text/calendar' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
}
