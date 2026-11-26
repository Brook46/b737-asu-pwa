#!/usr/bin/env python3
"""Build flight-card-pwa/data/msadb.json — high terrain on the Route info map.

For every 1°×1° cell from 30°W to 105°E and 5°S to 72°N (the region Flight
Card's routes cross), the highest terrain in it, from the open AWS Terrain
Tiles (Terrarium PNGs, Mapzen / Tilezen; free, no key), then a minimum safe
altitude the way a grid MORA is figured: highest terrain + 1,000 ft, or
+ 2,000 ft where the terrain is above 5,000 ft, rounded up to the next 100 ft.

Only cells whose figure is 10,000 ft or more are kept (the Alps, the Caucasus,
Turkey's east, Iran, the Himalaya…).

Two passes: zoom 6 finds the mountain cells (highest pixel ≥ 5,500 ft), then
each of those is measured again at zoom 9 (~200 m pixels). Even zoom 9 shaves
a little off a sharp summit (Mont Blanc 4,720 m against 4,808 m), so 500 ft
is added to the highest terrain before the MORA margins. The app still labels
these as approximate and points to the chart's grid MORA.

    python3 scripts/build-msadb.py [cache-dir]
"""
import io, json, math, os, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor
from PIL import Image
import numpy as np

Z = 6
LON0, LON1, LAT0, LAT1 = -30, 105, -5, 72
MIN_FT = 10000
Z2 = 9                 # second pass
ALLOW_FT = 500         # summits the tiles shave off (Everest reads ~230 ft low at zoom 9)
OUT = os.path.join(os.path.dirname(__file__), '..', 'flight-card-pwa', 'data', 'msadb.json')
CACHE = sys.argv[1] if len(sys.argv) > 1 else os.path.join('/tmp', 'terrarium-z6')
os.makedirs(CACHE, exist_ok=True)

def tile_xy(lon, lat, z=None):
    z = z or Z
    n = 2 ** z
    x = (lon + 180) / 360 * n
    y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n
    return x, y

def fetch(z, x, y):
    p = os.path.join(CACHE, f'{z}-{x}-{y}.png')
    if not os.path.exists(p):
        url = f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
        with urllib.request.urlopen(url, timeout=60) as r:
            data = r.read()
        with open(p + '.part', 'wb') as f:
            f.write(data)
        os.replace(p + '.part', p)
    return p

def tile(x, y, z=None):
    z = z or Z
    p = os.path.join(CACHE, f'{z}-{x}-{y}.png')
    if not os.path.exists(p):
        url = f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
        with urllib.request.urlopen(url, timeout=60) as r, open(p, 'wb') as f:
            f.write(r.read())
    a = np.asarray(Image.open(p).convert('RGB')).astype(np.float64)
    return a[:, :, 0] * 256 + a[:, :, 1] + a[:, :, 2] / 256 - 32768   # metres

# Highest terrain per 1° cell, from every pixel's centre, of one tile.
def add_tile(cellmax, tx, ty, z, only=None):
    n = 2 ** z
    h = tile(tx, ty, z)
    px = np.arange(256) + 0.5
    lon = (tx + px / 256) / n * 360 - 180
    lat = np.degrees(np.arctan(np.sinh(math.pi * (1 - 2 * (ty + px / 256) / n))))
    LON, LAT = np.meshgrid(lon, lat)
    ok = (LON >= LON0) & (LON < LON1) & (LAT >= LAT0) & (LAT < LAT1)
    la, lo = np.floor(LAT[ok]).astype(int), np.floor(LON[ok]).astype(int)
    v = h[ok]
    # Max per cell in numpy: one key per (lat, lon) cell.
    key = (la + 90) * 1000 + (lo + 180)
    uniq, inv = np.unique(key, return_inverse=True)
    mx = np.full(len(uniq), -1e9)
    np.maximum.at(mx, inv, v)
    for kk, m in zip(uniq.tolist(), mx.tolist()):
        k = (kk // 1000 - 90, kk % 1000 - 180)
        if only is not None and k not in only:
            continue
        if m > cellmax.get(k, -1e9):
            cellmax[k] = m

# Pass 1, zoom 6: where the mountains are.
coarse = {}
x0, y0 = tile_xy(LON0, LAT1)
x1, y1 = tile_xy(LON1, LAT0)
for ty in range(int(y0), int(y1) + 1):
    for tx in range(int(x0), int(x1) + 1):
        add_tile(coarse, tx, ty, Z)
cand = {k for k, m in coarse.items() if m * 3.28084 >= 5500}
print(f'{len(cand)} mountain cells', file=sys.stderr)

# Pass 2, zoom 9: those cells measured again.
need = set()
for la, lo in cand:
    ax, ay = tile_xy(lo, la + 1, Z2)
    bx, by = tile_xy(lo + 1, la, Z2)
    for x in range(int(ax), int(bx) + 1):
        for y in range(int(ay), int(by) + 1):
            need.add((x, y))
print(f'{len(need)} zoom-{Z2} tiles', file=sys.stderr)
with ThreadPoolExecutor(12) as ex:
    for i, _ in enumerate(ex.map(lambda t: fetch(Z2, *t), sorted(need))):
        if i % 200 == 0:
            print(f'  {i}/{len(need)}', file=sys.stderr)
cellmax = {}
for x, y in sorted(need):
    add_tile(cellmax, x, y, Z2, only=cand)

cells = {}
for (la, lo), m in cellmax.items():
    ft = m * 3.28084 + ALLOW_FT
    msa = ft + (2000 if ft > 5000 else 1000)
    msa = int(math.ceil(msa / 100.0))          # hundreds of feet
    if msa * 100 >= MIN_FT:
        cells[f'{la},{lo}'] = msa

out = {
    'v': 1, 'res': 1, 'unit': 'hundreds of ft',
    'note': 'Approximate grid MSA: highest terrain in the 1° cell (AWS Terrain Tiles, zoom 9) + 500 ft allowance, then + 1,000 ft, or + 2,000 ft above 5,000 ft; only cells of 10,000 ft or more. Not for navigation: use the chart grid MORA.',
    'cells': dict(sorted(cells.items())),
}
with open(OUT, 'w') as f:
    json.dump(out, f, separators=(',', ':'))
print(f'\n{len(cells)} cells ≥ {MIN_FT} ft → {OUT}', file=sys.stderr)
