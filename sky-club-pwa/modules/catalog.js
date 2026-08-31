// catalog.js — static body metadata + kid-facts shared by the Explore orrery and the Sky screen.
// One short fact per body: written to be read aloud in a single breath.

export const SUN = {
  id: 'sun', name: 'Sun', emoji: '☀️', texture: 'icons/textures/sun.jpg',
  diameter: '1,392,700 km', dayLength: '25 days',
  color: '#ffcf5c', sizePx: 84, skySize: 40,
  fact: 'The Sun is a giant ball of glowing fire that gives us light and warmth.',
  safety: 'Never look right at the real sun — it can hurt your eyes!',
};

export const MOON = {
  id: 'moon', name: 'Moon', emoji: '🌙', texture: 'icons/textures/moon.jpg',
  diameter: '3,475 km', dayLength: '27.3 days',
  color: '#dfe3ea', light: '#f3f5fe', dark: '#9397ab', sizePx: 14, skySize: 46,
  fact: 'The Moon circles our Earth and lights up our night sky.',
};

// order = distance from the Sun. sizePx is square-root-scaled from the real
// diameter (km) of each planet — compressed so Mercury doesn't disappear next to
// Jupiter, but relative sizing still tracks reality. orbitPx is NOT purely
// distance-scaled: it's the sqrt-distance ordering pushed out just far enough that
// consecutive circles (and the Sun) never touch, with ~8px of clear space between
// every pair at closest approach — see computeOrbitRadii() below. A pure sqrt-AU
// scale bunches the four inner planets close enough that their circles overlap the
// Sun and each other; real orreries live with that visually-cluttered core (or
// scale distance and size completely independently), and giving them dedicated
// breathing room reads far more clearly on a small screen.
// The Explore screen (orbits.js) turns these into an actual position using each
// planet's real ecliptic longitude for the selected date (astro.js), not a fixed
// animation speed — so this is a real (if compressed) picture of the solar system
// on any given day, not just a decorative spin.
// light/dark: the exact two-tone gradient pairs from the Nocturne design mockup
// (`Sky Club.dc.html`'s DATA/SKY arrays) — used for the orrery's small orbiting
// dot and the Sky screen's marker, both flat glowing spheres rather than the
// photo texture (which only reads well at the bigger card size, see orbits.js).
// skySize: a modest, roughly-brightness-ordered size for the Sky-screen marker —
// independent of sizePx (which is scaled for the orrery's real-diameter ordering
// and would make the Sun comically huge as a sky marker).
export const PLANETS = [
  { id: 'mercury', diameter: '4,879 km', dayLength: '59 days', name: 'Mercury', emoji: '🪨', texture: 'icons/textures/mercury.jpg', color: '#b9a89a', light: '#d8cdc2', dark: '#6f6157', sizePx: 14, skySize: 16,
    fact: 'Mercury is the closest planet to the Sun and gets super hot in the day.' },
  { id: 'venus', diameter: '12,104 km', dayLength: '243 days', name: 'Venus', emoji: '🌕', texture: 'icons/textures/venus.jpg', color: '#e8c48c', light: '#f7e3b4', dark: '#b8863c', sizePx: 18, skySize: 20,
    fact: 'Venus is wrapped in thick clouds and is the hottest planet of all!' },
  { id: 'earth', diameter: '12,756 km', dayLength: '24 hours', name: 'Earth', emoji: '🌍', texture: 'icons/textures/earth.jpg', color: '#5aa4e8', light: '#8fd0ee', dark: '#255f92', sizePx: 19, skySize: 20,
    fact: 'Earth is our home — the only planet with oceans, air, and you!' },
  { id: 'mars', diameter: '6,792 km', dayLength: '24.6 hours', name: 'Mars', emoji: '🔴', texture: 'icons/textures/mars.jpg', color: '#e07a5f', light: '#f09468', dark: '#93381f', sizePx: 15, skySize: 17,
    fact: 'Mars is called the Red Planet because its dusty ground is rusty orange.' },
  { id: 'jupiter', diameter: '142,984 km', dayLength: '9.9 hours', name: 'Jupiter', emoji: '🟠', texture: 'icons/textures/jupiter.jpg', color: '#d9a066', light: '#f2d3ac', dark: '#94643c', sizePx: 46, skySize: 22,
    fact: 'Jupiter is the biggest planet — over a thousand Earths could fit inside!' },
  { id: 'saturn', diameter: '120,536 km', dayLength: '10.7 hours', name: 'Saturn', emoji: '🪐', texture: 'icons/textures/saturn.jpg', color: '#e8cf9a', light: '#f6e5b8', dark: '#a8874a', sizePx: 43, skySize: 19, ring: true,
    fact: 'Saturn wears beautiful rings made of ice and rock, like a hat!' },
  { id: 'uranus', diameter: '50,724 km', dayLength: '17.2 hours', name: 'Uranus', emoji: '🔵', texture: 'icons/textures/uranus.jpg', color: '#9fd8d8', light: '#bdeef2', dark: '#4b8c9c', sizePx: 30, skySize: 16,
    fact: 'Uranus spins on its side, rolling around the Sun like a ball.' },
  { id: 'neptune', diameter: '49,244 km', dayLength: '16.1 hours', name: 'Neptune', emoji: '🔷', texture: 'icons/textures/neptune.jpg', color: '#5b7fe0', light: '#9db4f7', dark: '#2f4794', sizePx: 29, skySize: 16,
    fact: 'Neptune is a deep blue planet, way out at the edge of our solar family.' },
];

const ORBIT_GAP = 8;       // minimum clear space, in px, between any two neighboring circles
// The rendered ring (app.css .ring-layer) is 288% of the planet's own width, so
// it extends 0.94x the planet's own size beyond its edge — RING_PAD has to cover
// that or the ring visually overlaps Jupiter/Uranus on their neighboring orbits.
const RING_PAD = 42;

/** Assigns each planet an orbitPx radius, guaranteeing no circle ever overlaps the
 * Sun or its neighbors: each ring sits at (previous ring + both radii + the gap). */
(function computeOrbitRadii() {
  let edge = SUN.sizePx / 2; // outer edge of the previous body
  for (const planet of PLANETS) {
    const spacingRadius = planet.sizePx / 2 + (planet.ring ? RING_PAD : 0);
    const orbit = edge + ORBIT_GAP + spacingRadius;
    planet.orbitPx = Math.round(orbit);
    edge = orbit + spacingRadius;
  }
})();

/** Everything Sky mode can point at, keyed by the id astro.js hands back (lowercase body name). */
export const SKY_BODIES = Object.fromEntries(
  [SUN, MOON, ...PLANETS].map((b) => [b.id, b])
);

export function bodyById(id) {
  return SKY_BODIES[id] || null;
}
