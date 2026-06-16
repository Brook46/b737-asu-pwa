// xc.js — "best distance over up to 5 turnpoints" (km).
//
// A simplified XContest-style free-distance score: the longest total leg
// distance you can make through up to five points of your flight, kept in
// chronological order. Used to crown the King of the day. A dynamic program
// over a downsampled track keeps it cheap enough to run live on a phone.

function havKm(a, b) {
  const R = 6371, toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function downsample(pts, max) {
  if (pts.length <= max) return pts;
  const out = [], step = pts.length / max;
  for (let i = 0; i < pts.length; i += step) out.push(pts[Math.floor(i)]);
  out.push(pts[pts.length - 1]);
  return out;
}

export function bestDistanceKm(pts) {
  if (!pts || pts.length < 2) return 0;
  const p = downsample(pts, 40);
  const m = p.length, K = 4;                  // up to 5 points ⇒ 4 legs
  const dp = Array.from({ length: K + 1 }, () => new Float64Array(m).fill(-1));
  for (let j = 0; j < m; j++) dp[0][j] = 0;
  let best = 0;
  for (let k = 1; k <= K; k++) {
    for (let j = 0; j < m; j++) {
      for (let i = 0; i < j; i++) {
        if (dp[k - 1][i] < 0) continue;
        const v = dp[k - 1][i] + havKm(p[i], p[j]);
        if (v > dp[k][j]) dp[k][j] = v;
      }
      if (dp[k][j] > best) best = dp[k][j];
    }
  }
  return best;
}
