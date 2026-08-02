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

// ── size classes ────────────────────────────────────────────────────────────
//
// Wake-turbulence categories, near enough: the same four buckets a controller
// separates traffic by, and the same cue — bigger symbol, bigger aeroplane —
// read without having to think about it.
export const SIZE = {
  SUPER: 'super',       // A380, An-225: their own category
  HEAVY: 'heavy',       // widebodies, 136 t+
  MEDIUM: 'medium',     // narrowbodies, 7–136 t
  REGIONAL: 'regional', // regional jets and turboprops
  LIGHT: 'light',       // everything smaller
};

const SUPER_TYPES = new Set(['A388', 'A124', 'A225']);
// Prefix matching only where the prefix can't collide. Short military codes get
// an exact set instead: `C17` as a prefix also matches the Cessna 172, which is
// how a training aeroplane ends up drawn as a Globemaster.
const HEAVY_RE = /^(A30|A31|A33|A34|A35|B74|B75|B76|B77|B78|MD11|IL96|IL86|IL76|AN12|AN22|AN124)/;
const HEAVY_TYPES = new Set(['C17', 'C5M', 'B52', 'A400', 'K35R', 'KC46', 'KC10', 'E3TF', 'E3CF', 'P8', 'B788']);
const REGIONAL_RE = /^(AT[47]|DH8|CRJ|E13|E14|E17|E19|E29|E75|SF34|J328|SB20|F50|F70|RJ8|RJ1|B46|SU95|AN24|AN26|D328|C295|CN35|C27J)/;
const LIGHT_RE = /^(C1[0-9]{2}|C2[0-9]{2}|PA[0-9]|P28|P32|SR2|DA[0-9]|BE[0-9]|PC12|SW4|D228|TBM|M20|AT8|GLID|EC[0-9]|R22|R44)/;

/** Which size class an aircraft belongs to, from its type and ADS-B category. */
export function sizeClass(type, category) {
  const t = String(type || '').toUpperCase();
  const cat = String(category || '').toUpperCase();
  if (SUPER_TYPES.has(t) || cat === 'A6') return SIZE.SUPER;
  if (HEAVY_TYPES.has(t) || HEAVY_RE.test(t)) return SIZE.HEAVY;
  if (LIGHT_RE.test(t)) return SIZE.LIGHT;
  if (REGIONAL_RE.test(t)) return SIZE.REGIONAL;
  // The type is the stronger signal; category only decides what it can't.
  if (cat === 'A5') return SIZE.HEAVY;
  if (cat === 'A3' || cat === 'A4') return SIZE.MEDIUM;
  if (cat === 'A1' || cat === 'A2') return SIZE.LIGHT;
  if (cat === 'A7') return SIZE.LIGHT;   // rotorcraft: small symbol, own shape
  return SIZE.MEDIUM;
}

const SIZE_SCALE = {
  super: 1.42, heavy: 1.2, medium: 1, regional: 0.86, light: 0.72,
};

export function sizeFor(type, category) {
  return SIZE_SCALE[sizeClass(type, category)] || 1;
}

export const SIZE_LABEL = {
  super: 'Super', heavy: 'Heavy', medium: 'Medium', regional: 'Regional', light: 'Light',
};

// ── type names ──────────────────────────────────────────────────────────────

