// sky.js — the Sky screen: point the phone (or drag) and see the real sky behind
// it — the Sun, Moon, planets, ~5,000 real stars, all 88 constellations and the
// Milky Way, each exactly where it is right now.
//
// How it's drawn (the SkyView / Star Walk model):
//   • sensors.js::readView() gives the phone's orientation as a camera basis
//     (right / up / forward) in true-north East-North-Up coordinates.
//   • Every object is a unit direction vector. Stars, constellation figures and
//     the Milky Way live in the J2000 equatorial frame and never change; one
//     rotation per second (astro.js::eqjToEnu) turns that frame into the local
//     sky. Each frame the camera basis is rotated INTO the star frame instead,
//     so projecting a star is three dot products.
//   • Projection is a real pinhole camera (gnomonic): x = f·(v·right)/(v·fwd).
//     Straight lines on screen are great circles on the sky — which is exactly
//     why constellation lines stay straight — and nothing is distorted near
//     the zenith, unlike the old "Δazimuth × pixels-per-degree" mapping.
//   • Two canvases. #sky-bg is LOW resolution: the sky's colour (night, twilight,
//     day, sun glare, moonlight), the ground and the Milky Way are computed per
//     pixel of it and the browser's smooth upscaling does the blurring for free.
//     #sky-fg is full resolution: stars, lines, bodies, horizon and labels.
//
// Toddler mechanics are unchanged: tap anything to hear/see it, rest the
// reticle on something to have it named and caught, edge arrows point the way
// to Sun/Moon/planets that are up but off screen.

import { skyBodies, eqjToEnu, raDecToVec, EQJ_TO_GAL, moonPhase } from './astro.js?v=22';
import { SKY_BODIES } from './catalog.js?v=22';
import { sensorState, geolocate, primeLocation, requestOrientationPermission, nudge, readView } from './sensors.js?v=22';
import { say } from './speech.js?v=22';
import { spot, isSpotted, isBadgeBody, showToast } from './badges.js?v=22';
import { openCard, openStarCard } from './orbits.js?v=22';
import { nextEventHeadline } from './events.js?v=22';
import { drawMoonPhase, moonTextureReady } from './moonphase.js?v=22';

const DEG = Math.PI / 180;

// Field of view across the screen's SHORT side. ~60° is what sky apps settle
// on: wide enough to hold a whole constellation, narrow enough that a star on
// screen is recognisably where it is outside.
const BASE_FOV_DEG = 60;
const MIN_FOV_DEG = 18, MAX_FOV_DEG = 110;
const RECOMPUTE_MS = 1000;        // bodies + sky rotation; the sky turns 0.004°/s
// Faintest star drawn under a dark sky. Deliberately suburban (5.3), not the
// catalogue's 6.0: the point is to match what you can actually see outside, and
// a screen full of stars you can't see makes the real ones impossible to find.
const NIGHT_LIMIT_MAG = 5.3;
// In daylight the stars are still drawn, faintly, down to about this: the app's
// job at noon is "here's where they are", not a blank blue screen.
const DAY_LIMIT_MAG = 2.3;
const LABEL_MAG = 1.6;            // named stars at least this bright are always labelled
const LOCK_RADIUS_PX = 42;
const LOCK_MS = 1600;
const LOCK_COOLDOWN_MS = 4000;
const TAP_SLOP_PX = 10, TAP_MS = 450;
const BG_MAX_PIXELS = 18000;      // per-pixel sky model budget — see drawBackground()
const FG_MAX_PIXELS = 3.2e6;      // caps DPR on big iPads
const NEAR_Z = 0.02;              // near-plane for clipping lines behind the viewer
const CARDINALS = [['N', 0], ['NE', 45], ['E', 90], ['SE', 135], ['S', 180], ['SW', 225], ['W', 270], ['NW', 315]];

// ---- catalogue (built once from data/sky.json) ----
let N = 0;
let starVec = null, starMag = null, starBV = null, starSprite = null, starCon = null;
let starName = {};
const featuredByIdx = new Map();
const entityCache = new Map();
let conLabels = [];               // { vec, name, speak, fact }
let figVec = null, figCon = null; // 6 floats per segment
let asterisms = [];               // { name, fact, segs: Float32Array, center }
let mwMap = null;                 // { px: Uint8Array, w, h, bMax, res }

// ---- live sky ----
// Testing aid: ?at=2026-09-23T02:00Z runs the Sky screen at that moment (the
// clock keeps ticking from there), so day, twilight and a moonless night can
// be checked without waiting for them.
const CLOCK_OFFSET_MS = (() => {
  try {
    const at = new URLSearchParams(location.search).get('at');
    const t = at ? Date.parse(at) : NaN;
    return Number.isFinite(t) ? t - Date.now() : 0;
  } catch { return 0; }
})();
const skyNow = () => new Date(Date.now() + CLOCK_OFFSET_MS);
let started = false, lastCalc = 0;
let M = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
let bodies = [];
let sunEnu = [0, 0, -1], sunAlt = -90, moonEnu = [0, 0, -1], moonAlt = -90;
let phaseDeg = 0, moonIllum = 0;
let limMag = NIGHT_LIMIT_MAG, starVis = 1, mwGain = 1, dayness = 0, moonWash = 0, twilight = 0;
let fov = BASE_FOV_DEG;
let currentCon = -1;

// ---- rendering ----
let viewEl = null, skyScreenEl = null, reticleEl = null, reticleDotEl = null;
let bgCanvas, bgCtx, bgImage = null, bgW = 0, bgH = 0, bgScale = 1;
let fgCanvas, fgCtx, dpr = 1;
let W = 0, H = 0;
let headerBottom = 0;              // constellation names keep clear of the title block
let lastBg = { fwd: null, up: null, t: 0, fov: 0, gen: -1 };
let skyGen = 0;                   // bumps whenever the sky model changes
const hitTargets = [];
const flashes = new Map();        // id → time a catch started, for the pulse ring
const arrowEls = new Map();
let starSprites = [];
const planetSprites = new Map();
let sunSprite = null, moonCanvas = null, moonSpritePhase = -999;
const HILL = new Float32Array(361); // sin(altitude) of the skyline, per degree of azimuth
let HILL_MAX = 0;

// ---- reticle lock ----
let lockKey = null, lockStart = 0, lockTarget = null;
const lastAutoCatch = new Map();

export async function initSky() {
  document.getElementById('sky-start').addEventListener('click', startSky);
  viewEl = document.getElementById('sky-view');
  skyScreenEl = document.getElementById('sky-screen');
  bgCanvas = document.getElementById('sky-bg');
  fgCanvas = document.getElementById('sky-fg');
  bgCtx = bgCanvas.getContext('2d');
  fgCtx = fgCanvas.getContext('2d');
  wirePointer();
  buildHills();
  buildSprites();
  try {
    const res = await fetch('data/sky.json');
    prepareCatalogue(await res.json());
  } catch {
    // Bodies still work without the star catalogue.
  }
}

// --------------------------------------------------------------------------
// Catalogue
// --------------------------------------------------------------------------

function friendlyName(name) {
  return name.replace(/^The /, '');
}
// Short on-sky label for a curated constellation: 'Orion the Hunter' → 'Orion',
// 'The Big Dog' → 'Big Dog'. The full name is still what gets spoken.
function labelName(name) {
  return friendlyName(name).split(' the ')[0];
}

