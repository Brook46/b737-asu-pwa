#!/usr/bin/env python3
"""Writes a .ter grid as a lossless PNG + JSON header for the browser simulator.

The published simulator can't serve binary files, so it loads terrain.png
(elevation + 32768 in red·256 + green, Terrarium-style, north up) and
terrain.json (grid geometry), and rebuilds the .ter bytes in the page.

    python3 tools/terrain/ter2png.py sim/terrain.ter sim/terrain
"""
import json
import struct
import sys

from PIL import Image


def main(src, out):
    d = open(src, "rb").read()
    if d[:4] != b"PGTR":
        sys.exit("not a .ter file")
    rows, cols = struct.unpack_from("<HH", d, 6)
    south, west, dlat, dlon = struct.unpack_from("<dddd", d, 12)
    z = struct.unpack_from("<%dh" % (rows * cols), d, 44)
    im = Image.new("RGB", (cols, rows))
    px = im.load()
    for r in range(rows):
        for c in range(cols):
            v = z[r * cols + c] + 32768
            px[c, rows - 1 - r] = (v >> 8, v & 255, 0)  # .ter row 0 is the south edge
    im.save(out + ".png", optimize=True)
    with open(out + ".json", "w") as f:
        json.dump({"format": "terrarium-rg", "rows": rows, "cols": cols, "south": south, "west": west,
                   "dlat": dlat, "dlon": dlon, "source": "AWS Terrain Tiles (build_terrain.py)"}, f)
    print("wrote", out + ".png", out + ".json")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "sim/terrain.ter", sys.argv[2] if len(sys.argv) > 2 else "sim/terrain")
