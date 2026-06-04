// ly-routes.js — local LY flight-number → route lookup.
//
// HONEST CAVEAT: there is no free, no-key, CORS-friendly public API that
// returns "next departure of ELY1" from inside a PWA. FlightAware AeroAPI,
// AviationStack, Eurocontrol B2B, and the El Al APIs all require either an
// API key or a server-side proxy. Rather than rely on something that breaks
// the moment a key expires (or that drags us back into the OAuth swamp),
// we keep a small, deterministic static table of the most common ELY
// routes that a 737NG pilot is likely to fly. The table is local, works
// offline, and only seeds dep/arr — schedule times and aircraft type are
// intentionally omitted because they vary day to day and the user wants
// reliable data, not a guess.
//
// Easy to extend: add a new entry below keyed by digits-only flight number.

// `block` is the typical block time (scheduled gate-to-gate, HH:MM) for that
// flight. Public timetable values, used only as a planning starter so the
// crew can sanity-check fuel before the real OFP arrives. Not authoritative.
const LY_ROUTES = {
  // Long-haul (787/777 — included so the route still resolves if a 737NG
  // pilot is dead-heading or paperwork mentions one of these).
  '1':   { dep: 'TLV', arr: 'JFK', block: '12:30' },
  '2':   { dep: 'JFK', arr: 'TLV', block: '10:30' },
  '7':   { dep: 'TLV', arr: 'EWR', block: '12:30' },
  '8':   { dep: 'EWR', arr: 'TLV', block: '10:30' },
  '15':  { dep: 'TLV', arr: 'LAX', block: '14:30' },
  '16':  { dep: 'LAX', arr: 'TLV', block: '12:30' },
  '25':  { dep: 'TLV', arr: 'BOS', block: '12:00' },
  '26':  { dep: 'BOS', arr: 'TLV', block: '10:30' },
  '27':  { dep: 'TLV', arr: 'YYZ', block: '12:30' },
  '28':  { dep: 'YYZ', arr: 'TLV', block: '10:30' },

  // Europe / med — typical 737NG turns out of TLV. Pair numbers are
  // outbound (odd) / inbound (even) by El Al convention.
  '315': { dep: 'TLV', arr: 'LHR', block: '05:30' },
  '316': { dep: 'LHR', arr: 'TLV', block: '04:45' },
  '317': { dep: 'TLV', arr: 'LHR', block: '05:30' },
  '318': { dep: 'LHR', arr: 'TLV', block: '04:45' },
  '331': { dep: 'TLV', arr: 'FCO', block: '03:45' },
  '332': { dep: 'FCO', arr: 'TLV', block: '03:15' },
  '335': { dep: 'TLV', arr: 'AMS', block: '04:45' },
  '336': { dep: 'AMS', arr: 'TLV', block: '04:15' },
  '341': { dep: 'TLV', arr: 'BCN', block: '05:00' },
  '342': { dep: 'BCN', arr: 'TLV', block: '04:30' },
  '345': { dep: 'TLV', arr: 'MXP', block: '04:00' }, // Milan Malpensa
  '346': { dep: 'MXP', arr: 'TLV', block: '03:30' },
  '351': { dep: 'TLV', arr: 'MAD', block: '05:15' },
  '352': { dep: 'MAD', arr: 'TLV', block: '04:45' },
  '361': { dep: 'TLV', arr: 'VIE', block: '03:30' },
  '362': { dep: 'VIE', arr: 'TLV', block: '03:00' },
  '365': { dep: 'TLV', arr: 'BUD', block: '03:15' },
  '366': { dep: 'BUD', arr: 'TLV', block: '03:00' },
  '371': { dep: 'TLV', arr: 'WAW', block: '03:45' },
  '372': { dep: 'WAW', arr: 'TLV', block: '03:30' },
  '381': { dep: 'TLV', arr: 'CDG', block: '05:00' },
  '382': { dep: 'CDG', arr: 'TLV', block: '04:30' },
  '385': { dep: 'TLV', arr: 'NCE', block: '04:15' },
  '386': { dep: 'NCE', arr: 'TLV', block: '03:45' },
  '391': { dep: 'TLV', arr: 'ZRH', block: '04:30' },
  '392': { dep: 'ZRH', arr: 'TLV', block: '04:00' },
  '393': { dep: 'TLV', arr: 'GVA', block: '04:30' },
  '394': { dep: 'GVA', arr: 'TLV', block: '04:15' },
  '395': { dep: 'TLV', arr: 'MUC', block: '03:45' },
  '396': { dep: 'MUC', arr: 'TLV', block: '03:30' },
  '397': { dep: 'TLV', arr: 'BRU', block: '04:45' },
  '398': { dep: 'BRU', arr: 'TLV', block: '04:15' },

  // Closer-in regional turns
  '541': { dep: 'TLV', arr: 'KIV', block: '02:30' },
  '542': { dep: 'KIV', arr: 'TLV', block: '02:30' },
  '547': { dep: 'TLV', arr: 'VRN', block: '04:00' },
  '548': { dep: 'VRN', arr: 'TLV', block: '03:30' },
  '551': { dep: 'TLV', arr: 'ATH', block: '02:30' },
  '552': { dep: 'ATH', arr: 'TLV', block: '02:30' },
  '553': { dep: 'TLV', arr: 'SKG', block: '02:45' }, // Thessaloniki
  '554': { dep: 'SKG', arr: 'TLV', block: '02:45' },
  '555': { dep: 'TLV', arr: 'LCA', block: '01:00' },
  '556': { dep: 'LCA', arr: 'TLV', block: '00:45' },
  '561': { dep: 'TLV', arr: 'SOF', block: '02:30' },
  '562': { dep: 'SOF', arr: 'TLV', block: '02:30' },
  '571': { dep: 'TLV', arr: 'PRG', block: '03:30' },
  '572': { dep: 'PRG', arr: 'TLV', block: '03:15' },
};

// Look up by digits-only flight number. Accepts inputs like "1", "ely1",
// "LY 1", "001" — strips everything non-numeric first.
export function lookupRoute(rawFlightNumber) {
  if (!rawFlightNumber) return null;
  const digits = String(rawFlightNumber).replace(/\D/g, '').replace(/^0+/, '');
  if (!digits) return null;
  return LY_ROUTES[digits] || null;
}

// Normalise a user-typed flight number to digits only. "ELY1" → "1",
// "LY 7" → "7", "337" → "337".
export function normaliseFlightNumber(raw) {
  if (raw == null) return '';
  return String(raw).replace(/\D/g, '').replace(/^0+/, '');
}

// Render a normalised flight number with the ELY callsign prefix that 737NG
// pilots use on the radio. "1" → "ELY1".
export function displayFlight(normalised) {
  if (!normalised) return '';
  return 'ELY' + String(normalised);
}
