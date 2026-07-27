// igc.js — IGC flight-log parser.
//
// IGC files are fixed-column ASCII (FAI spec, "Technical Specification for
// GNSS Flight Recorders"). We only need the H (header) and B (fix) records:
//
//   B H H M M S S D D M M m m m N D D D M M m m m E V P P P P P G G G G G
//   0 1         6 7           14 15            23 24 25     29 30     34
//   │ └ UTC time └ latitude      └ longitude      │  └ baro   └ GPS alt
//   │              DDMMmmm+N/S     DDDMMmmm+E/W   └ fix validity A/V
//   └ record type
//
// Deliberately tolerant: real-world loggers (Flymaster, XCTrack, Skytraxx,
// Naviter, Flytec…) all bend the spec somewhere — short lines, CRLF, BOM,
// missing headers, GPS-only altitude, midnight rollover. A bad line is skipped,
// never thrown, because the pilot just wants their flight on the screen.

/** Fixed column offsets of a B-record. */
const B = {
  TIME: 1, LAT: 7, LAT_HEM: 14, LON: 15, LON_HEM: 23,
  VALID: 24, PALT: 25, GALT: 30, MIN_LEN: 35,
};

const DAY_MS = 86400000;

/**
 * Parse IGC text into a FlightTrack skeleton (no derived dynamics yet — that's
 * metrics.js, which this function calls last).
 *
 * @param {string} text     raw file contents
 * @param {{id?:string, color?:string, fileName?:string, pilotName?:string}} [meta]
 * @returns {import('../types').FlightTrack}
 * @throws {Error} only when the file yields fewer than 2 usable fixes
 */
