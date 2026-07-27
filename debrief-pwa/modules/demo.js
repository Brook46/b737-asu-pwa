// demo.js — two synthetic flights, emitted as real IGC text.
//
// Why generate IGC rather than fabricate FlightTrack objects directly: the demo
// then exercises the actual parser, the actual metrics pipeline and the actual
// highlight detector. If the demo looks right, the real code path is right.
//
// The scenario is Monte Grappa → the Bassano plain (a real, well-known Italian
// site with 1 600 m of relief), on a westerly wind so the thermals drift. Two
// pilots fly the same day: "Alon" takes a committing low line across the valley
// and gets a genuine save; "Maya" launches later, stays high and lands early.
// Between them they trigger every one of the four highlight types.

const DT = 2;                    // logger interval, seconds
const WIND = { dir: 265, speed: 4.5 };   // met convention: direction it comes FROM

/** Site geometry, all real coordinates. */
const LAUNCH = { lat: 45.8726, lng: 11.7935, alt: 1420 };

/**
 * @returns {{fileName:string, igc:string, pilotName:string}[]} two flights
 */
export function demoFlights() {
  return [buildAlon(), buildMaya()];
}

// ── flight scripts ──────────────────────────────────────────────────────────

/**
 * The committing line: good climb off launch, a long glide out over the plain
 * that goes badly wrong, a scratchy save at ~110 m AGL, then home.
 */
function buildAlon() {
  const phases = [
    { kind: 'ridge', seconds: 90, alt: 1420 },
    { kind: 'thermal', toAlt: 2320, climb: 3.4, dir: +1 },          // BEST_CLIMB
    { kind: 'glide', to: { lat: 45.8480, lng: 11.8420 }, sink: -1.15, speed: 11.5 },
    { kind: 'thermal', toAlt: 2050, climb: 1.6, dir: -1 },
    // The mistake: pushing into the plain with too little height, in sink. The
    // second leg is deliberately long so altitude, not arrival, ends it — that's
    // what puts him on the deck at ~110 m over the Bassano flats.
    { kind: 'glide', to: { lat: 45.8020, lng: 11.8240 }, sink: -3.6, speed: 14.5 }, // HEAVY_SINK
    { kind: 'glide', to: { lat: 45.7700, lng: 11.7950 }, sink: -1.5, speed: 12.0, toAlt: 240 },
    { kind: 'thermal', toAlt: 1180, climb: 1.15, dir: +1, rough: 1.1 },              // LOW_SAVE
    { kind: 'glide', to: { lat: 45.7720, lng: 11.7480 }, sink: -1.2, speed: 15.5 },  // FAST_GLIDE
    { kind: 'thermal', toAlt: 1450, climb: 2.1, dir: -1 },
    { kind: 'glide', to: { lat: 45.7660, lng: 11.7290 }, sink: -1.3, speed: 11.0, toAlt: 190 },
  ];
  const igc = render({
    pilot: 'Alon', glider: 'Ozone Delta 4', gliderId: 'IT-4471', site: 'Monte Grappa',
    startUTC: [10, 42, 0], phases,
  });
  return { fileName: 'demo-alon-grappa.igc', igc, pilotName: 'Alon' };
}

/** The conservative line: launches 11 minutes later, works the ridge, stays high. */
function buildMaya() {
  const phases = [
    { kind: 'ridge', seconds: 140, alt: 1440 },
    { kind: 'thermal', toAlt: 2180, climb: 2.6, dir: -1 },
    { kind: 'glide', to: { lat: 45.8520, lng: 11.8330 }, sink: -1.05, speed: 10.5 },
    { kind: 'thermal', toAlt: 2480, climb: 2.9, dir: -1 },
    { kind: 'glide', to: { lat: 45.8900, lng: 11.8050 }, sink: -1.1, speed: 12.5 },
    { kind: 'thermal', toAlt: 2300, climb: 1.8, dir: +1 },
    { kind: 'glide', to: { lat: 45.8360, lng: 11.7700 }, sink: -1.25, speed: 13.5 },
    { kind: 'glide', to: { lat: 45.7900, lng: 11.7420 }, sink: -1.35, speed: 12.0, toAlt: 210 },
  ];
  const igc = render({
    pilot: 'Maya', glider: 'Advance Iota 3', gliderId: 'IT-2088', site: 'Monte Grappa',
    startUTC: [10, 53, 0], phases,
  });
  return { fileName: 'demo-maya-grappa.igc', igc, pilotName: 'Maya' };
}

// ── simulator ───────────────────────────────────────────────────────────────

/**
 * Fly the phase list and emit IGC. A deterministic PRNG keeps the demo (and any
 * screenshot of it) identical between runs while still looking like real air.
 */