// The specific model, by ICAO type code.
const MODELS = {
  B733: 'Boeing 737-300', B734: 'Boeing 737-400', B735: 'Boeing 737-500',
  B736: 'Boeing 737-600', B737: 'Boeing 737-700', B738: 'Boeing 737-800',
  B739: 'Boeing 737-900', B37M: 'Boeing 737 MAX 7', B38M: 'Boeing 737 MAX 8',
  B39M: 'Boeing 737 MAX 9', B3XM: 'Boeing 737 MAX 10',
  B752: 'Boeing 757-200', B753: 'Boeing 757-300',
  B762: 'Boeing 767-200', B763: 'Boeing 767-300', B764: 'Boeing 767-400',
  B772: 'Boeing 777-200', B77L: 'Boeing 777-200LR', B773: 'Boeing 777-300',
  B77W: 'Boeing 777-300ER', B778: 'Boeing 777-8', B779: 'Boeing 777-9',
  B788: 'Boeing 787-8', B789: 'Boeing 787-9', B78X: 'Boeing 787-10',
  B741: 'Boeing 747-100', B742: 'Boeing 747-200', B743: 'Boeing 747-300',
  B744: 'Boeing 747-400', B748: 'Boeing 747-8', B74F: 'Boeing 747 Freighter',
  B712: 'Boeing 717-200', B722: 'Boeing 727-200',
  A318: 'Airbus A318', A319: 'Airbus A319', A320: 'Airbus A320', A321: 'Airbus A321',
  A19N: 'Airbus A319neo', A20N: 'Airbus A320neo', A21N: 'Airbus A321neo',
  A306: 'Airbus A300-600', A30B: 'Airbus A300', A310: 'Airbus A310',
  A332: 'Airbus A330-200', A333: 'Airbus A330-300', A338: 'Airbus A330-800neo',
  A339: 'Airbus A330-900neo', A337: 'Airbus A330-700 Beluga XL',
  A342: 'Airbus A340-200', A343: 'Airbus A340-300', A345: 'Airbus A340-500',
  A346: 'Airbus A340-600', A359: 'Airbus A350-900', A35K: 'Airbus A350-1000',
  A388: 'Airbus A380-800',
  BCS1: 'Airbus A220-100', BCS3: 'Airbus A220-300',
  E170: 'Embraer 170', E75L: 'Embraer 175', E75S: 'Embraer 175',
  E190: 'Embraer 190', E195: 'Embraer 195', E290: 'Embraer E190-E2',
  E295: 'Embraer E195-E2', E145: 'Embraer ERJ-145', E135: 'Embraer ERJ-135',
  CRJ2: 'Bombardier CRJ200', CRJ7: 'Bombardier CRJ700',
  CRJ9: 'Bombardier CRJ900', CRJX: 'Bombardier CRJ1000',
  AT43: 'ATR 42-300', AT45: 'ATR 42-500', AT72: 'ATR 72',
  AT75: 'ATR 72-500', AT76: 'ATR 72-600',
  DH8A: 'Dash 8-100', DH8C: 'Dash 8-300', DH8D: 'Dash 8 Q400',
  MD82: 'McDonnell Douglas MD-82', MD83: 'McDonnell Douglas MD-83',
  MD88: 'McDonnell Douglas MD-88', MD90: 'McDonnell Douglas MD-90',
  MD11: 'McDonnell Douglas MD-11',
  SU95: 'Sukhoi Superjet 100', C919: 'COMAC C919', ARJ2: 'COMAC ARJ21',
  SF34: 'Saab 340', RJ85: 'Avro RJ85', RJ1H: 'Avro RJ100',
};

// The family a model belongs to — what a pilot says out loud. Only where the
// family name adds something the model name doesn't already carry.
const FAMILIES = {
  B733: '737 Classic', B734: '737 Classic', B735: '737 Classic',
  B736: '737NG', B737: '737NG', B738: '737NG', B739: '737NG',
  B37M: '737 MAX', B38M: '737 MAX', B39M: '737 MAX', B3XM: '737 MAX',
  A318: 'A320 family', A319: 'A320 family', A320: 'A320 family', A321: 'A320 family',
  A19N: 'A320neo family', A20N: 'A320neo family', A21N: 'A320neo family',
  A332: 'A330ceo', A333: 'A330ceo', A338: 'A330neo', A339: 'A330neo',
  A359: 'A350 XWB', A35K: 'A350 XWB',
  B788: 'Dreamliner', B789: 'Dreamliner', B78X: 'Dreamliner',
  B772: 'Triple Seven', B77L: 'Triple Seven', B773: 'Triple Seven', B77W: 'Triple Seven',
  B778: '777X', B779: '777X',
  B741: 'Jumbo', B742: 'Jumbo', B743: 'Jumbo', B744: 'Jumbo', B748: 'Jumbo',
  A388: 'Superjumbo',
  BCS1: 'A220', BCS3: 'A220',
  E170: 'E-Jet', E75L: 'E-Jet', E75S: 'E-Jet', E190: 'E-Jet', E195: 'E-Jet',
  E290: 'E-Jet E2', E295: 'E-Jet E2',
};

