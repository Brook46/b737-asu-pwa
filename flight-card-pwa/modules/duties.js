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
  OFF: 'dayOff', GDO: 'dayOff',
  MIL: 'miluim', MILUIM: 'miluim',
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
const LOGISTICS = /\b(pick ?-?up|drive home|end of (rest|contract)|rest end|limo)\b/i;

export function classify(title, notes = '') {
  const firstLine = String(notes).split(/\r?\n/).find(l => l.trim()) || '';
  for (const text of [title, firstLine]) {
    const tokens = String(text || '').split(/[^A-Za-z0-9_]+/).filter(Boolean);
    if (tokens.length && LEAD_ONLY[tokens[0]]) return { kind: LEAD_ONLY[tokens[0]], code: tokens[0] };
    for (const t of tokens) if (CODES[t]) return { kind: CODES[t], code: t };
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

// One calendar event -> a duty, or null when it's a flight, its logistics,
// or has nothing to show.
export function eventToDuty(ev) {
  const title = String(ev.summary || '').trim();
  const notes = String(ev.description || '').trim();
  if (!title && !notes) return null;
  if (FLIGHT_LIKE.test(title) || LOGISTICS.test(title)) return null;
  const st = icalToMs(ev.dtstart, ev.dtstartTz, ev.dtstartIsDate);
  if (!st) return null;
  const en = icalToMs(ev.dtend, ev.dtendTz, ev.dtendIsDate) || st;
  const { kind, code } = classify(title, notes);
  const d = new Date(st.ms);
  return {
    uid: ev.uid || `${title}@${st.ms}`,
    kind, code,
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