function render(cfg) {
  const rnd = mulberry32(0x5eed ^ hash(cfg.pilot));
  const noise = () => rnd() * 2 - 1;

  let { lat, lng, alt } = LAUNCH;
  alt = cfg.phases[0].alt || LAUNCH.alt;
  let heading = 250;
  let t = cfg.startUTC[0] * 3600 + cfg.startUTC[1] * 60 + cfg.startUTC[2];

  /** @type {string[]} */
  const rows = [];
  const emit = () => rows.push(bRecord(t, lat, lng, alt));

  // Wind drift, in degrees per second of simulated time.
  const windRad = ((WIND.dir + 180) % 360) * Math.PI / 180;
  const drift = (seconds) => {
    const d = WIND.speed * seconds;
    lat += (d * Math.cos(windRad)) / 111320;
    lng += (d * Math.sin(windRad)) / (111320 * Math.cos(lat * Math.PI / 180));
  };

  const advance = (speed, hdg, seconds) => {
    const d = speed * seconds;
    const rad = hdg * Math.PI / 180;
    lat += (d * Math.cos(rad)) / 111320;
    lng += (d * Math.sin(rad)) / (111320 * Math.cos(lat * Math.PI / 180));
  };

  for (const ph of cfg.phases) {
    if (ph.kind === 'ridge') {
      // Soaring back and forth along the launch ridge before committing.
      const steps = Math.round(ph.seconds / DT);
      for (let i = 0; i < steps; i++) {
        heading += Math.sin(i / 6) * 14;
        alt += (0.35 + noise() * 0.5) * DT;
        advance(9.5, heading, DT);
        drift(DT * 0.4);
        emit();
        t += DT;
      }
      continue;
    }

    if (ph.kind === 'thermal') {
      // Circle at ~18°/s (a normal paraglider 360) until the target height.
      const rough = ph.rough || 0.55;
      let guard = 0;
      while (alt < ph.toAlt && guard++ < 4000) {
        heading = (heading + ph.dir * (17 + noise() * 3) * DT + 360) % 360;
        // Climb strengthens toward the middle of the thermal and gets ragged
        // near the top, which is what makes the vario trace look real.
        const frac = (alt - (ph.toAlt - 900)) / 900;
        const shape = 1 - 0.35 * Math.abs(Math.max(-1, Math.min(1, frac)));
        alt += Math.max(-1.5, ph.climb * shape + noise() * rough) * DT;
        advance(9.0, heading, DT);
        drift(DT);
        emit();
        t += DT;
      }
      continue;
    }

    // glide
    let guard = 0;
    while (guard++ < 6000) {
      const brg = bearingTo(lat, lng, ph.to.lat, ph.to.lng);
      // Ease onto the new course rather than snapping to it.
      heading = (heading + clampAngle(brg - heading) * 0.25 + 360) % 360;
      alt += (ph.sink + noise() * 0.45) * DT;
      advance(ph.speed, heading, DT);
      drift(DT * 0.7);
      emit();
      t += DT;

      if (distance(lat, lng, ph.to.lat, ph.to.lng) < 250) break;
      if (ph.toAlt && alt <= ph.toAlt) break;
      if (alt <= 150) break;   // on the ground
    }
  }

  return header(cfg) + rows.join('\r\n') + '\r\n';
}

// ── IGC serialisation ───────────────────────────────────────────────────────

function header(cfg) {
  const d = DEMO_DATE;
  const p = (v, n = 2) => String(v).padStart(n, '0');
  return [
    'AXDB001 Thermal Debrief demo',
    `HFDTE${p(d.day)}${p(d.month)}${p(d.year % 100)}`,
    `HFPLTPILOTINCHARGE:${cfg.pilot}`,
    `HFGTYGLIDERTYPE:${cfg.glider}`,
    `HFGIDGLIDERID:${cfg.gliderId}`,
    `HFSITSite:${cfg.site}`,
    'HFDTM100GPSDATUM:WGS-1984',
    'HFRFWFIRMWAREVERSION:1.0',
    'HFGPSRECEIVER:Generated',
    'I013638FXA',
    '',
  ].join('\r\n');
}

/** Fixed date so the demo is reproducible: a good July day in the Veneto. */
const DEMO_DATE = { year: 2026, month: 7, day: 14 };

/** One B-record, fixed-width per the FAI spec. */
function bRecord(secs, lat, lng, alt) {
  const p = (v, n) => String(Math.abs(Math.trunc(v))).padStart(n, '0');
  const hh = Math.floor(secs / 3600) % 24;
  const mm = Math.floor((secs % 3600) / 60);
  const ss = Math.floor(secs % 60);

  const a = Math.round(alt);
  // A little offset between baro and GPS altitude, as every real logger shows.
  const gps = a + 12;

  return `B${p(hh, 2)}${p(mm, 2)}${p(ss, 2)}${dm(lat, 2)}${lat < 0 ? 'S' : 'N'}` +
    `${dm(lng, 3)}${lng < 0 ? 'W' : 'E'}A${p(Math.max(0, a), 5)}${p(Math.max(0, gps), 5)}`;
}

/** Decimal degrees → DDMMmmm / DDDMMmmm. */
function dm(deg, degDigits) {
  const v = Math.abs(deg);
  const d = Math.floor(v);
  const minThousandths = Math.round((v - d) * 60 * 1000);
  // Rounding can carry 59.9995' up to 60.000' — normalise so MM never reads 60.
  const carry = Math.floor(minThousandths / 60000);
  const rest = minThousandths - carry * 60000;
  const dd = String(d + carry).padStart(degDigits, '0');
  const mmm = String(rest).padStart(5, '0');
  return dd + mmm;
}

// ── geo + rng helpers ───────────────────────────────────────────────────────

function bearingTo(lat1, lng1, lat2, lng2) {
  const dLat = lat2 - lat1;
  const dLng = (lng2 - lng1) * Math.cos(lat1 * Math.PI / 180);
  return (Math.atan2(dLng, dLat) * 180 / Math.PI + 360) % 360;
}

function distance(lat1, lng1, lat2, lng2) {
  const dLat = (lat2 - lat1) * 111320;
  const dLng = (lng2 - lng1) * 111320 * Math.cos(lat1 * Math.PI / 180);
  return Math.hypot(dLat, dLng);
}

function clampAngle(a) {
  let d = a % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

/** Small deterministic PRNG — same demo every time. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h;
}
