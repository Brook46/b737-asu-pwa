#!/usr/bin/env python3
"""Build flight-card-pwa/data/fixdb.txt: waypoint names to positions, so a
pasted ATC route ("SUVAS UL53 PAPIN DCT ...") can be drawn as flown.

Usage: python3 scripts/build-fixdb.py <fix.dat> [navdb.json]
  fix.dat    — X-Plane / FlightGear fixes (Robin A. Peel, GNU GPL v2),
               e.g. https://gitlab.com/flightgear/fgdata/-/raw/next/Navaids/fix.dat.gz
               (cycle 2013.10: old, but most en-route fixes still stand)
  navdb.json — b737-systems-pwa/data/navdb.json (OurAirports navaids, current)

One line per name: NAME lat lon [lat lon ...], hundredths of a degree
(0.6 nm — plenty for a route line). Names repeat worldwide; the app picks
the copy nearest the route.
"""
import json, os, re, sys

here = os.path.dirname(__file__)
fix_src = sys.argv[1]
nav_src = sys.argv[2] if len(sys.argv) > 2 else os.path.join(here, '..', 'b737-systems-pwa', 'data', 'navdb.json')
out = os.path.join(here, '..', 'flight-card-pwa', 'data', 'fixdb.txt')

pts = {}
def add(name, lat, lon):
    p = (round(lat * 100), round(lon * 100))
    lst = pts.setdefault(name, [])
    # The same point twice (a fix and a navaid, or two near-copies) once.
    if not any(abs(a - p[0]) <= 2 and abs(b - p[1]) <= 2 for a, b in lst):
        lst.append(p)

with open(fix_src, encoding='latin-1') as fh:
    for line in fh:
        f = line.split()
        if len(f) != 3 or not re.fullmatch(r'[A-Z]{5}', f[2]):
            continue
        try:
            add(f[2], float(f[0]), float(f[1]))
        except ValueError:
            pass

nav = json.load(open(nav_src))['navaids']
for ident, lst in nav.items():
    if not re.fullmatch(r'[A-Z]{2,3}', ident):
        continue
    for n in lst:
        if n[0] in ('VOR', 'VORDME', 'VORTAC', 'NDB', 'TACAN', 'DME'):
            add(ident, n[1], n[2])

with open(out, 'w') as fh:
    fh.write('# Fixes: X-Plane/FlightGear fix.dat 2013.10 (c) Robin A. Peel, GNU GPL v2. Navaids: OurAirports (public domain).\n')
    for name in sorted(pts):
        fh.write(name + ' ' + ' '.join(f'{a} {b}' for a, b in pts[name]) + '\n')
print(len(pts), 'names ->', os.path.getsize(out) // 1024, 'KB')
