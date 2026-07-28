// search.js — what the search box means.
//
// Searching a traffic display has two different jobs, and the old version only
// did the first one:
//
//   1. *Filter* what's in front of me — "show me the El Al flights on screen".
//   2. *Find* one specific aeroplane — "where is EKM right now?" — which has
//      nothing to do with where the map happens to be pointed.
//
// So a query is both a filter (applied locally, instantly) and, when it looks
// like it names one aircraft, a global lookup against the feed's by-registration
// and by-callsign endpoints. The aircraft comes back even if it's over Poland.
//
// The three-letter shorthand: a 737 fleet is talked about by the last three
// letters of the registration — "EKM", "EHH", "EDL" — so a bare three-letter
// query is treated as `4X-xxx` by default, on top of the ordinary text match.

const HOME_PREFIX = '4X';   // Israeli registrations; the fleet this app was built for

/** Strip hyphens/spaces and upper-case — how registrations are compared. */
export function normReg(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Work out what the user meant.
 * @returns {{raw, text, reg:string|null, callsign:string|null, hex:string|null,
 *            shorthand:boolean}}
 */
export function parseQuery(raw) {
  const text = String(raw || '').trim().toUpperCase();
  const q = text.replace(/\s+/g, '');
  const out = { raw, text, reg: null, callsign: null, hex: null, shorthand: false };
  if (!q) return out;

  // "EKM" → 4X-EKM. Three bare letters are a tail number in fleet shorthand.
  if (/^[A-Z]{3}$/.test(q)) {
    out.reg = `${HOME_PREFIX}-${q}`;
    out.shorthand = true;
    return out;
  }

  // "4XEKM" / "4X-EKM" → 4X-EKM
  const home = /^4X-?([A-Z]{3})$/.exec(q);
  if (home) { out.reg = `${HOME_PREFIX}-${home[1]}`; return out; }

  // An ICAO flight-number callsign: three letters plus digits.
  if (/^[A-Z]{3}\d{1,4}[A-Z]{0,2}$/.test(q)) { out.callsign = q; return out; }

  // A Mode-S address.
  if (/^[0-9A-F]{6}$/.test(q) && /\d/.test(q)) { out.hex = q; return out; }

  // Anything else with a hyphen or a letter+digits mix that looks like a
  // registration: G-EZBY, N123AB, HA-LYA, EI-RZD…
  if (/^[A-Z]{1,2}\d?-?[A-Z0-9]{2,5}$/.test(q) && /[A-Z]/.test(q)) out.reg = q;

  return out;
}

/** Does this aircraft match the query, by any of the fields a user might type? */
export function matches(ac, parsed, route) {
  const q = parsed.text.replace(/\s+/g, '');
  if (!q) return true;

  // Registration, hyphen-insensitive both ways ("4XEHH" ≡ "4X-EHH" ≡ "EHH").
  const reg = normReg(ac.reg);
  if (reg) {
    if (parsed.reg && reg === normReg(parsed.reg)) return true;
    if (reg.includes(q)) return true;
  }
  if (parsed.hex && ac.hex && ac.hex.toUpperCase() === parsed.hex) return true;

  const hay = [
    ac.callsign, ac.code, ac.reg, ac.type, ac.desc,
    ac.airline ? ac.airline.name : '',
    route && route.airline ? route.airline.name : '',
    route && route.origin ? `${route.origin.iata} ${route.origin.icao} ${route.origin.city}` : '',
    route && route.destination ? `${route.destination.iata} ${route.destination.icao} ${route.destination.city}` : '',
  ].join(' ').toUpperCase();

  // Free text matches loosely; a no-space query also matches across the joins.
  return hay.includes(parsed.text) || hay.replace(/[^A-Z0-9]/g, '').includes(q);
}

/** Is this query specific enough to be worth a global lookup? */
export function isTargeted(parsed) {
  return !!(parsed.reg || parsed.callsign || parsed.hex);
}

/**
 * Ask the feed for this exact aircraft, wherever it is.
 * Tries the most specific reading of the query first, then the alternatives —
 * "EKM" is probably 4X-EKM, but if nothing answers we still try it as text.
 *
 * @param {(kind:string, value:string)=>Promise<Array>} fetchOne
 * @returns {Promise<{raw:Array, via:string}>}
 */
export async function lookupGlobal(parsed, fetchOne) {
  const tries = [];
  if (parsed.hex) tries.push(['hex', parsed.hex]);
  if (parsed.reg) tries.push(['reg', parsed.reg]);
  if (parsed.callsign) tries.push(['callsign', parsed.callsign]);
  // A three-letter shorthand that isn't a 4X- tail may still be an airline code
  // or a callsign the user half-typed; don't guess further than that.

  for (const [kind, value] of tries) {
    const raw = await fetchOne(kind, value);
    if (raw && raw.length) return { raw, via: `${kind}:${value}` };
  }
  return { raw: [], via: '' };
}

/** Human explanation of what we searched for, shown when nothing is in view. */
export function describe(parsed) {
  if (parsed.shorthand) return `${parsed.reg} (three letters = a ${HOME_PREFIX}- tail)`;
  if (parsed.reg) return parsed.reg;
  if (parsed.callsign) return parsed.callsign;
  if (parsed.hex) return `Mode S ${parsed.hex}`;
  return parsed.text;
}
