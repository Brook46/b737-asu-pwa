// ical.js — minimal RFC 5545 reader for Google Calendar's secret iCal feed.
//
// Only extracts what Flight Card needs: VEVENT blocks with summary,
// dtstart, dtend, and description. Description is where ELALOrganizer
// (the user's source) stores the full slip-style roster text — which the
// existing roster parser (modules/roster.js) already handles. So the
// pipeline is: fetch iCal → parse VEVENTs → run each DESCRIPTION through
// parseRoster → appendLegs.

// Public API ----------------------------------------------------------------

/**
 * Parse an iCal text buffer. Returns an array of plain objects:
 *   { uid, summary, description, dtstart, dtend }
 * Lines are RFC-5545 unfolded; field values are CRLF-aware and unescape
 * the four \-sequences iCal mandates (\, \; \n \\).
 */
export function parseIcal(text) {
  if (!text || typeof text !== 'string') return [];
  const unfolded = unfoldLines(text);
  const lines = unfolded.split(/\r?\n/);
  const events = [];
  let current = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line === 'BEGIN:VEVENT') { current = {}; continue; }
    if (line === 'END:VEVENT')   { if (current) events.push(current); current = null; continue; }
    if (!current) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const left  = line.slice(0, colon);
    const value = unescapeValue(line.slice(colon + 1));
    // Property names can carry parameters after a semicolon
    // (e.g. DTSTART;TZID=Asia/Jerusalem). Strip those for the key.
    const key = left.split(';')[0].toUpperCase();
    if (key === 'UID')         current.uid = value;
    else if (key === 'SUMMARY')     current.summary = value;
    else if (key === 'DESCRIPTION') current.description = value;
    else if (key === 'DTSTART')     current.dtstart = value;
    else if (key === 'DTEND')       current.dtend = value;
  }
  return events;
}

// Internals -----------------------------------------------------------------

// RFC 5545 §3.1: long lines are folded by inserting CRLF + a single space or
// tab. To rebuild the logical line we strip every CRLF that's followed by
// whitespace.
function unfoldLines(text) {
  return text.replace(/\r?\n[ \t]/g, '');
}

// Only four sequences are valid escapes inside iCal text values.
function unescapeValue(v) {
  return String(v)
    .replace(/\\N/gi, '\n')
    .replace(/\\,/g,  ',')
    .replace(/\\;/g,  ';')
    .replace(/\\\\/g, '\\');
}
