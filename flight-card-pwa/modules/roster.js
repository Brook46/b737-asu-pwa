// roster.js — parse a company duty-roster text into one or more flight legs.
//
// Recognises blocks like:
//
//   Cockpit:
//   OPR 021284 CAP KOLAN YUVAL          [phone:0547450555,REQ ...]
//   OPR 024046 FO  BROOKSTEIN ALLON     [phone:0545555048,REQ ...]
//
//   Slip details (UTC):
//   1) 0337 EHE TLV-AMS [17.06 03:50 - 17.06 09:05 , 05:15 Hrs]
//   Cabin:
//   OPR 030108 PUR ANGEL TIMNA          [phone:...,ASN ...]
//   OPR 065456 ST  CASTEL ANAT          [phone:...,ASN ...]
//   ...
//
//   2) 0338 EHB AMS-TLV [18.06 10:15 - 18.06 15:00 , 04:45 Hrs]
//   Cabin:
//   ...
//
// Public API: parseRoster(text) → { flights, cpt, fo } | null

import { yearNear } from './dates.js?v=168';
import { RELIEF_SLOTS, CABIN_SLOTS, CREW_FIELDS } from './crew.js?v=168';

const ROSTER_MARKERS = [
  /\bSlip\s+details\b/i,
  /\bCockpit\s*:/i,
];

const FLIGHT_LINE_RE   = /^(\d+)\)\s+(\d{3,4})\s+([A-Z0-9]{2,4})\s+([A-Z]{3})-([A-Z]{3})\s+\[([^\]]+)\]/;
const TIME_BLOCK_RE    = /(\d{2})\.(\d{2})\s+(\d{1,2}:\d{2})\s*-\s*(\d{2})\.(\d{2})\s+(\d{1,2}:\d{2})\s*,\s*(\d{1,2}:\d{2})/;
// After a leg has flown, the feed adds its real times under the slip line:
//   1) 5115 EKM TLV-BUS [19.02 10:55 - 19.02 13:25 , 02:30 Hrs]
//                    Actual: [19.02 10:57 - 19.02 13:15 , 02:18 Hrs]
// Off-block → on-block, UTC — the same chock-to-chock span the crew portal's
// CSV calls "ActualFlightTime". It's the logbook's block time, so it lands in
// its own fields and never in actual_flight_time, which is airborne time
// (GPS take-off → landing; see sectors-csv.js on keeping the two apart).
const ACTUAL_LINE_RE   = /^Actual\s*:\s*\[([^\]]+)\]/i;