/** The specific model, e.g. "Boeing 737-800". Falls back to the type code. */
export function familyOf(type, desc) {
  const t = String(type || '').toUpperCase();
  if (MODELS[t]) return MODELS[t];
  if (desc) return desc;
  return t;
}

/** The family and size class together, e.g. "737NG · Medium". */
export function classLine(type, category) {
  const t = String(type || '').toUpperCase();
  const fam = FAMILIES[t];
  const size = SIZE_LABEL[sizeClass(t, category)];
  return fam ? `${fam} · ${size}` : size;
}

/**
 * The map symbol: a top-down airliner silhouette, rotated to the ground track.
 * Drawn as an inline SVG divIcon so it scales crisply and can be re-coloured
 * without touching the DOM structure.
 */
// One silhouette per kind, so traffic is told apart by shape at a glance and
// colour stays free to mean altitude. Each is drawn nose-up in a 32×32 box.
const SHAPES = {
  // Airliner: swept wings, T-shaped tailplane. Narrowbody proportions — the
  // widebody and regional variants below are the same drawing with the wing
  // span and sweep changed, so the family stays recognisable and only the size
  // reads differently.
  airline: 'M16 1.6 c1.5 0 2.4 2.1 2.5 5.2 l0 3.1 11.2 6.6 0 3.1 -11.2 -3.4 0 5.9 3.9 2.9 0 2.3 -6.4 -1.7 -6.4 1.7 0 -2.3 3.9 -2.9 0 -5.9 -11.2 3.4 0 -3.1 11.2 -6.6 0 -3.1 c0.1 -3.1 1 -5.2 2.5 -5.2 z',
  // Widebody: longer fuselage, wider and more swept wing.
  heavy: 'M16 1 c1.7 0 2.7 2.3 2.8 5.6 l0 3.4 13.0 7.2 0 3.3 -13.0 -3.6 0 6.6 4.4 3.2 0 2.5 -7.2 -1.9 -7.2 1.9 0 -2.5 4.4 -3.2 0 -6.6 -13.0 3.6 0 -3.3 13.0 -7.2 0 -3.4 c0.1 -3.3 1.1 -5.6 2.8 -5.6 z',
  // Super: the widest wing of all, and a fuselage that runs the whole box.
  super: 'M16 0.6 c1.9 0 3.0 2.5 3.1 6.0 l0 3.6 14.4 7.6 0 3.5 -14.4 -3.8 0 7.2 4.8 3.4 0 2.7 -7.9 -2.1 -7.9 2.1 0 -2.7 4.8 -3.4 0 -7.2 -14.4 3.8 0 -3.5 14.4 -7.6 0 -3.6 c0.1 -3.5 1.2 -6.0 3.1 -6.0 z',
  // Regional jet / turboprop: short, nearly straight wing.
  regional: 'M16 3 c1.3 0 2.1 1.9 2.2 4.6 l0 3.0 9.4 4.0 0 2.8 -9.4 -2.4 0 5.4 3.4 2.6 0 2.1 -5.6 -1.5 -5.6 1.5 0 -2.1 3.4 -2.6 0 -5.4 -9.4 2.4 0 -2.8 9.4 -4.0 0 -3.0 c0.1 -2.7 0.9 -4.6 2.2 -4.6 z',
  // Military jet: sharp delta, clipped tail — reads as fast and pointed.
  military: 'M16 2 l2.2 8.4 0 2.6 11 8.4 0 3.2 -11 -3.6 0 4.4 3.4 3.4 0 2.2 -5.6 -2 -5.6 2 0 -2.2 3.4 -3.4 0 -4.4 -11 3.6 0 -3.2 11 -8.4 0 -2.6 z',
  // Business jet: slim fuselage, small wings, tail-mounted engines.
  bizjet: 'M16 3 c1.2 0 1.9 1.8 2 4.4 l0 5.6 9.4 5.6 0 2.6 -9.4 -2.8 0 4.6 3 2.4 0 1.9 -5 -1.4 -5 1.4 0 -1.9 3 -2.4 0 -4.6 -9.4 2.8 0 -2.6 9.4 -5.6 0 -5.6 c0.1 -2.6 0.8 -4.4 2 -4.4 z',
  // Light aircraft: straight high wing, fat prop nose.
  light: 'M16 4 c1.1 0 1.7 1.4 1.8 3.6 l0 3.4 11.2 2.6 0 2.8 -11.2 -1.4 0 6.4 3.4 2.2 0 1.8 -5.2 -1.2 -5.2 1.2 0 -1.8 3.4 -2.2 0 -6.4 -11.2 1.4 0 -2.8 11.2 -2.6 0 -3.4 c0.1 -2.2 0.7 -3.6 1.8 -3.6 z',
};

