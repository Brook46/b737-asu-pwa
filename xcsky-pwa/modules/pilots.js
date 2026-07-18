// pilots.js — live pilots from the Open Glider Network (live.glidernet.org).
//
// OGN is the open aggregation point for live tracking: FLARM and OGN trackers,
// FANET, SafeSky, and app trackers (XCTrack etc.) that relay into it all show
// up here. LiveTrack24's and XContest's own APIs are appKey/login-walled, so
// OGN is what a keyless client can honestly use — and its lxml endpoint echoes
// the CORS Origin header, so we can fetch straight from the browser.
//
// Endpoint bbox params: a=0&b=<latN>&c=<latS>&d=<lonE>&e=<lonW>

const OGN_URL = 'https://live.glidernet.org/lxml.php';

// OGN aircraft type codes.
export const TYPE_NAMES = {
  0: 'Unknown', 1: 'Glider', 2: 'Tow plane', 3: 'Helicopter', 4: 'Parachute',
  5: 'Drop plane', 6: 'Hang glider', 7: 'Paraglider', 8: 'Aircraft', 9: 'Jet',
  10: 'UFO', 11: 'Balloon', 12: 'Airship', 13: 'UAV', 14: 'Ground', 15: 'Static',
};

// Free-flight / soaring types shown by default (jets & GA hidden behind a toggle).
export const SOARING_TYPES = new Set([1, 2, 4, 6, 7, 11]);

export function typeColor(t) {
  switch (t) {
    case 7: return '#ef7d3b';  // paraglider — orange
    case 6: return '#f2c14e';  // hang glider — gold
    case 1: return '#5ec2ff';  // glider — blue
    case 2: return '#7cc143';  // tow plane — green
    case 11: return '#ab47bc'; // balloon — purple
    default: return '#8a93a6';
  }
}

/**
 * Fetch live pilots inside a Leaflet-style bounds object.
 * @returns {Promise<Pilot[]>} [{lat,lon,label,reg,alt,time,ageSec,track,speed,climb,type}]
 */
export async function fetchPilots(bounds) {
  const p = new URLSearchParams({
    a: '0',
    b: bounds.getNorth().toFixed(3),
    c: bounds.getSouth().toFixed(3),
    d: bounds.getEast().toFixed(3),
    e: bounds.getWest().toFixed(3),
  });
  const res = await fetch(`${OGN_URL}?${p}`);
  if (!res.ok) throw new Error(`ogn ${res.status}`);
  const xml = new DOMParser().parseFromString(await res.text(), 'text/xml');
  const out = [];
  for (const m of xml.querySelectorAll('m')) {
    // a="lat,lon,CN,reg,alt_m,HH:MM:SS,age_s,track,speed_kmh,climb_ms,type,receiver,devId,uid"
    const f = (m.getAttribute('a') || '').split(',');
    if (f.length < 11) continue;
    const lat = parseFloat(f[0]), lon = parseFloat(f[1]);
    if (!isFinite(lat) || !isFinite(lon)) continue;
    out.push({
      lat, lon,
      label: f[2] || f[3] || '?',
      reg: f[3] || '',
      alt: parseInt(f[4], 10) || 0,        // m MSL
      time: f[5] || '',
      ageSec: parseInt(f[6], 10) || 0,
      track: parseInt(f[7], 10) || 0,
      speed: parseInt(f[8], 10) || 0,      // km/h
      climb: parseFloat(f[9]) || 0,        // m/s
      type: parseInt(f[10], 10) || 0,
      uid: f[13] || f[12] || `${lat},${lon}`,
    });
  }
  return out;
}

export function ageLabel(sec) {
  if (sec < 90) return `${sec}s ago`;
  return `${Math.round(sec / 60)}m ago`;
}
