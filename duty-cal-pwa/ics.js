// Build a minimal RFC5545 .ics from one or more events.
// Times are exported in "floating" local time (no TZ marker) — they appear in
// the calendar app at the same wall-clock time you saw in the PDF.

function pad(n) { return String(n).padStart(2,'0'); }
function fmt(d) {
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
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
  return [
    'BEGIN:VEVENT',
    `UID:${ev.id}@duty-cal-pwa`,
    `DTSTAMP:${dt}`,
    `DTSTART:${fmt(ev.start)}`,
    `DTEND:${fmt(ev.end)}`,
    `SUMMARY:${esc(prettyTitle(ev))}`,
    `DESCRIPTION:${esc(buildDescription(ev, note))}`,
    'END:VEVENT',
  ].join('\r\n');
}

function prettyTitle(ev) {
  if (ev.kind === 'flight') return '✈︎ ' + ev.title;
  if (ev.kind === 'pickup') return '🚗 Pickup';
  if (ev.kind === 'driveHome') return '🏠 Drive home';
  if (ev.kind === 'restEnd') return '⏰ End of rest';
  return ev.title;
}

function buildDescription(ev, note) {
  const lines = [];
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