/** Helicopter: fuselage plus a rotor disc — nothing else on the map looks like it. */
function heliSvg({ color, stroke, sw, w, rot, opacity }) {
  return `<svg viewBox="0 0 32 32" width="${w}" height="${w}" style="transform:rotate(${rot}deg);opacity:${opacity}" aria-hidden="true">
    <path d="M16 8 c1.6 0 2.6 1.6 2.6 4.2 l0 7.4 3.2 3.2 0 1.8 -5.8 -1.4 -5.8 1.4 0 -1.8 3.2 -3.2 0 -7.4 c0 -2.6 1 -4.2 2.6 -4.2 z"
      fill="${color}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/>
    <g stroke="${color}" stroke-width="1.5" stroke-linecap="round" opacity=".9">
      <line x1="5" y1="5" x2="27" y2="27"/><line x1="27" y1="5" x2="5" y2="27"/>
    </g>
    <circle cx="16" cy="16" r="1.6" fill="${stroke}"/>
  </svg>`;
}

// Engine pods, so a four-engine Jumbo doesn't read the same as a twin. Drawn
// on the wing in the same rotated group as the body.
const PODS = {
  super: [[7.6, 19.4], [10.6, 18.0], [21.4, 18.0], [24.4, 19.4]],
  heavy: [[10.4, 18.6], [21.6, 18.6]],
};

function podMarks(cls, stroke) {
  const pods = PODS[cls];
  if (!pods) return '';
  return pods.map(([x, y]) =>
    `<rect x="${x - 1.05}" y="${y - 1.5}" width="2.1" height="3.6" rx="1"
       fill="${stroke}" opacity=".75"/>`).join('');
}

export function planeSvg({ color, track, scale = 1, selected = false, ground = false, ghost = false, kind = 'airline', cls = '' }) {
  const w = Math.round(30 * scale);
  const rot = Number.isFinite(track) ? track : 0;
  const stroke = selected ? '#ffffff' : 'rgba(0,0,0,.55)';
  const sw = selected ? 1.6 : 1;
  const opacity = ghost ? 0.9 : (ground ? 0.75 : 1);
  if (kind === 'heli' && !ghost) return heliSvg({ color, stroke, sw, w, rot, opacity });
  // Airliners vary by size class; every other kind has one silhouette.
  const shapeKey = kind === 'airline' && SHAPES[cls] ? cls : kind;
  const body = `<path d="${SHAPES[shapeKey] || SHAPES.airline}"`;
  const pods = kind === 'airline' && !ghost ? podMarks(cls, stroke) : '';

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
    ${pods}
  </svg>`;
}
