// colors.js — what the track's colour means.
//
// The vario ramp follows the spec's convention (red = lift, green = neutral,
// blue = sink) rather than the blue-to-red "heat" convention some tools use.
// It maps onto how pilots talk: red is where you stop and turn, blue is where
// you get out. Thresholds are the spec's: lift above +0.5 m/s, sink below
// −1.0 m/s, with a smooth ramp between so a marginal climb reads as marginal.
//
// Every mode returns Uint8 RGBA, which is what deck.gl wants, and every mode
// publishes a legend so the UI never hard-codes a swatch.

import { clamp } from './metrics.js';

const LIFT_MS = 0.5;    // spec: above this is lift → red
const SINK_MS = -1.0;   // spec: below this is sink → blue

const RED = [232, 78, 68];
const GREEN = [110, 205, 120];
const BLUE = [70, 150, 245];
const DEEP_BLUE = [40, 92, 200];
const HOT = [255, 214, 92];

/** Mode registry: id → label, short help, and legend stops for the UI. */
export const COLOR_MODES = [
  {
    id: 'vario',
    label: 'Climb',
    help: 'Red = lift above +0.5 m/s · green = neutral · blue = sink below −1.0 m/s',
    legend: [
      { rgb: DEEP_BLUE, label: '−3' }, { rgb: BLUE, label: '−1' },
      { rgb: GREEN, label: '0' }, { rgb: RED, label: '+0.5' }, { rgb: HOT, label: '+3' },
    ],
    unit: 'm/s',
  },
  {
    id: 'turn',
    label: 'Turn',
    help: 'Red = left-hand rotation · blue = right-hand · grey = flying straight',
    legend: [
      { rgb: RED, label: 'left' }, { rgb: [140, 148, 160], label: 'straight' },
      { rgb: BLUE, label: 'right' },
    ],
    unit: '°/s',
  },
  {
    id: 'speed',
    label: 'Speed',
    help: 'Ground speed, 0 → 60 km/h',
    legend: [
      { rgb: [60, 90, 170], label: '0' }, { rgb: GREEN, label: '25' },
      { rgb: HOT, label: '40' }, { rgb: RED, label: '60+' },
    ],
    unit: 'km/h',
  },
  {
    id: 'glide',
    label: 'Glide',
    help: 'Glide ratio over the ground — dark where you were sinking out, bright where it was gliding',
    legend: [
      { rgb: [150, 60, 60], label: '2:1' }, { rgb: HOT, label: '6:1' },
      { rgb: GREEN, label: '9:1' }, { rgb: [120, 230, 255], label: '12:1+' },
    ],
    unit: ':1',
  },
  {
    id: 'pilot',
    label: 'Pilot',
    help: 'One flat colour per pilot — the clearest read when comparing lines',
    legend: [],
    unit: '',
  },
];

export const DEFAULT_MODE = 'vario';

/** Track colours, assigned in order. Distinct in hue *and* lightness so they
 *  stay separable against both satellite imagery and the topo basemap. */
export const TRACK_COLORS = ['#5ec2ff', '#ffc43d', '#7cf29b', '#ff7ad9'];

/**
 * Per-segment colours for one track: `points.length - 1` RGBA quads, coloured
 * by the *start* point of each segment.
 *
 * @param {import('../types').FlightTrack} track
 * @param {import('../types').ColorMode} mode
 * @param {number} [alpha] 0–255
 * @returns {Uint8Array}
 */
export function segmentColors(track, mode, alpha = 235) {
  const pts = track.points;
  const n = Math.max(0, pts.length - 1);
  const out = new Uint8Array(n * 4);
  const flat = mode === 'pilot' ? hexToRgb(track.color) : null;

  for (let i = 0; i < n; i++) {
    const c = flat || colorFor(mode, pts[i], track);
    out[i * 4] = c[0]; out[i * 4 + 1] = c[1]; out[i * 4 + 2] = c[2]; out[i * 4 + 3] = alpha;
  }
  return out;
}

/**
 * Colour for a single fix (or an interpolated sample).
 * @returns {[number,number,number]}
 */
