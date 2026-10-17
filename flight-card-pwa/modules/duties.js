// duties.js — non-flight duty events from the duty calendar: simulators,
// recurrent and ground training, courses, office, medical, standby/dummy,
// vacation, days off, miluim.
//
// Calendar sync used to run every event through the flight-slip parser and
// silently drop whatever wasn't a flight. This turns those events into
// duties instead. Flights are still left to roster.js: anything that looks
// like a flight, a pickup or a drive home is not a duty.
//
// The codes and what they mean come from duty-cal-pwa/kinds.js — the duty
// calendar app's taxonomy, built from the real duty-plan PDFs. Copied rather
// than imported: the apps are deliberately independent.

export const DUTY_KINDS = {
  sim:      { badge: 'SIM', label: 'Simulator' },
  training: { badge: 'TRN', label: 'Recurrent training' },
  course:   { badge: 'GND', label: 'Ground course' },
  office:   { badge: 'OFC', label: 'Office' },
  medical:  { badge: 'MED', label: 'Medical' },
  sick:     { badge: 'SCK', label: 'Sick' },
  standby:  { badge: 'SBY', label: 'Standby' },
  vacation: { badge: 'VAC', label: 'Vacation' },
  dayOff:   { badge: 'OFF', label: 'Day off' },
  miluim:   { badge: 'MIL', label: 'Miluim' },
  other:    { badge: 'DTY', label: 'Duty' },
};

// Roster codes, as they appear (upper case). Matched case-sensitively so an
// ordinary word in a title ("Do", "Office hours") isn't mistaken for a code.
const CODES = {
  SIM: 'sim', LOS: 'sim', CAT3: 'sim', RPC: 'sim', OPC: 'sim', LPC: 'sim', LOFT: 'sim', FFS: 'sim',
  RST: 'training', TZI: 'training', RGT: 'training', SEP: 'training', CCC: 'training',
  UPRT: 'training', REC: 'training',
  CRM: 'course', DNG: 'course', SYS: 'course', CRS: 'course', GND: 'course',
  OPS: 'office', OFC: 'office', OFFICE: 'office',
  MED: 'medical', MEDICAL: 'medical',
  DUMMY: 'standby', SBY: 'standby', STBY: 'standby', RESERVE: 'standby',
  VAC: 'vacation', VAC_FLD: 'vacation', VACATION: 'vacation', ANNUAL: 'vacation', LEAVE: 'vacation',
  OFF: 'dayOff', GDO: 'dayOff', BASE_REQ: 'dayOff',
  MIL: 'miluim', MILUIM: 'miluim',
  SICK: 'sick', SCK: 'sick', SCK_PLAN: 'sick',
};
// Plain names for codes read off the real ELALOrganizer feed, where the title
// is nothing but the code. Without one the row falls back to its kind's label.
const CODE_LABELS = {
  DUM_MORN: 'Morning standby', SBY_SCR: 'Standby',
  HOME_RGT: 'Home study (RGT)', RGT: 'Recurrent ground training',
  BASE_REQ: 'Requested day off', SCK_PLAN: 'Sick (planned)',
  VAC_FLD: 'Vacation',
};
// Too short or too common to trust anywhere in a title: only as its first word.
const LEAD_ONLY = { X: 'dayOff', DO: 'dayOff', AL: 'vacation', LC: 'training', RES: 'standby', DUM: 'standby' };

// Plain-language fallback, English and Hebrew, for titles that spell the
// duty out. Order matters: "reserve duty" is miluim, not standby.
const WORDS = [
  [/miluim|reserve duty|מילואים/i, 'miluim'],
  [/simulat|סימולטור/i, 'sim'],
  [/recurrent|refresher|ריענון|השתלמות/i, 'training'],
  [/ground (school|training|course)|\bcourse\b|קורס|הכשרה|הדרכה/i, 'course'],
  [/medical|רפואי/i, 'medical'],
  [/\boffice\b|briefing|meeting|משרד|תדריך|ישיבה/i, 'office'],
  [/stand-?by|\breserve\b|dummy|כוננות/i, 'standby'],
  [/vacation|holiday|annual leave|חופשה/i, 'vacation'],
  [/day off|יום חופש/i, 'dayOff'],
];

// A flight (or its logistics) is never a duty — those belong to roster.js.
const FLIGHT_LIKE = /^\s*(?:E?LY|ELAL)\s?\d{2,4}\b|\b[A-Z]{3}\s*(?:-|–|→|->)\s*[A-Z]{3}\b|✈/;
// EOR ("EOR (TLV-ZRH-TLV)", "EOR (SIM_SHO)") is the feed's end-of-rest
// marker after a duty: a zero-length timestamp, not something you do.
const LOGISTICS = /\b(pick ?-?up|drive home|end of (rest|contract)|rest end|limo)\b|^\s*EOR\b/i;

// A whole code first ("VAC_FLD", "SCK_PLAN"), then its parts: the feed joins
// a qualifier on with an underscore — DUM_MORN is a morning DUMMY, HOME_RGT is
// RGT done at home, SBY_SCR a standby.
function codeKind(t, lead) {
  if (CODES[t]) return CODES[t];
  if (lead && LEAD_ONLY[t]) return LEAD_ONLY[t];
  if (!t.includes('_')) return null;
  const parts = t.split('_');
  if (lead && LEAD_ONLY[parts[0]]) return LEAD_ONLY[parts[0]];
  for (const p of parts) if (CODES[p]) return CODES[p];
  return null;
}

