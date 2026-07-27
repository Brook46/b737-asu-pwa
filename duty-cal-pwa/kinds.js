// Single source of truth for duty-event taxonomy.
//
// Every module (parser, calendar renderer, app shell, ICS exporter) reads
// category metadata from here instead of hard-coding `if (kind === '...')`
// chains. Adding a new category = adding one entry below + one CSS colour var.
//
// EVENT SHAPE
// -----------
//   {
//     id:        string,        // stable across re-parses (see parser.stableEventId)
//     kind:      KindId,        // primary category — drives colour, badge, filter
//     subtype:   string|null,   // refinement within a kind (see SUBTYPES)
//     code:      string|null,   // normalised roster code: 'VAC' | 'SBY' | 'GND' | 'GDO' …
//     rawCode:   string|null,   // exactly what appeared in the PDF: 'VAC_FLD' | 'DUMMY' | 'X' …
//     dayKey:    'YYYY-MM-DD',  // calendar day the event is anchored to
//     start:     Date,
//     end:       Date,
//     allDay:    boolean,       // render in the all-day lane rather than the hour grid
//     title:     string,
//     sub:       string,        // one-line secondary text on the chip
//     dutyId:    string|null,   // groups pickup + flight + drive-home of one duty
//     origin:    'pdf'|'manual',
//     blockMinutes: number|null,// flights: scheduled block time from [FT hh:mm]
//     dutyMinutes:  number|null,// ground/standby: length of the reporting window
//     report:    'HH:MM'|null,  // standby: report time
//     release:   'HH:MM'|null,  // standby: release time
//     details:   object,        // free-form rows rendered in the details modal
//   }

/** @typedef {'flight'|'pickup'|'driveHome'|'restEnd'|'standby'|'ground'|'vacation'|'dayOff'|'miluim'|'note'|'other'} KindId */

// countsAsDuty      → included in the FTL duty-hours tally
// blocksAvailability → the pilot cannot pick up another flight that day
//                      (consumed by swap.js when computing free days)
export const KINDS = {
  flight: {
    group: 'flight', code: 'FLT', label: 'Flight',
    countsAsDuty: true, blocksAvailability: true, defaultAllDay: false,
  },
  pickup: {
    group: 'pickup', code: 'P/U', label: 'Pickup',
    countsAsDuty: true, blocksAvailability: false, defaultAllDay: false,
  },
  driveHome: {
    group: 'pickup', code: 'HME', label: 'Drive home',
    countsAsDuty: false, blocksAvailability: false, defaultAllDay: false,
  },
  restEnd: {
    group: 'rest', code: 'RST', label: 'End of rest',
    countsAsDuty: false, blocksAvailability: false, defaultAllDay: false,
  },
  standby: {
    group: 'standby', code: 'SBY', label: 'Standby',
    countsAsDuty: true, blocksAvailability: true, defaultAllDay: true,
  },
  ground: {
    group: 'ground', code: 'GND', label: 'Ground duty',
    countsAsDuty: true, blocksAvailability: true, defaultAllDay: false,
  },
  vacation: {
    group: 'vacation', code: 'VAC', label: 'Vacation',
    countsAsDuty: false, blocksAvailability: true, defaultAllDay: true,
  },
  dayOff: {
    group: 'dayOff', code: 'OFF', label: 'Day off',
    countsAsDuty: false, blocksAvailability: true, defaultAllDay: true,
  },
  miluim: {
    group: 'miluim', code: 'MIL', label: 'Miluim',
    countsAsDuty: false, blocksAvailability: true, defaultAllDay: true,
  },
  note: {
    group: 'note', code: 'NOTE', label: 'Note',
    countsAsDuty: false, blocksAvailability: false, defaultAllDay: false,
  },
  other: {
    group: 'other', code: 'ETC', label: 'Other',
    countsAsDuty: false, blocksAvailability: true, defaultAllDay: false,
  },
};

// Refinements within a kind. Key order drives the order of the <select>.
export const SUBTYPES = {
  standby: {
    home:    { label: 'Home reserve',     short: 'Home' },
    airport: { label: 'Airport standby',  short: 'Apt' },
  },
  ground: {
    sim:       { label: 'Simulator',          short: 'SIM'  },
    recurrent: { label: 'Recurrent training', short: 'RCT'  },
    medical:   { label: 'Medical',            short: 'MED'  },
    office:    { label: 'Office day',         short: 'OFC'  },
    course:    { label: 'Ground course',      short: 'CRS'  },
  },
};