export function colorFor(mode, p, track) {
  switch (mode) {
    case 'vario': return varioColor(p.vario);
    case 'turn': return turnColor(p.turnRate);
    case 'speed': return speedColor(p.speed || 0);
    case 'glide': return glideColor(p.glide || 0);
    case 'pilot':
    default: return hexToRgb(track ? track.color : '#5ec2ff');
  }
}

/**
 * Spec ramp: deep blue (strong sink) → blue (−1) → green (0) → red (+0.5) →
 * gold (strong lift). Gold on top of red so a ripping core still stands out
 * against a merely-workable climb.
 */
export function varioColor(v) {
  if (!Number.isFinite(v)) return GREEN;
  if (v <= -3) return DEEP_BLUE;
  if (v <= SINK_MS) return mix(DEEP_BLUE, BLUE, (v + 3) / (SINK_MS + 3));
  if (v <= 0) return mix(BLUE, GREEN, (v - SINK_MS) / (0 - SINK_MS));
  if (v <= LIFT_MS) return mix(GREEN, RED, v / LIFT_MS);
  if (v <= 3) return mix(RED, HOT, (v - LIFT_MS) / (3 - LIFT_MS));
  return HOT;
}

/** Red = left (counter-clockwise), blue = right, grey through the middle. */
export function turnColor(dps) {
  if (!Number.isFinite(dps)) return [140, 148, 160];
  const grey = [140, 148, 160];
  const mag = clamp(Math.abs(dps) / 22, 0, 1);   // ~22°/s is a well-banked 360
  return mix(grey, dps < 0 ? RED : BLUE, mag);
}

function speedColor(ms) {
  const kmh = ms * 3.6;
  if (kmh <= 0) return [60, 90, 170];
  if (kmh <= 25) return mix([60, 90, 170], GREEN, kmh / 25);
  if (kmh <= 40) return mix(GREEN, HOT, (kmh - 25) / 15);
  if (kmh <= 60) return mix(HOT, RED, (kmh - 40) / 20);
  return RED;
}

function glideColor(r) {
  if (!Number.isFinite(r) || r <= 0) return [90, 96, 110];   // climbing / undefined
  if (r <= 2) return [150, 60, 60];
  if (r <= 6) return mix([150, 60, 60], HOT, (r - 2) / 4);
  if (r <= 9) return mix(HOT, GREEN, (r - 6) / 3);
  if (r <= 12) return mix(GREEN, [120, 230, 255], (r - 9) / 3);
  return [120, 230, 255];
}

// ── helpers ─────────────────────────────────────────────────────────────────

function mix(a, b, t) {
  const f = clamp(t, 0, 1);
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

/** "#5ec2ff" | "5ec2ff" | "#5cf" → [r,g,b] */
export function hexToRgb(hex) {
  let h = String(hex || '').replace('#', '').trim();
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  if (!Number.isFinite(n) || h.length !== 6) return [94, 194, 255];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const rgbCss = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

/** Same value the legend swatches use, as a CSS gradient. */
export function legendGradient(mode) {
  const m = COLOR_MODES.find((x) => x.id === mode);
  if (!m || !m.legend.length) return '';
  const stops = m.legend.map((s, i) =>
    `${rgbCss(s.rgb)} ${Math.round(i / (m.legend.length - 1) * 100)}%`);
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

/** The live readout value + unit for the current colour mode. */
export function modeValue(mode, sample) {
  if (!sample) return '—';
  switch (mode) {
    case 'vario': return `${sample.vario > 0 ? '+' : ''}${sample.vario.toFixed(1)} m/s`;
    case 'turn': return Math.abs(sample.turnRate) < 3
      ? 'straight' : `${sample.turnRate < 0 ? 'L' : 'R'} ${Math.abs(sample.turnRate).toFixed(0)}°/s`;
    case 'speed': return `${Math.round((sample.speed || 0) * 3.6)} km/h`;
    case 'glide': return sample.glide > 0 ? `${sample.glide.toFixed(1)}:1` : '—';
    default: return '';
  }
}
