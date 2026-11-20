#!/usr/bin/env python3
"""Bakes a terrain grid for the instrument and the simulator from AWS Terrain
Tiles (terrarium PNG, ~90 m Copernicus/SRTM-derived DEM, open data).

    python3 tools/terrain/build_terrain.py [south west north east] [step_m] [out]
    default: the Gilboa / Harod / Beit She'an area, 120 m grid → data/gilboa.ter

File format (little-endian):
  "PGTR" | u16 version=1 | u16 rows | u16 cols | u16 reserved
  f64 south | f64 west | f64 dlat | f64 dlon        (cell size in degrees)
  i16 elevation[rows][cols], metres, row 0 = southern edge, col 0 = western edge
"""
import io, math, struct, sys, urllib.request
from PIL import Image

Z = 11
TILE = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"


def tile_xy(lat, lon, z):
    n = 2 ** z
    x = (lon + 180) / 360 * n
    y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n
    return x, y


def main():
    a = sys.argv[1:]
    s, w, n, e = map(float, a[:4]) if len(a) >= 4 else (32.36, 35.16, 32.76, 35.66)
    step = float(a[4]) if len(a) >= 5 else 120.0
    out = a[5] if len(a) >= 6 else "data/gilboa.ter"
    x0, y1 = tile_xy(s, w, Z)
    x1, y0 = tile_xy(n, e, Z)
    tiles = {}
    for tx in range(int(x0), int(x1) + 1):
        for ty in range(int(y0), int(y1) + 1):
            data = urllib.request.urlopen(TILE.format(z=Z, x=tx, y=ty), timeout=30).read()
            tiles[(tx, ty)] = Image.open(io.BytesIO(data)).convert("RGB")
    print(f"{len(tiles)} tiles")

    def elev(lat, lon):
        fx, fy = tile_xy(lat, lon, Z)
        tx, ty = int(fx), int(fy)
        px, py = (fx - tx) * 256, (fy - ty) * 256
        # bilinear inside one tile (edges clamp; good enough at 120 m)
        im = tiles[(tx, ty)]
        ix, iy = min(int(px), 254), min(int(py), 254)
        ax, ay = px - ix, py - iy
        def h(i, j):
            r, g, b = im.getpixel((i, j))
            return r * 256 + g + b / 256 - 32768
        return (h(ix, iy) * (1 - ax) * (1 - ay) + h(ix + 1, iy) * ax * (1 - ay)
                + h(ix, iy + 1) * (1 - ax) * ay + h(ix + 1, iy + 1) * ax * ay)

    dlat = step / 111195.0
    dlon = step / (111195.0 * math.cos(math.radians((s + n) / 2)))
    rows = int((n - s) / dlat) + 1
    cols = int((e - w) / dlon) + 1
    buf = bytearray(b"PGTR" + struct.pack("<HHHH", 1, rows, cols, 0) + struct.pack("<dddd", s, w, dlat, dlon))
    lo, hi = 1e9, -1e9
    for r in range(rows):
        lat = s + r * dlat
        for c in range(cols):
            v = int(round(elev(lat, w + c * dlon)))
            lo, hi = min(lo, v), max(hi, v)
            buf += struct.pack("<h", v)
    with open(out, "wb") as f:
        f.write(buf)
    print(f"wrote {out}: {rows}x{cols} @ {step:.0f} m, {lo}..{hi} m, {len(buf)} bytes")


if __name__ == "__main__":
    main()
