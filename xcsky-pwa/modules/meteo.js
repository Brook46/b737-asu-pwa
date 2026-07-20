// meteo.js — Open-Meteo data access for XC Sky.
//
// Everything here is keyless and free (open-meteo.com). Two endpoints:
//   • geocoding  — search place names → lat/lon
//   • forecast   — hourly soaring variables + a vertical profile (pressure levels)
//
// We deliberately pull raw physical variables and derive the soaring numbers
// ourselves in soaring.js, so the maths is auditable rather than a black box.

const FORECAST_API = 'https://api.open-meteo.com/v1/forecast';
const GEOCODE_API  = 'https://geocoding-api.open-meteo.com/v1/search';

// Pressure levels used for the wind profile + sounding, high (surface) → low.
// Up to 500 hPa (~5.5 km) covers every thermal and the sounding's plotted range.
// 400/300 hPa were pure payload — and Open-Meteo bills by variables × steps, so
// trimming them directly reduces how often we trip the rate limit.
export const LEVELS = [1000, 925, 850, 700, 600, 500];

// Weather models Open-Meteo exposes that are useful for soaring. `best_match`
// auto-picks the best available model for the point (HRRR/ICON-D2/… near the
// surface, GFS elsewhere) — a good default.
//
// GFS-family models return `boundary_layer_height` directly; the others don't,
// so their thermal top comes from the dry-adiabat method (soaring.js) using the
// pressure-level temperatures — which every one of these provides. That lets us
// offer the full spread of global + regional models.
export const MODELS = [
  { id: 'best_match', label: 'Auto (best)', short: 'Auto' },
  { id: 'gfs_seamless', label: 'GFS · NOAA', short: 'GFS' },
  { id: 'ecmwf_ifs025', label: 'ECMWF · IFS', short: 'ECMWF' },
  { id: 'icon_seamless', label: 'ICON · DWD', short: 'ICON' },
  { id: 'icon_eu', label: 'ICON-EU · 7 km', short: 'ICON-EU' },
  { id: 'meteofrance_seamless', label: 'Météo-France · AROME/ARPEGE', short: 'AROME' },
  { id: 'gem_seamless', label: 'GEM · Canada', short: 'GEM' },
  { id: 'ukmo_seamless', label: 'UKMO · UK Met', short: 'UKMO' },
  { id: 'jma_seamless', label: 'JMA · Japan', short: 'JMA' },
];

// Surface / column variables (one value per hour).
const SURFACE_VARS = [
  'temperature_2m', 'dewpoint_2m', 'relative_humidity_2m',
  'surface_pressure',
  'cape', 'convective_inhibition', 'lifted_index',
  'boundary_layer_height', 'freezing_level_height',
  'cloud_cover', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high',
  'shortwave_radiation',
  'precipitation', 'weathercode',
  'windspeed_10m', 'winddirection_10m', 'wind_gusts_10m',
];

// Per-pressure-level variables (become e.g. windspeed_850hPa).
const LEVEL_VARS = ['temperature', 'relative_humidity', 'windspeed', 'winddirection', 'geopotential_height'];

function levelVarNames() {
  const out = [];
  for (const lv of LEVELS) for (const v of LEVEL_VARS) out.push(`${v}_${lv}hPa`);
  return out;
}

/** Search place names. Returns [{name, admin, country, lat, lon, elevation}]. */
export async function geocode(query, count = 6) {
  const q = query.trim();
  if (!q) return [];
  const url = `${GEOCODE_API}?name=${encodeURIComponent(q)}&count=${count}&language=en&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`geocode ${res.status}`);
  const data = await res.json();
  return (data.results || []).map((r) => ({
    name: r.name,
    admin: r.admin1 || '',
    country: r.country_code || r.country || '',
    lat: r.latitude,
    lon: r.longitude,
    elevation: r.elevation,
  }));
}

/** Reverse-lookup a short label for a coordinate (best-effort, may be empty). */
export async function reverseLabel(lat, lon) {
  try {
    // Open-Meteo has no reverse endpoint; use the free BigDataCloud client API.
    const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`;
    const res = await fetch(url);
    if (!res.ok) return '';
    const d = await res.json();
    return d.locality || d.city || d.principalSubdivision || '';
  } catch { return ''; }
}

