// windflow.js — the "wind flowing like on Windy" animation: a canvas of
// particles advected by the gridded wind field at the selected height. Trails
// fade each frame; particles reseed on death or when they leave the map.
//
// It runs as a Leaflet layer sitting above the tiles: one full-viewport canvas,
// redrawn every frame, repositioned on pan/zoom. The wind field comes from
// grid.windField(); we bilinearly interpolate u/v at each particle.

let map = null, canvas = null, ctx = null, raf = null;
let field = null;              // {bounds, cols, rows, u, v}
let particles = [];
let running = false;

const N = 1800;                // particle count
const MAX_AGE = 90;            // frames before reseed
const FADE = 0.90;            // trail persistence per frame
const SPEED = 0.35;           // px per (km/h) per frame scale

export function isOn() { return running; }

export function start(leafletMap) {
  map = leafletMap;
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.className = 'wind-flow-canvas';
    map.getPanes().overlayPane.appendChild(canvas);
  }
  ctx = canvas.getContext('2d');
  running = true;
  resize();
  map.on('move zoom viewreset', reposition);
  map.on('moveend zoomend', resize);
  loop();
}

export function stop() {
  running = false;
  if (raf) cancelAnimationFrame(raf);
  if (map) { map.off('move zoom viewreset', reposition); map.off('moveend zoomend', resize); }
  if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
  canvas = null; ctx = null; particles = [];
}

/** Feed a new wind field (on time / level / area change). */
export function setField(f) {
  field = f;
  if (running && particles.length === 0) seed();
}

function resize() {
  if (!map || !canvas) return;
  const size = map.getSize();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = size.x * dpr; canvas.height = size.y * dpr;
  canvas.style.width = size.x + 'px'; canvas.style.height = size.y + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  reposition();
  seed();
}

// Keep the canvas pinned to the top-left of the current view (overlayPane moves
// with the map, so we offset by the pane's translation).
function reposition() {
  if (!map || !canvas) return;
  const tl = map.containerPointToLayerPoint([0, 0]);
  L.DomUtil.setPosition(canvas, tl);
}

function seed() {
  particles = [];
  for (let i = 0; i < N; i++) particles.push(newParticle());
}
function newParticle() {
  const s = map.getSize();
  return { x: Math.random() * s.x, y: Math.random() * s.y, age: Math.random() * MAX_AGE };
}

// Bilinear u/v (km/h) at a container pixel, via lat/lon → grid fraction.
function windAtPixel(px, py) {
  if (!field) return null;
  const ll = map.containerPointToLatLng([px, py]);
  const b = field.bounds;
  const fx = (ll.lng - b.getWest()) / (b.getEast() - b.getWest()) * field.cols - 0.5;
  const fy = (b.getNorth() - ll.lat) / (b.getNorth() - b.getSouth()) * field.rows - 0.5;
  if (fx < 0 || fy < 0 || fx > field.cols - 1 || fy > field.rows - 1) return null;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, field.cols - 1), y1 = Math.min(y0 + 1, field.rows - 1);
  const tx = fx - x0, ty = fy - y0;
  const idx = (r, c) => r * field.cols + c;
  const bil = (arr) => {
    const a = arr[idx(y0, x0)], b2 = arr[idx(y0, x1)], c = arr[idx(y1, x0)], d = arr[idx(y1, x1)];
    if ([a, b2, c, d].some((v) => Number.isNaN(v))) return NaN;
    return (a * (1 - tx) + b2 * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  };
  const u = bil(field.u), v = bil(field.v);
  return Number.isNaN(u) || Number.isNaN(v) ? null : { u, v };
}

function speedColor(sp) {
  if (sp < 10) return 'rgba(190,225,255,0.55)';
  if (sp < 20) return 'rgba(150,235,180,0.7)';
  if (sp < 30) return 'rgba(245,215,120,0.8)';
  if (sp < 40) return 'rgba(245,150,90,0.85)';
  return 'rgba(240,110,100,0.9)';
}

function loop() {
  if (!running || !ctx) return;
  const s = map.getSize();
  // fade previous frame for trails
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = `rgba(0,0,0,${FADE})`;
  ctx.fillRect(0, 0, s.x, s.y);
  ctx.globalCompositeOperation = 'source-over';
  ctx.lineWidth = 1.4;

  if (field) {
    for (const p of particles) {
      const w = windAtPixel(p.x, p.y);
      p.age++;
      if (!w || p.age > MAX_AGE || p.x < 0 || p.y < 0 || p.x > s.x || p.y > s.y) {
        Object.assign(p, newParticle()); continue;
      }
      const sp = Math.hypot(w.u, w.v);
      // screen: +x east (u), +y south (−v)
      const nx = p.x + w.u * SPEED * 0.06;
      const ny = p.y - w.v * SPEED * 0.06;
      ctx.strokeStyle = speedColor(sp);
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(nx, ny); ctx.stroke();
      p.x = nx; p.y = ny;
    }
  }
  raf = requestAnimationFrame(loop);
}
