// compare.js — "do the models agree?"
//
// One Open-Meteo request with several `models=` returns every model's data in a
// single payload, with each variable suffixed by the model id
// (`temperature_2m_gfs_seamless`). We split that back apart, run the same
// soaring physics over each, and report the spread for one day.
//
// A day where ICON, ECMWF and AROME all say 2 m/s to 2500 m is a day you can
// plan around. A day where they disagree by 1000 m is a day to stay flexible —
// that judgement is the whole point of showing this.

import { fetchRetry } from './meteo.js';
import { deriveHour } from './soaring.js';
import * as Store from './store.js';

const FORECAST_API = 'https://api.open-meteo.com/v1/forecast';

// A deliberately small set: the independent global/regional models pilots
// actually cross-check. More models = a bigger payload and a closer rate limit.
export const COMPARE_MODELS = [
  { id: 'ecmwf_ifs025', label: 'ECMWF' },
  { id: 'gfs_seamless', label: 'GFS' },
  { id: 'icon_seamless', label: 'ICON' },
  { id: 'meteofrance_seamless', label: 'AROME' },
];

// Minimum variable set — enough for deriveHour's dry-adiabat fallback.
const VARS = [
  'temperature_2m', 'dewpoint_2m', 'boundary_layer_height', 'shortwave_radiation',
  'cloud_cover_low', 'windspeed_10m', 'winddirection_10m',
  'temperature_850hPa', 'temperature_700hPa', 'temperature_600hPa',
  'geopotential_height_850hPa', 'geopotential_height_700hPa', 'geopotential_height_600hPa',
];

const key = (lat, lon, dayKey) => `cmp:${lat.toFixed(2)},${lon.toFixed(2)}:${dayKey}`;

/**
 * Compare models for one day at one point.
 * @returns [{id, label, peakClimb, peakTop, base, bestHour}] — missing models dropped.
 */
export async function compareDay({ lat, lon, dayKey, elevation }) {
  const cached = await Store.get(key(lat, lon, dayKey)).catch(() => null);
  // Model runs update a few times a day; an hour-old comparison is still honest.
  if (cached && Date.now() - cached.at < 3600e3) return cached.value;

  const params = new URLSearchParams({
    latitude: lat.toFixed(4), longitude: lon.toFixed(4),
    hourly: VARS.join(','),
    models: COMPARE_MODELS.map((m) => m.id).join(','),
    start_date: dayKey, end_date: dayKey,
    timezone: 'auto', windspeed_unit: 'kmh', cell_selection: 'nearest',
  });
  const res = await fetchRetry(`${FORECAST_API}?${params}`);
  if (!res.ok) throw new Error(`compare ${res.status}`);
  const data = await res.json();
  const h = data.hourly;
  if (!h || !h.time) throw new Error('no comparison data');

  const out = [];
  for (const m of COMPARE_MODELS) {
    const col = (v) => h[`${v}_${m.id}`] ?? (COMPARE_MODELS.length === 1 ? h[v] : null);
    if (!col('temperature_2m')) continue;                 // model not available here
    const row = summarise(h.time, col, data.elevation ?? elevation);
    if (row) out.push({ id: m.id, label: m.label, ...row });
  }
  if (out.length) Store.put(key(lat, lon, dayKey), out);
  return out;
}

/** Peak climb / top over the soarable part of the day for one model. */
function summarise(times, col, elevation) {
  let best = null;
  for (let i = 0; i < times.length; i++) {
    const hourOfDay = Number(times[i].slice(11, 13));
    if (hourOfDay < 8 || hourOfDay > 19) continue;
    const hr = {
      t2m: col('temperature_2m')[i], td2m: col('dewpoint_2m')[i],
      blHeight: col('boundary_layer_height') ? col('boundary_layer_height')[i] : null,
      shortwave: col('shortwave_radiation')[i],
      cloudLow: col('cloud_cover_low') ? col('cloud_cover_low')[i] : 0,
      wind10: col('windspeed_10m')[i], windDir10: col('winddirection_10m')[i],
      levels: [850, 700, 600].map((p) => ({
        p,
        t: col(`temperature_${p}hPa`) ? col(`temperature_${p}hPa`)[i] : null,
        z: col(`geopotential_height_${p}hPa`) ? col(`geopotential_height_${p}hPa`)[i] : null,
      })).filter((l) => l.t != null),
    };
    const d = deriveHour(hr, elevation);
    if (!best || d.climb > best.peakClimb) {
      best = {
        peakClimb: d.climb, peakTop: d.workingTop, base: d.cumulus ? d.cloudBase : null,
        bestHour: hourOfDay, wind: hr.wind10,
      };
    }
  }
  return best;
}

/** Spread across models — the honest "how much can I trust this?" number. */
export function spread(rows) {
  if (rows.length < 2) return null;
  const tops = rows.map((r) => r.peakTop).filter((v) => v != null);
  const climbs = rows.map((r) => r.peakClimb);
  return {
    topRange: tops.length > 1 ? Math.max(...tops) - Math.min(...tops) : null,
    climbRange: Math.max(...climbs) - Math.min(...climbs),
  };
}
