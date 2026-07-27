// format.js — one place for every number that reaches the screen.
//
// Metric throughout: metres, km, km/h, m/s. That's what free-flight pilots,
// XContest, and every vario on the market use, so there's no unit toggle to
// get wrong. Times are shown in UTC because that's what the IGC file records
// and what makes two pilots' tracks line up in Absolute Time Sync.

/** 3725 → "1:02:05"; 754 → "12:34". */
export function fmtDuration(sec) {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  const p = (v) => String(v).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(ss)}` : `${m}:${p(ss)}`;
}

/** Epoch ms → "14:32:05" UTC. */
export function fmtClock(ms) {
  const d = new Date(ms);
  const p = (v) => String(v).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

/** Epoch ms → "14:32" UTC. */
export function fmtClockShort(ms) {
  const d = new Date(ms);
  const p = (v) => String(v).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/** "2026-07-14" → "14 Jul 2026". */
export function fmtDate(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso || '';
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
  return `${d.getUTCDate()} ${mon} ${d.getUTCFullYear()}`;
}

/** Thin-space thousands separator so 1240 reads as "1 240 m" at a glance. */
export function fmtAlt(m) {
  if (!Number.isFinite(m)) return '—';
  return `${Math.round(m).toLocaleString('en-GB').replace(/,/g, ' ')} m`;
}

/** Metres → "850 m" below a km, "12.4 km" above. */
export function fmtDist(m) {
  if (!Number.isFinite(m)) return '—';
  if (Math.abs(m) < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}

/** m/s → "41 km/h". */
export function fmtSpeed(ms) {
  if (!Number.isFinite(ms)) return '—';
  return `${Math.round(ms * 3.6)} km/h`;
}

/** Always signed — a vario reading without its sign is useless. */
export function fmtVario(ms) {
  if (!Number.isFinite(ms)) return '—';
  const v = ms.toFixed(1);
  return `${ms > 0 ? '+' : ''}${v}`;
}

/** Glide ratio → "8.1:1", or "—" while climbing. */
export function fmtGlide(r) {
  if (!Number.isFinite(r) || r <= 0) return '—';
  return `${r.toFixed(1)}:1`;
}

/** m AGL, rounded to something believable given DEM resolution. */
export function fmtAgl(m) {
  if (!Number.isFinite(m)) return '—';
  return `${Math.round(m / 5) * 5} m`;
}

/** Turn rate → "L 14°/s" / "R 21°/s" / "straight". */
export function fmtTurn(dps) {
  if (!Number.isFinite(dps) || Math.abs(dps) < 3) return 'straight';
  return `${dps < 0 ? 'L' : 'R'} ${Math.abs(dps).toFixed(0)}°/s`;
}
