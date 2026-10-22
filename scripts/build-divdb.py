#!/usr/bin/env python3
"""Build flight-card-pwa/data/divdb.json — diversion airports for Route info.

Usage: python3 scripts/build-divdb.py <dir with airports.csv runways.csv navaids.csv countries.csv>
Data:  https://davidmegginson.github.io/ourairports-data/  (public domain)

Keeps every large airport and every medium airport with scheduled service
that has at least one open, hard-surfaced runway of 5,000 ft or more —
anything shorter is no diversion for a 737. Compact arrays to keep it small:

  { "v": <build date>,
    "countries": { "GR": "Greece", ... },
    "a": { ICAO: [lat, lon, elevFt, name, city, country, size, iata,
                  [[ "03R/21L", lenFt, widthFt, hdgTrueOfLowEnd, lighted ], ...],
                  [[ type, ident, freqKHzOrMHz ], ...] ] } }

size: 2 = large_airport, 1 = medium. Runways are hard-surfaced only.
There is no ILS in OurAirports (navaids are VOR/DME/NDB/TACAN) — the app
says so rather than guessing.
"""
import csv, json, os, sys, datetime

src = sys.argv[1]
out = os.path.join(os.path.dirname(__file__), '..', 'flight-card-pwa', 'data', 'divdb.json')

HARD = ('ASP', 'CON', 'PEM', 'BIT', 'TAR', 'PAV', 'ASPH', 'CONC', 'MAC', 'BET', 'COP', 'HARD')

def fnum(v, nd=4):
    try:
        return round(float(v), nd)
    except (TypeError, ValueError):
        return None

def rows(name):
    with open(os.path.join(src, name), newline='', encoding='utf-8') as fh:
        yield from csv.DictReader(fh)

countries = {r['code']: r['name'] for r in rows('countries.csv')}

air = {}
for r in rows('airports.csv'):
    t = r['type']
    if t not in ('large_airport', 'medium_airport'):
        continue
    if t == 'medium_airport' and r['scheduled_service'] != 'yes':
        continue
    icao = (r['icao_code'] or '').strip() or (r['gps_code'] or '').strip()
    if len(icao) != 4 or not icao.isalpha():
        continue
    lat, lon = fnum(r['latitude_deg']), fnum(r['longitude_deg'])
    if lat is None or lon is None:
        continue
    try:
        elev = int(float(r['elevation_ft'] or 0))
    except ValueError:
        elev = 0
    air[r['ident']] = {
        'icao': icao.upper(), 'lat': lat, 'lon': lon, 'elev': elev,
        'name': r['name'][:44], 'city': (r['municipality'] or '')[:30],
        'cc': r['iso_country'], 'size': 2 if t == 'large_airport' else 1,
        'iata': (r['iata_code'] or '').strip(), 'rwy': [], 'nav': [],
    }

for r in rows('runways.csv'):
    a = air.get(r['airport_ident'])
    if not a or r['closed'] == '1':
        continue
    surf = (r['surface'] or '').upper()
    if not any(h in surf for h in HARD):
        continue
    try:
        length = int(float(r['length_ft'] or 0))
    except ValueError:
        continue
    if length < 5000:
        continue
    try:
        width = int(float(r['width_ft'] or 0))
    except ValueError:
        width = 0
    le, he = (r['le_ident'] or '').strip(), (r['he_ident'] or '').strip()
    hdg = fnum(r['le_heading_degT'], 0)
    if hdg is None:
        # Fall back to the runway number: 03 → 30°.
        digits = ''.join(ch for ch in le if ch.isdigit())
        hdg = int(digits) * 10 if digits else None
    a['rwy'].append([f'{le}/{he}' if he else le, length, width, int(hdg) if hdg is not None else None,
                     1 if r['lighted'] == '1' else 0])

for r in rows('navaids.csv'):
    a = air.get((r['associated_airport'] or '').strip())
    if not a:
        continue
    try:
        khz = float(r['frequency_khz'] or 0)
    except ValueError:
        continue
    freq = round(khz / 1000, 2) if khz > 10000 else int(khz)   # VOR in MHz, NDB in kHz
    a['nav'].append([r['type'], r['ident'], freq])

out_a = {}
for a in air.values():
    if not a['rwy']:
        continue
    a['rwy'].sort(key=lambda x: -x[1])
    out_a[a['icao']] = [a['lat'], a['lon'], a['elev'], a['name'], a['city'], a['cc'], a['size'],
                        a['iata'], a['rwy'][:6], a['nav'][:6]]

used = {v[5] for v in out_a.values()}
db = {'v': datetime.date.today().isoformat(),
      'countries': {k: v for k, v in countries.items() if k in used},
      'a': out_a}
os.makedirs(os.path.dirname(out), exist_ok=True)
with open(out, 'w', encoding='utf-8') as fh:
    json.dump(db, fh, ensure_ascii=False, separators=(',', ':'))
print(f'{len(out_a)} airports, {os.path.getsize(out) // 1024} KB -> {out}')
