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

const ROSTER_MARKERS = [
  /\bSlip\s+details\b/i,
  /\bCockpit\s*:/i,
];

const COCKPIT_LINE_RE  = /^OPR\s+\d+\s+(CAP|FO|FC|F\/O|CPT)\s+(.+?)(?:\s{2,}|\s+\[|$)/i;
const FLIGHT_LINE_RE   = /^(\d+)\)\s+(\d{3,4})\s+([A-Z0-9]{2,4})\s+([A-Z]{3})-([A-Z]{3})\s+\[([^\]]+)\]/;
const TIME_BLOCK_RE    = /(\d{2})\.(\d{2})\s+(\d{1,2}:\d{2})\s*-\s*(\d{2})\.(\d{2})\s+(\d{1,2}:\d{2})\s*,\s*(\d{1,2}:\d{2})/;
const CABIN_LINE_RE    = /^OPR\s+\d+\s+(PUR|ST|JU|SR|SCM)\s+(.+?)(?:\s{2,}|\s+\[|$)/i;
// Deadhead positioning crew — can be either pilots or cabin crew. El Al
// rosters mark them with DH (sometimes DHP / DHC) in the same column where
// CPT / PUR live. Captured into a per-leg `dh` field (comma-separated).
const DH_LINE_RE       = /^OPR\s+\d+\s+(DH|DHP|DHC|DHD)\s+(.+?)(?:\s{2,}|\s+\[|$)/i;
const NEW_FLIGHT_START = /^\d+\)\s+\d{3,4}\s+/;
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

export function parseRoster(text) {
  if (!text) return null;
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

  // 1) Cockpit block — CPT + FO are duty-wide. Phones get collected into a
  // duty-wide phone map keyed by canonical (FIRSTNAME SURNAME) so the cabin
  // loop below can extend it for each leg's cabin crew.
  let cpt = '', fo = '';
  let cptPhone = '', foPhone = '';
  const phones = {}; // { CANONICAL_NAME: '+972...' }
  let inCockpit = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^Cockpit\s*:/i.test(line)) { inCockpit = true; continue; }
    if (inCockpit) {
      // Cockpit ends at the first "Slip details" line, the first flight row, or a Cabin: line
      if (/^Slip\s+details/i.test(line) || NEW_FLIGHT_START.test(line) || /^Cabin\s*:/i.test(line)) {
        inCockpit = false;
      } else {
        const m = COCKPIT_LINE_RE.exec(line);
        if (m) {
          const role = m[1].toUpperCase();
          const flipped = flipName(m[2].trim());
          const phone = extractPhone(line);
          if (role === 'CAP' || role === 'CPT') { cpt = flipped; cptPhone = phone; if (phone) phones[flipped.toUpperCase()] = phone; }
          else if (role === 'FO' || role === 'F/O' || role === 'FC') { fo = flipped; foPhone = phone; if (phone) phones[flipped.toUpperCase()] = phone; }
        }
      }
    }
  }

  // 2) Flights — collect each leg and its cabin crew until the next leg starts.
  const flights = [];
  let cur = null;

  for (const raw of lines) {
    const line = raw.trim();
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
        // find which leg the current time belongs to. ctot defaults to dep_time
        // — the slip's scheduled UTC out-time — which is the closest thing the
        // roster carries to a slot time.
        dep_date: '', dep_time: '',
        arr_date: '', arr_time: '',
        ctot: '',
        cpt, fo,
        cabin: [], // ordered list of cabin crew names (PUR first, then ST/JU)
        dh:    [], // deadhead positioning crew on this leg (DH/DHP/DHC)
      };
      const tm = TIME_BLOCK_RE.exec(block);
      if (tm) {
        // tm[1]=dd, tm[2]=mm of dep; tm[3]=HH:MM dep UTC;
        // tm[4]=dd, tm[5]=mm of arr; tm[6]=HH:MM arr UTC; tm[7]=duration
        cur.dep_date = `${tm[1]}.${tm[2]}`;
        cur.dep_time = tm[3].length === 4 ? '0' + tm[3] : tm[3];
        cur.arr_date = `${tm[4]}.${tm[5]}`;
        cur.arr_time = tm[6].length === 4 ? '0' + tm[6] : tm[6];
        cur.flight_time = tm[7];
        // ctot intentionally left empty — the roster's dep_time is the
        // scheduled out-time, not a Eurocontrol slot, and the user prefers
        // to read the real CTOT from ops (or look it up via the ↗ Flightaware
        // button in the header).
      }
      continue;
    }
    if (cur) {
      // Stop accepting cabin lines once we hit the next flight row (handled above)
      const cm = CABIN_LINE_RE.exec(line);
      if (cm) {
        const flipped = flipName(cm[2]);
        cur.cabin.push(flipped);
        const phone = extractPhone(line);
        if (phone) phones[flipped.toUpperCase()] = phone;
        continue;
      }
      // Deadhead positioning crew — can be either pilots or cabin crew, and
      // the roster lists them with a DH-family prefix.
      const dm = DH_LINE_RE.exec(line);
      if (dm) {
        const flipped = flipName(dm[2]);
        cur.dh.push(flipped);
        const phone = extractPhone(line);
        if (phone) phones[flipped.toUpperCase()] = phone;
      }
    }
  }
  if (cur) flights.push(cur);

  if (!flights.length) return null;

  // Map cabin crew to cc1..cc5 — first cabin entry (the PUR) → cc1, others fill in order.
  // DH is collapsed to a comma-separated string so the existing data card
  // text-input plumbing can render it without a new cell kind.
  for (const f of flights) {
    for (let i = 0; i < 5; i++) {
      f['cc' + (i + 1)] = f.cabin[i] || '';
    }
    delete f.cabin;
    f.dh = (f.dh || []).join(', ');
  }

  return { flights, cpt, fo, phones };
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

    // edd is "dd.mm.yyyy"; the internal dep_date schema is just "dd.mm"
    // (the year gets inferred by storage.depTs's rolling-window heuristic).
    // We do hold onto the year locally to roll arr_date forward correctly
    // for "+1"-style overnight arrivals.
    const eddM = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(String(e.edd || ''));
    const depDate = eddM ? `${eddM[1]}.${eddM[2]}` : '';
    const year    = eddM ? parseInt(eddM[3], 10) : new Date().getUTCFullYear();

    let arrDate = depDate;
    if (depDate && arrM && arrM[3] && eddM) {
      const addDays = parseInt(arrM[3], 10) || 0;
      const d = new Date(Date.UTC(
        year,
        parseInt(eddM[2], 10) - 1,
        parseInt(eddM[1], 10) + addDays
      ));
      arrDate = `${String(d.getUTCDate()).padStart(2,'0')}.${String(d.getUTCMonth()+1).padStart(2,'0')}`;
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
      arr_date:    arrDate,
      arr_time:    arrM ? padT(arrM[2]) : '',
      ctot:        '',
      // Per-leg crew (the JSON shape carries crew on every leg, so
      // captain/FO can change between legs of the same duty period).
      cpt: flipName(crew.CPT || ''),
      fo:  flipName(crew.FO  || ''),
      // PU (purser) maps to cc1; the JSON skips a CC1 key, going PU,
      // CC2…CC5 — same shape the slip-text parser produces.
      cc1: flipName(crew.PU  || ''),
      cc2: flipName(crew.CC2 || ''),
      cc3: flipName(crew.CC3 || ''),
      cc4: flipName(crew.CC4 || ''),
      cc5: flipName(crew.CC5 || ''),
      // Deadhead positioning crew — the JSON shape carries them either as
      // crew.DH (array or string) or as a comma-separated DHC field. Be
      // tolerant of both so we don't drop names on a schema tweak.
      dh: normaliseDhField(crew.DH ?? crew.DHC ?? crew.dh ?? ''),
    };
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
  const keys = ['flight','tail','dep','arr','flight_time','ctot','cpt','fo','cc1','cc2','cc3','cc4','cc5','dh'];
  for (const k of keys) {
    if (leg[k] !== undefined && leg[k] !== '') out[k] = leg[k];
  }
  return out;
}
