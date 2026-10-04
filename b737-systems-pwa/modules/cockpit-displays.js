// cockpit-displays.js — the flight deck's screens, drawn on canvases in the
// 737NG style: PFD, ND (map), upper DU (primary engine + fuel), lower DU
// (secondary engine + hydraulic SYS), the MCP and the ISFD. They read a data
// snapshot assembled from the phase and the live system states, so a
// failure you set in a schematic shows up on the displays too.

const F = (px, w = 700) => `${w} ${px}px "Helvetica Neue", Arial, sans-serif`;
const RED = '#ff3b30', MAG = '#ff5ad2', GRN = '#3df03d', CYN = '#28e3f2', AMB = '#ffb21e', WHT = '#f4f4f4';

/** Engine numbers for a phase (illustrative, typical values). */
export function engineFor(phase, running) {
  if (!running) return { n1: 0, n2: 0, egt: 22, ff: 0, oilP: 0, oilT: 22, oilQ: 18, vib: 0 };
  return {
    ground: { n1: 20.6, n2: 59.8, egt: 420, ff: 0.27, oilP: 34, oilT: 70, oilQ: 16, vib: 0.2 },
    takeoff: { n1: 95.4, n2: 98.2, egt: 878, ff: 3.18, oilP: 62, oilT: 115, oilQ: 15, vib: 0.6 },
    cruise: { n1: 87.6, n2: 93.1, egt: 742, ff: 1.24, oilP: 55, oilT: 108, oilQ: 15, vib: 0.4 },
    landing: { n1: 76.0, n2: 86.0, egt: 655, ff: 0.95, oilP: 50, oilT: 104, oilQ: 15, vib: 0.5 },
  }[phase];
}

/** Flight numbers for a phase. */
export function flightFor(phase) {
  return {
    ground: { ias: 0, mach: 0, alt: 0, vs: 0, hdg: 90, gs: 0, tas: 0, pitch: 0, fma: ['', '', ''], ap: '' },
    takeoff: { ias: 158, mach: 0.24, alt: 300, vs: 2400, hdg: 90, gs: 162, tas: 160, pitch: 15, fma: ['N1', 'LNAV', 'TO/GA'], ap: 'FD' },
    cruise: { ias: 268, mach: 0.785, alt: 37000, vs: 0, hdg: 93, gs: 468, tas: 452, pitch: 2.2, fma: ['MCP SPD', 'LNAV', 'VNAV PTH'], ap: 'CMD' },
    landing: { ias: 92, mach: 0.14, alt: 0, vs: 0, hdg: 90, gs: 90, tas: 92, pitch: 0, fma: ['', '', ''], ap: '' },
  }[phase];
}

function clear(g, W, H) { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); }
function text(g, s, x, y, c = WHT, px = 20, align = 'left', w = 700) { g.fillStyle = c; g.font = F(px, w); g.textAlign = align; g.fillText(s, x, y); }
function box(g, x, y, w, h, c = WHT, lw = 2) { g.strokeStyle = c; g.lineWidth = lw; g.strokeRect(x, y, w, h); }

