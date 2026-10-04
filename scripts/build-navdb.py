#!/usr/bin/env python3
"""Build b737-systems-pwa/data/navdb.json from OurAirports CSVs (public domain).

Usage: python3 scripts/build-navdb.py <dir with airports.csv runways.csv navaids.csv>
Data: https://davidmegginson.github.io/ourairports-data/

Compact layout (arrays, not objects, to keep it small):
  airports: { ICAO: [lat, lon, elevFt, name, [[rwy, lat, lon, trueHdg, lenFt, thrElevFt, dispThrFt], ...]] }
  navaids:  { IDENT: [[type, lat, lon, freq, name, magVar], ...] }   (idents repeat worldwide)
"""
import csv, json, os, sys

src = sys.argv[1]
out = os.path.join(os.path.dirname(__file__), '..', 'b737-systems-pwa', 'data', 'navdb.json')

def f(v, nd=5):
    try:
        return round(float(v), nd)
    except (TypeError, ValueError):
        return None

airports = {}
with open(os.path.join(src, 'airports.csv'), newline='', encoding='utf-8') as fh:
    for r in csv.DictReader(fh):
        icao = (r['icao_code'] or '').strip() or (r['gps_code'] or '').strip()
        if len(icao) != 4 or not icao.isalpha():
            continue
        if r['type'] not in ('large_airport', 'medium_airport'):
            continue
        if r['type'] == 'medium_airport' and r['scheduled_service'] != 'yes':
            continue
        lat, lon = f(r['latitude_deg']), f(r['longitude_deg'])
        if lat is None or lon is None:
            continue
        airports[icao] = [lat, lon, int(float(r['elevation_ft'] or 0)), r['name'][:40], []]

with open(os.path.join(src, 'runways.csv'), newline='', encoding='utf-8') as fh:
    for r in csv.DictReader(fh):
        a = airports.get(r['airport_ident'])
        if not a or r['closed'] == '1':
            continue
        try:
            length = int(float(r['length_ft'] or 0))
        except ValueError:
            length = 0
        if length < 4000:
            continue
        for end in ('le', 'he'):
            ident = (r[end + '_ident'] or '').strip()
            lat, lon, hdg = f(r[end + '_latitude_deg']), f(r[end + '_longitude_deg']), f(r[end + '_heading_degT'], 1)
            if not ident or lat is None or lon is None:
                continue
            if hdg is None:
                continue
            elev = r[end + '_elevation_ft']
            disp = r[end + '_displaced_threshold_ft']
            a[4].append([ident, lat, lon, hdg, length, int(float(elev)) if elev else a[2], int(float(disp)) if disp else 0])

navaids = {}
TYPES = {'VOR': 'VOR', 'VOR-DME': 'VORDME', 'VORTAC': 'VORTAC', 'DME': 'DME', 'NDB': 'NDB', 'NDB-DME': 'NDB', 'TACAN': 'TACAN'}
with open(os.path.join(src, 'navaids.csv'), newline='', encoding='utf-8') as fh:
    for r in csv.DictReader(fh):
        t = TYPES.get(r['type'])
        ident = (r['ident'] or '').strip()
        lat, lon = f(r['latitude_deg']), f(r['longitude_deg'])
        if not t or not ident or lat is None or lon is None:
            continue
        khz = f(r['frequency_khz'], 1) or 0
        freq = round(khz / 1000, 2) if t != 'NDB' else khz       # VOR/DME in MHz, NDB in kHz
        mv = f(r['magnetic_variation_deg'], 1)
        navaids.setdefault(ident, []).append([t, lat, lon, freq, r['name'][:28], mv if mv is not None else 0])

os.makedirs(os.path.dirname(out), exist_ok=True)
with open(out, 'w') as fh:
    json.dump({'source': 'OurAirports (public domain)', 'airports': airports, 'navaids': navaids}, fh, separators=(',', ':'))
print(len(airports), 'airports,', sum(len(a[4]) for a in airports.values()), 'runway ends,',
      sum(len(v) for v in navaids.values()), 'navaids ->', os.path.getsize(out) // 1024, 'KB')
