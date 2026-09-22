#!/usr/bin/env node
// build-sky-data.mjs — regenerates data/sky.json, the real sky the Sky screen draws.
//
//   node sky-club-pwa/tools/build-sky-data.mjs [dir-with-downloads]
//
// Source: d3-celestial by Olaf Frohn (BSD-3-Clause), whose star data is the
// HYG/Hipparcos catalogue and whose constellation figures and Milky Way
// contours come from Stellarium/IAU sources. Without an argument the files are
// fetched from GitHub; pass a directory to build from local copies instead.
//
// data/stars.json stays the hand-edited file for everything a kid hears —
// facts, friendly constellation names, distances. This script joins those
// curated entries onto the catalogue by POSITION, which is also a check on
// them: the curated coordinates were typed from memory, and any entry that
// lands more than MATCH_DEG from a real star of similar brightness fails the
// build instead of silently pinning a fact to the wrong point of light.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import zlib from 'node:zlib';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = 'https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/';
const MAG_LIMIT = 6.0;      // naked-eye limit under a truly dark sky
const NAME_MAG_LIMIT = 4.5; // proper names only for stars you could plausibly pick out
const MATCH_DEG = 1.5;

// Curated constellation/asterism id (data/stars.json) → IAU abbreviation used by
// the catalogue. Asterisms map onto the constellation that contains them.
const CURATED_TO_IAU = {
  bigdipper: 'UMa', orion: 'Ori', cassiopeia: 'Cas', southerncross: 'Cru',
  scorpius: 'Sco', leo: 'Leo', cygnus: 'Cyg', taurus: 'Tau', gemini: 'Gem',
  ursaminor: 'UMi', pegasus: 'Peg', andromeda: 'And', perseus: 'Per',
  auriga: 'Aur', bootes: 'Boo', lyra: 'Lyr', aquila: 'Aql', canisminor: 'CMi',
  centaurus: 'Cen', draco: 'Dra', corvus: 'Crv', sagittarius: 'Sgr',
  canismajor: 'CMa', aries: 'Ari', cetus: 'Cet',
  // summertriangle spans Lyra/Cygnus/Aquila — kept as its own asterism line.
};

const dir = process.argv[2];
async function load(name) {
  if (dir) return JSON.parse(await readFile(path.join(dir, name), 'utf8'));
  const res = await fetch(SRC + name);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return res.json();
}

const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const ra360 = (lon) => (lon + 360) % 360; // catalogue longitudes are RA in degrees, −180..180

function sepDeg(ra1, dec1, ra2, dec2) {
  const d = Math.PI / 180;
  const c = Math.sin(dec1 * d) * Math.sin(dec2 * d) +
    Math.cos(dec1 * d) * Math.cos(dec2 * d) * Math.cos((ra1 - ra2) * d);
  return Math.acos(Math.max(-1, Math.min(1, c))) / d;
}

const [starsGeo, names, lines, consGeo, mw] = await Promise.all([
  load('stars.6.json'), load('starnames.json'), load('constellations.lines.json'),
  load('constellations.json'), load('mw.json'),
]);
const curated = JSON.parse(await readFile(path.join(APP, 'data/stars.json'), 'utf8'));

// ---- constellations ----
const consIds = consGeo.features.map((f) => f.id);
const conIndex = new Map();
consIds.forEach((id, i) => { if (!conIndex.has(id)) conIndex.set(id, i); });

// ---- stars, brightest first (draw order + label priority) ----
const starFeats = starsGeo.features
  .filter((f) => f.properties.mag <= MAG_LIMIT)
  .sort((a, b) => a.properties.mag - b.properties.mag);

const stars = [];
const starNames = {};
const hipToIndex = new Map();
starFeats.forEach((f, i) => {
  const [lon, dec] = f.geometry.coordinates;
  const bv = parseFloat(f.properties.bv);
  const nm = names[f.id];
  const con = nm && conIndex.has(nm.c) ? conIndex.get(nm.c) : -1;
  stars.push(r2(ra360(lon)), r2(dec), r2(f.properties.mag), Number.isFinite(bv) ? r2(bv) : 0.6, con);
  hipToIndex.set(String(f.id), i);
  if (nm && nm.name && f.properties.mag <= NAME_MAG_LIMIT) starNames[i] = nm.name;
});