// ── PFD ─────────────────────────────────────────────────────────────────────
export function drawPFD(g, W, H, d) {
  clear(g, W, H);
  const f = d.flight;
  const cx = W * 0.5, cy = H * 0.47, ppd = 7;   // pixels per degree of pitch
  // Attitude: clipped to the ADI window.
  g.save();
  g.beginPath(); g.roundRect?.(cx - 140, cy - 150, 280, 300, 22) ?? g.rect(cx - 140, cy - 150, 280, 300); g.clip();
  // Bank rolls the horizon round the airplane symbol.
  g.translate(cx, cy); g.rotate((-(f.bank || 0) * Math.PI) / 180); g.translate(-cx, -cy);
  const hy = cy + f.pitch * ppd;
  g.fillStyle = '#1c78d4'; g.fillRect(-W, -H, W * 3, hy + H);
  g.fillStyle = '#7b4a1e'; g.fillRect(-W, hy, W * 3, H * 2);
  g.strokeStyle = WHT; g.lineWidth = 2;
  g.beginPath(); g.moveTo(-W, hy); g.lineTo(W * 2, hy); g.stroke();
  for (let p = -30; p <= 30; p += 2.5) {
    if (!p) continue;
    const y = hy - p * ppd, w = p % 10 === 0 ? 60 : p % 5 === 0 ? 34 : 16;
    g.beginPath(); g.moveTo(cx - w, y); g.lineTo(cx + w, y); g.stroke();
    if (p % 10 === 0) { text(g, String(Math.abs(p)), cx - w - 10, y + 6, WHT, 16, 'right'); text(g, String(Math.abs(p)), cx + w + 10, y + 6, WHT, 16); }
  }
  g.restore();
  // Bank scale.
  g.strokeStyle = WHT; g.lineWidth = 2;
  g.beginPath(); g.arc(cx, cy, 150, Math.PI * 1.32, Math.PI * 1.68); g.stroke();
  g.fillStyle = WHT; g.beginPath(); g.moveTo(cx, cy - 150); g.lineTo(cx - 8, cy - 164); g.lineTo(cx + 8, cy - 164); g.fill();
  // Airplane symbol.
  g.fillStyle = '#000'; g.strokeStyle = WHT; g.lineWidth = 2;
  for (const s of [-1, 1]) { g.fillRect(cx + s * 40 - (s < 0 ? 52 : 0), cy - 5, 52, 10); g.strokeRect(cx + s * 40 - (s < 0 ? 52 : 0), cy - 5, 52, 10); }
  g.fillRect(cx - 6, cy - 6, 12, 12); g.strokeRect(cx - 6, cy - 6, 12, 12);
  // Speed tape.
  const tape = (x, w, val, step, labelEvery, fmt, right) => {
    g.fillStyle = '#4a4f55'; g.fillRect(x, cy - 170, w, 340);
    g.save(); g.beginPath(); g.rect(x, cy - 170, w, 340); g.clip();
    const pxu = 340 / (step * 6);
    const base = Math.floor(val / step) * step;
    for (let v = base - step * 4; v <= base + step * 4; v += step) {
      if (v < 0) continue;
      const y = cy - (v - val) * pxu;
      g.strokeStyle = WHT; g.lineWidth = 2;
      g.beginPath(); g.moveTo(right ? x : x + w, y); g.lineTo(right ? x + 12 : x + w - 12, y); g.stroke();
      if (v % labelEvery === 0) text(g, fmt(v), right ? x + 18 : x + w - 18, y + 7, WHT, 20, right ? 'left' : 'right');
    }
    g.restore();
    // Readout box.
    g.fillStyle = '#000'; g.fillRect(x - (right ? 4 : 0), cy - 20, w + 4, 40); box(g, x - (right ? 4 : 0), cy - 20, w + 4, 40, WHT, 2);
  };
  tape(16, 82, f.ias, 10, 20, (v) => String(v), false);
  // Speed bugs: target (magenta), and V1 / VR on the ground.
  const spdY = (v) => cy - (v - f.ias) * (340 / 60);
  if (f.spdTgt) {
    const y = Math.max(cy - 168, Math.min(cy + 168, spdY(f.spdTgt)));
    g.strokeStyle = MAG; g.lineWidth = 2.5; g.beginPath(); g.moveTo(98, y - 9); g.lineTo(88, y - 9); g.lineTo(88, y + 9); g.lineTo(98, y + 9); g.stroke();
    g.fillStyle = '#000'; g.fillRect(16, cy - 170, 82, 26);
    text(g, String(Math.round(f.spdTgt)), 57, cy - 150, MAG, 22, 'center');
  }
  for (const [lbl, v] of f.vBugs || []) {
    const y = spdY(v);
    if (y < cy - 170 || y > cy + 170) continue;
    g.strokeStyle = GRN; g.lineWidth = 2; g.beginPath(); g.moveTo(98, y); g.lineTo(110, y); g.stroke();
    text(g, lbl, 112, y + 6, GRN, 15);
  }
  text(g, String(Math.round(f.ias)), 90, cy + 10, WHT, 28, 'right');
  tape(W - 108, 92, f.alt, 100, 200, (v) => String(v), true);
  text(g, String(Math.round(f.alt)).padStart(3, ' '), W - 22, cy + 10, WHT, 24, 'right');
  if (f.altTgt != null) {
    g.fillStyle = '#000'; g.fillRect(W - 108, cy - 170, 92, 26);
    text(g, String(f.altTgt), W - 62, cy - 150, MAG, 22, 'center');
    const y = cy - (f.altTgt - f.alt) * (340 / 600);
    if (y > cy - 170 && y < cy + 170) { g.strokeStyle = MAG; g.lineWidth = 2.5; g.strokeRect(W - 112, y - 10, 10, 20); }
  }
  if (f.mach > 0.4) text(g, `.${String(Math.round(f.mach * 1000)).padStart(3, '0')}`, 56, cy + 210, WHT, 22, 'center');
  // FMA.
  g.fillStyle = '#000'; g.fillRect(0, 0, W, 58);
  f.fma.forEach((m, i) => {
    const x = 96 + i * 120;
    if (m) { text(g, m, x, 28, GRN, 20, 'center'); box(g, x - 56, 6, 112, 28, GRN, 1.5); }
    if (f.fmaArm?.[i]) text(g, f.fmaArm[i], x, 52, WHT, 15, 'center');
  });
  if (f.ap) text(g, f.ap, cx, 82, GRN, 24, 'center');
  // GPWS / windshear on the attitude display.
  const w = d.warn;
  if (w?.pullUp) { g.fillStyle = '#000'; g.fillRect(cx - 62, cy + 58, 124, 34); text(g, 'PULL UP', cx, cy + 84, RED, 26, 'center'); }
  if (w?.windshear === 'red') { g.fillStyle = '#000'; g.fillRect(cx - 82, cy + 100, 164, 34); text(g, 'WINDSHEAR', cx, cy + 126, RED, 26, 'center'); }
  // Heading at the bottom.
  g.fillStyle = '#4a4f55'; g.fillRect(cx - 150, H - 58, 300, 58);
  for (let k = -30; k <= 30; k += 5) {
    const x = cx + k * 4.5, hd = (f.hdg + k + 360) % 360;
    g.strokeStyle = WHT; g.lineWidth = 2;
    g.beginPath(); g.moveTo(x, H - 58); g.lineTo(x, H - (hd % 10 === 0 ? 44 : 50)); g.stroke();
    if (hd % 10 === 0 && Math.abs(k) < 30) text(g, String(Math.round(hd / 10)).padStart(2, '0'), x, H - 22, WHT, 16, 'center');
  }
  g.fillStyle = '#000'; g.fillRect(cx - 28, H - 76, 56, 22); text(g, String(Math.round(f.hdg)).padStart(3, '0'), cx, H - 59, WHT, 18, 'center');
  text(g, 'STD', W - 60, H - 10, CYN, 18, 'center');
  if (Math.abs(f.vs) >= 400) text(g, `${f.vs > 0 ? '+' : ''}${f.vs}`, W - 54, cy + 214, WHT, 16, 'center');
  if (f.ra != null && f.ra < 2500 && !f.onGround) text(g, String(Math.max(0, Math.round(f.ra / 10) * 10)), cx, cy + 190, WHT, 22, 'center');
}