// Country lookups are cached on a coarse grid so the route fence costs at most
// a handful of requests. Returns an ISO country code, or '' over the sea /
// on error (which the fence treats as out-of-bounds).
const _countryCache = new Map();
export async function reverseCountry(lat, lon) {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  if (_countryCache.has(key)) return _countryCache.get(key);
  let code = '';
  try {
    const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`;
    const res = await fetch(url);
    if (res.ok) {
      const d = await res.json();
      code = (d.countryCode || '').toUpperCase();   // '' when offshore
    }
  } catch { /* keep '' */ }
  _countryCache.set(key, code);
  return code;
}

/**
 * Fetch the full soaring forecast for a point.
 * @returns {Promise<Forecast>} normalised structure (see below).
 */
export async function fetchForecast({ lat, lon, model = 'best_match', days = 3 }) {
  const hourly = [...SURFACE_VARS, ...levelVarNames()].join(',');
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    hourly,
    models: model,
    forecast_days: String(days),
    timezone: 'auto',
    windspeed_unit: 'kmh',
    cell_selection: 'nearest',
  });
  const res = await fetchRetry(`${FORECAST_API}?${params}`);
  if (!res.ok) throw new Error(`forecast ${res.status}`);
  const data = await res.json();
  if (!data.hourly || !data.hourly.time) throw new Error('no hourly data returned');
  return normalise(data);
}

/**
 * fetch that rides out Open-Meteo's per-IP rate limit. 429/5xx are retried with
 * exponential backoff + jitter (honouring Retry-After when the server sends it);
 * 4xx other than 429 return immediately since retrying won't help.
 *
 * Mobile carriers put many phones behind one IP (CGNAT), so a 429 is usually a
 * shared, short-lived window — waiting a few seconds almost always clears it.
 */
export async function fetchRetry(url, opts, { retries = 3 } = {}) {
  let last = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let res;
    try {
      res = await fetch(url, opts);
    } catch (err) {                                  // network blip
      if (attempt === retries) throw err;
      await sleep(backoff(attempt));
      continue;
    }
    if (res.ok) return res;
    if (res.status !== 429 && res.status < 500) return res;
    last = res;
    if (attempt === retries) break;
    const ra = parseInt(res.headers.get('retry-after') || '', 10);
    await sleep(Number.isFinite(ra) ? Math.min(ra * 1000, 15000) : backoff(attempt));
  }
  return last;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const backoff = (n) => Math.min(9000, 900 * 2 ** n) + Math.random() * 600;

/**
 * Reshape Open-Meteo's parallel arrays into per-hour objects. Each hour carries
 * its surface fields plus a `levels` array [{p, z, t, rh, spd, dir}] sorted
 * surface→top, filtered to levels above the terrain.
 *
 * @typedef {Object} Forecast
 * @property {number} lat @property {number} lon
 * @property {number} elevation  terrain height (m MSL) of the model cell
 * @property {string} timezone
 * @property {Hour[]} hours
 */
function normalise(data) {
  const h = data.hourly;
  const n = h.time.length;
  const get = (name, i) => {
    const arr = h[name];
    const v = arr ? arr[i] : null;
    return (v === null || v === undefined) ? null : v;
  };
  const hours = [];
  for (let i = 0; i < n; i++) {
    const iso = h.time[i];
    const dt = new Date(iso);
    const levels = [];
    for (const p of LEVELS) {
      const z = get(`geopotential_height_${p}hPa`, i);
      if (z === null) continue;
      levels.push({
        p,
        z,
        t: get(`temperature_${p}hPa`, i),
        rh: get(`relative_humidity_${p}hPa`, i),
        spd: get(`windspeed_${p}hPa`, i),
        dir: get(`winddirection_${p}hPa`, i),
      });
    }
    // Sort surface (highest pressure) → top (lowest pressure) i.e. z ascending.
    levels.sort((a, b) => a.z - b.z);

    hours.push({
      iso,
      time: dt,
      hourOfDay: dt.getHours(),
      dayKey: iso.slice(0, 10),
      t2m: get('temperature_2m', i),
      td2m: get('dewpoint_2m', i),
      rh2m: get('relative_humidity_2m', i),
      sfcPressure: get('surface_pressure', i),
      cape: get('cape', i),
      cin: get('convective_inhibition', i),
      liftedIndex: get('lifted_index', i),
      blHeight: get('boundary_layer_height', i),      // m AGL
      freezingLevel: get('freezing_level_height', i), // m MSL
      cloudTotal: get('cloud_cover', i),
      cloudLow: get('cloud_cover_low', i),
      cloudMid: get('cloud_cover_mid', i),
      cloudHigh: get('cloud_cover_high', i),
      shortwave: get('shortwave_radiation', i),       // W/m²
      precip: get('precipitation', i),
      weathercode: get('weathercode', i),
      wind10: get('windspeed_10m', i),
      windDir10: get('winddirection_10m', i),
      gust10: get('wind_gusts_10m', i),
      levels,
    });
  }
  return {
    lat: data.latitude,
    lon: data.longitude,
    elevation: data.elevation,
    timezone: data.timezone,
    utcOffsetSeconds: data.utc_offset_seconds,
    hours,
  };
}

/** Group hours by local calendar day → [{dayKey, date, hours}]. */
export function groupByDay(forecast) {
  const map = new Map();
  for (const hr of forecast.hours) {
    if (!map.has(hr.dayKey)) map.set(hr.dayKey, []);
    map.get(hr.dayKey).push(hr);
  }
  return [...map.entries()].map(([dayKey, hours]) => ({
    dayKey,
    date: new Date(hours[0].iso),
    hours,
  }));
}
