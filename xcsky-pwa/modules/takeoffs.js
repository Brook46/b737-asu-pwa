// takeoffs.js — launch sites from ParaglidingEarth (the open "paragliding map"
// crowd DB that FlyXC also uses), ranked "which launch works right now".
//
// PGE sends no CORS header, so we read it through our own worker's /pge shim.
// Each site carries per-direction suitability weights (N/NE/E/…, 0=no, 1=ok,
// 2=primary). We score a site at the selected day+hour by combining:
//   • wind-direction match — does the forecast surface wind (the direction it
//     comes FROM, i.e. the way you launch INTO) suit a facing this site has?
//   • wind strength — comfortable for a paraglider launch, not too strong
//   • thermal strength at the site (from the weather grid)
// Only sites reachable inside the loaded grid can be scored (so the ranking is
// always consistent with what's painted on the map).

import { sampleAt, gridReady } from './grid.js';

const WORKER_BASE = 'https://b737-asu-pwa.alonbrookstein.workers.dev';
const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

let cache = null;   // { key, sites:[…] }

function bboxKey(b) {
  return [b.getSouth().toFixed(1), b.getWest().toFixed(1), b.getNorth().toFixed(1), b.getEast().toFixed(1)].join('|');
}

/** Fetch launches for a Leaflet bounds (cached per coarse bbox). Returns [] on failure. */
export async function fetchTakeoffs(bounds) {
  const key = bboxKey(bounds);
  if (cache && cache.key === key) return cache.sites;
  const q = new URLSearchParams({
    n: bounds.getNorth().toFixed(4), s: bounds.getSouth().toFixed(4),
    e: bounds.getEast().toFixed(4), w: bounds.getWest().toFixed(4), limit: '120',
  });
  let sites = [];
  try {
    const res = await fetch(`${WORKER_BASE}/pge?${q}`);
    if (res.ok) {
      const gj = await res.json();
      sites = (gj.features || []).map(parseSite).filter(Boolean);
    }
  } catch { /* offline / worker down → no takeoffs */ }
  cache = { key, sites };
  return sites;
}

function parseSite(f) {
  const c = f.geometry && f.geometry.coordinates;
  const p = f.properties || {};
  if (!c || c.length < 2) return null;
  const dirs = {};
  for (const d of DIRS) dirs[d] = parseInt(p[d], 10) || 0;
  return {
    id: p.pge_site_id || `${c[1]},${c[0]}`,
    name: p.name || 'Takeoff',
    lat: c[1], lon: c[0],
    alt: parseInt(p.takeoff_altitude, 10) || null,
    dirs,
    paragliding: p.paragliding === '1',
    thermals: p.thermals === '1',
    link: p.pge_link || `https://www.paraglidingearth.com/?site=${p.pge_site_id}`,
  };
}

/** Suitability weight (0/1/2) of a site for wind coming FROM `deg`, blending the
 *  two nearest of the 8 compass facings. */
function facingWeight(dirs, deg) {
  const idx = ((deg % 360) + 360) % 360 / 45;   // 0..8
  const lo = Math.floor(idx) % 8, hi = (lo + 1) % 8;
  const frac = idx - Math.floor(idx);
  return dirs[DIRS[lo]] * (1 - frac) + dirs[DIRS[hi]] * frac;
}

/** Score one site 0..100 at the given day/hour, plus a short reason. */
export function scoreSite(site, dayKey, hour) {
  const wx = sampleAt(site.lat, site.lon, dayKey, hour);
  if (!wx) return { score: 0, wx: null, reason: 'no data' };

  const wind = wx.wind ?? 0;
  const facing = facingWeight(site.dirs, wx.windDir ?? 0);   // 0..2

  // Wind-direction match (0..45). No matching facing ⇒ cross/tail ⇒ unlaunchable.
  const dirScore = facing <= 0.05 ? 0 : (facing >= 1 ? 45 : 22 + facing * 23);

  // Wind strength for a paraglider launch (0..25): best 6–22 km/h.
  let windScore = 25;
  if (wind < 4) windScore = 15;                    // nil-wind: launchable, less ideal
  else if (wind > 22) windScore = Math.max(0, 25 - (wind - 22) * 2.2);
  if (wind > 34) windScore -= 25;                  // too strong to launch safely

  // Thermal strength at the site (0..30).
  const thermal = Math.min(30, (wx.climb || 0) * 15);

  let score = Math.round(Math.max(0, dirScore + windScore + thermal));
  if (facing <= 0.05) score = Math.min(score, 8);  // wrong-way wind caps it hard

  let reason;
  if (facing <= 0.05) reason = 'wind off the back';
  else if (wind > 34) reason = 'too windy';
  else if ((wx.climb || 0) >= 1.2 && facing >= 1) reason = 'wind on + working';
  else if (facing >= 1) reason = 'good wind line';
  else reason = 'marginal wind angle';

  return { score, wx, facing, reason };
}

/** Rank the sites for a day/hour (best first). Requires a loaded weather grid. */
export function rankSites(sites, dayKey, hour) {
  if (!gridReady()) return [];
  return sites
    .map((s) => ({ site: s, ...scoreSite(s, dayKey, hour) }))
    .filter((r) => r.wx)
    .sort((a, b) => b.score - a.score);
}

export function scoreColor(score) {
  if (score >= 78) return '#7cc143';
  if (score >= 60) return '#a7c957';
  if (score >= 42) return '#f2c14e';
  if (score >= 22) return '#ef7d3b';
  return '#8a93a6';
}

export { DIRS };