function prepareCatalogue(json) {
  const s = json.stars;
  N = s.length / 5;
  starVec = new Float32Array(N * 3);
  starMag = new Float32Array(N);
  starBV = new Float32Array(N);
  starSprite = new Uint8Array(N);
  starCon = new Int16Array(N);
  for (let i = 0; i < N; i++) {
    const v = raDecToVec(s[i * 5], s[i * 5 + 1]);
    starVec[i * 3] = v[0]; starVec[i * 3 + 1] = v[1]; starVec[i * 3 + 2] = v[2];
    starMag[i] = s[i * 5 + 2];
    starBV[i] = s[i * 5 + 3];
    starSprite[i] = bvBucket(starBV[i]);
    starCon[i] = s[i * 5 + 4];
  }
  starName = json.starNames || {};
  for (const f of json.featured.stars) featuredByIdx.set(f.i, f);

  const curatedByIau = new Map();
  asterisms = [];
  for (const c of json.featured.cons) {
    if (c.iau && !curatedByIau.has(c.iau)) curatedByIau.set(c.iau, c);
    if (!c.iau && c.lines && c.lines.length) {
      const segs = new Float32Array(c.lines.length * 6);
      const ctr = [0, 0, 0];
      c.lines.forEach(([a, b], k) => {
        for (let d = 0; d < 3; d++) {
          segs[k * 6 + d] = starVec[a * 3 + d];
          segs[k * 6 + 3 + d] = starVec[b * 3 + d];
          ctr[d] += starVec[a * 3 + d] + starVec[b * 3 + d];
        }
      });
      const n = Math.hypot(...ctr) || 1;
      asterisms.push({ name: friendlyName(c.name), fact: c.fact, segs, center: ctr.map((x) => x / n) });
    }
  }
  conLabels = json.cons.map((c) => {
    const cur = curatedByIau.get(c.id);
    return {
      vec: raDecToVec(c.at[0], c.at[1]),
      name: cur ? labelName(cur.name) : c.name,
      speak: cur ? cur.name : c.name,
      fact: cur ? cur.fact : '',
    };
  });

  let segCount = 0;
  for (const f of json.figures) segCount += f.p.length / 2 - 1;
  figVec = new Float32Array(segCount * 6);
  figCon = new Int16Array(segCount);
  let k = 0;
  for (const f of json.figures) {
    const pts = [];
    for (let j = 0; j < f.p.length; j += 2) pts.push(raDecToVec(f.p[j], f.p[j + 1]));
    for (let j = 0; j + 1 < pts.length; j++, k++) {
      figVec.set(pts[j], k * 6);
      figVec.set(pts[j + 1], k * 6 + 3);
      figCon[k] = f.c;
    }
  }

  if (json.milkyWayMap) loadMilkyWay(json.milkyWayMap);
}

function loadMilkyWay(meta) {
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    const rgba = x.getImageData(0, 0, img.width, img.height).data;
    const px = new Uint8Array(img.width * img.height);
    for (let i = 0; i < px.length; i++) px[i] = rgba[i * 4];
    // Per-column brightness/warmth toward the galactic centre (the bulge), so
    // the per-pixel loop does a table lookup instead of a cos().
    const core = new Float32Array(img.width);
    for (let c = 0; c < img.width; c++) core[c] = Math.max(0, Math.cos(c * meta.res * DEG));
    mwMap = { px, core, w: img.width, h: img.height, bMax: meta.bMax, res: meta.res };
    skyGen++;
  };
  img.src = meta.src;
}

// A star's colour from its B−V index: B−V → temperature (Ballesteros 2012) →
// blackbody RGB (Helland's fit), then softened toward white — real stars look
// only subtly tinted to the eye, but the tint is what makes Betelgeuse
// Betelgeuse and Rigel Rigel.
function bvToRgb(bv, sat = 0.62) {
  const b = Math.max(-0.4, Math.min(2.0, bv));
  const t = 4600 * (1 / (0.92 * b + 1.7) + 1 / (0.92 * b + 0.62)) / 100;
  let r, g, bl;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    bl = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    bl = 255;
  }
  const c = (v) => Math.max(0, Math.min(255, v));
  return [c(r), c(g), c(bl)].map((v) => Math.round(255 + (v - 255) * sat));
}
const BV_MIN = -0.35, BV_MAX = 2.0, BV_BUCKETS = 16;
function bvBucket(bv) {
  const t = (Math.max(BV_MIN, Math.min(BV_MAX, bv)) - BV_MIN) / (BV_MAX - BV_MIN);
  return Math.round(t * (BV_BUCKETS - 1));
}
function bvColorName(bv) {
  if (bv < -0.02) return 'Blue-white';
  if (bv < 0.3) return 'White';
  if (bv < 0.58) return 'Yellow-white';
  if (bv < 0.82) return 'Yellow';
  if (bv < 1.4) return 'Orange';
  return 'Orange-red';
}
const hex = (rgb) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');

function starEntity(i) {
  if (entityCache.has(i)) return entityCache.get(i);
  const f = featuredByIdx.get(i);
  const name = (f && f.name) || starName[i];
  if (!name) return null;
  const con = starCon[i] >= 0 ? conLabels[starCon[i]] : null;
  const e = {
    kind: 'star', id: f ? f.id : `hip${i}`, name,
    fact: f ? f.fact : undefined,
    distanceLy: f ? f.distanceLy : undefined,
    mag: starMag[i],
    // The info card's hero star uses a more saturated tint than the sky, so
    // "Orange" on the card visibly is orange.
    color: hex(bvToRgb(starBV[i], 0.95)),
    colorName: bvColorName(starBV[i]),
    conName: con ? con.name : null,
  };
  entityCache.set(i, e);
  return e;
}

// --------------------------------------------------------------------------
// Sprites
// --------------------------------------------------------------------------

