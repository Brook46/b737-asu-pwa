// Crew-portal sector CSV → logbook legs.
//
// The crew app exports a "MySectors.csv": one row per sector flown, going
// back to the pilot's first line flight. It is the only machine-readable
// record of everything that happened before Flight Card existed, so this
// module turns one into leg objects the logbook and the insights already
// understand.
//
// Verified against a 492-row export spanning 2019→2026:
//   • STD / STA are UTC, and STA − STD equals "Planned Flight Time" on every
//     single row — so the schedule columns map straight onto block_time.
//   • "ActualFlightTime" is ATA − ATD (chock to chock) on every row, while the
//     app's actual_flight_time is what the GPS detector writes: takeoff →
//     landing. Airborne time is therefore computed from Airborne/Landing, and
//     the CSV's own actual block is deliberately NOT used — mixing the two
//     would make "hours flown" mean different things on different legs.
//   • The "Date" column is blank on ~10% of rows while STD never is, so every
//     date (and every YEAR — see dates.js on why that matters) comes from STD.

// ---------- RFC 4180 CSV ----------
// Quoted fields, "" escapes, embedded commas and newlines. Tolerates CRLF
// and a UTF-8 BOM.
export function parseCsv(text) {
  const src = String(text || '').replace(/^﻿/, '');
  const rows = [];
  let row = [], field = '', i = 0, quoted = false;
  const endField = () => { row.push(field); field = ''; };
  const endRow = () => { endField(); rows.push(row); row = []; };
  while (i < src.length) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { quoted = true; i++; continue; }
    if (ch === ',') { endField(); i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { endRow(); i++; continue; }
    field += ch; i++;
  }
  if (field !== '' || row.length) endRow();
  // Drop trailing blank lines.
  while (rows.length && rows.at(-1).every(c => !String(c).trim())) rows.pop();
  return rows;
}

// Header keys are matched on letters+digits only, so "A/C Reg", "Take-Off
// Pilot" and the export's own "Intructor" typo all survive a column rename.
const key = (h) => String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// "19/07/2019 03:40:00" → { date:"19.07", time:"03:40", year:2019, ms }
function parseDt(raw) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?/
    .exec(String(raw || '').trim());
  if (!m) return null;
  const [, d, mo, y, hh, mm, ss] = m;
  return {
    date: `${d.padStart(2, '0')}.${mo.padStart(2, '0')}`,
    time: `${hh.padStart(2, '0')}:${mm}`,
    year: Number(y),
    ms: Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mm), Number(ss || 0)),
  };
}

