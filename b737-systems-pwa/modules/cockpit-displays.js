// cockpit-displays.js — the flight deck's screens, drawn on canvases in the
// 737NG style: PFD, ND (map), upper DU (primary engine + fuel), lower DU
// (secondary engine + hydraulic SYS), the MCP and the ISFD. They read a data
// snapshot assembled from the phase and the live system states, so a
// failure you set in a schematic shows up on the displays too.

const F = (px, w = 700) => `${w} ${px}px "Helvetica Neue", Arial, sans-serif`;
const MAG = '#ff5ad2', GRN = '#3df03d', CYN = '#28e3f2', AMB = '#ffb21e', WHT = '#f4f4f4';

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
    landing: { ias: 92, mach: 0.14, alt: 0, vs: 0, hdg: 90, gs: 90, tas: 92, pitch: 0, fma: ['', 'ROLLOUT', ''], ap: '' },
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
  const hy = cy + f.pitch * ppd;
  g.fillStyle = '#1c78d4'; g.fillRect(0, 0, W, hy);
  g.fillStyle = '#7b4a1e'; g.fillRect(0, hy, W, H);
  g.strokeStyle = WHT; g.lineWidth = 2;
  g.beginPath(); g.moveTo(0, hy); g.lineTo(W, hy); g.stroke();
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
  text(g, String(Math.round(f.ias)), 90, cy + 10, WHT, 28, 'right');
  tape(W - 108, 92, f.alt, 100, 200, (v) => String(v), true);
  text(g, String(Math.round(f.alt)).padStart(3, ' '), W - 22, cy + 10, WHT, 24, 'right');
  if (f.mach > 0.4) text(g, `.${String(Math.round(f.mach * 1000)).padStart(3, '0')}`, 56, cy + 210, WHT, 22, 'center');
  // FMA.
  g.fillStyle = '#000'; g.fillRect(0, 0, W, 44);
  f.fma.forEach((m, i) => {
    const x = 96 + i * 120;
    if (m) { text(g, m, x, 30, GRN, 20, 'center'); box(g, x - 52, 8, 104, 30, GRN, 1.5); }
  });
  if (f.ap) text(g, f.ap, cx, 82, GRN, 24, 'center');
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
  if (f.vs) text(g, `${f.vs > 0 ? '+' : ''}${f.vs}`, W - 54, 60, WHT, 16, 'center');
}

// ── ND (MAP) ────────────────────────────────────────────────────────────────
export function drawND(g, W, H, d) {
  clear(g, W, H);
  const f = d.flight;
  const cx = W / 2, cy = H * 0.86, R = H * 0.66;
  g.strokeStyle = WHT; g.lineWidth = 2;
  g.beginPath(); g.arc(cx, cy, R, Math.PI * 1.17, Math.PI * 1.83); g.stroke();
  for (let a = -60; a <= 60; a += 5) {
    const hd = (f.hdg + a + 360) % 360, rad = ((a - 90) * Math.PI) / 180;
    const r0 = R, r1 = R - (hd % 10 === 0 ? 16 : 8);
    g.beginPath(); g.moveTo(cx + r0 * Math.cos(rad), cy + r0 * Math.sin(rad)); g.lineTo(cx + r1 * Math.cos(rad), cy + r1 * Math.sin(rad)); g.stroke();
    if (hd % 30 === 0) {
      const rr = R - 32;
      text(g, String(hd / 10), cx + rr * Math.cos(rad), cy + rr * Math.sin(rad) + 7, WHT, 18, 'center');
    }
  }
  g.fillStyle = '#000'; g.fillRect(cx - 30, cy - R - 32, 60, 26); box(g, cx - 30, cy - R - 32, 60, 26);
  text(g, String(Math.round(f.hdg)).padStart(3, '0'), cx, cy - R - 12, WHT, 20, 'center');
  // Range ring and the route.
  g.setLineDash([6, 8]); g.strokeStyle = '#9aa0a6';
  g.beginPath(); g.arc(cx, cy, R / 2, Math.PI * 1.17, Math.PI * 1.83); g.stroke(); g.setLineDash([]);
  g.strokeStyle = MAG; g.lineWidth = 3;
  g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + 18, cy - R * 0.55); g.lineTo(cx - 40, cy - R * 0.95); g.stroke();
  for (const [x, y, n] of [[cx + 18, cy - R * 0.55, 'BALUN'], [cx - 40, cy - R * 0.95, 'GITAX']]) {
    g.save(); g.translate(x, y); g.rotate(Math.PI / 4); g.strokeStyle = MAG; g.strokeRect(-6, -6, 12, 12); g.restore();
    text(g, n, x + 14, y + 6, MAG, 16);
  }
  // Own ship.
  g.strokeStyle = WHT; g.lineWidth = 3;
  g.beginPath(); g.moveTo(cx, cy - 22); g.lineTo(cx - 13, cy + 10); g.lineTo(cx + 13, cy + 10); g.closePath(); g.stroke();
  text(g, `GS ${Math.round(f.gs)}`, 12, 26, WHT, 18); text(g, `TAS ${Math.round(f.tas)}`, 104, 26, WHT, 18);
  text(g, 'MAP', W - 12, 26, GRN, 18, 'right');
  text(g, '40', cx - R / 2 + 10, cy - R * 0.38, WHT, 15);
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
