// fmt.js — display formatting. Aviation units throughout (feet, knots, ft/min,
// nautical miles): this shows airline traffic to people who read altimeters, so
// converting to metric would only introduce rounding error and confusion.

/** Altitude: flight level above the transition-ish, feet below. */
export function alt(ft, onGround) {
  if (onGround) return 'GND';
  if (ft === null || ft === undefined || !Number.isFinite(ft)) return '—';
  if (ft >= 18000) return `FL${String(Math.round(ft / 100)).padStart(3, '0')}`;
  return `${Math.round(ft / 25) * 25} ft`;
}

/** Bare feet, for the detail rows where FL isn't wanted. */
export function feet(ft) {
  if (!Number.isFinite(ft)) return '—';
  return `${Math.round(ft).toLocaleString('en-US')} ft`;
}

export function kt(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${Math.round(v)} kt`;
}

/** Vertical rate with an arrow — level inside ±100 fpm, like a VSI. */
export function vs(fpm) {
  if (fpm === null || fpm === undefined || !Number.isFinite(fpm)) return '—';
  const r = Math.round(fpm / 50) * 50;
  if (Math.abs(r) < 100) return 'level';
  return `${r > 0 ? '↑' : '↓'} ${Math.abs(r).toLocaleString('en-US')} fpm`;
}

export function deg(d) {
  if (d === null || d === undefined || !Number.isFinite(d)) return '—';
  return `${String(Math.round(d) % 360).padStart(3, '0')}°`;
}

export function nm(v) {
  if (!Number.isFinite(v)) return '—';
  return v < 10 ? `${v.toFixed(1)} NM` : `${Math.round(v)} NM`;
}

/** Freshness of a position report. */
export function age(sec) {
  if (!Number.isFinite(sec)) return '';
  if (sec < 15) return 'live';
  if (sec < 90) return `${Math.round(sec)}s ago`;
  return `${Math.round(sec / 60)}m ago`;
}

/** How long ago a timestamp was: "4m", "1h20", "2d". */
export function since(ts) {
  if (!ts) return '—';
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h${String(mins % 60).padStart(2, '0')}`;
  return `${Math.floor(h / 24)}d`;
}

/** The same, as a phrase: "just now", "12m ago", "1h20 ago". */
export function ago(ts) {
  const s = since(ts);
  return (s === 'just now' || s === '—') ? s : `${s} ago`;
}

/** "1842Z" — UTC, the way arrival times are written on a flight plan. */
export function hhmmZ(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return `${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}Z`;
}

/** The same instant in the reader's own time zone, e.g. "20:42". */
export function hhmmLocal(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** "2h05" / "35 min" — a duration in minutes. */
export function dur(mins) {
  if (!Number.isFinite(mins) || mins < 0) return '—';
  const m = Math.round(mins);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
}

/**
 * Parse a scheduled time given as "HHMM"/"HH:MM" (UTC) into a timestamp.
 *
 * A clock time carries no date, so the day has to be chosen — and it must be
 * chosen against the *arrival*, not against the current moment. A flight
 * landing at 0545Z tomorrow scheduled for 0930Z is 3h45 early on the right day
 * and nonsense on any other; anchoring to "now" is what produced deltas of
 * several hours. Whichever of yesterday/today/tomorrow lands nearest the
 * anchor is the day meant, so the difference is always within ±12 h.
 */
export function parseStaUtc(raw, anchor = Date.now()) {
  const m = /^(\d{1,2}):?(\d{2})$/.exec(String(raw || '').trim());
  if (!m) return 0;
  const h = Number(m[1]); const min = Number(m[2]);
  if (h > 23 || min > 59) return 0;
  const d = new Date(anchor);
  const base = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, min, 0, 0);
  const DAY = 24 * 3600 * 1000;
  let best = base;
  for (const off of [-DAY, 0, DAY]) {
    if (Math.abs(base + off - anchor) < Math.abs(best - anchor)) best = base + off;
  }
  return best;
}

export function clock(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

/** ISO country code → flag emoji, for the airline chip. */
export function flag(iso) {
  const c = String(iso || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return '';
  return String.fromCodePoint(...[...c].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}
