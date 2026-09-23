// data/advance-omega-uls.js — ADVANCE OMEGA ULS (OMEGA XA 5 ULS, 2023), EN/LTF D.
//
// Line naming and cascade topology come from Advance's own published line plan:
//   https://app.advance.ch/upload/product/documents/OMEGA%20XA%205%20ULS%20Lineplan_final.pdf
// Advance names lines <level><riser><index>: level 1 is the canopy attachment
// point, higher levels are the cascade down to the riser. The line-check length
// is the developed length from the riser to each level-1 point.
//
// NOMINAL LENGTHS — provenance, read this before trusting them:
//
//   sizes 22 and 23  REAL. Taken from public measurement protocols on
//                    we-measure.io for this exact model and size, which carry
//                    the manufacturer nominals. Verified two ways: two
//                    independent size-22 protocols agree on every main to the
//                    centimetre, and in both sizes every published main value
//                    reproduces exactly as the mean of its suspension points
//                    (see test/check-omega.mjs, which asserts this).
//
//   sizes 21 and 24  NOT AVAILABLE. No public protocol exists for them and
//                    Advance's per-size Line Check PDF sits behind a My Advance
//                    owner login. The topology below is real; the lengths are
//                    absent rather than guessed. Load yours from
//                    my.advance.swiss → Inspection → Line check, then paste it
//                    into Setup → "Add lengths".
//
// Brake/steering lines (1S1…1S5, SL Low/Up) are deliberately absent: Advance's
// line-check protocol does not include them, and neither do the public
// protocols for this wing.

// Span-wise sections. 1 = innermost, 3 = outermost structural, 4 = stabilo.
// Each structural section pairs a front (A/B) main with a rear (C/D) main, which
// is what makes the angle-of-incidence number meaningful.
export const OMEGA_ULS_MAINS = [
  { id: '3AB1', riser: 'A',  section: 1,
    lines: ['1A1', '1A2', '1A3', '1A4', '1B1', '1B2', '1B3', '1B4'] },
  { id: '4CD1', riser: 'C',  section: 1,
    lines: ['1C1', '1C2', '1C3', '1C4', '1D1', '1D2', '1D3', '1D4'] },

  { id: '3AB2', riser: 'A',  section: 2,
    lines: ['1A5', '1A6', '1A7', '1A8', '1B5', '1B6', '1B7', '1B8'] },
  { id: '4CD2', riser: 'C',  section: 2,
    lines: ['1C5', '1C6', '1C7', '1C8', '1D5', '1D6', '1D7', '1D8'] },

  { id: '4AB1', riser: 'A',  section: 3,
    lines: ['1A9', '1A10', '1A11', '1A12', '1A13', '1A14', '1B9', '1B10'] },
  { id: '4C3',  riser: 'C',  section: 3,
    lines: ['1C9', '1C10', '1C11', '1C12', '1C13', '1C14'] },

  { id: 'AST',  riser: 'ST', section: 4,
    lines: ['1A15', '1A16', '1C15', '1C16'] },
];

/** Every level-1 line id this wing has, in the plan's own order. */
export const OMEGA_ULS_LINE_IDS = OMEGA_ULS_MAINS.flatMap(m => m.lines);

const SIZE_22 = {
  '1A1': 7429, '1A2': 7387, '1A3': 7346, '1A4': 7365,
  '1B1': 7413, '1B2': 7369, '1B3': 7331, '1B4': 7352,
  '1C1': 7416, '1C2': 7377, '1C3': 7336, '1C4': 7357,
  '1D1': 7502, '1D2': 7468, '1D3': 7419, '1D4': 7434,

  '1A5': 7291, '1A6': 7244, '1A7': 7165, '1A8': 7164,
  '1B5': 7280, '1B6': 7232, '1B7': 7152, '1B8': 7157,
  '1C5': 7283, '1C6': 7239, '1C7': 7159, '1C8': 7158,
  '1D5': 7353, '1D6': 7307, '1D7': 7215, '1D8': 7215,

  '1A9': 6994, '1A10': 6939, '1A11': 6825, '1A12': 6810,
  '1A13': 6692, '1A14': 6691, '1B9': 6984, '1B10': 6934,
  '1C9': 6983, '1C10': 6932, '1C11': 6847, '1C12': 6832,
  '1C13': 6742, '1C14': 6744,

  '1A15': 6423, '1A16': 6392, '1C15': 6431, '1C16': 6433,
};

const SIZE_23 = {
  '1A1': 7602, '1A2': 7558, '1A3': 7520, '1A4': 7539,
  '1B1': 7587, '1B2': 7541, '1B3': 7501, '1B4': 7525,
  '1C1': 7573, '1C2': 7531, '1C3': 7491, '1C4': 7513,
  '1D1': 7659, '1D2': 7622, '1D3': 7574, '1D4': 7590,

  '1A5': 7456, '1A6': 7408, '1A7': 7328, '1A8': 7328,
  '1B5': 7441, '1B6': 7394, '1B7': 7315, '1B8': 7316,
  '1C5': 7433, '1C6': 7388, '1C7': 7309, '1C8': 7312,
  '1D5': 7501, '1D6': 7456, '1D7': 7367, '1D8': 7366,

  '1A9': 7153, '1A10': 7097, '1A11': 6977, '1A12': 6961,
  '1A13': 6839, '1A14': 6839, '1B9': 7140, '1B10': 7089,
  '1C9': 7129, '1C10': 7080, '1C11': 6990, '1C12': 6975,
  '1C13': 6881, '1C14': 6883,

  '1A15': 6561, '1A16': 6526, '1C15': 6564, '1C16': 6569,
};

// Published main values, kept so the build-time check can verify that each one
// really is the mean of its suspension points.
export const OMEGA_ULS_PUBLISHED_MAINS = {
  '22': { '3AB1': 7374.00, '4CD1': 7413.63, '3AB2': 7210.63, '4CD2': 7241.13,
          '4AB1': 6858.63, '4C3': 6846.67, 'AST': 6419.75 },
  '23': { '3AB1': 7546.63, '4CD1': 7569.13, '3AB2': 7373.25, '4CD2': 7391.50,
          '4AB1': 7011.88, '4C3': 6989.67, 'AST': 6555.00 },
};

const size = (weight, lines) => ({
  pilotWeightKg: weight,
  mains: OMEGA_ULS_MAINS,
  lines: lines || null,
  needsLengths: !lines,
});

export const ADVANCE_OMEGA_ULS = {
  id: 'advance-omega-uls',
  brand: 'Advance',
  model: 'OMEGA ULS',
  wingClass: 'EN/LTF D',
  liners: 3,
  year: 2023,
  synthetic: false,
  source: 'Topology from Advance\'s published OMEGA XA 5 ULS line plan. '
        + 'Sizes 22 and 23 carry real manufacturer nominals (cross-checked against '
        + 'public we-measure.io protocols); sizes 21 and 24 need lengths from your '
        + 'own My Advance line-check sheet.',
  tensionKg: 5,
  tolIndMm: 10,
  tolGlobalMm: 50,
  sizes: {
    '21': size([65, 80], null),
    '22': size([75, 90], SIZE_22),
    '23': size([85, 100], SIZE_23),
    '24': size([95, 113], null),
  },
};