// ── ND (MAP) ────────────────────────────────────────────────────────────────
// Track-up expanded MAP: compass arc, range rings, the FMC route (active leg
// and route magenta, a modification white dashed), waypoints, airports and
// runways, T/C and T/D, the VNAV path deviation on the right in descent.
// d.nav comes from app.js (FMC + flight sim); without it the arc is empty.
function star(g, x, y, r, c) {
  g.strokeStyle = c; g.lineWidth = 2;
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4, rr = i % 2 ? r * 0.32 : r;
    g.lineTo(x + rr * Math.sin(a), y - rr * Math.cos(a));
  }
  g.closePath(); g.stroke();
}
export function drawND(g, W, H, d) {
  clear(g, W, H);
  const f = d.flight, n = d.nav;
  const cx = W / 2, cy = H * 0.86, R = H * 0.66;
  const trkM = n?.ac ? n.ac.trkM : f.hdg;
  const range = n?.range || 40, k = R / range;
  // Compass arc (track up).
  g.strokeStyle = WHT; g.lineWidth = 2;
  g.beginPath(); g.arc(cx, cy, R, Math.PI * 1.17, Math.PI * 1.83); g.stroke();
  const t0 = Math.ceil((trkM - 62) / 5) * 5;
  for (let hd = t0; hd <= trkM + 62; hd += 5) {
    const a = hd - trkM, rad = ((a - 90) * Math.PI) / 180, h = ((hd % 360) + 360) % 360;
    const r1 = R - (h % 10 === 0 ? 16 : 8);
    g.beginPath(); g.moveTo(cx + R * Math.cos(rad), cy + R * Math.sin(rad)); g.lineTo(cx + r1 * Math.cos(rad), cy + r1 * Math.sin(rad)); g.stroke();
    if (h % 30 === 0) { const rr = R - 32; text(g, String(h / 10), cx + rr * Math.cos(rad), cy + rr * Math.sin(rad) + 7, WHT, 18, 'center'); }
  }
  // Heading pointer (no wind: heading = track) and the track box.
  g.fillStyle = '#000'; g.fillRect(cx - 34, cy - R - 34, 68, 28); box(g, cx - 34, cy - R - 34, 68, 28);
  text(g, String(Math.round(trkM) % 360 || 360).padStart(3, '0'), cx, cy - R - 12, WHT, 22, 'center');
  text(g, 'TRK', cx - 44, cy - R - 13, GRN, 16, 'right'); text(g, 'MAG', cx + 44, cy - R - 13, GRN, 16);
  // Range ring at half range.
  g.setLineDash([6, 8]); g.strokeStyle = '#9aa0a6'; g.lineWidth = 1.5;
  g.beginPath(); g.arc(cx, cy, R / 2, Math.PI * 1.1, Math.PI * 1.9); g.stroke(); g.setLineDash([]);
  text(g, String(range / 2), cx - R / 2 * 0.86 - 4, cy - R / 2 * 0.5 + 6, WHT, 15, 'right');
  // MCP heading bug in HDG SEL.
  if (d.mcpHdg != null) {
    const rad = ((d.mcpHdg - trkM - 90) * Math.PI) / 180;
    g.strokeStyle = MAG; g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(cx + R * Math.cos(rad), cy + R * Math.sin(rad)); g.lineTo(cx + (R + 12) * Math.cos(rad), cy + (R + 12) * Math.sin(rad)); g.stroke();
  }

  if (n?.ac) {
    const A = n.ac, cosL = Math.cos((A.lat * Math.PI) / 180), t = (A.trk * Math.PI) / 180;
    const P = (p) => {
      const dx = (p.lon - A.lon) * 60 * cosL, dy = (p.lat - A.lat) * 60;
      const x = dx * Math.cos(t) - dy * Math.sin(t), y = dx * Math.sin(t) + dy * Math.cos(t);
      return [cx + x * k, cy - y * k];
    };
    g.save();
    g.beginPath(); g.rect(0, 40, W, cy + 30 - 40); g.clip();
    // Runways: two edges along the runway and a dashed extended centreline.
    for (const rw of n.rwys || []) {
      const end = rw.far || rw;
      const [x1, y1] = P(rw), [x2, y2] = P(end);
      const ang = Math.atan2(y2 - y1, x2 - x1), nx = -Math.sin(ang) * 4, ny = Math.cos(ang) * 4;
      g.strokeStyle = WHT; g.lineWidth = 1.6;
      for (const s of [-1, 1]) { g.beginPath(); g.moveTo(x1 + nx * s, y1 + ny * s); g.lineTo(x2 + nx * s, y2 + ny * s); g.stroke(); }
      if (rw.ext) {
        const [ex, ey] = P(rw.ext);
        g.setLineDash([10, 8]); g.beginPath(); g.moveTo(x1, y1); g.lineTo(ex, ey); g.stroke(); g.setLineDash([]);
      }
      text(g, rw.label, x1 + 10, y1 + 18, WHT, 15);
    }
    // Airports.
    for (const ap of n.apts || []) {
      const [x, y] = P(ap);
      g.strokeStyle = CYN; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.stroke();
      text(g, ap.ident, x + 11, y - 8, CYN, 16);
    }
    // Route: modification white dashed, active magenta.
    const drawRoute = (legs, color, dash, from = 0) => {
      g.strokeStyle = color; g.lineWidth = 2.6; g.setLineDash(dash);
      g.beginPath();
      legs.slice(from).forEach((l, i) => { const [x, y] = P(l); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
      g.stroke(); g.setLineDash([]);
    };
    if (n.mod?.length) drawRoute(n.mod, WHT, [12, 8]);
    if (n.legs?.length) {
      const from = Math.max(0, (n.activeIdx || 1) - 1);
      if (n.active) {
        // Active leg starts at the airplane.
        g.strokeStyle = MAG; g.lineWidth = 2.6;
        drawRoute(n.legs, MAG, [], from);
      } else drawRoute(n.legs, CYN, [10, 8]);
      n.legs.forEach((l, i) => {
        if (n.active && i < from) return;
        if (l.kind === 'rwy' || l.kind === 'rwyArr') return;
        const [x, y] = P(l);
        const act = n.active && i === n.activeIdx;
        if (l.kind === 'apt' || l.kind === 'aptArr') return;
        star(g, x, y, 10, act ? MAG : WHT);
        text(g, l.ident, x + 13, y + 6, act ? MAG : WHT, 17);
        if (l.alt != null) text(g, l.alt >= 18000 ? `FL${Math.round(l.alt / 100)}` : String(l.alt), x + 13, y + 24, WHT, 14);
      });
    }
    // Top of climb / descent.
    for (const [p, lbl] of [[n.tc, 'T/C'], [n.tod, 'T/D']]) {
      if (!p) continue;
      const [x, y] = P(p);
      g.strokeStyle = GRN; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.stroke();
      text(g, lbl, x + 11, y + 6, GRN, 16);
    }
    g.restore();
    // Active waypoint data, top right.
    if (n.to) {
      text(g, n.to.ident, W - 14, 26, MAG, 21, 'right');
      text(g, n.to.eta, W - 14, 50, WHT, 18, 'right');
      text(g, `${n.to.dist < 100 ? n.to.dist.toFixed(1) : Math.round(n.to.dist)} NM`, W - 14, 74, WHT, 18, 'right');
    }
    // VNAV path deviation (descent).
    if (n.vdev != null) {
      const x = W - 30, y0 = H * 0.45;
      g.strokeStyle = WHT; g.lineWidth = 2;
      for (const s of [-2, -1, 1, 2]) { g.beginPath(); g.arc(x, y0 + s * 30, 4, 0, Math.PI * 2); g.stroke(); }
      g.beginPath(); g.moveTo(x - 10, y0); g.lineTo(x + 10, y0); g.stroke();
      const dy = Math.max(-66, Math.min(66, (-n.vdev / 400) * 60));
      g.fillStyle = MAG; g.beginPath(); g.moveTo(x, y0 + dy - 9); g.lineTo(x + 7, y0 + dy); g.lineTo(x, y0 + dy + 9); g.lineTo(x - 7, y0 + dy); g.closePath(); g.fill();
    }
  } else text(g, 'NO ACTIVE ROUTE', cx, cy - R * 0.55, CYN, 20, 'center');

  // Own ship.
  g.strokeStyle = WHT; g.lineWidth = 3;
  g.beginPath(); g.moveTo(cx, cy - 22); g.lineTo(cx - 13, cy + 10); g.lineTo(cx + 13, cy + 10); g.closePath(); g.stroke();
  text(g, 'GS', 12, 26, WHT, 15); text(g, String(Math.round(f.gs)), 40, 26, WHT, 21);
  text(g, 'TAS', 96, 26, WHT, 15); text(g, String(Math.round(f.tas)), 132, 26, WHT, 21);
  text(g, `MAP ${range}`, 14, H - 14, GRN, 15);
  // Terrain / windshear / traffic messages.
  const w = d.warn;
  if (w?.windshear) text(g, 'WINDSHEAR', cx, H * 0.5, w.windshear === 'red' ? RED : AMB, 28, 'center');
  else if (w?.terrain) text(g, w.terrain === 'red' ? 'TERRAIN' : 'CAUTION TERRAIN', cx, H * 0.5, w.terrain === 'red' ? RED : AMB, 28, 'center');
  if (w?.tcas) text(g, 'TRAFFIC', W - 70, H - 30, w.tcas === 'RA' ? RED : AMB, 22, 'center');
}

// ── Gauges for the engine displays ──────────────────────────────────────────
function arcGauge(g, x, y, r, frac, val, redFrac = 1, label = '') {
  const a0 = Math.PI, a1 = Math.PI * 1.0 + Math.PI * 1.17;
  g.strokeStyle = WHT; g.lineWidth = 3;
  g.beginPath(); g.arc(x, y, r, a0, a1); g.stroke();
  g.strokeStyle = '#ff2a2a'; g.lineWidth = 4;
  const ra = a0 + (a1 - a0) * redFrac;
  g.beginPath(); g.moveTo(x + r * Math.cos(ra), y + r * Math.sin(ra)); g.lineTo(x + (r - 12) * Math.cos(ra), y + (r - 12) * Math.sin(ra)); g.stroke();
  if (frac > 0) {
    g.fillStyle = 'rgba(200,200,200,.18)';
    g.beginPath(); g.moveTo(x, y); g.arc(x, y, r - 2, a0, a0 + (a1 - a0) * frac); g.closePath(); g.fill();
  }
  const na = a0 + (a1 - a0) * frac;
  g.strokeStyle = WHT; g.lineWidth = 3;
  g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r - 4) * Math.cos(na), y + (r - 4) * Math.sin(na)); g.stroke();
  g.fillStyle = '#000'; g.fillRect(x + 4, y - r - 6, r + 12, 30); box(g, x + 4, y - r - 6, r + 12, 30, WHT, 2);
  text(g, val, x + r + 12, y - r + 17, WHT, 22, 'right');
  if (label) text(g, label, x, y + r * 0.62, CYN, 15, 'center');
}

