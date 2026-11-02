// crew.js — THE list of crew slots. Every module that walks a leg's crew
// imports it from here.
//
// It used to be copied by hand into about twenty places (storage migrations,
// the registry, analytics, the logbook, the PA tokens, the data card, the
// roster parser, the share-link packer…). Each limit was raised by finding
// every copy — cabin crew went 5 → 8 that way — and any copy missed would
// quietly drop people. One list means one number to change.
//
// Deliberately imports nothing, so anything can import it without creating a
// load-order cycle.

// Pilots beyond the two seats, by rank: a second captain, a second and third
// first officer. There is no relief-pilot rank: a pilot flying cruise relief
// is a captain or a first officer, and is shown as one (CPT 1 / CPT 2, FO 1 /
// FO 2). Five pilots in all; a sixth shares the last slot of their rank.
export const EXTRA_CPT_KEYS = ['cpt2'];
export const EXTRA_FO_KEYS  = ['fo2', 'fo3'];

// Cabin crew. A 737 carries 4–6, a 787 or 777 long-haul many more; the old
// limit of 8 cut long-haul cabins short. cc1 is always the purser.
export const CABIN_SLOTS = 16;

export const PILOT_KEYS  = ['cpt', ...EXTRA_CPT_KEYS, 'fo', ...EXTRA_FO_KEYS];
export const CABIN_KEYS  = Array.from({ length: CABIN_SLOTS }, (_, i) => `cc${i + 1}`);

// The working crew: who counts for "most flown with", the crew registry, the
// PA name tokens and the logbook.
export const CREW_KEYS = [...PILOT_KEYS, ...CABIN_KEYS];

// Everything crew-shaped on a leg, including deadheads. `dh` is one
// comma-separated text field: deadheads are passengers on the leg, not crew
// working it, so they aren't counted as flown-with.
export const CREW_FIELDS = [...CREW_KEYS, 'dh'];

// A pilot's label: CPT and FO, numbered only when the flight has more than
// one of that rank. `isFilled(key)` says which slots this flight has filled.
function pilotLabel(key, isFilled) {
  const m = /^(cpt|fo)(\d?)$/.exec(key);
  if (!m) return null;
  const rank = m[1] === 'cpt' ? 'CPT' : 'FO';
  if (m[2]) return `${rank} ${m[2]}`;
  const extra = m[1] === 'cpt' ? EXTRA_CPT_KEYS : EXTRA_FO_KEYS;
  return extra.some(k => isFilled(k)) ? `${rank} 1` : rank;
}

export function crewLabel(key, isFilled = () => false) {
  const p = pilotLabel(key, isFilled);
  if (p) return p;
  if (key === 'dh')  return 'Deadhead';
  if (key === 'cc1') return 'Purser (PU)';
  const m = /^cc(\d+)$/.exec(key);
  if (m) return `CC${m[1]}`;
  return key.toUpperCase();
}

// Short label for compact places (logbook chips).
export function crewShort(key, isFilled = () => false) {
  const p = pilotLabel(key, isFilled);
  if (p) return p;
  if (key === 'cc1') return 'PU';
  if (key === 'dh')  return 'DH';
  return key.toUpperCase();
}

// Which slots an editing view shows. CPT and FO always; every filled slot;
// plus the FIRST free slot of each kind after the last filled one — one place
// to add a second captain, another FO or a cabin crew member rather than a
// column of empty boxes. Deadhead always, so a positioning crew member can be
// added at any time.
export function slotsToShow(isFilled) {
  const out = [];
  const group = (keys) => {
    let last = -1;
    keys.forEach((k, i) => { if (isFilled(k)) last = i; });
    keys.forEach((k, i) => { if (isFilled(k) || i === last + 1) out.push(k); });
  };
  out.push('cpt'); group(EXTRA_CPT_KEYS);
  out.push('fo');  group(EXTRA_FO_KEYS);
  group(CABIN_KEYS);
  out.push('dh');
  return out;
}

// Into named slots in order; anyone past the last shares it, comma-separated,
// so nobody is dropped.
export function intoSlots(names, keys) {
  const out = {};
  keys.forEach((k, i) => { out[k] = names[i] || ''; });
  if (names.length > keys.length) out[keys[keys.length - 1]] = names.slice(keys.length - 1).join(', ');
  return out;
}
