// navdb.js — the FMC's navigation database and geodesy helpers.
// Data: data/navdb.json, built by scripts/build-navdb.py from OurAirports
// (public domain): airports with runways, and VOR / DME / NDB navaids. There
// are no named enroute fixes or procedures in it, so the FMC also accepts
// latitude/longitude (N32W035, N3201.5E03452.1) and place/bearing/distance
// (BGN270/20) entries, like the real box.

const R_NM = 3440.065;
const rad = (d) => (d * Math.PI) / 180, deg = (r) => (r * 180) / Math.PI;

export const geo = {
  /** Great-circle distance, NM. */
  dist(a, b) {
    const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(h)));
  },
  /** Initial true bearing a → b, degrees 0–360. */
  brg(a, b) {
    const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
    const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
    return (deg(Math.atan2(y, x)) + 360) % 360;
  },
  /** Point at true bearing / distance (NM) from a. */
  dest(a, brgT, nm) {
    const d = nm / R_NM, t = rad(brgT), la = rad(a.lat), lo = rad(a.lon);
    const lat = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(t));
    const lon = lo + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(lat));
    return { lat: deg(lat), lon: ((deg(lon) + 540) % 360) - 180 };
  },
  /** Signed angle b − a in −180…180. */
  diff(a, b) { return ((b - a + 540) % 360) - 180; },
  /** Cross-track distance (NM, + right of course) from the great circle a→b. */
  xtk(a, b, p) {
    const d13 = geo.dist(a, p) / R_NM, t13 = rad(geo.brg(a, p)), t12 = rad(geo.brg(a, b));
    return Math.asin(Math.sin(d13) * Math.sin(t13 - t12)) * R_NM;
  },
  fmtLat(v) { const a = Math.abs(v), d = Math.floor(a); return `${v < 0 ? 'S' : 'N'}${String(d).padStart(2, '0')}°${((a - d) * 60).toFixed(1).padStart(4, '0')}`; },
  fmtLon(v) { const a = Math.abs(v), d = Math.floor(a); return `${v < 0 ? 'W' : 'E'}${String(d).padStart(3, '0')}°${((a - d) * 60).toFixed(1).padStart(4, '0')}`; },
};

let db = null, loading = null;
export function loadNav(url) {
  loading ||= fetch(url).then((r) => r.json()).then((d) => { db = d; return d; }).catch((e) => { loading = null; throw e; });
  return loading;
}

const near = (list, ref) => (ref ? [...list].sort((a, b) => geo.dist(ref, a) - geo.dist(ref, b))[0] : list[0]);

export const nav = {
  get ready() { return !!db; },
  get source() { return db?.source || ''; },
  airport(icao) {
    const a = db?.airports[icao];
    return a ? { ident: icao, lat: a[0], lon: a[1], elev: a[2], name: a[3], type: 'apt', rwys: a[4] } : null;
  },
  runways(icao) { return (db?.airports[icao]?.[4] || []).map((r) => ({ id: r[0], lat: r[1], lon: r[2], hdgT: r[3], len: r[4], elev: r[5], disp: r[6] })); },
  runway(icao, id) { return nav.runways(icao).find((r) => r.id === id) || null; },
  /** Nearest navaid with this ident (idents repeat worldwide). */
  navaid(ident, ref) {
    const list = db?.navaids[ident];
    if (!list?.length) return null;
    const n = near(list.map((v) => ({ type: v[0], lat: v[1], lon: v[2], freq: v[3], name: v[4], mv: v[5] })), ref);
    return { ident, ...n };
  },
  /** Local magnetic variation (east +) from the nearest VOR, degrees. */
  magVar(p) {
    if (!db || !p) return 0;
    let best = null, bd = 1e9;
    const k = `${Math.round(p.lat)},${Math.round(p.lon)}`;
    if (nav._mvCache?.[k] != null) return nav._mvCache[k];
    for (const list of Object.values(db.navaids)) for (const v of list) {
      if (v[0] === 'NDB') continue;
      const d = Math.abs(v[1] - p.lat) + Math.abs(v[2] - p.lon) * Math.cos(rad(p.lat));
      if (d < bd) { bd = d; best = v; }
    }
    (nav._mvCache ||= {})[k] = best ? best[5] : 0;
    return nav._mvCache[k];
  },
  /**
   * A waypoint from what the pilot types: airport, navaid, lat/lon or
   * place/bearing/distance. Returns { ident, lat, lon, type } or null.
   */
  point(text, ref) {
    const s = String(text).trim().toUpperCase();
    if (!s) return null;
    // Lat/lon: N32E034, N3201.5E03452.1, N32W035
    let m = s.match(/^([NS])(\d{2})(\d{2}(?:\.\d)?)?([EW])(\d{3})(\d{2}(?:\.\d)?)?$/);
    if (m) {
      const lat = (+m[2] + (m[3] ? +m[3] / 60 : 0)) * (m[1] === 'S' ? -1 : 1);
      const lon = (+m[5] + (m[6] ? +m[6] / 60 : 0)) * (m[4] === 'W' ? -1 : 1);
      if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
      return { ident: `${m[1]}${m[2]}${m[4]}${m[5]}`, lat, lon, type: 'll' };
    }
    // Place / bearing / distance: BGN270/20 (bearing magnetic)
    m = s.match(/^([A-Z0-9]{2,5})(\d{3})\/(\d{1,3}(?:\.\d)?)$/);
    if (m) {
      const base = nav.point(m[1], ref);
      if (!base) return null;
      const t = (+m[2] + nav.magVar(base) + 360) % 360;
      const p = geo.dest(base, t, +m[3]);
      // Boeing-style name: first three letters of the place + a sequence number.
      return { ident: `${m[1].slice(0, 3)}${String(Math.round(+m[3])).padStart(2, '0')}`.slice(0, 5), ...p, type: 'pbd' };
    }
    if (/^[A-Z]{4}$/.test(s)) { const a = nav.airport(s); if (a) return a; }
    if (/^[A-Z0-9]{1,5}$/.test(s)) { const n = nav.navaid(s, ref); if (n) return { ...n, type: n.type }; }
    return null;
  },
};