// ── Upper DU: N1, EGT, fuel ─────────────────────────────────────────────────
export function drawUpper(g, W, H, d) {
  clear(g, W, H);
  const { e1, e2 } = d;
  arcGauge(g, 120, 120, 64, e1.n1 / 110, e1.n1.toFixed(1), 104 / 110);
  arcGauge(g, 300, 120, 64, e2.n1 / 110, e2.n1.toFixed(1), 104 / 110);
  text(g, 'N1', 210, 150, CYN, 20, 'center');
  arcGauge(g, 120, 290, 56, e1.egt / 1000, String(Math.round(e1.egt)), 0.95);
  arcGauge(g, 300, 290, 56, e2.egt / 1000, String(Math.round(e2.egt)), 0.95);
  text(g, 'EGT', 210, 316, CYN, 20, 'center');
  if (d.rev) { text(g, 'REV', 120, 64, GRN, 18, 'center'); text(g, 'REV', 300, 64, GRN, 18, 'center'); }
  // Thermal anti-ice: green when the cowl valve is open, amber if it disagrees.
  (d.tai || []).forEach((t, i) => { if (t) text(g, 'TAI', i ? 300 : 120, 40, t === 'amber' ? AMB : GRN, 18, 'center'); });
  // Fuel quantity.
  const fu = d.fuel;
  if (fu) {
    text(g, 'FUEL', W - 70, 236, CYN, 16, 'center'); text(g, 'KG X 1000', W - 70, 254, CYN, 13, 'center');
    const q = (v) => (v / 1000).toFixed(2);
    const tank = (x, y, v, warn, tag) => {
      text(g, q(v), x, y, warn ? AMB : WHT, 24, 'center');
      if (tag) text(g, tag, x, y + 20, AMB, 14, 'center');
    };
    tank(W - 70, 300, fu.c, fu.config, fu.config ? 'CONFIG' : '');
    tank(W - 112, 380, fu.m1, fu.low1 || fu.imbalLow === 1, fu.low1 ? 'LOW' : fu.imbalLow === 1 ? 'IMBAL' : '');
    tank(W - 28, 380, fu.m2, fu.low2 || fu.imbalLow === 2, fu.low2 ? 'LOW' : fu.imbalLow === 2 ? 'IMBAL' : '');
    text(g, 'CTR', W - 70, 276, WHT, 13, 'center'); text(g, '1', W - 112, 356, WHT, 13, 'center'); text(g, '2', W - 28, 356, WHT, 13, 'center');
    text(g, `TOTAL ${(fu.total / 1000).toFixed(1)}`, W - 70, 440, WHT, 18, 'center');
  }
  text(g, `TAT ${d.tat > 0 ? '+' : ''}${d.tat}c`, 16, 30, WHT, 16);
}