export function parseIGC(text, meta = {}) {
  if (typeof text !== 'string' || !text) throw new Error('Empty file');

  // Strip a UTF-8 BOM and normalise line endings before splitting.
  const lines = text.replace(/^﻿/, '').split(/\r\n|\r|\n/);

  const header = { pilot: '', glider: '', gliderId: '', site: '', dateMs: NaN };
  /** @type {import('../types').IGCPoint[]} */
  const points = [];

  let dayOffset = 0;       // accumulated midnight rollovers
  let prevSecs = -1;
  let skipped = 0;

  for (const raw of lines) {
    if (!raw) continue;
    const type = raw[0];

    if (type === 'H' || type === 'h') { readHeader(raw, header); continue; }
    if (type !== 'B' && type !== 'b') continue;
    if (raw.length < B.MIN_LEN) { skipped++; continue; }

    const secs = readTime(raw);
    if (secs === null) { skipped++; continue; }

    const lat = readLatLon(raw, B.LAT, 2, B.LAT_HEM, 'S');
    const lng = readLatLon(raw, B.LON, 3, B.LON_HEM, 'W');
    if (lat === null || lng === null) { skipped++; continue; }
    // A logger with no fix yet often emits 0/0. That's the Gulf of Guinea, not a launch.
    if (lat === 0 && lng === 0) { skipped++; continue; }

    // Midnight rollover: UTC seconds must never go backwards within one file.
    // Guard with a 12 h threshold so a single out-of-order fix can't add a day.
    if (prevSecs >= 0 && secs < prevSecs - 43200) dayOffset += DAY_MS;
    prevSecs = secs;

    points.push({
      timestamp: secs * 1000 + dayOffset,   // rebased onto the real date below
      lat, lng,
      pressureAlt: readAlt(raw, B.PALT),
      gpsAlt: readAlt(raw, B.GALT),
      vario: 0, heading: 0, turnRate: 0,
    });
  }

  if (points.length < 2) {
    throw new Error(skipped
      ? `No usable GPS fixes (${skipped} malformed B-records)`
      : 'No GPS fixes found — is this an IGC file?');
  }

  // Rebase the time-of-day offsets onto the header date (or today, if the file
  // has no HFDTE — the wall-clock date only matters for Absolute Time Sync).
  const base = Number.isFinite(header.dateMs) ? header.dateMs : startOfTodayUTC();
  for (const p of points) p.timestamp += base;

  // Some loggers repeat a fix or emit them out of order after a signal gap.
  points.sort((a, b) => a.timestamp - b.timestamp);
  const clean = points.filter((p, i) => i === 0 || p.timestamp > points[i - 1].timestamp);

  const id = meta.id || `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  /** @type {import('../types').FlightTrack} */
  const track = {
    id,
    pilotName: meta.pilotName || header.pilot || nameFromFile(meta.fileName) || 'Pilot',
    date: isoDate(clean[0].timestamp),
    color: meta.color || '#5ec2ff',
    points: clean,
    metrics: /** @type {any} */ ({}),
    highlights: [],
    fileName: meta.fileName || '',
    gliderType: header.glider,
    gliderId: header.gliderId,
    site: header.site,
    visible: true,
  };

  return track;
}

// ── record readers ──────────────────────────────────────────────────────────

/** "HHMMSS" → seconds since UTC midnight, or null. */
function readTime(line) {
  const hh = num(line, B.TIME, 2), mm = num(line, B.TIME + 2, 2), ss = num(line, B.TIME + 4, 2);
  if (hh === null || mm === null || ss === null) return null;
  if (hh > 23 || mm > 59 || ss > 59) return null;
  return hh * 3600 + mm * 60 + ss;
}

/**
 * Fixed-width DDMMmmm / DDDMMmmm → signed decimal degrees.
 * @param {number} degLen 2 for latitude, 3 for longitude
 * @param {string} negHem the hemisphere letter that means "negative"
 */
function readLatLon(line, at, degLen, hemAt, negHem) {
  const deg = num(line, at, degLen);
  const min = num(line, at + degLen, 2);
  const dec = num(line, at + degLen + 2, 3);
  if (deg === null || min === null || dec === null) return null;
  if (min > 59) return null;
  const hem = line[hemAt];
  let v = deg + (min + dec / 1000) / 60;
  if (hem === negHem || hem === negHem.toLowerCase()) v = -v;
  if (Math.abs(v) > (degLen === 2 ? 90 : 180)) return null;
  return v;
}

/**
 * 5-digit altitude in metres. Handles the two common non-spec forms: a leading
 * minus for sub-sea-level pressure altitude ("-0012"), and blanks for "unknown".
 */
function readAlt(line, at) {
  const s = line.slice(at, at + 5);
  if (!/\d/.test(s)) return 0;
  const v = parseInt(s.replace(/[^\d-]/g, ''), 10);
  if (!Number.isFinite(v)) return 0;
  // Sanity clamp: above the Armstrong line it's corrupt, not a flight.
  return v < -500 || v > 20000 ? 0 : v;
}

/** Parse a fixed-width digit run, rejecting anything non-numeric. */
function num(line, at, len) {
  const s = line.slice(at, at + len);
  if (s.length !== len || !/^\d+$/.test(s)) return null;
  return parseInt(s, 10);
}

/**
 * Header records. Both the spec form (`HFPLTPILOT:Name`) and the many variants
 * (`HFPLTPILOTINCHARGE:`, `HOPLT:`, `HFDTEDATE:060725,01`) are accepted by
 * matching the 3-letter subject code and taking everything after the colon.
 */
function readHeader(line, out) {
  const subject = line.slice(2, 5).toUpperCase();
  const afterColon = () => {
    const i = line.indexOf(':');
    return i >= 0 ? line.slice(i + 1).trim() : '';
  };

  switch (subject) {
    case 'PLT': out.pilot = out.pilot || cleanName(afterColon() || line.slice(11).trim()); break;
    case 'GTY': out.glider = out.glider || afterColon() || line.slice(16).trim(); break;
    case 'GID': out.gliderId = out.gliderId || afterColon() || line.slice(14).trim(); break;
    case 'SIT': out.site = out.site || afterColon() || line.slice(9).trim(); break;
    case 'DTE': {
      // DDMMYY, wherever it sits in the record.
      const m = line.match(/(\d{2})(\d{2})(\d{2})/);
      if (!m) break;
      const [, dd, mm, yy] = m.map(Number);
      if (dd < 1 || dd > 31 || mm < 1 || mm > 12) break;
      // IGC dates are 2-digit; the format postdates 2000.
      out.dateMs = Date.UTC(2000 + yy, mm - 1, dd);
      break;
    }
  }
}

/** Drop the placeholder pilot names loggers ship with. */
function cleanName(s) {
  const v = (s || '').replace(/^[:\s]+/, '').trim();
  if (!v) return '';
  if (/^(not set|unknown|pilot|n\/a|none|-+)$/i.test(v)) return '';
  return v.slice(0, 40);
}

function nameFromFile(fileName) {
  if (!fileName) return '';
  const stem = fileName.replace(/\.[^.]*$/, '');
  // Short IGC filenames are date-serial codes (e.g. "2A3X4Vd1"), not names.
  return stem.length > 8 && /[a-z]/i.test(stem) ? stem.slice(0, 24) : '';
}

function startOfTodayUTC() {
  const n = new Date();
  return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
}

function isoDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Quick sniff so the file picker can reject non-IGC input before parsing. */
export function looksLikeIGC(text) {
  return typeof text === 'string' && /^B\d{6}\d{7}[NS]/m.test(text.slice(0, 65536));
}
