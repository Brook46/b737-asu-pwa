// types.d.ts — the data model for Thermal Debrief.
//
// This app follows the suite convention: no bundler, no build step, plain ES
// modules in the browser. So these interfaces are *tooling only* — VS Code and
// `tsc --noEmit` read them via the `@typedef`/JSDoc references in modules/, and
// nothing here ships to the device. The runtime shapes below are exactly what
// modules/igc.js and modules/metrics.js produce.

/** One GPS fix from an IGC B-record, with derived flight dynamics. */
export interface IGCPoint {
  /** Unix epoch in **milliseconds** (JS `Date.getTime()`), UTC. */
  timestamp: number;
  lat: number;
  lng: number;
  /** Barometric altitude, metres MSL. 0 on GPS-only loggers — see FlightTrack.altSource. */
  pressureAlt: number;
  /** GPS altitude, metres MSL (WGS-84 ellipsoid as recorded). */
  gpsAlt: number;
  /** Climb rate, m/s. Least-squares slope of altitude over a ±3 s window. */
  vario: number;
  /** Track heading, 0–360° true. */
  heading: number;
  /** Turn rate, deg/sec. Positive = right-hand (clockwise), negative = left. */
  turnRate: number;

  // ── derived extras (not in the original spec, needed by the charts/export) ──
  /** Ground speed, m/s. */
  speed?: number;
  /** Instantaneous glide ratio over a ±7.5 s window; 0 while climbing. */
  glide?: number;
  /** Terrain elevation below the fix, metres MSL. Set by modules/terrain.js. */
  groundAlt?: number;
  /** Height above ground, metres. Only present once terrain is resolved. */
  agl?: number;
  /** Seconds since this track's launch — the Relative Start Sync clock. */
  t?: number;
}

/** A parsed flight, ready to render. One IGC file in, one of these out. */
export interface FlightTrack {
  id: string;
  pilotName: string;
  /** ISO date of the flight, `YYYY-MM-DD`, from the IGC HFDTE header. */
  date: string;
  /** CSS hex colour used for this track everywhere in the UI. */
  color: string;
  points: IGCPoint[];
  metrics: FlightMetrics;
  highlights: FlightHighlight[];

  // ── provenance / display ────────────────────────────────────────────────────
  /** Original filename. */
  fileName?: string;
  gliderType?: string;
  gliderId?: string;
  site?: string;
  /** Which altitude channel the vario was derived from. */
  altSource?: 'pressure' | 'gps';
  /** True once modules/terrain.js has resolved ground elevation for every fix. */
  hasTerrain?: boolean;
  /** Whether the track is drawn / included in playback. */
  visible?: boolean;
}

export interface FlightMetrics {
  /** Metres MSL. */
  maxAlt: number;
  /** Best sustained climb, m/s (10 s average, so a single noisy fix can't win). */
  maxClimb: number;
  /** Split of *turning* time only — straight glides are excluded from both sides. */
  turnBias: { leftPercent: number; rightPercent: number };
  /** Ground track length, metres. */
  totalDistance: number;

  // ── derived extras ──────────────────────────────────────────────────────────
  minAlt?: number;
  /** Worst sustained sink, m/s (negative). */
  maxSink?: number;
  /** Flight duration, seconds. */
  duration?: number;
  maxSpeed?: number;
  avgSpeed?: number;
  /** Launch → landing straight line, metres. */
  straightDistance?: number;
  /** Total height gained in thermals, metres. */
  totalClimb?: number;
  thermalCount?: number;
  /** Best glide ratio sustained over a full glide leg. */
  bestGlide?: number;
  /** Lowest height above ground after launch, metres. Needs terrain. */
  minAgl?: number;
  launchAlt?: number;
}

export interface FlightHighlight {
  /** Unix epoch ms — the moment the event peaks. */
  timestamp: number;
  type: 'BEST_CLIMB' | 'LOW_SAVE' | 'FAST_GLIDE' | 'HEAVY_SINK';
  description: string;

  // ── derived extras ──────────────────────────────────────────────────────────
  /** The headline number (m/s, m AGL, km…) that earned the flag. */
  value?: number;
  /** Index into FlightTrack.points. */
  index?: number;
  /** Event span, for clip export and chart shading. */
  startTime?: number;
  endTime?: number;
}

/** How the master clock maps onto each track. */
export type SyncMode = 'absolute' | 'relative';

/** What the per-segment track colour encodes. */
export type ColorMode = 'vario' | 'turn' | 'speed' | 'glide' | 'pilot';
