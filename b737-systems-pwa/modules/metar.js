// metar.js — the latest METAR for an airport, and what it says for SP.16:
// temperature, visibility, precipitation (as the SP.16 icing categories) and
// the runway state group when the report carries one.
//
// Source: metar.vatsim.net (plain text, CORS, worldwide — same feed Flight
// Card uses), falling back to the Flight Card worker's /metar
// (aviationweather.gov). Decoding is a convenience: every value it fills in
// stays editable, and the raw report is always shown.

const WORKER = 'https://b737-asu-pwa.alonbrookstein.workers.dev';

async function get(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const t = (await r.text()).trim();
  if (!t || /no metar|not found/i.test(t)) throw new Error('No METAR');
  return t.split('\n')[0].trim();
}

/** The raw METAR for an ICAO code. */
export async function fetchMetar(icao) {
  const id = encodeURIComponent(icao.toUpperCase());
  try { return await get(`https://metar.vatsim.net/${id}`); } catch { /* fall back */ }
  return get(`${WORKER}/metar?icao=${id}`);
}

const DEPOSIT = ['clear and dry', 'damp', 'wet or water patches', 'rime or frost', 'dry snow', 'wet snow', 'slush', 'ice', 'compacted snow', 'frozen ruts'];

// Runway state depth: 00 = less than 1 mm, 01–90 mm, 92–98 = 10–40 cm.
function depthMm(ee) {
  if (!/^\d\d$/.test(ee)) return null;
  const n = Number(ee);
  if (n <= 90) return n;
  if (n >= 92 && n <= 98) return (n - 90) * 50;
  return null;
}

/**
 * The parts of a METAR that SP.16 needs.
 * precip: 'none' | 'fog' | 'rain' | 'snow' | 'frz' (the SP.16.2 visible
 * moisture categories; freezing rain / drizzle / fog and heavy snow are 'frz').
 * surface: 'dry' | 'wet' | 'contam' | 'deep' | null (null = no runway state group).
 */
export function parseMetar(raw) {
  // Observed part only: the trend forecast and remarks are not current weather.
  const all = raw.replace(/=$/, '').split(/\s+/);
  const end = all.findIndex((t, k) => k > 1 && /^(RMK|TEMPO|BECMG|NOSIG)$/.test(t));
  const tok = end > 0 ? all.slice(0, end) : all;
  const out = { raw, icao: tok[0] === 'METAR' || tok[0] === 'SPECI' ? tok[1] : tok[0], time: null, tempC: null, dewC: null, visM: null, wx: [], precip: 'none', rwy: [], surface: null };
  let i = 0;
  for (const t of tok) {
    i++;
    if (/^\d{6}Z$/.test(t)) out.time = t;
    else if (t === 'CAVOK') out.visM = 10000;
    else if (/^\d{4}$/.test(t) && out.visM == null && i > 2) out.visM = t === '9999' ? 10000 : Number(t);
    else if (/^\d+(\/\d+)?SM$/.test(t) && out.visM == null) {
      const [a, b] = t.replace('SM', '').split('/');
      const whole = b && /^\d$/.test(tok[i - 2] || '') ? Number(tok[i - 2]) : 0;   // "1 1/2SM"
      out.visM = Math.round((whole + (b ? Number(a) / Number(b) : Number(a))) * 1609);
    } else if (/^M?\d{2}\/(M?\d{2})?$/.test(t)) {
      const [a, b] = t.split('/');
      out.tempC = Number(a.replace('M', '-'));
      if (b) out.dewC = Number(b.replace('M', '-'));
    } else if (/^(\+|-)?(MI|PR|BC|DR|BL|SH|TS|FZ)?(DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PO|SQ|FC|SS|DS)+$/.test(t)) {
      out.wx.push(t);
    } else if (/^R\d{2}[LCR]?\/([0-9/]{6}|CLRD\/\/)$/.test(t)) {
      const [r, s] = t.slice(1).split('/');
      if (s.startsWith('CLRD')) out.rwy.push({ rwy: r, deposit: 0, desc: 'cleared', depth: 0 });
      else out.rwy.push({ rwy: r === '88' ? 'all' : r, deposit: s[0] === '/' ? null : Number(s[0]), desc: s[0] === '/' ? 'not reported' : DEPOSIT[Number(s[0])], depth: depthMm(s.slice(2, 4)) });
    } else if (t === 'R/SNOCLO') out.rwy.push({ rwy: 'all', deposit: null, desc: 'closed by snow', depth: null, closed: true });
  }
  // Visible moisture (SP.16.2): fog counts at 1,600 m or less.
  const has = (re) => out.wx.some((w) => re.test(w));
  if (has(/FZ(RA|DZ|FG)/) || has(/^\+.*SN/)) out.precip = 'frz';
  else if (has(/SN|SG|PL|IC|GS|GR/)) out.precip = 'snow';
  else if (has(/RA|DZ/)) out.precip = 'rain';
  else if (has(/FG/) || (has(/BR/) && out.visM != null && out.visM <= 1600)) out.precip = 'fog';
  // Runway: the worst reported deposit decides.
  for (const r of out.rwy) {
    let s = null;
    const d = r.depth ?? 0;
    if (r.closed) s = 'contam';
    else if (r.deposit === 0) s = 'dry';
    else if (r.deposit === 1) s = 'wet';
    else if (r.deposit === 2) s = d > 13 ? 'deep' : d > 3 ? 'contam' : 'wet';
    else if (r.deposit === 4) s = d > 102 ? 'deep' : 'contam';
    else if (r.deposit === 5 || r.deposit === 6) s = d > 13 ? 'deep' : 'contam';
    else if (r.deposit != null) s = 'contam';
    const rank = { dry: 0, wet: 1, contam: 2, deep: 3 };
    if (s && (out.surface == null || rank[s] > rank[out.surface])) out.surface = s;
  }
  return out;
}

/** Minutes since a ddhhmmZ time, or null. */
export function ageMin(time, now = new Date()) {
  if (!time) return null;
  const d = Number(time.slice(0, 2)), h = Number(time.slice(2, 4)), m = Number(time.slice(4, 6));
  let t = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), d, h, m);
  if (t > now.getTime() + 3600000) t = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, d, h, m);
  return Math.round((now.getTime() - t) / 60000);
}

const PRECIP = { none: 'no precipitation', fog: 'fog', rain: 'rain or drizzle', snow: 'snow, sleet or ice', frz: 'freezing precipitation or heavy snow' };

/** One line for the user: what was read from the report. */
export function summary(m) {
  const p = [];
  if (m.tempC != null) p.push(`${String(m.tempC).replace('-', '−')} °C`);
  if (m.visM != null) p.push(m.visM >= 10000 ? 'visibility 10 km+' : `visibility ${m.visM} m`);
  p.push(PRECIP[m.precip]);
  for (const r of m.rwy) p.push(`RWY ${r.rwy}: ${r.desc}${r.depth ? ` ${r.depth} mm` : ''}`);
  return p.join(' · ');
}
