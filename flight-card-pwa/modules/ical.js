// ical.js — minimal RFC-5545 reader.
//
// We only care about a handful of VEVENT fields (SUMMARY, DESCRIPTION,
// LOCATION, DTSTART, DTEND, UID) — and the Notes / DESCRIPTION text is what
// the roster parser ultimately consumes. Not a full RFC parser.

// Unfold continuation lines: a CRLF followed by a single space or tab joins
// to the previous line.
function unfold(text) {
  return String(text || '').replace(/\r?\n[ \t]/g, '');
}

// Decode the small escape set used in iCal text values.
function decodeIcsText(s) {
  if (s == null) return '';
  return String(s)
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

// Parse a single VEVENT block (lines between BEGIN:VEVENT / END:VEVENT).
function parseEvent(lines) {
  const out = { uid: '', summary: '', description: '', location: '', dtstart: '', dtend: '' };
  for (const rawLine of lines) {
    // Strip parameter list: PROPNAME;PARAM=VAL:VALUE → PROPNAME : VALUE
    const colonIdx = rawLine.indexOf(':');
    if (colonIdx < 0) continue;
    const head = rawLine.slice(0, colonIdx);
    const value = rawLine.slice(colonIdx + 1);
    const name = head.split(';')[0].toUpperCase();
    switch (name) {
      case 'UID':         out.uid = value.trim(); break;
      case 'SUMMARY':     out.summary = decodeIcsText(value); break;
      case 'DESCRIPTION': out.description = decodeIcsText(value); break;
      case 'LOCATION':    out.location = decodeIcsText(value); break;
      case 'DTSTART':     out.dtstart = value.trim(); break;
      case 'DTEND':       out.dtend = value.trim(); break;
    }
  }
  return out;
}

// Parse an entire .ics text body into an array of event records.
export function parseIcs(text) {
  const unfolded = unfold(text);
  const lines = unfolded.split(/\r?\n/);
  const events = [];
  let buf = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { buf = []; continue; }
    if (line === 'END:VEVENT')   {
      if (buf) events.push(parseEvent(buf));
      buf = null;
      continue;
    }
    if (buf) buf.push(line);
  }
  return events;
}

// A roster-shaped event has the roster markers in its DESCRIPTION (or, as a
// last resort, SUMMARY). Reuses the same markers parseRoster uses so the two
// modules agree on what counts.
const ROSTER_MARKERS = [
  /\bSlip\s+details\b/i,
  /\bCockpit\s*:/i,
];

function looksLikeRoster(text) {
  return text && ROSTER_MARKERS.some(re => re.test(text));
}

// Find the most recent roster event. Prefers events whose start time is in
// the future (i.e. upcoming flight) over past ones. If multiple match,
// returns the one with the soonest DTSTART.
export function latestRosterEvent(events) {
  const now = Date.now();
  const matches = events.filter(e => looksLikeRoster(e.description) || looksLikeRoster(e.summary));
  if (!matches.length) return null;
  // Parse DTSTART loosely. We accept "YYYYMMDDTHHMMSSZ" or ISO.
  const withTs = matches.map(e => ({ ev: e, ts: parseDtstart(e.dtstart) }));
  // Upcoming first; among those, soonest. Else most-recent past.
  const upcoming = withTs.filter(x => x.ts && x.ts >= now).sort((a, b) => a.ts - b.ts);
  if (upcoming.length) return upcoming[0].ev;
  const past = withTs.filter(x => x.ts && x.ts < now).sort((a, b) => b.ts - a.ts);
  if (past.length) return past[0].ev;
  return matches[0];
}

function parseDtstart(s) {
  if (!s) return 0;
  // iCal "20260617T035000Z" → ISO "2026-06-17T03:50:00Z"
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(s);
  if (m) {
    const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] || ''}`;
    const t = Date.parse(iso);
    if (!Number.isNaN(t)) return t;
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? 0 : t;
}