// ── Lower DU: N2, FF, oil, vibration + hydraulic SYS ────────────────────────
export function drawLower(g, W, H, d) {
  clear(g, W, H);
  const { e1, e2 } = d;
  const row = (label, a, b, y, unit = '') => {
    text(g, a, 150, y, WHT, 24, 'right'); text(g, b, 360, y, WHT, 24, 'right');
    text(g, label, 256, y, CYN, 16, 'center'); if (unit) text(g, unit, 256, y + 16, CYN, 12, 'center');
  };
  row('N2', e1.n2.toFixed(1), e2.n2.toFixed(1), 46);
  row('FF', e1.ff.toFixed(2), e2.ff.toFixed(2), 96, 'KG/H X1000');
  row('OIL P', String(Math.round(e1.oilP)), String(Math.round(e2.oilP)), 150);
  row('OIL T', String(Math.round(e1.oilT)), String(Math.round(e2.oilT)), 196);
  row('OIL Q %', String(e1.oilQ * 5), String(e2.oilQ * 5), 242);
  row('VIB', e1.vib.toFixed(1), e2.vib.toFixed(1), 288);
  // Hydraulic page strip.
  const h = d.hyd;
  if (h) {
    g.strokeStyle = '#555'; g.beginPath(); g.moveTo(16, 318); g.lineTo(W - 16, 318); g.stroke();
    text(g, 'HYDRAULIC', W / 2, 346, WHT, 18, 'center');
    text(g, 'A', 160, 376, WHT, 20, 'center'); text(g, 'B', 352, 376, WHT, 20, 'center');
    text(g, 'PRESS', W / 2, 410, CYN, 15, 'center'); text(g, 'QTY %', W / 2, 456, CYN, 15, 'center');
    const pc = (p) => (p < 1500 ? AMB : WHT);
    text(g, String(h.pressA), 160, 412, pc(h.pressA), 24, 'center'); text(g, String(h.pressB), 352, 412, pc(h.pressB), 24, 'center');
    text(g, String(h.qtyA), 160, 458, WHT, 24, 'center'); text(g, String(h.qtyB), 352, 458, WHT, 24, 'center');
    if (h.rfA) text(g, 'RF', 210, 458, WHT, 16, 'center');
    if (h.rfB) text(g, 'RF', 402, 458, WHT, 16, 'center');
  }
}