// ---- curated join ----
const featuredStars = [];
const failures = [];
for (const s of curated.stars) {
  const ra = s.ra * 15;
  let best = -1, bestScore = Infinity, bestSep = 0;
  for (let i = 0; i < starFeats.length; i++) {
    const sep = sepDeg(ra, s.dec, stars[i * 5], stars[i * 5 + 1]);
    if (sep > MATCH_DEG) continue;
    // Prefer the positional match, but a much brighter/fainter star is the wrong one.
    const score = sep + Math.abs(stars[i * 5 + 2] - s.mag) * 0.8;
    if (score < bestScore) { bestScore = score; best = i; bestSep = sep; }
  }
  if (best < 0 || Math.abs(stars[best * 5 + 2] - s.mag) > 1.2) {
    failures.push(`${s.id}: no catalogue star within ${MATCH_DEG}° of similar brightness`);
    continue;
  }
  const catName = starNames[best];
  if (catName && catName.toLowerCase().replace(/\s/g, '') !== s.name.toLowerCase().replace(/\s/g, '') &&
      s.mag <= 1.5) {
    // Bright curated stars must agree with the catalogue's own name.
    failures.push(`${s.id}: matched "${catName}" (${bestSep.toFixed(2)}°)`);
    continue;
  }
  const entry = { i: best, id: s.id, name: s.name };
  for (const k of ['fact', 'distanceLy', 'con']) if (s[k] !== undefined) entry[k] = s[k];
  if (bestSep > 0.5) console.warn(`note: ${s.id} curated position was ${bestSep.toFixed(2)}° off the catalogue`);
  featuredStars.push(entry);
}
if (failures.length) {
  console.error('Curated stars that did not match the real catalogue:\n  ' + failures.join('\n  '));
  process.exit(1);
}

const byCuratedId = new Map(featuredStars.map((f) => [f.id, f.i]));
const featuredCons = curated.constellations.map((c) => {
  const out = { id: c.id, name: c.name, fact: c.fact, iau: CURATED_TO_IAU[c.id] || null, kind: c.kind };
  if (!out.iau) {
    // Asterisms with no IAU home keep their own figure, drawn from real positions.
    out.lines = c.lines.map(([a, b]) => [byCuratedId.get(a), byCuratedId.get(b)]).filter(([a, b]) => a !== undefined && b !== undefined);
  }
  return out;
});

// ---- constellation figures + label anchors ----
const linesById = new Map(lines.features.map((f) => [f.id, f.geometry.coordinates]));
const cons = consGeo.features.map((f) => ({
  id: f.id,
  // Latin, as every atlas and sky app labels them (the English glosses in the
  // source — "Colt", "Indian", "Crane" — read oddly and match nothing else).
  name: f.properties.name,
  at: [r1(ra360(f.geometry.coordinates[0])), r1(f.geometry.coordinates[1])],
  rank: Number(f.properties.rank) || 3,
}));
const figures = [];
for (const [id, polylines] of linesById) {
  for (const pl of polylines) {
    figures.push({ c: conIndex.get(id), p: pl.flatMap(([lon, dec]) => [r2(ra360(lon)), r2(dec)]) });
  }
}

