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

// Pilots beyond the captain and first officer: augmented / relief crew on
// long-haul (a 4-pilot 787 crew is CPT + FO + 2). Three covers five pilots.
export const RELIEF_SLOTS = 3;

// Cabin crew. A 737 carries 4–6, a 787 or 777 long-haul many more; the old
// limit of 8 cut long-haul cabins short. cc1 is always the purser.
export const CABIN_SLOTS = 16;

export const RELIEF_KEYS = Array.from({ length: RELIEF_SLOTS }, (_, i) => `rp${i + 1}`);
export const PILOT_KEYS  = ['cpt', 'fo', ...RELIEF_KEYS];
export const CABIN_KEYS  = Array.from({ length: CABIN_SLOTS }, (_, i) => `cc${i + 1}`);

// The working crew: who counts for "most flown with", the crew registry, the
// PA name tokens and the logbook.
export const CREW_KEYS = [...PILOT_KEYS, ...CABIN_KEYS];

// Everything crew-shaped on a leg, including deadheads. `dh` is one
// comma-separated text field: deadheads are passengers on the leg, not crew
// working it, so they aren't counted as flown-with.
export const CREW_FIELDS = [...CREW_KEYS, 'dh'];

export function crewLabel(key) {
  if (key === 'cpt') return 'CPT';
  if (key === 'fo')  return 'FO';
  if (key === 'dh')  return 'Deadhead';
  if (key === 'cc1') return 'Purser (PU)';
  let m = /^rp(\d+)$/.exec(key);
  if (m) return RELIEF_SLOTS > 1 ? `Relief pilot ${m[1]}` : 'Relief pilot';
  m = /^cc(\d+)$/.exec(key);
  if (m) return `CC${m[1]}`;
  return key.toUpperCase();
}

// Short label for compact places (logbook chips).
export function crewShort(key) {
  if (key === 'cc1') return 'PU';
  if (key === 'dh')  return 'DH';
  const m = /^rp(\d+)$/.exec(key);
  if (m) return 'RLF';
  return key.toUpperCase();
}

// Which slots an editing view shows. CPT and FO always; every filled relief
// and cabin slot; plus the FIRST free slot of each kind after the last filled
// one — one place to add a person rather than a column of empty boxes (with
// sixteen cabin slots, "show everything" would be twenty-odd inputs).
// Deadhead always, so a positioning crew member can be added at any time.
export function slotsToShow(isFilled) {
  const out = ['cpt', 'fo'];
  for (const group of [RELIEF_KEYS, CABIN_KEYS]) {
    let last = -1;
    group.forEach((k, i) => { if (isFilled(k)) last = i; });
    group.forEach((k, i) => { if (isFilled(k) || i === last + 1) out.push(k); });
  }
  out.push('dh');
  return out;
}