function spanHHMM(from, to) {
  if (!from || !to) return '';
  let min = Math.round((to.ms - from.ms) / 60000);
  if (!Number.isFinite(min) || min <= 0 || min > 24 * 60) return '';
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

const isTrue = (v) => /^(true|yes|1)$/i.test(String(v || '').trim());

// Surnames in this export are UPPERCASE inside "Operating Crew" and appear as
// "Allon BROOKSTEIN" in the seat columns — so a whole-word match on the
// surname identifies the same person in both places.
function hasSurname(haystack, surname) {
  if (!surname) return false;
  return new RegExp(`(^|[^A-Z])${surname}([^A-Z]|$)`)
    .test(String(haystack || '').toUpperCase());
}

// Whose logbook is this? The owner is on every operating crew list, so the
// surname appearing in the most rows wins. Returned null when no surname is
// dominant enough to trust — PF/PM then stays blank rather than guessed.
function detectOwner(records) {
  const counts = new Map();
  for (const r of records) {
    for (const raw of String(r.operatingcrew || '').split(',')) {
      const n = raw.trim().toUpperCase();
      if (n) counts.set(n, (counts.get(n) || 0) + 1);
    }
  }
  let best = '', bestN = 0;
  for (const [n, c] of counts) if (c > bestN) { best = n; bestN = c; }
  return (records.length && bestN >= records.length * 0.5) ? best : null;
}

// Normalise "Moshe BURGEL" → "Moshe Burgel". The crew registry canonicalises
// on uppercase, so this only affects how a name is printed.
function tidyName(raw) {
  return String(raw || '').trim()
    .replace(/\s+/g, ' ')
    .replace(/[A-Za-zÀ-ÿ']+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

// ---------- CSV → legs ----------
//
// Returns { legs, owner, rows, skippedDeadhead, skippedBad, from, to }.
// Deadhead sectors are NOT returned: the pilot was a passenger, so counting
// them would inflate hours flown and landings in the insights.
export function parseSectors(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('That file has no rows in it.');
  const head = rows[0].map(key);
  if (!head.includes('std') || !head.includes('flightno')) {
    throw new Error('Not a sector list — no "Flight No." and "STD" columns.');
  }
  const records = rows.slice(1)
    .filter(cells => cells.some(c => String(c).trim()))
    .map((cells) => {
      const rec = {};
      head.forEach((h, i) => { if (h) rec[h] = cells[i] == null ? '' : String(cells[i]).trim(); });
      return rec;
    });

  const owner = detectOwner(records);
  const legs = [];
  let skippedDeadhead = 0, skippedBad = 0;
  let from = Infinity, to = -Infinity;

  for (const r of records) {
    if (isTrue(r.deadheading)) { skippedDeadhead++; continue; }
    const dep = parseDt(r.std);
    const arr = parseDt(r.sta);
    const flight = String(r.flightno || '').replace(/\D/g, '').replace(/^0+/, '');
    if (!dep || !flight) { skippedBad++; continue; }
    if (dep.ms < from) from = dep.ms;
    if (dep.ms > to)   to   = dep.ms;

    // IATA, to match what is already in the store. airports.lookup() resolves
    // either system, but topDestinations / routeHeat / flownRoutes key on the
    // RAW string — so importing LLBG next to a calendar-synced TLV would file
    // one airport as two and split years of history down the middle.
    const depCode = (r.from || r.departairfieldiata || r.departairfieldicao || '').toUpperCase();
    const arrCode = (r.to   || r.arrivearfieldiata  || r.arriveairfieldiata
                            || r.arrivearfieldicao  || r.arriveairfieldicao || '').toUpperCase();

    const cpt = tidyName(r.lefthandseatpilot);
    const fo  = tidyName(r.righthandseatpilot);

    // Any operating pilot who wasn't in a seat is cruise relief. Worth
    // keeping — it's who you actually flew with — but it must not land in a
    // cc* slot, which the whole app reads as cabin crew.
    const relief = String(r.operatingcrew || '').split(',')
      .map(s => s.trim()).filter(Boolean)
      .filter(s => !hasSurname(cpt, s.toUpperCase())
                && !hasSurname(fo, s.toUpperCase())
                && !(owner && s.toUpperCase() === owner))
      .map(tidyName)
      .join(', ');

    // PF/PM for THIS pilot: was the owner the one flying that take-off or
    // that landing? Left blank when the column is empty (~10% of rows) or the
    // owner couldn't be identified — an empty role reads as "unknown" in the
    // logbook, a wrong one reads as fact.
    const role = (col) => {
      const v = String(col || '').trim();
      if (!owner || !v) return '';
      return hasSurname(v, owner) ? 'PF' : 'PM';
    };

    const blockTime = r.plannedflighttime || spanHHMM(dep, arr);
    const airborne  = spanHHMM(parseDt(r.airborne), parseDt(r.landing));

    const leg = {
      flight,
      tail:        String(r.acreg || '').toUpperCase(),
      dep:         depCode,
      arr:         arrCode,
      flight_time: blockTime,
      dep_date: dep.date, dep_time: dep.time, dep_year: dep.year,
      arr_date: arr ? arr.date : '', arr_time: arr ? arr.time : '',
      arr_year: arr ? arr.year : '',
      ctot: '',
      cpt, fo,
      dataCard: {
        block_time: blockTime,
        actual_flight_time: airborne,
        to_role:  role(r.takeoffpilot),
        ldg_role: role(r.landingpilot),
        ac_type:  String(r.actype || '').trim(),
        relief,
      },
      // Provenance: lets the logbook say where a leg came from, and lets a
      // future "undo the import" find exactly these legs again.
      src: 'csv',
    };
    for (const k of Object.keys(leg.dataCard)) {
      if (!leg.dataCard[k]) delete leg.dataCard[k];
    }
    legs.push(leg);
  }

  if (!legs.length && !skippedDeadhead) {
    throw new Error('No sectors could be read out of that file.');
  }
  return {
    legs, owner, rows: records.length,
    skippedDeadhead, skippedBad,
    from: Number.isFinite(from) ? from : null,
    to:   Number.isFinite(to)   ? to   : null,
  };
}