// ---- Milky Way brightness map (data/milkyway.png) ----
// The contours can't be filled as screen polygons: the band wraps all the way
// round the viewer, and a loop that encircles the eye has no well-defined
// "inside" once it is projected onto a flat screen. So they are rasterised here,
// once, into a brightness map in GALACTIC coordinates (the band is horizontal
// there, so a narrow latitude strip covers all of it), and sky.js samples that
// map per pixel of the sky — which is a correct projection at any view angle.
const EQ_TO_GAL = [ // IAU J2000 equatorial → galactic (transpose of astro.js GAL_TO_EQ)
  [-0.0548755604, -0.8734370902, -0.4838350155],
  [0.4941094279, -0.4448296300, 0.7469822445],
  [-0.8676661490, -0.1980763734, 0.4559837762],
];
function toGalactic(raDeg, decDeg) {
  const d = Math.PI / 180, ra = raDeg * d, dec = decDeg * d;
  const v = [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
  const g = EQ_TO_GAL.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
  return [((Math.atan2(g[1], g[0]) / d) + 360) % 360, Math.asin(Math.max(-1, Math.min(1, g[2]))) / d];
}
const MW_B_MAX = 40, MW_RES = 0.5; // ±40° of galactic latitude at 0.5°/px
const MW_W = 360 / MW_RES, MW_H = (2 * MW_B_MAX) / MW_RES;
const SS = 2; // supersampling for antialiased contour edges
const accum = new Float32Array(MW_W * MW_H);
for (const f of mw.features) {
  const edges = []; // [l1, b1, l2, b2], unwrapped so l2 - l1 never jumps across 0/360
  for (const poly of f.geometry.coordinates) for (const ring of poly) {
    for (let i = 0; i + 1 < ring.length; i++) {
      const [l1, b1] = toGalactic(ra360(ring[i][0]), ring[i][1]);
      let [l2, b2] = toGalactic(ra360(ring[i + 1][0]), ring[i + 1][1]);
      if (l2 - l1 > 180) l2 -= 360; else if (l1 - l2 > 180) l2 += 360;
      edges.push([l1, b1, l2, b2]);
    }
  }
  const W = MW_W * SS, H = MW_H * SS;
  const level = new Uint8Array(W * H);
  for (let col = 0; col < W; col++) {
    const lc = (col + 0.5) * (360 / W);
    const hits = [];
    for (const [l1, b1, l2, b2] of edges) {
      const lo = Math.min(l1, l2), hi = Math.max(l1, l2);
      for (const l of [lc, lc - 360, lc + 360]) {
        if (l >= lo && l < hi) hits.push(b1 + (b2 - b1) * (l - l1) / (l2 - l1));
      }
    }
    hits.sort((a, b) => a - b);
    // Even–odd between successive crossings: band edges and dust-lane holes alike.
    for (let k = 0; k + 1 < hits.length; k += 2) {
      const r0 = Math.max(0, Math.ceil((hits[k] + MW_B_MAX) / (2 * MW_B_MAX) * H - 0.5));
      const r1 = Math.min(H - 1, Math.floor((hits[k + 1] + MW_B_MAX) / (2 * MW_B_MAX) * H - 0.5));
      for (let r = r0; r <= r1; r++) level[r * W + col] = 1;
    }
  }
  for (let y = 0; y < MW_H; y++) for (let x = 0; x < MW_W; x++) {
    let s = 0;
    for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++) s += level[(y * SS + dy) * W + x * SS + dx];
    accum[y * MW_W + x] += s / (SS * SS);
  }
}
// A gentle blur (σ ≈ 0.75°) so the five contour steps read as one continuous glow.
function blur1d(src, w, h, horizontal, sigma) {
  const rad = Math.ceil(sigma * 3), k = [];
  for (let i = -rad; i <= rad; i++) k.push(Math.exp(-(i * i) / (2 * sigma * sigma)));
  const ks = k.reduce((a, b) => a + b, 0);
  const dst = new Float32Array(src.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let i = -rad; i <= rad; i++) {
      const xx = horizontal ? (x + i + w) % w : x, yy = horizontal ? y : Math.min(h - 1, Math.max(0, y + i));
      s += src[yy * w + xx] * k[i + rad];
    }
    dst[y * w + x] = s / ks;
  }
  return dst;
}
const blurred = blur1d(blur1d(accum, MW_W, MW_H, true, 1.5), MW_W, MW_H, false, 1.5);
const maxLevel = mw.features.length;
const png = encodeGrayPng(MW_W, MW_H, (x, y) => Math.round(Math.min(1, blurred[(MW_H - 1 - y) * MW_W + x] / maxLevel) * 255));
await writeFile(path.join(APP, 'data/milkyway.png'), png);
console.log(`milkyway.png: ${MW_W}×${MW_H}, ${(png.length / 1024).toFixed(0)} KB (row 0 = b +${MW_B_MAX}°, col 0 = l 0°)`);

function encodeGrayPng(w, h, px) {
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w + 1)] = 0;
    for (let x = 0; x < w; x++) raw[y * (w + 1) + 1 + x] = px(x, y);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit greyscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = {
  _comment: 'GENERATED by tools/build-sky-data.mjs from d3-celestial (BSD-3-Clause, Olaf Frohn; HYG/Hipparcos stars, Stellarium figures). Edit data/stars.json for facts, then re-run.',
  stars, starNames, cons, figures,
  milkyWayMap: { src: "data/milkyway.png", bMax: MW_B_MAX, res: MW_RES },
  featured: { stars: featuredStars, cons: featuredCons },
};
await writeFile(path.join(APP, 'data/sky.json'), JSON.stringify(out));
const kb = (JSON.stringify(out).length / 1024).toFixed(0);
console.log(`sky.json: ${stars.length / 5} stars, ${Object.keys(starNames).length} names, ${cons.length} constellations, ` +
  `${figures.length} figure lines, ` +
  `${featuredStars.length}/${curated.stars.length} curated stars joined — ${kb} KB`);
