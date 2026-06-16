// elevation.js — ground elevation (metres) at a lat/lng by decoding the AWS
// Terrarium DEM tiles (the same free tiles used for 3D terrain). Lets each pilot
// work out their own height above the ground (AGL = GPS altitude − ground).
//
// Terrarium encoding: elevation = (R*256 + G + B/256) − 32768.

const TILE = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const Z = 12;
const tiles = new Map();   // "z/x/y" -> Promise<ImageData|null>

export async function groundElevation(lat, lng) {
  if (lat == null || lng == null) return null;
  const n = 2 ** Z;
  const xf = (lng + 180) / 360 * n;
  const latRad = lat * Math.PI / 180;
  const yf = (1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2 * n;
  const xt = Math.floor(xf), yt = Math.floor(yf);
  const px = Math.min(255, Math.floor((xf - xt) * 256));
  const py = Math.min(255, Math.floor((yf - yt) * 256));
  const img = await loadTile(xt, yt);
  if (!img) return null;
  const i = (py * 256 + px) * 4;
  return (img.data[i] * 256 + img.data[i + 1] + img.data[i + 2] / 256) - 32768;
}

function loadTile(x, y) {
  const key = `${Z}/${x}/${y}`;
  if (tiles.has(key)) return tiles.get(key);
  const p = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = 256; c.height = 256;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        resolve(ctx.getImageData(0, 0, 256, 256));
      } catch { resolve(null); }   // tainted canvas / no CORS
    };
    img.onerror = () => resolve(null);
    img.src = TILE.replace('{z}', Z).replace('{x}', x).replace('{y}', y);
  });
  tiles.set(key, p);
  return p;
}