function canvasOf(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function buildSprites() {
  // One radial point-spread sprite per colour bucket: a white-hot core, a
  // tinted inner glow, a faint wide halo — how a bright star actually images.
  starSprites = [];
  for (let k = 0; k < BV_BUCKETS; k++) {
    const bv = BV_MIN + (k / (BV_BUCKETS - 1)) * (BV_MAX - BV_MIN);
    const [r, g, b] = bvToRgb(bv);
    const c = canvasOf(64, 64), x = c.getContext('2d');
    const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.15, `rgba(${Math.round((r + 255) / 2)},${Math.round((g + 255) / 2)},${Math.round((b + 255) / 2)},1)`);
    gr.addColorStop(0.27, `rgba(${r},${g},${b},0.62)`);
    gr.addColorStop(0.38, `rgba(${r},${g},${b},0.17)`);
    gr.addColorStop(0.6, `rgba(${r},${g},${b},0.04)`);
    gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
    x.fillStyle = gr;
    x.fillRect(0, 0, 64, 64);
    starSprites.push(c);
  }

  // The Sun: a limb-darkened disc (the inner 26% of the sprite) inside a warm glow.
  sunSprite = canvasOf(160, 160);
  const sx = sunSprite.getContext('2d');
  const sg = sx.createRadialGradient(80, 80, 0, 80, 80, 80);
  sg.addColorStop(0, '#ffffff');
  sg.addColorStop(0.2, '#fffbea');
  sg.addColorStop(0.255, 'rgba(255,240,196,0.97)');
  sg.addColorStop(0.3, 'rgba(255,214,130,0.42)');
  sg.addColorStop(0.5, 'rgba(255,190,100,0.13)');
  sg.addColorStop(1, 'rgba(255,170,80,0)');
  sx.fillStyle = sg;
  sx.fillRect(0, 0, 160, 160);

  moonCanvas = canvasOf(128, 128);

  // Planets: the real texture on a limb-darkened disc; Saturn with its ring
  // split into a back half (behind the globe) and a front half.
  for (const id of ['mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune']) {
    const body = SKY_BODIES[id];
    if (!body || !body.texture) continue;
    const img = new Image();
    img.onload = () => {
      const D = 96;
      const ring = id === 'saturn';
      const cw = ring ? Math.round(D * 2.9) : D, ch = ring ? Math.round(D * 1.1) : D;
      const c = canvasOf(cw, ch), x = c.getContext('2d');
      const px = cw / 2, py = ch / 2;
      const drawRing = (half) => {
        const rimg = ringImg;
        if (!rimg || !rimg.complete) return;
        x.save();
        if (half) { x.beginPath(); x.rect(0, py, cw, ch - py); x.clip(); }
        x.drawImage(rimg, px - D * 1.44, py - D * 0.51, D * 2.88, D * 1.02);
        x.restore();
      };
      if (ring) drawRing(false);
      x.save();
      x.beginPath(); x.arc(px, py, D / 2, 0, Math.PI * 2); x.clip();
      // The texture is an equirectangular map: its middle half is one hemisphere.
      x.drawImage(img, img.width * 0.25, 0, img.width * 0.5, img.height, px - D / 2, py - D / 2, D, D);
      if (id === 'venus') {
        // Venus is a featureless cream cloud deck to the eye (and in any
        // telescope); the texture is closer to a surface map, too dark and brown.
        x.fillStyle = 'rgba(255,246,222,0.62)';
        x.fillRect(px - D / 2, py - D / 2, D, D);
      }
      const limb = x.createRadialGradient(px - D * 0.12, py - D * 0.12, D * 0.1, px, py, D / 2);
      limb.addColorStop(0, 'rgba(255,255,255,0.10)');
      limb.addColorStop(0.7, 'rgba(0,0,0,0.05)');
      limb.addColorStop(1, 'rgba(0,0,0,0.55)');
      x.fillStyle = limb;
      x.fillRect(px - D / 2, py - D / 2, D, D);
      x.restore();
      if (ring) drawRing(true);
      planetSprites.set(id, { canvas: c, D, glow: hex(bvToRgb(0.9)), rgb: hexToRgb(body.color || '#ffffff') });
    };
    img.src = body.texture;
  }
}
const ringImg = (() => { const i = new Image(); i.src = 'icons/textures/saturn-ring.png'; return i; })();
function hexToRgb(h) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [255, 255, 255];
}

// A low, gentle skyline — rolling hills a degree or two high — so the ground
// reads as land rather than a ruled line. Fixed in azimuth, so it turns with
// the real directions exactly like a real horizon.
function buildHills() {
  for (let a = 0; a <= 360; a++) {
    const r = a * DEG;
    let h = 0.55
      + 0.55 * (0.5 + 0.5 * Math.sin(2 * r + 0.7))
      + 0.45 * Math.max(0, Math.sin(5 * r + 1.9)) * (0.5 + 0.5 * Math.sin(r + 2.4))
      + 0.18 * Math.sin(13 * r + 0.3) + 0.08 * Math.sin(31 * r + 1.1);
    h = Math.max(0.2, h);
    HILL[a] = Math.sin(h * DEG);
    HILL_MAX = Math.max(HILL_MAX, HILL[a]);
  }
}
function hillSinAt(azRad) {
  let d = azRad / DEG;
  d = ((d % 360) + 360) % 360;
  const i = Math.floor(d), t = d - i;
  return HILL[i] + (HILL[i + 1] - HILL[i]) * t;
}

// --------------------------------------------------------------------------
// Start / lifecycle
// --------------------------------------------------------------------------

// Always gets into the sky view — geolocate() never throws (see sensors.js).
// requestOrientationPermission() has to be the first thing called,
// synchronously, so it's still inside the tap on iOS.
function startSky() {
  const startBtn = document.getElementById('sky-start');
  const orientPromise = requestOrientationPermission();

  // Show the sky NOW from the last known (or default) location; refine below.
  primeLocation();
  document.getElementById('sky-gate').classList.add('hidden');
  viewEl.classList.remove('hidden');

  if (!started) {
    started = true;
    buildArrows();
    new ResizeObserver(resize).observe(viewEl);
    resize();
    recompute(skyNow());
    lastCalc = Date.now();
    requestAnimationFrame(loop);
    showNextEvent();
  }

  orientPromise.catch(() => {});
  refineLocation(startBtn);
}

async function refineLocation(startBtn) {
  const before = { lat: sensorState.lat, lon: sensorState.lon };
  await geolocate();
  const moved = Math.abs(sensorState.lat - before.lat) > 0.01 || Math.abs(sensorState.lon - before.lon) > 0.01;
  if (moved) {
    recompute(skyNow());
    lastCalc = Date.now();
    showNextEvent();
  }
  if (startBtn) startBtn.disabled = false;
}

function showNextEvent() {
  setTimeout(() => {
    const el = document.getElementById('sky-event-note');
    if (!el) return;
    try {
      const headline = nextEventHeadline(skyNow(), sensorState.lat, sensorState.lon);
      if (headline) {
        el.textContent = headline;
        el.classList.remove('hidden');
        measureHeader();
      }
    } catch {
      // a search failing shouldn't be visible — this note is a nice-to-have
    }
  }, 0);
}

function resize() {
  const w = viewEl.clientWidth, h = viewEl.clientHeight;
  if (!w || !h || (w === W && h === H)) return;
  W = w; H = h;
  dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(FG_MAX_PIXELS / (w * h)));
  fgCanvas.width = Math.round(w * dpr);
  fgCanvas.height = Math.round(h * dpr);
  bgScale = Math.min(0.5, Math.sqrt(BG_MAX_PIXELS / (w * h)));
  bgW = Math.max(1, Math.round(w * bgScale));
  bgH = Math.max(1, Math.round(h * bgScale));
  bgCanvas.width = bgW;
  bgCanvas.height = bgH;
  bgImage = bgCtx.createImageData(bgW, bgH);
  measureHeader();
  skyGen++;
}

function measureHeader() {
  const header = viewEl.querySelector('.sky-header');
  headerBottom = header ? header.getBoundingClientRect().bottom - viewEl.getBoundingClientRect().top : 0;
}

