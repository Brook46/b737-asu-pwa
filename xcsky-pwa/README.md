# Sky Monkeys — free soaring forecast

A free, no-subscription soaring/cross-country weather PWA for paraglider,
hang-glider and sailplane pilots. Inspired by the paid soaring-forecast services
(XC Skies, BLIPMAP/RASP) but built entirely on **open, keyless data** so it costs
nothing and needs no account.

Lives in the suite at `…/b737-asu-pwa/xcsky-pwa/` (folder name is historical).

## What it shows

The **map is the app** (SkySight-style): a full-screen map with the forecast
painted over it, phone-first.

- **Gridded weather overlay — the main feature.** A lattice of Open-Meteo point
  forecasts covering the viewport is fetched in one batched call and painted as
  a smooth colour field. Colour layers: **Thermals** (net climb m/s), **Top**
  (thermal top MSL), **Base** (cumulus cloud base; blue holes transparent).
  Scrub any of 7 days × 24 h — recolouring is instant from cache; pan/zoom
  refetches for the new area automatically.
- **Wind & convergence overlays** — stack over any colour field. **Wind** draws
  standard meteorological barbs (direction + strength). **Convergence**
  highlights lift lines computed from the horizontal wind divergence (bright
  cyan) — where air piles up and rises.
- **Best of the day (★)** — one tap picks the top-ranked launch and sketches a
  downwind, climb-following XC line to show the day's potential (distance +
  direction + soarable window). The line is **fenced to the launch country**
  (truncated at the border / coast via reverse-geocoding). Heuristic guidance,
  clearly labelled.
- **Live wind stations** — real-time Pioupiou sensors (keyless): a coloured
  arrow + average speed per station, gust & age in the popup.
- **Airspace (CTR / no-fly)** — OpenAIP airspace tiles, and **webcams** —
  Windy nearby cams. Both need a free API key pasted into settings (stored only
  on-device); the layer prompts with the signup link until a key is added.
- **KK7 overlays** — proven thermal hotspots & skyways from thermal.kk7.ch
  (layer control, top-right).
- **Live pilots** — OGN positions with heading, altitude, climb, age (20 s poll).
- **Ranked takeoffs (🎯)** — launch sites from ParaglidingEarth (the open
  "paragliding map"), ranked "which launch works now": wind-direction match
  against each site's facings + wind strength + thermal at the selected hour.
  Top-5 are numbered; markers coloured by score; re-ranks as you scrub time.
- **Task planner (✏️)** — tap to drop turnpoints, each with an adjustable
  cylinder; route line, total distance and closed-triangle distance; the weather
  field keeps updating underneath as you move the time slider.
- **Tap anywhere → point forecast** in a bottom sheet: day summary (flyability
  0–100, soarable window), the 24 h time-height thermal plot, wind-barb profile,
  and detail cards (top, base, climb + stars, surface & altitude wind, freezing
  level, over-development risk).
- **Location** — GPS, place search, saved spots. Metric/imperial toggle
  (m·km/h ↔ ft·kt).

## Live pilots — why OGN

Live positions come from the **Open Glider Network** (live.glidernet.org), the
open aggregation point that FLARM/OGN trackers, FANET, SafeSky and app trackers
(XCTrack etc.) relay into. LiveTrack24's and XContest's own live APIs are
appKey/login-walled, so a keyless client can't use them directly — OGN is the
honest open superset. The endpoint echoes the CORS `Origin` header, so the
browser fetches it directly; markers are colour-coded by craft type (paraglider,
hang glider, glider, tow, balloon) with a "soaring only / all traffic" filter.

## Data & how the numbers are derived

Weather comes from the free [Open-Meteo](https://open-meteo.com) API (no key). The
soaring parameters are computed locally in `modules/soaring.js` — deliberately
transparent so they can be sanity-checked against a real RASP:

| Number        | Derivation |
|---------------|------------|
| Thermal top   | terrain + boundary-layer depth |
| Cloud base    | terrain + LCL from the surface T/Td spread (Espy's rule) |
| Working top   | min(thermal top, cloud base) when cumulus form, else thermal top |
| Climb rate    | Deardorff convective velocity w\* (from shortwave→sensible-heat flux and BL depth), mapped to a conservative net vario reading |
| Flyability    | blend of climb, working band, surface wind/gust, cloud & over-development |

These are model guidance, not gospel — always fly your own judgement.

## Architecture

Vanilla JS, ES modules, one service worker. No framework, no bundler, no build
step, **no API keys, no backend** — everything is fetched from open endpoints
directly in the browser.

```
index.html · app.js · app.css · sw.js · manifest.json
modules/
  meteo.js     Open-Meteo fetch + geocoding, response normalisation
  soaring.js   soaring physics (thermal top, cloud base, w*, flyability)
  chart.js     canvas time-height plot + wind-barb profile
  units.js     metric/imperial formatting
  location.js  GPS, search, saved spots
  map.js       the always-on main map: bases, KK7 overlays, live pilots
  grid.js      colour field + wind barbs + convergence; batched fetch, physics
  pilots.js    OGN live-pilot fetch/parse (lxml), type colours
  takeoffs.js  ParaglidingEarth launch fetch (via worker /pge) + wind-match rank
  planning.js  XC task planner: waypoints, cylinders, distance
  recommend.js "maximise the day": best launch + downwind XC route heuristic
  stations.js  live Pioupiou wind-station fetch + colour grading
  webcams.js   Windy webcams fetch (on-device key)
  resume.js    iOS PWA resume-hardening
```

Launch data is proxied through the repo's Cloudflare worker (`/pge` route in
`flight-card-pwa/cloudflare-worker/taf-proxy.js`) because ParaglidingEarth sends
no CORS header — the one exception to "no backend", reusing the worker that's
already deployed.

Maps are **Leaflet + raster tiles** (Esri imagery / OpenTopoMap): plain-DOM
rendering, no WebGL/worker dependency, renders on every device.

## Dev

Served by the repo's no-cache `dev-server.py` (see root `.claude/launch.json`,
config **"Sky Monkeys"**, port 8093). Run it with the preview tools, not raw Bash.

### Ship checklist (per the repo)

1. Bump `CACHE_VERSION` in `sw.js`.
2. Bump the `?v=` query on `app.js` / `app.css` in `index.html`.
3. Add any new JS module to the service-worker precache list.
4. `node --check` edited JS (a PostToolUse hook does this).
5. After merge to main: `scripts/check-deploy.sh`.