// ONE pattern for every crew line, in any section:
//   OPR 021284 CAP KOLAN YUVAL          [phone:0547450555,REQ ...]
//   status id  rank name                 tail
// There used to be a separate pattern per section, each demanding status OPR
// and a rank from a short fixed list. A line with any other status (a
// deadheading crew member, say) or rank (a relief pilot, a cabin rank not on
// the list) matched nothing and was dropped without a trace — the person
// simply never appeared. Now every crew line is read, and the section and
// the status/rank decide where it goes.
const CREW_LINE_RE = /^([A-Z]{2,4})\s+(\d{3,})\s+([A-Z][A-Z/]{0,4})\s+(.+?)(?:\s{2,}|\s*\[|$)/i;

// A status or rank meaning "riding as a passenger, positioning".
const DH_TOKENS    = new Set(['DH', 'DHD', 'DHC', 'DHP', 'DHT', 'DHF', 'POS', 'PAX', 'PSG']);
const CAPT_RANKS   = new Set(['CAP', 'CPT', 'CAPT', 'CA', 'CMD']);
const FO_RANKS     = new Set(['FO', 'F/O', 'FC', 'SFO', 'SO', 'CRP', 'RP', 'SP', 'FP']);
const PURSER_RANKS = new Set(['PUR', 'PU', 'CSM', 'SCM', 'CS', 'ISM']);
const KNOWN_RANKS  = new Set([...CAPT_RANKS, ...FO_RANKS, ...PURSER_RANKS, 'ST', 'JU', 'SR', 'FA', 'BC']);
// A deadhead marker can sit in the rank column AND be followed by the
// person's own rank ("DHC FO  BAR TOM"); the single pattern above would then
// read the rank as the name. This one skips that second rank.
const DH_RANKED_RE = /^([A-Z]{2,4})\s+(\d{3,})\s+([A-Z][A-Z/]{0,4})\s+([A-Z][A-Z/]{0,3})\s+(.+?)(?:\s{2,}|\s*\[|$)/i;

// Section headers. Slip details closes whatever was open.
const SECTIONS = [
  [/^Cockpit\s*:/i, 'cockpit'],
  [/^Cabin\s*:/i, 'cabin'],
  [/^(Dead\s*-?\s*head(s|ing)?|DH[A-Z]?|Positioning|Pax|Passengers?)\b[^:]{0,20}:/i, 'dh'],
  [/^Slip\s+details/i, null],
];
// The roster line tail looks like  `[phone:0547450555,REQ ...]`. The phone
// is the part between `phone:` and the next comma/bracket. We grab the raw
// digits then normaliseIsraeliPhone() converts to E.164.
const PHONE_RE         = /\[\s*phone:\s*([+\d][\d\s-]{6,})/i;

// Israeli mobiles in the roster come as `0547450555` (10 digits starting 0).
// E.164 wants `+972541234567` — strip the leading 0, prepend +972. Numbers
// already in E.164 (starting with +) pass through after digit-stripping;
// anything else is returned with only the digits kept.
function normaliseIsraeliPhone(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (s.startsWith('+')) return '+' + s.slice(1).replace(/\D/g, '');
  const digits = s.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0')) return '+972' + digits.slice(1);
  return digits;
}

// Pull `[phone:0547450555,...]` from a roster line and normalise. Empty
// string when the line has no phone, which is fine — the registry just
// doesn't get a phone for that person until a future sync supplies one.
function extractPhone(line) {
  const m = PHONE_RE.exec(line);
  return m ? normaliseIsraeliPhone(m[1]) : '';
}

function isRoster(text) {
  return ROSTER_MARKERS.some(re => re.test(text));
}

// El Al rosters print names "SURNAME FIRSTNAME" (e.g. "KOLAN YUVAL"). The
// pilot prefers the everyday "FIRSTNAME SURNAME" order in the data card and
// PA tokens, so we flip at the parse boundary. Last whitespace-separated
// word is treated as the first name; everything before it is the surname.
// Handles multi-word surnames ("DA SILVA MARIA" → "MARIA DA SILVA") and
// passes single-word or empty values through untouched.
export function flipName(s) {
  const t = String(s || '').trim();
  if (!t) return t;
  const parts = t.split(/\s+/);
  if (parts.length < 2) return t;
  const first = parts.pop();
  return first + ' ' + parts.join(' ');
}

// Normalise an Israeli 3-letter registration suffix (e.g. "EHE") into "4X-EHE".
// Other strings come through unchanged.
function normaliseTail(raw) {
  const r = String(raw || '').trim().toUpperCase();
  if (/^[A-Z]{2,3}$/.test(r) && r.length === 3) return `4X-${r}`;
  return r;
}

export function parseRoster(text, opts = {}) {
  if (!text) return null;
  // anchorMs: the calendar event's DTSTART. Slip-text dates are bare "dd.mm",
  // so the year has to come from somewhere; calendar.js passes the event's own.
  //
  // A hand-pasted roster has no event, so it anchors to NOW — a roster is
  // always about the days around today, and yearNear resolves that correctly
  // in both directions including across New Year. The point is that EVERY
  // parse path now stamps a year: a leg without one can then only be legacy
  // data, which is what lets everything downstream treat a missing year as
  // "already flown" instead of guessing (see legTs in dates.js).
  const anchorMs = Number.isFinite(Number(opts.anchorMs))
    ? Number(opts.anchorMs)
    : Date.now();
  // JSON path — accept the lighter "crew portal" export shape too, an
  // array of leg objects like:
  //   { edd: "10.06.2026", flt: "2365 EKK", dep: "TLV 02:35",
  //     arr: "BUD 06:05", flightTime: "03:30", crew: { CPT, FO, PU, CC2… } }
  // Detection: any text that parses as a JSON array whose first element has
  // .flt and .dep is treated as a JSON roster. Falls back to the slip-text
  // parser below if it doesn't look like JSON.
  const jsonArr = tryParseJsonRoster(text);
  if (jsonArr) {
    const out = parseJsonRoster(jsonArr);
    if (out) return out;
  }
  if (!isRoster(text)) return null;
  const lines = String(text).split(/\r?\n/);

  // One pass. Crew lines are routed by the section they sit in:
  //   Cockpit block before the first leg  -> the duty's pilots (every leg)
  //   Cockpit block after a leg's row      -> that leg's own pilots
  //   Cabin block / lines under a leg      -> that leg's cabin crew
  //   a deadhead header, or a DH status/rank anywhere -> deadheads
  const duty = { pilots: [], cabin: [], dh: [] };
  const phones = {}; // { CANONICAL_NAME: '+972...' }
  const flights = [];
  let cur = null;
  let section = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const am = ACTUAL_LINE_RE.exec(line);
    if (am) {
      const tm = cur && TIME_BLOCK_RE.exec(am[1]);
      if (tm) {
        const hm = (t) => (t.length === 4 ? '0' + t : t);
        cur.dataCard = {
          off_block: hm(tm[3]),
          on_block:  hm(tm[6]),
          actual_block_time: hm(tm[7]),
        };
      }
      continue;
    }

    const fm = FLIGHT_LINE_RE.exec(line);
    if (fm) {
      if (cur) flights.push(cur);
      const [, , flight, tail, dep, arr, block] = fm;
      cur = {
        flight: String(flight),
        tail: normaliseTail(tail),
        dep: dep.toUpperCase(),
        arr: arr.toUpperCase(),
        flight_time: '',
        // Per-leg UTC schedule, captured so the leg-switcher's "Now" jump can
        // find which leg the current time belongs to.
        dep_date: '', dep_time: '',
        arr_date: '', arr_time: '',
        // Real calendar years when known — see the anchorMs note in parseRoster.
        dep_year: '', arr_year: '',
        ctot: '',
        pilots: null, // this leg's own cockpit, if the slip gives one
        cabin: [],    // cabin crew in roster order
        dh:    [],    // deadheads riding this leg
      };
      section = null; // crew lines under a leg with no header are its cabin
      const tm = TIME_BLOCK_RE.exec(block);
      if (tm) {
        // tm[1]=dd, tm[2]=mm of dep; tm[3]=HH:MM dep UTC;
        // tm[4]=dd, tm[5]=mm of arr; tm[6]=HH:MM arr UTC; tm[7]=duration
        cur.dep_date = `${tm[1]}.${tm[2]}`;
        cur.dep_time = tm[3].length === 4 ? '0' + tm[3] : tm[3];
        cur.arr_date = `${tm[4]}.${tm[5]}`;
        cur.arr_time = tm[6].length === 4 ? '0' + tm[6] : tm[6];
        cur.flight_time = tm[7];
        // Anchor the bare dd.mm to the event's real year when we have one.
        if (Number.isFinite(anchorMs)) {
          cur.dep_year = yearNear(cur.dep_date, anchorMs) || '';
          // An arrival earlier in the calendar than its departure means the
          // leg crossed into the next year (31.12 → 01.01).
          cur.arr_year = cur.dep_year;
          if (cur.dep_year && cur.arr_date < cur.dep_date) cur.arr_year = cur.dep_year + 1;
        }
        // ctot intentionally left empty — the roster's dep_time is the
        // scheduled out-time, not a Eurocontrol slot.
      }
      continue;
    }

    const hdr = SECTIONS.find(([re]) => re.test(line));
    if (hdr) { section = hdr[1]; continue; }

    const m = CREW_LINE_RE.exec(line);
    if (!m) continue;
    const status = m[1].toUpperCase();
    const rank = m[3].toUpperCase();
    let rawName = m[4].trim();
    if (DH_TOKENS.has(rank) && KNOWN_RANKS.has(rawName.toUpperCase())) {
      const dm = DH_RANKED_RE.exec(line);
      if (dm) rawName = dm[5].trim();
    }
    const name = flipName(rawName);
    if (!name) continue;
    const phone = extractPhone(line);
    if (phone) phones[name.toUpperCase()] = phone;

    if (section === 'dh' || DH_TOKENS.has(status) || DH_TOKENS.has(rank)) {
      (cur ? cur.dh : duty.dh).push(name);
    } else if (section === 'cockpit') {
      if (cur) (cur.pilots || (cur.pilots = [])).push({ name, rank });
      else duty.pilots.push({ name, rank });
    } else if (cur) {
      cur.cabin.push({ name, rank });
    } else if (section === 'cabin') {
      // A same-day turnaround lists Cockpit AND Cabin once, before "Slip
      // details": that cabin works every leg. It used to fall through to the
      // line below and turn the whole cabin into relief pilots.
      duty.cabin.push({ name, rank });
    } else {
      duty.pilots.push({ name, rank });   // crew before any leg, no header: cockpit
    }
  }
  if (cur) flights.push(cur);

  if (!flights.length) return null;

  // Into the fixed slots (see crew.js for why there's one list). Nobody is
  // dropped: anyone past the last slot shares it, comma-separated.
  for (const f of flights) {
    const pilots = assignPilots(f.pilots && f.pilots.length ? f.pilots : duty.pilots);
    f.cpt = pilots.cpt;
    f.fo = pilots.fo;
    Object.assign(f, fillSlots(pilots.relief, 'rp', RELIEF_SLOTS));
    const cabin = (f.cabin.length ? f.cabin : duty.cabin).slice();
    // cc1 is labelled Purser: put the purser there even if listed later.
    const pi = cabin.findIndex(p => PURSER_RANKS.has(p.rank));
    if (pi > 0) cabin.unshift(cabin.splice(pi, 1)[0]);
    Object.assign(f, fillSlots(cabin.map(p => p.name), 'cc', CABIN_SLOTS));
    // Deadheads listed for the whole duty can't be tied to one leg, so they
    // show on every leg rather than on none.
    f.dh = [...duty.dh, ...f.dh].join(', ');
    delete f.cabin;
    delete f.pilots;
  }

  const dutyPilots = assignPilots(duty.pilots);
  return { flights, cpt: dutyPilots.cpt, fo: dutyPilots.fo, phones };
}

// Captain = the first captain-rank pilot, FO = the first FO-rank pilot, the
// rest are relief pilots in roster order. A pilot with a rank this doesn't
// know still fills an empty seat before anyone is called relief — so an
// unfamiliar rank costs the label, never the person.
function assignPilots(list) {
  let cpt = '', fo = '';
  const rest = [];
  for (const p of list || []) {
    if (!cpt && CAPT_RANKS.has(p.rank)) cpt = p.name;
    else if (!fo && FO_RANKS.has(p.rank)) fo = p.name;
    else rest.push(p.name);
  }
  if (!cpt && rest.length) cpt = rest.shift();
  if (!fo && rest.length) fo = rest.shift();
  return { cpt, fo, relief: rest };
}

// names -> { prefix1: …, prefixN: … }. Overflow joins the LAST slot rather
// than falling off the end, which is how the old cap of eight cabin crew
// silently lost long-haul cabin members.
function fillSlots(names, prefix, n) {
  const out = {};
  for (let i = 0; i < n; i++) out[prefix + (i + 1)] = names[i] || '';
  if (names.length > n) out[prefix + n] = names.slice(n - 1).join(', ');
  return out;
}

// ---------- JSON roster shape ----------
// Detect whether the input text is an array-of-leg-objects JSON. Returns
// the parsed array on hit, null on miss — does NOT throw, so the
// slip-text path remains the natural fallback.
function tryParseJsonRoster(text) {
  const t = String(text || '').trim();
  if (!t || t[0] !== '[') return null;
  let parsed;
  try { parsed = JSON.parse(t); } catch { return null; }
  if (!Array.isArray(parsed) || !parsed.length) return null;
  const first = parsed[0];
  if (!first || typeof first !== 'object') return null;
  // Sniff: the crew-portal export carries .flt + .dep on every leg.
  if (!first.flt || !first.dep) return null;
  return parsed;
}

// Convert a JSON-roster array into the same { flights, cpt, fo } shape
// the slip-text parser returns. Field names from the wire ("flt", "edd",
// "flightTime", crew.PU…) get normalised to the internal schema
// (flight, dep_date/dep_time, flight_time, cc1…cc5).
function parseJsonRoster(arr) {
  const flights = [];
  let lastCpt = '', lastFo = '';
  for (const e of arr) {
    if (!e || typeof e !== 'object' || !e.flt || !e.dep) continue;
    // "2365 EKK" → flight "2365", tail suffix "EKK". Leading zeroes on
    // flight numbers ("0337") drop on the wire ("337") — that matches
    // what the header pill stores, and the leg switcher prints "ELY337".
    const fm = /^(\d{1,5})\s+([A-Z]{2,3})\b/.exec(e.flt);
    if (!fm) continue;
    const flightNum = String(parseInt(fm[1], 10));  // strip leading zeroes
    const tail = normaliseTail(fm[2]);

    // "TLV 02:35" → dep airport + UTC out-time. "TLV 01:25+1" on arrivals
    // signals "next day" — captured below to roll arr_date forward.
    const depM = /^([A-Z]{3,4})\s+(\d{1,2}:\d{2})/.exec(String(e.dep));
    const arrM = /^([A-Z]{3,4})\s+(\d{1,2}:\d{2})(?:\s*\+(\d+))?/.exec(String(e.arr || ''));

    // edd is "dd.mm.yyyy". dep_date stays "dd.mm" for display, but the year
    // is now KEPT alongside it (dep_year) instead of being discarded and
    // re-guessed later — guessing merges flights that are a year apart.
    const eddM = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(String(e.edd || ''));
    const depDate = eddM ? `${eddM[1]}.${eddM[2]}` : '';
    const year    = eddM ? parseInt(eddM[3], 10) : new Date().getUTCFullYear();

    let arrDate = depDate;
    let arrYear = eddM ? year : '';
    if (depDate && arrM && arrM[3] && eddM) {
      const addDays = parseInt(arrM[3], 10) || 0;
      const d = new Date(Date.UTC(
        year,
        parseInt(eddM[2], 10) - 1,
        parseInt(eddM[1], 10) + addDays
      ));
      arrDate = `${String(d.getUTCDate()).padStart(2,'0')}.${String(d.getUTCMonth()+1).padStart(2,'0')}`;
      arrYear = d.getUTCFullYear();   // +1 day can also mean +1 year
    }

    const padT = (t) => t && t.length === 4 ? '0' + t : t;
    const crew = (e.crew && typeof e.crew === 'object') ? e.crew : {};
    const leg = {
      flight:      flightNum,
      tail,
      dep:         depM ? depM[1].toUpperCase() : '',
      arr:         arrM ? arrM[1].toUpperCase() : '',
      flight_time: String(e.flightTime || ''),
      dep_date:    depDate,
      dep_time:    depM ? padT(depM[2]) : '',
      dep_year:    eddM ? year : '',
      arr_date:    arrDate,
      arr_time:    arrM ? padT(arrM[2]) : '',
      arr_year:    arrYear,
      ctot:        '',
      // Per-leg crew (the JSON shape carries crew on every leg, so
      // captain/FO can change between legs of the same duty period).
      cpt: flipName(crew.CPT || ''),
      fo:  flipName(crew.FO  || ''),
      // PU (purser) -> cc1; the JSON skips a CC1 key and goes PU, CC2, CC3…
      // Relief pilots and cabin crew past the fixed slots are filled below,
      // from the same crew.js list the slip-text parser uses.
      // Deadhead positioning crew — the JSON shape carries them either as
      // crew.DH (array or string) or as a comma-separated DHC field. Be
      // tolerant of both so we don't drop names on a schema tweak.
      dh: normaliseDhField(crew.DH ?? crew.DHC ?? crew.dh ?? ''),
    };
    // Relief pilots: whatever the export calls them, in a stable order.
    const relief = ['RP1', 'RP2', 'RP3', 'RP', 'CRP', 'SO', 'CPT2', 'FO2']
      .flatMap(k => [].concat(crew[k] || []))
      .map(n => flipName(String(n))).filter(Boolean);
    Object.assign(leg, fillSlots(relief, 'rp', RELIEF_SLOTS));
    const cabin = [crew.PU, ...Array.from({ length: 40 }, (_, i) => crew['CC' + (i + 2)])]
      .filter(Boolean).map(n => flipName(String(n)));
    Object.assign(leg, fillSlots(cabin, 'cc', CABIN_SLOTS));
    if (leg.cpt) lastCpt = leg.cpt;
    if (leg.fo)  lastFo  = leg.fo;
    flights.push(leg);
  }
  if (!flights.length) return null;
  return { flights, cpt: lastCpt, fo: lastFo };
}

// Normalise a DH crew value out of the JSON roster: accept array, comma-
// separated string, or empty. Returns a clean comma-separated string of
// flipped (FIRST LAST) display names.
function normaliseDhField(raw) {
  if (!raw) return '';
  const list = Array.isArray(raw)
    ? raw
    : String(raw).split(/[,;]+/);
  return list
    .map(n => flipName(String(n).trim()))
    .filter(Boolean)
    .join(', ');
}

// Convert a leg into the dataCard field bag that storage.setDataBulk wants.
export function legToFields(leg) {
  if (!leg) return {};
  const out = {};
  const keys = ['flight','tail','dep','arr','flight_time','ctot', ...CREW_FIELDS];
  for (const k of keys) {
    if (leg[k] !== undefined && leg[k] !== '') out[k] = leg[k];
  }
  return out;
}
