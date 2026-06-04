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
const NEW_FLIGHT_START = /^\d+\)\s+\d{3,4}\s+/;

function isRoster(text) {
  return ROSTER_MARKERS.some(re => re.test(text));
}

// Normalise an Israeli 3-letter registration suffix (e.g. "EHE") into "4X-EHE".
// Other strings come through unchanged.
function normaliseTail(raw) {
  const r = String(raw || '').trim().toUpperCase();
  if (/^[A-Z]{2,3}$/.test(r) && r.length === 3) return `4X-${r}`;
  return r;
}

export function parseRoster(text) {
  if (!text || !isRoster(text)) return null;
  const lines = String(text).split(/\r?\n/);

  // 1) Cockpit block — CPT + FO are duty-wide.
  let cpt = '', fo = '';
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
          const name = m[2].trim();
          if (role === 'CAP' || role === 'CPT')          cpt = name;
          else if (role === 'FO' || role === 'F/O' || role === 'FC') fo = name;
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
      if (cm) cur.cabin.push(cm[2].trim());
    }
  }
  if (cur) flights.push(cur);

  if (!flights.length) return null;

  // Map cabin crew to cc1..cc5 — first cabin entry (the PUR) → cc1, others fill in order.
  for (const f of flights) {
    for (let i = 0; i < 5; i++) {
      f['cc' + (i + 1)] = f.cabin[i] || '';
    }
    delete f.cabin;
  }

  return { flights, cpt, fo };
}

// Convert a leg into the dataCard field bag that storage.setDataBulk wants.
export function legToFields(leg) {
  if (!leg) return {};
  const out = {};
  const keys = ['flight','tail','dep','arr','flight_time','ctot','cpt','fo','cc1','cc2','cc3','cc4','cc5'];
  for (const k of keys) {
    if (leg[k] !== undefined && leg[k] !== '') out[k] = leg[k];
  }
  return out;
}