export function classify(title, notes = '') {
  const firstLine = String(notes).split(/\r?\n/).find(l => l.trim()) || '';
  for (const text of [title, firstLine]) {
    const tokens = String(text || '').split(/[^A-Za-z0-9_]+/).filter(Boolean);
    for (let i = 0; i < tokens.length; i++) {
      const kind = codeKind(tokens[i], i === 0);
      if (kind) return { kind, code: tokens[i] };
    }
  }
  for (const text of [title, notes]) {
    for (const [re, kind] of WORDS) if (re.test(text || '')) return { kind, code: '' };
  }
  return { kind: 'other', code: '' };
}

// ---------- iCal time -> UTC ms ----------
const pad = (n) => String(n).padStart(2, '0');

// The zone's UTC offset (ms) at an instant, from the browser's own time-zone
// database. No library: Intl already knows every zone, DST included.
function offsetAt(ts, tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(ts));
    const get = (t) => +parts.find(p => p.type === t).value;
    return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24,
                    get('minute'), get('second')) - ts;
  } catch { return 0; }               // a zone this browser doesn't know: treat as UTC
}
function zonedToUtc(y, mo, d, h, mi, s, tz) {
  const wall = Date.UTC(y, mo, d, h, mi, s);
  let ts = wall;
  for (let i = 0; i < 2; i++) ts = wall - offsetAt(ts, tz);   // twice settles DST edges
  return ts;
}
export function icalToMs(value, tz, isDate) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(String(value || '').trim());
  if (!m) return null;
  const [, y, mo, d, hh, mi, ss, z] = m;
  // All-day: the calendar DATE, kept as UTC midnight so its day never shifts.
  if (isDate || hh == null) return { ms: Date.UTC(+y, +mo - 1, +d), allDay: true };
  if (z)  return { ms: Date.UTC(+y, +mo - 1, +d, +hh, +mi, +(ss || 0)), allDay: false };
  if (tz) return { ms: zonedToUtc(+y, +mo - 1, +d, +hh, +mi, +(ss || 0), tz), allDay: false };
  return { ms: new Date(+y, +mo - 1, +d, +hh, +mi, +(ss || 0)).getTime(), allDay: false };
}

// Timed start/end that cover whole days of the device's own calendar —
// midnight to 23:59 (or the next midnight) — as an all-day range on UTC-
// midnight dates, the same shape a DATE event gets.
function wholeLocalDays(st, en) {
  if (st.allDay || en.allDay) return null;
  const a = new Date(st.ms), b = new Date(en.ms);
  if (a.getHours() || a.getMinutes()) return null;
  const endsMidnight = !b.getHours() && !b.getMinutes();
  const endsLastMinute = b.getHours() === 23 && b.getMinutes() === 59;
  if (!endsMidnight && !endsLastMinute) return null;
  if (en.ms - st.ms < 23 * 3600000) return null;
  const startDay = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  let endDay = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  if (endsLastMinute) endDay += 86400000;           // DTEND is exclusive
  return { st: { ms: startDay, allDay: true }, en: { ms: endDay, allDay: true } };
}

// The feed sends a vacation (or a run of standby days) one event per day.
// Consecutive whole-day duties with the same code become one entry —
// "Vacation · 12 days", not twelve rows. `uids` keeps every member so the
// store can drop the single days a previous sync saved.
export function mergeRuns(duties) {
  const list = duties.slice().sort((a, b) => a.start - b.start);
  const out = [];
  for (const d of list) {
    const prev = out[out.length - 1];
    if (prev && prev.allDay && d.allDay && prev.kind === d.kind
        && (prev.code || prev.title) === (d.code || d.title)
        && d.start <= prev.end && d.start >= prev.start) {
      prev.end = Math.max(prev.end, d.end);
      prev.uids = (prev.uids || [prev.uid]).concat(d.uid);
      if (d.notes && !prev.notes.includes(d.notes)) prev.notes = (prev.notes + '\n' + d.notes).trim();
      continue;
    }
    out.push({ ...d });
  }
  return out;
}

// One calendar event -> a duty, or null when it's a flight, its logistics,
// or has nothing to show.
export function eventToDuty(ev) {
  const title = String(ev.summary || '').trim();
  const notes = String(ev.description || '').trim();
  if (!title && !notes) return null;
  if (FLIGHT_LIKE.test(title) || LOGISTICS.test(title)) return null;
  let st = icalToMs(ev.dtstart, ev.dtstartTz, ev.dtstartIsDate);
  if (!st) return null;
  let en = icalToMs(ev.dtend, ev.dtendTz, ev.dtendIsDate) || st;
  // The feed never sends a real all-day event: a vacation day, DUMMY or SICK
  // arrives as local 00:00 → 23:59 in UTC (21:00Z → 20:59Z). Read that as the
  // whole day it is, or every day off shows as "00:00–23:59 LT · 23:59".
  const whole = wholeLocalDays(st, en);
  if (whole) { st = whole.st; en = whole.en; }
  const { kind, code } = classify(title, notes);
  const d = new Date(st.ms);
  return {
    uid: ev.uid || `${title}@${st.ms}`,
    kind, code,
    label: CODE_LABELS[code] || '',
    title: title || DUTY_KINDS[kind].label,
    notes: notes.slice(0, 2000),
    start: st.ms,
    end: Math.max(en.ms, st.ms),
    allDay: st.allDay,
    // UTC date/time in the same shape as a leg's, so duties sort into the
    // same timeline as flights (legTs) and print their date the same way.
    dep_date: `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}`,
    dep_year: d.getUTCFullYear(),
    dep_time: st.allDay ? '' : `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
  };
}
