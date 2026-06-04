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

const LY_ROUTES = {
  // Long-haul (787/777 — included so the route still resolves if a 737NG
  // pilot is dead-heading or paperwork mentions one of these).
  '1':   { dep: 'TLV', arr: 'JFK' },
  '2':   { dep: 'JFK', arr: 'TLV' },
  '7':   { dep: 'TLV', arr: 'EWR' },
  '8':   { dep: 'EWR', arr: 'TLV' },
  '15':  { dep: 'TLV', arr: 'LAX' },
  '16':  { dep: 'LAX', arr: 'TLV' },
  '25':  { dep: 'TLV', arr: 'BOS' },
  '26':  { dep: 'BOS', arr: 'TLV' },
  '27':  { dep: 'TLV', arr: 'YYZ' },
  '28':  { dep: 'YYZ', arr: 'TLV' },

  // Europe / med — typical 737NG turns out of TLV. Pair numbers are
  // outbound (odd) / inbound (even) by El Al convention.
  '315': { dep: 'TLV', arr: 'LHR' },
  '316': { dep: 'LHR', arr: 'TLV' },
  '317': { dep: 'TLV', arr: 'LHR' },
  '318': { dep: 'LHR', arr: 'TLV' },
  '331': { dep: 'TLV', arr: 'FCO' },
  '332': { dep: 'FCO', arr: 'TLV' },
  '335': { dep: 'TLV', arr: 'AMS' },
  '336': { dep: 'AMS', arr: 'TLV' },
  '341': { dep: 'TLV', arr: 'BCN' },
  '342': { dep: 'BCN', arr: 'TLV' },
  '345': { dep: 'TLV', arr: 'MXP' }, // Milan Malpensa
  '346': { dep: 'MXP', arr: 'TLV' },
  '351': { dep: 'TLV', arr: 'MAD' },
  '352': { dep: 'MAD', arr: 'TLV' },
  '361': { dep: 'TLV', arr: 'VIE' },
  '362': { dep: 'VIE', arr: 'TLV' },
  '365': { dep: 'TLV', arr: 'BUD' },
  '366': { dep: 'BUD', arr: 'TLV' },
  '371': { dep: 'TLV', arr: 'WAW' },
  '372': { dep: 'WAW', arr: 'TLV' },
  '381': { dep: 'TLV', arr: 'CDG' },
  '382': { dep: 'CDG', arr: 'TLV' },
  '385': { dep: 'TLV', arr: 'NCE' },
  '386': { dep: 'NCE', arr: 'TLV' },
  '391': { dep: 'TLV', arr: 'ZRH' },
  '392': { dep: 'ZRH', arr: 'TLV' },
  '393': { dep: 'TLV', arr: 'GVA' },
  '394': { dep: 'GVA', arr: 'TLV' },
  '395': { dep: 'TLV', arr: 'MUC' },
  '396': { dep: 'MUC', arr: 'TLV' },
  '397': { dep: 'TLV', arr: 'BRU' },
  '398': { dep: 'BRU', arr: 'TLV' },

  // Closer-in regional turns
  '541': { dep: 'TLV', arr: 'KIV' },
  '542': { dep: 'KIV', arr: 'TLV' },
  '547': { dep: 'TLV', arr: 'VRN' },
  '548': { dep: 'VRN', arr: 'TLV' },
  '551': { dep: 'TLV', arr: 'ATH' },
  '552': { dep: 'ATH', arr: 'TLV' },
  '553': { dep: 'TLV', arr: 'SKG' }, // Thessaloniki
  '554': { dep: 'SKG', arr: 'TLV' },
  '555': { dep: 'TLV', arr: 'LCA' },
  '556': { dep: 'LCA', arr: 'TLV' },
  '561': { dep: 'TLV', arr: 'SOF' },
  '562': { dep: 'SOF', arr: 'TLV' },
  '571': { dep: 'TLV', arr: 'PRG' },
  '572': { dep: 'PRG', arr: 'TLV' },
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