function smoothstep(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function recompute(now) {
  if (!sensorState.hasLocation) return;
  M = eqjToEnu(now, sensorState.lat, sensorState.lon);
  bodies = skyBodies(now, sensorState.lat, sensorState.lon);
  const sun = bodies.find((b) => b.id === 'sun');
  const moon = bodies.find((b) => b.id === 'moon');
  sunEnu = sun.enu; sunAlt = sun.alt;
  moonEnu = moon.enu; moonAlt = moon.alt;
  phaseDeg = moonPhase(now);
  moonIllum = (1 - Math.cos(phaseDeg * DEG)) / 2;

  // How bright the sky is, from where the Sun really is (civil twilight ends
  // at −6°, astronomical at −18°) and how much moonlight there is.
  dayness = smoothstep(-6, 4, sunAlt);
  twilight = smoothstep(-16, -3, sunAlt) * (1 - smoothstep(3, 12, sunAlt));
  const darkness = 1 - smoothstep(-18, -7, sunAlt);
  moonWash = moonAlt > 0 ? moonIllum * smoothstep(-2, 25, moonAlt) : 0;
  const nightLim = NIGHT_LIMIT_MAG - 1.3 * moonWash;
  limMag = DAY_LIMIT_MAG + (nightLim - DAY_LIMIT_MAG) * darkness;
  starVis = 0.32 + 0.68 * (1 - dayness);
  mwGain = darkness * (1 - 0.85 * moonWash);
  skyGen++;

  const note = document.getElementById('sky-daynote');
  if (sunAlt > -4) {
    note.textContent = "It's daytime — sunlight hides the stars, but they're still up there. Find the Sun and Moon! 🌙";
    note.classList.remove('hidden');
  } else {
    note.classList.add('hidden');
  }

  if ((Math.abs(phaseDeg - moonSpritePhase) > 0.5 || moonSpritePhase < -900) && moonTextureReady()) {
    drawMoonPhase(moonCanvas, phaseDeg, 0);
    moonSpritePhase = phaseDeg;
  } else if (!moonTextureReady()) {
    drawMoonPhase(moonCanvas, phaseDeg, 0); // paints on load
  }
}

function loop() {
  if (!started) return;
  requestAnimationFrame(loop);
  // Nothing to do while another tab is showing — no point burning an iPad's
  // battery on a sky nobody can see.
  if (!skyScreenEl.classList.contains('active') || viewEl.classList.contains('hidden')) return;
  if (!W || !H) { resize(); if (!W) return; }
  const t = performance.now();
  if (Date.now() - lastCalc > RECOMPUTE_MS) {
    recompute(skyNow());
    lastCalc = Date.now();
  }
  render(readView(t), t);
}

// --------------------------------------------------------------------------
// Frame
// --------------------------------------------------------------------------

// Camera basis vector v (ENU) expressed in the star (EQJ) frame: Mᵀ·v.
function toEqj(v) {
  return [
    M[0][0] * v[0] + M[1][0] * v[1] + M[2][0] * v[2],
    M[0][1] * v[0] + M[1][1] * v[1] + M[2][1] * v[2],
    M[0][2] * v[0] + M[1][2] * v[1] + M[2][2] * v[2],
  ];
}
function toGal(v) {
  return EQJ_TO_GAL.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
}
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function render(view, t) {
  const { right, up, fwd } = view;
  const cx = W / 2, cy = H / 2;
  const f = (Math.min(W, H) / 2) / Math.tan(fov * DEG / 2);
  const halfDiag = Math.atan(Math.hypot(W, H) / 2 / f);
  const cam = {
    right, up, fwd, cx, cy, f,
    rE: toEqj(right), uE: toEqj(up), fE: toEqj(fwd), zen: M[2],
    cosView: Math.cos(Math.min(halfDiag + 3 * DEG, 89 * DEG)),
    cosSeg: Math.cos(Math.min(halfDiag + 30 * DEG, 89 * DEG)),
  };

  drawBackground(cam, t);

  const ctx = fgCtx;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  hitTargets.length = 0;

  const labels = [];
  if (N) {
    drawFigures(ctx, cam);
    drawStars(ctx, cam, t, labels);
  }
  drawBodies(ctx, cam, t, labels);
  drawHorizon(ctx, cam);
  updateLock(cam);
  drawLabels(ctx, cam, labels);
}

// Clips a segment (camera coords) to the near plane and projects it.
function projectSeg(cam, ax, ay, az, bx, by, bz) {
  if (az < NEAR_Z && bz < NEAR_Z) return null;
  let aClipped = false, bClipped = false;
  if (az < NEAR_Z) {
    const k = (NEAR_Z - az) / (bz - az);
    ax += (bx - ax) * k; ay += (by - ay) * k; az = NEAR_Z; aClipped = true;
  } else if (bz < NEAR_Z) {
    const k = (NEAR_Z - bz) / (az - bz);
    bx += (ax - bx) * k; by += (ay - by) * k; bz = NEAR_Z; bClipped = true;
  }
  return [
    cam.cx + cam.f * ax / az, cam.cy - cam.f * ay / az,
    cam.cx + cam.f * bx / bz, cam.cy - cam.f * by / bz,
    aClipped, bClipped,
  ];
}

// ---- background: sky colour, Milky Way, ground — per pixel, at low res ----
function drawBackground(cam, t) {
  if (!bgImage) return;
  const { right, up, fwd, cx, cy, f } = cam;
  // Redraw only once the view has turned by about half a backdrop pixel. The
  // backdrop is soft by design, so that lag is invisible — while redrawing on
  // every tiny hand tremor (which is every frame on a hand-held phone) cost
  // ~6 ms a frame on a desktop, most of an iPad's frame budget.
  const halfPx = 0.5 / (f * bgScale);
  const cosT = Math.cos(halfPx);
  const moved = !lastBg.fwd || dot3(fwd, lastBg.fwd) < cosT || dot3(up, lastBg.up) < cosT;
  if (!moved && lastBg.fov === fov && lastBg.gen === skyGen) return;
  lastBg = { fwd, up, t, fov, gen: skyGen };

  const px = bgImage.data;
  const invF = 1 / f, s = bgScale;
  const fG = toGal(cam.fE), rG = toGal(cam.rE), uG = toGal(cam.uE);
  const [sx, sy, sz] = sunEnu, [mx, my, mz] = moonEnu;
  const day = dayness, tw = twilight;
  const moonUp = moonAlt > -1;
  const glareOn = sunAlt > -3;
  const mw = mwMap && mwGain > 0.02 ? mwMap : null;
  const mwK = mwGain * 1.25;
  const sinB = mw ? Math.sin(mw.bMax * DEG) : 0;
  const nightLift = moonWash * 1.0;
  let o = 0;
  for (let j = 0; j < bgH; j++) {
    const dy = (cy - (j + 0.5) / s) * invF;
    const rx0 = fwd[0] + dy * up[0], ry0 = fwd[1] + dy * up[1], rz0 = fwd[2] + dy * up[2];
    const gx0 = fG[0] + dy * uG[0], gy0 = fG[1] + dy * uG[1], gz0 = fG[2] + dy * uG[2];
    for (let i = 0; i < bgW; i++, o += 4) {
      const dx = ((i + 0.5) / s - cx) * invF;
      let x = rx0 + dx * right[0], y = ry0 + dx * right[1], z = rz0 + dx * right[2];
      const inv = 1 / Math.sqrt(x * x + y * y + z * z);
      x *= inv; y *= inv; z *= inv;
      let r, g, b;
      if (z < HILL_MAX && z < hillSinAt(Math.atan2(x, y))) {
        // Ground: dark land, a touch of horizon haze just under the skyline.
        const depth = 0.72 + 0.28 * (1 + z);
        const haze = Math.exp(z * 28);
        r = (7 + 30 * day) * depth + (18 + 90 * day) * haze * 0.35;
        g = (9 + 36 * day) * depth + (22 + 110 * day) * haze * 0.35;
        b = (15 + 30 * day) * depth + (40 + 120 * day) * haze * 0.35;
      } else {
        const zc = z < 0 ? 0 : z;
        const hz = 1 - zc;
        const h3 = hz * hz * hz, h2 = hz * hz;
        // Night: deep blue-violet overhead, airglow/light-dome toward the horizon.
        const nr = 5 + 17 * h3 + nightLift * (8 + 10 * h2);
        const ng = 7 + 22 * h3 + nightLift * (11 + 13 * h2);
        const nb = 18 + 40 * h3 + nightLift * (22 + 22 * h2);
        // Day: saturated overhead, pale and hazy at the horizon (Rayleigh).
        const dr = 36 + 124 * h2 * hz, dg = 92 + 104 * h2 * hz, db = 192 + 42 * h2 * hz;
        r = nr + (dr - nr) * day; g = ng + (dg - ng) * day; b = nb + (db - nb) * day;
        const mu = x * sx + y * sy + z * sz;
        if (tw > 0.01) {
          // Twilight: an orange band low on the Sun's side, fading upward.
          const sw = (1 + mu) * 0.5, sw2 = sw * sw;
          const low = Math.exp(-zc * 7) * sw2 * sw * tw;
          const high = Math.exp(-zc * 2.2) * sw2 * tw;
          r += 230 * low + 70 * high; g += 105 * low + 45 * high; b += 40 * low + 55 * high;
        }
        if (glareOn) {
          const d = 1 - mu;
          const glare = (0.95 * Math.exp(-d / 0.0012) + 0.4 * Math.exp(-d / 0.025) + 0.14 * Math.exp(-d / 0.22)) * smoothstep(-3, 2, sunAlt);
          r += 255 * glare; g += 246 * glare; b += 225 * glare;
        }
        if (moonUp && moonIllum > 0.05) {
          const dm = 1 - (x * mx + y * my + z * mz);
          const mg = moonIllum * (0.35 * Math.exp(-dm / 0.0025) + 0.07 * Math.exp(-dm / 0.06)) * (1 - day);
          r += 190 * mg; g += 198 * mg; b += 220 * mg;
        }
        if (mw) {
          const gz = (gz0 + dx * rG[2]) * inv;
          if (gz > -sinB && gz < sinB) {
            const gx = (gx0 + dx * rG[0]) * inv, gy = (gy0 + dx * rG[1]) * inv;
            const bDeg = gz * (1 + gz * gz * (0.1667 + 0.075 * gz * gz)) / DEG; // asin, |b| < 40°
            let lDeg = Math.atan2(gy, gx) / DEG;
            if (lDeg < 0) lDeg += 360;
            const fx = lDeg / mw.res, fy = (mw.bMax - bDeg) / mw.res;
            const x0 = Math.floor(fx), y0 = Math.min(mw.h - 2, Math.max(0, Math.floor(fy)));
            const tx = fx - x0, ty = Math.min(1, Math.max(0, fy - y0));
            const xa = x0 % mw.w, xb = (x0 + 1) % mw.w;
            const p = mw.px;
            const v = ((p[y0 * mw.w + xa] * (1 - tx) + p[y0 * mw.w + xb] * tx) * (1 - ty) +
              (p[(y0 + 1) * mw.w + xa] * (1 - tx) + p[(y0 + 1) * mw.w + xb] * tx) * ty) / 255;
            if (v > 0.004) {
              // Brighter and warmer toward the galactic centre (the bulge), cooler
              // and fainter elsewhere; dimmed by extinction near the horizon.
              const core = mw.core[xa];
              const ext = z > 0.3 ? 1 : z < 0 ? 0 : z * (1 / 0.3);
              const inten = v * (0.7 + 0.3 * v) * mwK * (0.6 + 0.4 * core * core) * ext * 78;
              const warm = core * core * core;
              r += inten * (0.78 + 0.22 * warm);
              g += inten * (0.84 + 0.08 * warm);
              b += inten * (1.0 - 0.18 * warm);
            }
          }
        }
      }
      // Ordered dither: kills banding in the very dark gradients.
      const dth = (((i * 7 + j * 13) & 7) - 3.5) * 0.45;
      px[o] = r + dth; px[o + 1] = g + dth; px[o + 2] = b + dth; px[o + 3] = 255;
    }
  }
  bgCtx.putImageData(bgImage, 0, 0);
}

// ---- constellation figures (and the Summer Triangle) ----
function drawFigures(ctx, cam) {
  const { rE, uE, fE, cosSeg } = cam;
  const fade = 0.35 + 0.65 * (1 - dayness);
  const normal = new Path2D(), hi = new Path2D(), under = new Path2D();
  const zen = cam.zen;
  const GAP = 5; // lines stop short of the stars, as in a star atlas
  for (let k = 0; k < figCon.length; k++) {
    const o = k * 6;
    const ax = figVec[o], ay = figVec[o + 1], az = figVec[o + 2];
    const bx = figVec[o + 3], by = figVec[o + 4], bz = figVec[o + 5];
    const za = ax * fE[0] + ay * fE[1] + az * fE[2];
    const zb = bx * fE[0] + by * fE[1] + bz * fE[2];
    if (za < cosSeg && zb < cosSeg) continue;
    const s = projectSeg(cam,
      ax * rE[0] + ay * rE[1] + az * rE[2], ax * uE[0] + ay * uE[1] + az * uE[2], za,
      bx * rE[0] + by * rE[1] + bz * rE[2], bx * uE[0] + by * uE[1] + bz * uE[2], zb);
    if (!s) continue;
    let [x1, y1, x2, y2] = s;
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len < 2 * GAP + 2) continue;
    const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
    if (!s[4]) { x1 += ux * GAP; y1 += uy * GAP; }
    if (!s[5]) { x2 -= ux * GAP; y2 -= uy * GAP; }
    const underground = ax * zen[0] + ay * zen[1] + az * zen[2] < 0 && bx * zen[0] + by * zen[1] + bz * zen[2] < 0;
    const p = underground ? under : figCon[k] === currentCon ? hi : normal;
    p.moveTo(x1, y1); p.lineTo(x2, y2);
  }
  ctx.lineCap = 'round';
  ctx.lineWidth = 1;
  ctx.strokeStyle = `rgba(125,150,220,${(0.34 * fade).toFixed(3)})`;
  ctx.stroke(normal);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = `rgba(185,200,255,${(0.85 * fade).toFixed(3)})`;
  ctx.stroke(hi);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(125,150,220,0.1)';
  ctx.stroke(under);

  // Asterisms that aren't a constellation of their own — dashed, warm.
  ctx.setLineDash([3, 5]);
  ctx.lineWidth = 1;
  ctx.strokeStyle = `rgba(255,214,150,${(0.4 * fade).toFixed(3)})`;
  for (const a of asterisms) {
    const p = new Path2D();
    for (let k = 0; k < a.segs.length; k += 6) {
      const v = a.segs;
      const za = v[k] * fE[0] + v[k + 1] * fE[1] + v[k + 2] * fE[2];
      const zb = v[k + 3] * fE[0] + v[k + 4] * fE[1] + v[k + 5] * fE[2];
      if (za < cosSeg && zb < cosSeg) continue;
      const s = projectSeg(cam,
        v[k] * rE[0] + v[k + 1] * rE[1] + v[k + 2] * rE[2], v[k] * uE[0] + v[k + 1] * uE[1] + v[k + 2] * uE[2], za,
        v[k + 3] * rE[0] + v[k + 4] * rE[1] + v[k + 5] * rE[2], v[k + 3] * uE[0] + v[k + 4] * uE[1] + v[k + 5] * uE[2], zb);
      if (s) { p.moveTo(s[0], s[1]); p.lineTo(s[2], s[3]); }
    }
    ctx.stroke(p);
  }
  ctx.setLineDash([]);
}

