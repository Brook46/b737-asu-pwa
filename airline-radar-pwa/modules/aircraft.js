// aircraft.js — how an aircraft looks on the map: the symbol, its size, and
// the colour that encodes altitude.
//
// The altitude ramp is the one piece of the display that has to be readable at
// a glance: dark blue on the ground, cyan through the climb, green in the
// mid-levels, amber in the upper twenties, hot pink at cruise levels. It's a
// perceptual ramp, not a rainbow — adjacent flight levels stay distinguishable.

const RAMP = [
  [0,     '#7e8ba3'],  // on/near the ground — grey-blue
  [3000,  '#4fc3f7'],  // circuit / departure
  [10000, '#37d67a'],  // below the transition, climbing out
  [20000, '#b8e04a'],
  [28000, '#f6c343'],
  [34000, '#f5844a'],
  [40000, '#ef5da8'],  // cruise levels and above
];

function lerp(a, b, t) { return a + (b - a) * t; }

function hex2rgb(h) {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

/** Colour for a pressure altitude in feet. */
export function altColor(alt) {
  if (alt === null || alt === undefined || !Number.isFinite(alt)) return '#7e8ba3';
  const a = Math.max(0, alt);
  if (a >= RAMP[RAMP.length - 1][0]) return RAMP[RAMP.length - 1][1];
  for (let i = 1; i < RAMP.length; i++) {
    if (a <= RAMP[i][0]) {
      const t = (a - RAMP[i - 1][0]) / (RAMP[i][0] - RAMP[i - 1][0]);
      const c1 = hex2rgb(RAMP[i - 1][1]);
      const c2 = hex2rgb(RAMP[i][1]);
      const c = c1.map((v, k) => Math.round(lerp(v, c2[k], t)));
      return `rgb(${c[0]},${c[1]},${c[2]})`;
    }
  }
  return RAMP[0][1];
}

export const LEGEND = [
  ['GND', '#7e8ba3'], ['3', '#4fc3f7'], ['100', '#37d67a'],
  ['200', '#b8e04a'], ['280', '#f6c343'], ['340', '#f5844a'], ['400+', '#ef5da8'],
];

// Wide-bodies get a bigger symbol, regional jets and turboprops a smaller one —
// the same size cue a radar controller reads without thinking about it.
const HEAVY = /^(A33|A34|A35|A38|A30|A31|B74|B77|B78|B76|B75|MD11|IL96|A337|A338|A339)/;
const LIGHT = /^(AT[47]|DH8|CRJ|E13|E14|SF34|J328|BE|SB20|F50|F70)/;

export function sizeFor(type) {
  const t = String(type || '').toUpperCase();
  if (HEAVY.test(t)) return 1.22;
  if (LIGHT.test(t)) return 0.84;
  return 1;
}

/** Rough manufacturer/family label, e.g. "Boeing 737 MAX 8". */
export function familyOf(type, desc) {
  if (desc) return desc;
  const t = String(type || '').toUpperCase();
  const map = {
    B738: 'Boeing 737-800', B737: 'Boeing 737-700', B739: 'Boeing 737-900',
    B38M: 'Boeing 737 MAX 8', B39M: 'Boeing 737 MAX 9', B37M: 'Boeing 737 MAX 7',
    B3XM: 'Boeing 737 MAX 10', B752: 'Boeing 757-200', B763: 'Boeing 767-300',
    B77W: 'Boeing 777-300ER', B77L: 'Boeing 777-200LR', B772: 'Boeing 777-200',
    B788: 'Boeing 787-8', B789: 'Boeing 787-9', B78X: 'Boeing 787-10',
    B744: 'Boeing 747-400', B748: 'Boeing 747-8',
    A320: 'Airbus A320', A319: 'Airbus A319', A321: 'Airbus A321',
    A20N: 'Airbus A320neo', A21N: 'Airbus A321neo', A19N: 'Airbus A319neo',
    A332: 'Airbus A330-200', A333: 'Airbus A330-300', A339: 'Airbus A330-900neo',
    A359: 'Airbus A350-900', A35K: 'Airbus A350-1000', A388: 'Airbus A380-800',
    E190: 'Embraer 190', E195: 'Embraer 195', E75L: 'Embraer 175',
    BCS1: 'Airbus A220-100', BCS3: 'Airbus A220-300',
    AT76: 'ATR 72-600', AT75: 'ATR 72-500', DH8D: 'Dash 8 Q400',
  };
  return map[t] || t;
}

/**
 * The map symbol: a top-down airliner silhouette, rotated to the ground track.
 * Drawn as an inline SVG divIcon so it scales crisply and can be re-coloured
 * without touching the DOM structure.
 */
export function planeSvg({ color, track, scale = 1, selected = false, ground = false, ghost = false }) {
  const w = Math.round(30 * scale);
  const rot = Number.isFinite(track) ? track : 0;
  const stroke = selected ? '#ffffff' : 'rgba(0,0,0,.55)';
  const sw = selected ? 1.6 : 1;
  const opacity = ghost ? 0.9 : (ground ? 0.75 : 1);
  const body = `<path d="M16 1.6 c1.5 0 2.4 2.1 2.5 5.2 l0 3.1 11.2 6.6 0 3.1 -11.2 -3.4 0 5.9 3.9 2.9 0 2.3 -6.4 -1.7 -6.4 1.7 0 -2.3 3.9 -2.9 0 -5.9 -11.2 3.4 0 -3.1 11.2 -6.6 0 -3.1 c0.1 -3.1 1 -5.2 2.5 -5.2 z"`;

  // A last-known position is drawn hollow inside a dashed ring: it is a memory,
  // not a contact, and it must never read like a live target.
  if (ghost) {
    return `<svg viewBox="0 0 32 32" width="${w}" height="${w}" style="opacity:${opacity}" aria-hidden="true">
      <circle cx="16" cy="16" r="14" fill="none" stroke="${color}" stroke-width="1.4"
        stroke-dasharray="3 3" opacity=".85"/>
      <g style="transform:rotate(${rot}deg);transform-origin:16px 16px">
        ${body} fill="none" stroke="${color}" stroke-width="1.7" stroke-linejoin="round"/>
      </g>
    </svg>`;
  }

  return `<svg viewBox="0 0 32 32" width="${w}" height="${w}" style="transform:rotate(${rot}deg);opacity:${opacity}" aria-hidden="true">
    ${body} fill="${color}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/>
  </svg>`;
}
