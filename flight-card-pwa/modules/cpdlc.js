// cpdlc.js — which FIR the aircraft is in, the next one ahead, and whether
// each has CPDLC, with its log-on code.
//
// The FIR outlines are the Route info map's (mapdata.js: VAT-Spy tracings —
// rough, for orientation). A ring is named by the FIR label that falls inside
// it; where rings overlap (an ACC sector inside its FIR) the smallest wins.
//
// Log-on codes: EUROCONTROL WikiLink "Network Status", the ATN B1 ATSUs in
// operation (checked Nov 2026). CPDLC is mandatory above FL285 in Europe;
// some centres start lower. Outside that list it says so — there may still
// be FANS somewhere, so the AIP or the Jeppesen pages have the last word.

import { FIR_LABELS, firRings } from './mapdata.js?v=251';

// FIR (or ACC sector) on the map → the log-on to use there.
const LOGON = {
  EDGG: { code: 'EDUU', note: 'Karlsruhe UAC · EDYY in the north-west' },
  EDWW: { code: 'EDYY', note: 'Maastricht UAC · EDUU in the south' },
  EDMM: { code: 'EDUU', note: 'Karlsruhe UAC' },
  EBBU: { code: 'EDYY', note: 'Maastricht UAC' },
  EHAA: { code: 'EDYY', note: 'Maastricht UAC' },
  EFIN: { code: 'EFIN' }, EETT: { code: 'EETT' }, EVRR: { code: 'EVRR' }, EYVL: { code: 'EYVC' },
  EGTT: { code: 'EGTT' }, EGPX: { code: 'EGPX' }, EISN: { code: 'EISN' },
  EKDK: { code: 'EKDK' }, EPWW: { code: 'EPWW' },
  ESAA: { code: 'ESMM', note: 'ESOS in the north' }, ESMM: { code: 'ESMM' }, ESOS: { code: 'ESOS' },
  GCCC: { code: 'GCCC' }, LBSR: { code: 'LBSR' }, LCCC: { code: 'LCCC' }, LDZO: { code: 'LDZO' },
  LECB: { code: 'LECB' }, LECM: { code: 'LECM' },
  LFBB: { code: 'LFBB' }, LFEE: { code: 'LFEE' }, LFFF: { code: 'LFFF' }, LFMM: { code: 'LFMM' }, LFRR: { code: 'LFRR' },
  LHCC: { code: 'LHCC' }, LIBB: { code: 'LIBB' }, LIMM: { code: 'LIMM' }, LIPP: { code: 'LIPP' }, LIRR: { code: 'LIRR' },
  LJLA: { code: 'LJLA' }, LKAA: { code: 'LKAA' }, LMMM: { code: 'LMMM' }, LOVV: { code: 'LOVV' },
  LPPC: { code: 'LPPC' }, LRBB: { code: 'LRBB' },
  LSAS: { code: 'LSAZ', note: 'LSAG in the west' }, LSAG: { code: 'LSAG' }, LSAZ: { code: 'LSAZ' },
  LYBA: { code: 'LYBA' }, LZBB: { code: 'LZBB' },
};
// On the way, not in operation yet.
const SOON = { LGGG: 'Greece: CPDLC planned for 2028', ENOS: 'Norway: CPDLC planned for 2028' };

let rings = null;
function ringsNamed() {
  if (rings) return rings;
  rings = firRings().map(r => {
    const [x0, y0, x1, y1] = r.box;
    const lbl = FIR_LABELS.find(([, lon, lat]) => lon >= x0 && lon <= x1 && lat >= y0 && lat <= y1 && inRing(r.pts, lon, lat));
    return { ...r, id: lbl ? lbl[0] : '', area: (x1 - x0) * (y1 - y0) };
  }).filter(r => r.id);
  return rings;
}
function inRing(p, lon, lat) {
  let inside = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const xi = p[i], yi = p[i + 1], xj = p[j], yj = p[j + 1];
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export function firAt(lat, lon) {
  let best = null;
  for (const r of ringsNamed()) {
    const [x0, y0, x1, y1] = r.box;
    if (lon < x0 || lon > x1 || lat < y0 || lat > y1) continue;
    if (inRing(r.pts, lon, lat) && (!best || r.area < best.area)) best = r;
  }
  return best ? best.id : '';
}
export function cpdlcOf(id) {
  if (LOGON[id]) return { on: true, ...LOGON[id] };
  return { on: false, note: SOON[id] || 'No CPDLC (ATN) — voice' };
}

// Along the way ahead, every 10 nm: the FIR we're in and the first
// different one ahead, with its distance and time at this groundspeed.
// The way ahead is the filed route from abeam where we are when one was
// pasted and we're on it (`ahead`, from plan-route.js progress()), else
// the great circle straight to the destination.
const R = Math.PI / 180;
function gcPoint(a, b, f) {
  const f1 = a.lat * R, l1 = a.lon * R, f2 = b.lat * R, l2 = b.lon * R;
  const d = 2 * Math.asin(Math.sqrt(Math.sin((f2 - f1) / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin((l2 - l1) / 2) ** 2));
  if (d < 1e-9) return { lat: a.lat, lon: a.lon, d: 0 };
  const A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
  const x = A * Math.cos(f1) * Math.cos(l1) + B * Math.cos(f2) * Math.cos(l2);
  const y = A * Math.cos(f1) * Math.sin(l1) + B * Math.cos(f2) * Math.sin(l2);
  const z = A * Math.sin(f1) + B * Math.sin(f2);
  return { lat: Math.atan2(z, Math.hypot(x, y)) / R, lon: Math.atan2(y, x) / R, d: d * 3440.065 };
}
export function nextFir(pos, dest, gsKt, ahead = null) {
  const here = firAt(pos.lat, pos.lon);
  const path = ahead && ahead.length ? [pos, ...ahead] : [pos, dest];
  let run = 0;
  for (let k = 0; k + 1 < path.length; k++) {
    const total = gcPoint(path[k], path[k + 1], 1).d;
    const steps = Math.max(1, Math.ceil(total / 10));
    for (let i = 1; i <= steps; i++) {
      const p = gcPoint(path[k], path[k + 1], i / steps);
      const id = firAt(p.lat, p.lon);
      if (id && id !== here) {
        const dist = run + total * i / steps;
        return { here, next: id, distNm: dist, min: gsKt > 60 ? dist / gsKt * 60 : null };
      }
    }
    run += total;
  }
  return { here, next: '', distNm: null, min: null };
}