// Extra magnitudes of dimming from looking through more air near the horizon
// (0.25 mag per airmass; Rozenberg's airmass formula stays finite at 0°).
function extinction(sinAlt) {
  if (sinAlt <= 0) return 3;
  const X = 1 / (sinAlt + 0.025 * Math.exp(-11 * sinAlt));
  return 0.25 * (X - 1);
}

// ---- stars ----
function drawStars(ctx, cam, t, labels) {
  const { rE, uE, fE, zen, cx, cy, f, cosView } = cam;
  const zoomBonus = 1.7 * Math.log10(BASE_FOV_DEG / fov);
  const lim = Math.min(6.3, limMag + zoomBonus);
  const twinkleOn = dayness < 0.5;
  const tt = t / 1000;
  let bestCon = -1, bestD2 = 70 * 70;
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < N; i++) {
    const m = starMag[i];
    if (m > lim) break; // brightest first: everything after is fainter still
    const o = i * 3;
    const vx = starVec[o], vy = starVec[o + 1], vz = starVec[o + 2];
    const zc = vx * fE[0] + vy * fE[1] + vz * fE[2];
    if (zc < cosView) continue;
    const sx = cx + f * (vx * rE[0] + vy * rE[1] + vz * rE[2]) / zc;
    const sy = cy - f * (vx * uE[0] + vy * uE[1] + vz * uE[2]) / zc;
    if (sx < -30 || sx > W + 30 || sy < -30 || sy > H + 30) continue;
    const altS = vx * zen[0] + vy * zen[1] + vz * zen[2];
    let mEff = m;
    let hidden = false;
    if (altS < 0.4) {
      mEff += extinction(Math.max(0.001, altS));
      if (altS < HILL_MAX) {
        // Below the skyline: still drawn, faintly, "through" the ground —
        // otherwise a star you are pointing the phone down at simply vanishes.
        const e = vx * M[0][0] + vy * M[0][1] + vz * M[0][2];
        const n = vx * M[1][0] + vy * M[1][1] + vz * M[1][2];
        if (altS < hillSinAt(Math.atan2(e, n))) { hidden = true; mEff = m; }
      }
    }
    const L = Math.pow(10, -0.4 * (mEff - lim));
    if (L < 1) continue;
    const lg = Math.log10(L);
    const d = 3.6 + 5.2 * Math.pow(L, 0.32);
    let a = Math.min(1, 0.58 + 0.2 * lg) * starVis;
    if (hidden) a *= 0.16;
    else if (twinkleOn && m < 2.2) {
      // Scintillation: brighter stars flicker, more so low in the sky.
      const amp = 0.07 + 0.2 * (1 - Math.min(1, altS * 2.2));
      a *= 1 - amp * (0.5 + 0.5 * Math.sin(tt * (5.1 + (i % 7)) + i * 1.7) * Math.sin(tt * (2.3 + (i % 5) * 0.4) + i));
    }
    ctx.globalAlpha = a;
    ctx.drawImage(starSprites[starSprite[i]], sx - d / 2, sy - d / 2, d, d);

    if (starCon[i] >= 0 && m < 4.5 && !hidden) {
      const d2 = (sx - cx) * (sx - cx) + (sy - cy) * (sy - cy);
      if (d2 < bestD2) { bestD2 = d2; bestCon = starCon[i]; }
    }
    if (featuredByIdx.has(i) || starName[i]) {
      const hit = { x: sx, y: sy, r: 24, kind: 'star', key: `s${i}`, idx: i, rank: m };
      hitTargets.push(hit);
      if (m <= LABEL_MAG && !hidden) labels.push({ kind: 'star', x: sx, y: sy + d * 0.18 + 11, text: starEntity(i)?.name, hit });
    }
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  currentCon = bestCon;

  // Constellation names (after the stars, so they're never covered).
  const fade = 0.4 + 0.6 * (1 - dayness);
  for (let c = 0; c < conLabels.length; c++) {
    const lab = conLabels[c];
    const zc = dot3(lab.vec, fE);
    if (zc < cosView) continue;
    const x = cx + f * dot3(lab.vec, rE) / zc, y = cy - f * dot3(lab.vec, uE) / zc;
    if (x < 10 || x > W - 10 || y < 10 || y > H - 10) continue;
    if (dot3(lab.vec, zen) < -0.05) continue;
    const hit = { x, y, r: 36, kind: 'con', key: `c${c}`, con: lab, rank: 50 };
    hitTargets.push(hit);
    labels.push({ kind: 'con', x, y, text: lab.name.toUpperCase(), hi: c === currentCon, fade, hit });
  }
  for (const a of asterisms) {
    const zc = dot3(a.center, fE);
    if (zc < cosView) continue;
    const x = cx + f * dot3(a.center, rE) / zc, y = cy - f * dot3(a.center, uE) / zc;
    if (x < 10 || x > W - 10 || y < 10 || y > H - 10) continue;
    const hit = { x, y, r: 36, kind: 'con', key: `a${a.name}`, con: { name: a.name, speak: a.name, fact: a.fact }, rank: 50 };
    hitTargets.push(hit);
    labels.push({ kind: 'aster', x, y, text: a.name.toUpperCase(), fade, hit });
  }
}