// Legend / filter groups, in display order. `kind` is the filter key persisted
// in localStorage; `hiddenByDefault` seeds a first-run user's filter set.
export const LEGEND_GROUPS = [
  { kind: 'pickup',   label: 'Pickup / drive home', hiddenByDefault: false },
  { kind: 'flight',   label: 'Flight',              hiddenByDefault: false },
  { kind: 'standby',  label: 'Standby',             hiddenByDefault: false },
  { kind: 'ground',   label: 'Ground duty',         hiddenByDefault: false },
  { kind: 'dayOff',   label: 'Days off',            hiddenByDefault: false },
  { kind: 'vacation', label: 'Vacation',            hiddenByDefault: false },
  { kind: 'miluim',   label: 'Miluim',              hiddenByDefault: false },
  { kind: 'rest',     label: 'End of rest',         hiddenByDefault: true  },
  { kind: 'note',     label: 'Note / custom',       hiddenByDefault: false },
  { kind: 'other',    label: 'Other',               hiddenByDefault: true  },
];

/** Map a kind id to its legend/filter group. Unknown kinds fall back to 'other'. */
export function groupOf(kind) {
  return KINDS[kind]?.group || 'other';
}

/** Short badge text for a chip, e.g. 'SBY', 'GND', 'OFF'. */
export function badgeOf(ev) {
  const base = KINDS[ev.kind]?.code || null;
  if (!base) return null;
  const sub = ev.subtype && SUBTYPES[ev.kind]?.[ev.subtype];
  return sub ? sub.short : base;
}

/** Human label including subtype, e.g. 'Standby — Home reserve'. */
export function labelOf(ev) {
  const base = KINDS[ev.kind]?.label || 'Event';
  const sub = ev.subtype && SUBTYPES[ev.kind]?.[ev.subtype];
  return sub ? `${base} — ${sub.label}` : base;
}

export function defaultHiddenKinds() {
  return new Set(LEGEND_GROUPS.filter(g => g.hiddenByDefault).map(g => g.kind));
}

// ---------------------------------------------------------------------------
// Roster-code recognition. Used by the parser to turn a raw PDF token into a
// (kind, subtype) pair rather than dumping everything into 'other'.
// ---------------------------------------------------------------------------

/** Ground-duty roster codes → subtype. */
export const GROUND_CODES = {
  SIM:   'sim',
  LOS:   'sim',        // Line Operation Sim
  CAT3:  'sim',        // Cat 3 rating (sim)
  RPC:   'sim',        // Proficiency check (sim)
  RST:   'recurrent',  // Recurrent training (sim)
  TZI:   'recurrent',  // ELY recurrent-training code
  RGT:   'recurrent',  // Recurrent ground training
  SEP:   'recurrent',  // Safety & emergency procedures
  CCC:   'recurrent',  // Cockpit-cabin coordination
  UPRT:  'recurrent',  // Upset prevention
  LC:    'recurrent',  // Line check
  CRM:   'course',
  DNG:   'course',     // Dangerous goods
  SYS:   'course',     // Aircraft systems
  OPS:   'office',     // Briefing & operation
  OFC:   'office',
  OFFICE:'office',
  MED:   'medical',
  MEDICAL:'medical',
};

export const STANDBY_CODES = new Set(['DUMMY', 'DUM', 'SBY', 'STBY', 'RES', 'RESERVE']);
export const VACATION_CODES = new Set(['VAC', 'VAC_FLD', 'VACATION', 'ANNUAL', 'LEAVE', 'AL']);
export const DAYOFF_CODES   = new Set(['X', 'OFF', 'GDO', 'DO']);

/**
 * Classify a bare roster code.
 * @returns {{kind: KindId, subtype: string|null, code: string}|null}
 */
export function classifyCode(raw) {
  if (!raw) return null;
  const c = String(raw).toUpperCase().replace(/[^A-Z0-9_]/g, '');
  if (DAYOFF_CODES.has(c))   return { kind: 'dayOff',   subtype: null, code: 'GDO' };
  if (VACATION_CODES.has(c)) return { kind: 'vacation', subtype: null, code: 'VAC' };
  if (STANDBY_CODES.has(c))  return { kind: 'standby',  subtype: null, code: 'SBY' };
  if (GROUND_CODES[c])       return { kind: 'ground',   subtype: GROUND_CODES[c], code: 'GND' };
  return null;
}