// ── MCP ─────────────────────────────────────────────────────────────────────
// One strip, left to right as on the airplane. Canvas 1480 × 110.
export const MCP_W = 1480, MCP_H = 110;
export function drawMCP(g, W, H, d) {
  g.fillStyle = '#c4c8cb'; g.fillRect(0, 0, W, H);
  const f = d.flight, on = (b) => d.mcp.has(b);
  const ias = f.mach > 0.4 ? `.${String(Math.round(f.mach * 100)).padStart(2, '0')}` : String(Math.max(150, Math.round(f.ias / 5) * 5) || 150);
  const items = [
    ['win', 'COURSE', '093', 80], ['btn', 'N1'], ['btn', 'SPEED'], ['win', 'IAS/MACH', ias, 104],
    ['btn', 'VNAV'], ['btn', 'LVL CHG'], ['win', 'HEADING', String(Math.round(f.hdg)).padStart(3, '0'), 84],
    ['btn', 'HDG SEL'], ['btn', 'LNAV'], ['btn', 'VOR LOC'], ['btn', 'APP'],
    ['win', 'ALTITUDE', f.alt > 1000 ? String(f.alt) : '10000', 118], ['btn', 'ALT HLD'],
    ['win', 'VERT SPEED', '', 100], ['btn', 'V/S'], ['btn', 'CMD A'], ['btn', 'CMD B'], ['btn', 'CWS A'],
    ['win', 'COURSE', '093', 80],
  ];
  let x = 14;
  for (const [kind, label, val, w] of items) {
    if (kind === 'win') {
      text(g, label, x + w / 2, 24, '#1e1f20', 14, 'center', 700);
      g.fillStyle = '#0a0a0a'; g.fillRect(x, 32, w, 40);
      text(g, val, x + w - 8, 62, '#ffd9a0', 27, 'right', 600);
      x += w + 8;
    } else {
      g.fillStyle = '#1b1c1e'; g.fillRect(x, 20, 58, 72);
      g.fillStyle = on(label) ? GRN : '#2c3b2c'; g.fillRect(x + 8, 27, 42, 7);
      text(g, label, x + 29, 70, '#ececec', label.length > 5 ? 11 : 13, 'center');
      x += 64;
    }
  }
  text(g, 'A/T', 1474, 100, '#1e1f20', 11, 'right');
}

// ── ISFD ────────────────────────────────────────────────────────────────────
export function drawISFD(g, W, H, d) {
  clear(g, W, H);
  const f = d.flight, cy = H / 2 + f.pitch * 5;
  g.fillStyle = '#1c78d4'; g.fillRect(40, 0, W - 80, cy); g.fillStyle = '#7b4a1e'; g.fillRect(40, cy, W - 80, H);
  g.fillStyle = '#333'; g.fillRect(0, 0, 40, H); g.fillRect(W - 40, 0, 40, H);
  text(g, String(Math.round(f.ias)), 36, H / 2 + 6, WHT, 14, 'right');
  text(g, String(Math.round(f.alt / 10) * 10), W - 4, H / 2 + 6, WHT, 12, 'right');
  g.strokeStyle = '#ffd400'; g.lineWidth = 3; g.beginPath(); g.moveTo(W / 2 - 24, H / 2); g.lineTo(W / 2 + 24, H / 2); g.stroke();
}