// ---- Sun, Moon, planets ----
function bodySize(b) {
  if (b.id === 'sun') return 30;
  if (b.id === 'moon') return 46;
  const m = typeof b.mag === 'number' ? b.mag : 3;
  // Small: to the eye a planet is a bright point, so the glow (sized by real
  // magnitude, below) carries it and the textured globe is a detail inside.
  return Math.max(8, Math.min(15, 11.5 - 1.0 * m));
}

function drawBodies(ctx, cam, t, labels) {
  const { right, up, fwd, cx, cy, f } = cam;
  const pendingArrows = [];
  for (const b of bodies) {
    const entity = SKY_BODIES[b.id];
    if (!entity) continue;
    const v = b.enu;
    const xc = dot3(v, right), yc = dot3(v, up), zc = dot3(v, fwd);
    const d = bodySize(b);
    const x = cx + f * xc / Math.max(zc, 1e-6), y = cy - f * yc / Math.max(zc, 1e-6);
    const onScreen = zc > 0.05 && x > -d && x < W + d && y > -d && y < H + d;
    const arrow = arrowEls.get(b.id);
    if (!onScreen) {
      if (arrow) {
        if (b.alt > -1) {
          // Screen direction of the target, even when it's behind the viewer.
          pendingArrows.push({ el: arrow, ang: Math.atan2(yc, xc || 1e-4) });
        } else arrow.classList.add('hidden');
      }
      continue;
    }
    if (arrow) arrow.classList.add('hidden');

    const below = Math.sin(b.alt * DEG) < hillSinAt(b.az * DEG);
    const alpha = below ? 0.38 : 1;
    ctx.globalAlpha = alpha;
    if (b.id === 'sun') {
      const s = d / 0.26;
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(sunSprite, x - s / 2, y - s / 2, s, s);
      ctx.globalCompositeOperation = 'source-over';
    } else if (b.id === 'moon') {
      drawMoon(ctx, cam, x, y, d, alpha);
    } else {
      const sp = planetSprites.get(b.id);
      // A planet is a steady point of light to the eye: a glow sized by its real
      // brightness, with the real globe at the centre for anyone who looks close.
      const m = typeof b.mag === 'number' ? b.mag : 3;
      const glowL = Math.pow(10, -0.4 * (m - limMag));
      if (glowL > 1) {
        const gd = d * (2.0 + 0.55 * Math.min(6, Math.log10(glowL) * 1.6));
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = alpha * Math.min(1, 0.4 + 0.16 * Math.log10(glowL)) * (0.55 + 0.45 * starVis);
        ctx.drawImage(starSprites[bvBucket(m < -3 ? 0.6 : b.id === 'mars' ? 1.5 : 0.9)], x - gd / 2, y - gd / 2, gd, gd);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = alpha;
      }
      if (sp) {
        const scale = d / sp.D;
        ctx.drawImage(sp.canvas, x - sp.canvas.width * scale / 2, y - sp.canvas.height * scale / 2, sp.canvas.width * scale, sp.canvas.height * scale);
      } else {
        ctx.fillStyle = entity.color || '#fff';
        ctx.beginPath(); ctx.arc(x, y, d / 2, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    if (isSpotted(b.id)) {
      ctx.strokeStyle = 'rgba(181,171,252,0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, d / 2 + 5, 0, Math.PI * 2); ctx.stroke();
    }
    const fl = flashes.get(b.id);
    if (fl !== undefined) {
      const k = (t - fl) / 900;
      if (k >= 1) flashes.delete(b.id);
      else {
        ctx.strokeStyle = `rgba(231,229,254,${(1 - k).toFixed(3)})`;
        ctx.lineWidth = 3 * (1 - k) + 1;
        ctx.beginPath(); ctx.arc(x, y, d / 2 + 6 + k * 34, 0, Math.PI * 2); ctx.stroke();
      }
    }
    const hit = { x, y, r: Math.max(28, d / 2 + 12), disc: d / 2 + 2, kind: 'body', key: b.id, entity, rank: -100 };
    hitTargets.push(hit);
    labels.push({ kind: 'body', x, y: y + d / 2 + 14, text: entity.name.toUpperCase(), dim: below, hit });
  }
  placeArrows(pendingArrows, cx, cy);
}

// Edge arrows sit on the screen's edge (inset), where the target would come
// into view, and step apart along it when two point almost the same way.
function placeArrows(list, cx, cy) {
  const top = Math.max(headerBottom + 8, 60), bottom = H - 104, inset = 30;
  const pts = list.map(({ el, ang }) => {
    const dx = Math.cos(ang), dy = -Math.sin(ang);
    const kx = dx > 0 ? (W - inset - cx) / dx : dx < 0 ? (inset - cx) / dx : Infinity;
    const ky = dy > 0 ? (bottom - cy) / dy : dy < 0 ? (top - cy) / dy : Infinity;
    const k = Math.min(kx, ky);
    return { el, ang, x: cx + dx * k, y: cy + dy * k };
  });
  for (let i = 0; i < pts.length; i++) {
    for (let j = 0; j < i; j++) {
      if (Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) < 40) {
        // Nudge along whichever edge it sits on.
        const onSide = pts[i].x <= inset + 1 || pts[i].x >= W - inset - 1;
        if (onSide) pts[i].y = Math.min(bottom, Math.max(top, pts[j].y + (pts[i].y >= pts[j].y ? 42 : -42)));
        else pts[i].x = Math.min(W - inset, Math.max(inset, pts[j].x + (pts[i].x >= pts[j].x ? 42 : -42)));
      }
    }
  }
  for (const p of pts) {
    p.el.classList.remove('hidden');
    p.el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%) rotate(${-p.ang / DEG}deg)`;
  }
}

function drawMoon(ctx, cam, x, y, d, alpha) {
  // Turn the Moon so its lit edge faces the Sun's real direction on screen: find
  // a point a few degrees from the Moon along the great circle toward the Sun.
  const m = moonEnu, s = sunEnu;
  const k = dot3(m, s);
  let tx = s[0] - k * m[0], ty = s[1] - k * m[1], tz = s[2] - k * m[2];
  const tn = Math.hypot(tx, ty, tz) || 1;
  const e = 0.05;
  const p = [m[0] + e * tx / tn, m[1] + e * ty / tn, m[2] + e * tz / tn];
  const pz = dot3(p, cam.fwd);
  let ang = 0;
  if (pz > 0.01) {
    const px = cam.cx + cam.f * dot3(p, cam.right) / pz, py = cam.cy - cam.f * dot3(p, cam.up) / pz;
    ang = Math.atan2(py - y, px - x);
  }
  // moonphase.js draws the lit side on the RIGHT while waxing, LEFT while waning.
  if (phaseDeg > 180) ang += Math.PI;

  // A soft glow around a bright Moon.
  if (moonIllum > 0.2) {
    const gd = d * 3.2;
    const g = ctx.createRadialGradient(x, y, d * 0.45, x, y, gd / 2);
    g.addColorStop(0, `rgba(200,210,235,${(0.22 * moonIllum * (1 - dayness * 0.7) * alpha).toFixed(3)})`);
    g.addColorStop(1, 'rgba(200,210,235,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - gd / 2, y - gd / 2, gd, gd);
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  // At night, the unlit disc hides the stars behind it. In daylight it
  // mustn't: the daytime Moon is only its lit part, pale against blue sky.
  if (dayness < 0.6) {
    ctx.globalAlpha = alpha * (1 - dayness / 0.6) * 0.92;
    ctx.fillStyle = '#05070f';
    ctx.beginPath(); ctx.arc(0, 0, d / 2 - 0.5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(moonCanvas, -d / 2, -d / 2, d, d);
  ctx.restore();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}

// ---- skyline + compass points ----
function drawHorizon(ctx, cam) {
  const { right, up, fwd, cx, cy, f } = cam;
  const path = new Path2D();
  let prev = null;
  for (let a = 0; a <= 360; a += 2) {
    const r = a * DEG, h = Math.asin(HILL[a]);
    const v = [Math.sin(r) * Math.cos(h), Math.cos(r) * Math.cos(h), Math.sin(h)];
    const cur = [dot3(v, right), dot3(v, up), dot3(v, fwd)];
    if (prev) {
      const s = projectSeg(cam, prev[0], prev[1], prev[2], cur[0], cur[1], cur[2]);
      if (s) { path.moveTo(s[0], s[1]); path.lineTo(s[2], s[3]); }
    }
    prev = cur;
  }
  ctx.strokeStyle = `rgba(${150 + 60 * dayness},${170 + 50 * dayness},${215},0.55)`;
  ctx.lineWidth = 1.2;
  ctx.stroke(path);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const [name, az] of CARDINALS) {
    const r = az * DEG, h = -4 * DEG;
    const v = [Math.sin(r) * Math.cos(h), Math.cos(r) * Math.cos(h), Math.sin(h)];
    const z = dot3(v, fwd);
    if (z < 0.1) continue;
    const x = cx + f * dot3(v, right) / z, y = cy - f * dot3(v, up) / z;
    if (x < -20 || x > W + 20 || y < -20 || y > H + 20) continue;
    const major = name.length === 1;
    ctx.font = major ? '700 15px Inter, system-ui, sans-serif' : '600 10px Inter, system-ui, sans-serif';
    ctx.fillStyle = name === 'N' ? '#ff9d8f' : major ? 'rgba(225,230,250,0.9)' : 'rgba(200,210,240,0.6)';
    ctx.fillText(name, x, y);
  }
}

// ---- labels (drawn last, on top of everything) ----
// Placed in priority order — bodies, whatever the reticle rests on, bright
// stars, then constellation names — and a label that would overlap one already
// placed is skipped rather than drawn on top of it. Constellation names also
// keep clear of the screen title block.
const LABEL_FONTS = {
  body: '700 11px Inter, system-ui, sans-serif',
  lock: '700 13px Inter, system-ui, sans-serif',
  star: '500 11px Inter, system-ui, sans-serif',
  conHi: '700 12px Inter, system-ui, sans-serif',
  con: '600 10px Inter, system-ui, sans-serif',
};
const LABEL_ORDER = { body: 0, star: 2, con: 3, aster: 3 };

function drawLabels(ctx, cam, labels) {
  const lockedKey = lockTarget ? lockTarget.key : null;
  // Whatever the reticle is resting on gets its name, even an unlabelled star.
  if (lockTarget && lockTarget.kind === 'star') {
    const e = starEntity(lockTarget.idx);
    if (e) labels.push({ kind: 'lock', x: lockTarget.x, y: lockTarget.y + 19, text: e.name });
  }
  const order = (l) => (l.kind === 'lock' ? 1 : (l.hit && l.hit.key === lockedKey ? 1 : LABEL_ORDER[l.kind]) + (l.hi ? -0.5 : 0));
  labels.sort((a, b) => order(a) - order(b));

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // A dark outline rather than shadowBlur: a blurred shadow per label per frame
  // is one of the slowest things canvas does on iOS Safari.
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(4,6,14,0.7)';
  // Sun/Moon/planet discs count as occupied, so no name is written across them.
  const placed = hitTargets.filter((h) => h.kind === 'body').map((h) => [h.x - h.disc, h.y - h.disc, h.x + h.disc, h.y + h.disc]);
  for (const l of labels) {
    if (!l.text) continue;
    const locked = l.kind === 'lock' || (l.hit && l.hit.key === lockedKey);
    if (l.kind === 'star' && lockTarget && l.hit === lockTarget) continue; // the 'lock' label replaces it
    const isCon = l.kind === 'con' || l.kind === 'aster';
    const text = l.kind === 'body' || isCon ? spaced(l.text) : l.text;
    const font = l.kind === 'body' ? LABEL_FONTS.body
      : l.kind === 'lock' ? LABEL_FONTS.lock
      : l.kind === 'star' ? LABEL_FONTS.star
      : (l.hi || locked) ? LABEL_FONTS.conHi : LABEL_FONTS.con;
    ctx.font = font;
    const w = ctx.measureText(text).width + 6, h = 14;
    const box = [l.x - w / 2, l.y - h / 2, l.x + w / 2, l.y + h / 2];
    if (isCon && headerBottom && box[1] < headerBottom) continue;
    if (!locked && placed.some((p) => box[0] < p[2] && box[2] > p[0] && box[1] < p[3] && box[3] > p[1])) continue;
    placed.push(box);
    if (l.kind === 'body') {
      ctx.fillStyle = locked ? '#e7e5fe' : l.dim ? 'rgba(233,233,237,0.5)' : 'rgba(233,233,237,0.95)';
    } else if (l.kind === 'lock') {
      ctx.fillStyle = '#e7e5fe';
    } else if (l.kind === 'star') {
      ctx.fillStyle = `rgba(220,228,250,${(0.8 * (0.5 + 0.5 * starVis)).toFixed(3)})`;
    } else {
      const a = ((l.hi || locked) ? 0.95 : 0.5) * l.fade;
      ctx.fillStyle = l.kind === 'aster' ? `rgba(255,220,165,${a.toFixed(3)})` : `rgba(175,192,240,${a.toFixed(3)})`;
    }
    ctx.strokeText(text, l.x, l.y);
    ctx.fillText(text, l.x, l.y);
  }
}

// Canvas letter-spacing isn't available everywhere (older Safari); thin spaces
// give small caps labels the same airy tracking the DOM labels had.
function spaced(s) {
  return s.split('').join(' ');
}

// --------------------------------------------------------------------------
// Point-and-hold, taps, drag, pinch
// --------------------------------------------------------------------------

function buildArrows() {
  const container = document.getElementById('sky-arrows');
  container.innerHTML = '';
  arrowEls.clear();
  for (const id of Object.keys(SKY_BODIES)) {
    const body = SKY_BODIES[id];
    const div = document.createElement('div');
    div.className = 'sky-arrow hidden';
    const dot = document.createElement('span');
    dot.className = body.id === 'sun' ? 'body-dot sun-dot arrow-dot' : 'body-dot arrow-dot';
    if (body.id !== 'sun') {
      dot.style.setProperty('--dot-light', body.light);
      dot.style.setProperty('--dot-dark', body.dark);
      dot.style.setProperty('--dot-glow', '8px');
    }
    const chevron = document.createElement('i');
    chevron.className = 'ph-fill ph-caret-right arrow-chevron';
    div.appendChild(dot);
    div.appendChild(chevron);
    container.appendChild(div);
    arrowEls.set(id, div);
  }
}

// Dwell targets: bodies and named stars (constellation labels are tap-only).
function updateLock(cam) {
  const dotEl = reticleDotEl || (reticleDotEl = document.querySelector('.reticle-dot'));
  const ret = reticleEl || (reticleEl = document.querySelector('.reticle'));
  let best = null, bestD = LOCK_RADIUS_PX;
  for (const h of hitTargets) {
    if (h.kind === 'con') continue;
    const dd = Math.hypot(h.x - cam.cx, h.y - cam.cy) + (h.kind === 'body' ? -8 : 0);
    if (dd < bestD) { bestD = dd; best = h; }
  }
  lockTarget = best;
  const now = performance.now();
  if (!best) {
    lockKey = null;
    if (dotEl) dotEl.style.transform = '';
    if (ret) ret.classList.remove('locking');
    return;
  }
  if (best.key !== lockKey) { lockKey = best.key; lockStart = now; }
  const progress = Math.min(1, (now - lockStart) / LOCK_MS);
  if (dotEl) dotEl.style.transform = `scale(${(1 + progress * 1.6).toFixed(2)})`;
  if (ret) ret.classList.add('locking');
  if (progress >= 1) {
    const last = lastAutoCatch.get(best.key) || 0;
    if (now - last > LOCK_COOLDOWN_MS) {
      lastAutoCatch.set(best.key, now);
      const entity = best.kind === 'body' ? best.entity : starEntity(best.idx);
      if (entity) catchBody(entity, false);
    }
    lockStart = now;
  }
}

// A deliberate TAP opens the info sheet; the reticle dwell only speaks —
// throwing a full-screen sheet over the sky every time you rest on something
// while panning would be unusable.
function catchBody(entity, openSheet) {
  flashes.set(entity.id, performance.now());
  if (openSheet) {
    if (entity.kind === 'star') openStarCard(entity, entity.conName);
    else openCard(entity.id);
  } else if (entity.fact) {
    say(entity.name, entity.fact, entity.safety);
  } else {
    say(`That's ${entity.name}!`);
  }
  if (isBadgeBody(entity.id)) {
    if (spot(entity.id)) {
      showToast(document.getElementById('sky-toast'), `${entity.emoji || ''} ${entity.name} spotted!`);
    }
  }
}

function handleTap(x, y) {
  let best = null, bestScore = Infinity;
  for (const h of hitTargets) {
    const d = Math.hypot(h.x - x, h.y - y);
    if (d > h.r) continue;
    // Bodies beat stars beat constellation names; then nearest, then brightest.
    const tier = h.kind === 'body' ? 0 : h.kind === 'star' ? 1000 : 2000;
    const score = tier + d + (h.kind === 'star' ? h.rank * 2 : 0);
    if (score < bestScore) { bestScore = score; best = h; }
  }
  if (!best) return;
  if (best.kind === 'body') catchBody(best.entity, true);
  else if (best.kind === 'star') { const e = starEntity(best.idx); if (e) catchBody(e, true); }
  else say(best.con.speak, best.con.fact || undefined);
}

function wirePointer() {
  const view = document.getElementById('sky-view');
  const pointers = new Map();
  let pinch = null;
  let tap = null;
  view.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) tap = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
    else tap = null;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), fov };
    }
  });
  view.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > 10) fov = Math.max(MIN_FOV_DEG, Math.min(MAX_FOV_DEG, pinch.fov * pinch.d / d));
      return;
    }
    if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > TAP_SLOP_PX) tap = null;
    if (!sensorState.usingDevice && pointers.size === 1) {
      // Drag the sky itself: the point under your finger stays under it.
      const degPerPx = fov / Math.min(W || 1, H || 1);
      nudge(-dx * degPerPx, dy * degPerPx);
    }
  });
  const end = (e) => {
    if (tap && tap.id === e.pointerId && performance.now() - tap.t < TAP_MS) {
      const r = view.getBoundingClientRect();
      handleTap(e.clientX - r.left, e.clientY - r.top);
    }
    tap = null;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
  };
  view.addEventListener('pointerup', end);
  view.addEventListener('pointercancel', (e) => { tap = null; end(e); });
  view.addEventListener('wheel', (e) => {
    e.preventDefault();
    fov = Math.max(MIN_FOV_DEG, Math.min(MAX_FOV_DEG, fov * Math.exp(e.deltaY * 0.0015)));
  }, { passive: false });
}
