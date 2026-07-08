# B737 GPWS / EGPWS Simulator (PWA)

Training aid that reproduces the Honeywell MK V GPWS/EGPWS on the 737NG:
real aural callouts, glareshield annunciator lights, PFD/ND indications,
mode envelopes and the overhead inhibit logic.

## Run locally
```
python3 dev-server.py 8096 gpws-pwa
# or from repo root, the "GPWS" entry in .claude/launch.json
```

## Structure
- `index.html` — layout: Flight displays (PFD/ND) → annunciators → overhead → modes → flight state
- `app.js` — mode logic, inhibit rules, aural priority scheduler, PFD/ND rendering, quick scenarios
- `audio.js` — Web Audio engine, decodes and plays the real callout clips in `sounds/`
- `sounds/` — GPWS/EGPWS aural recordings (see attribution below)
- `sw.js` — offline cache (bump `VERSION` on each deploy)

## Modes covered
Basic Modes 1–7 (excessive descent, terrain closure, altitude loss after
takeoff, unsafe terrain clearance A/B, below glideslope, bank angle &
altitude callouts, reactive windshear) plus EGPWS look-ahead terrain (TAD)
and terrain clearance floor (TCF). Each shows ARMED / ACTIVE (caution/
warning) / INHIBITED with the reason.

## Audio attribution
Aurals are community GPWS/EGPWS sound sets in the Boeing/Honeywell voice —
**not** certified Honeywell audio, for training/illustration only:
- Boeing-voice callouts (pull up, sink rate, don't sink, too low gear/flaps,
  glideslope, bank angle, minimums, altitude callouts) —
  [tylerbmusic/GeoFS-GPWS-Callouts](https://github.com/tylerbmusic/GeoFS-GPWS-Callouts)
- Terrain family (terrain, terrain-pull-up, too low terrain) —
  [net-lisias-kspu/GPWS](https://github.com/net-lisias-kspu/GPWS)
- Windshear — [andrewhawkes/x-plane-11-alert-sounds](https://github.com/andrewhawkes/x-plane-11-alert-sounds)

## Disclaimer
Simplified envelopes; **not for operational use.** Always follow your
approved QRH and operator procedures.
