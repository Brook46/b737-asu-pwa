# Sky Monkeys — free soaring forecast

A free, no-subscription soaring/cross-country weather PWA for paraglider,
hang-glider and sailplane pilots. Inspired by the paid soaring-forecast services
(XC Skies, BLIPMAP/RASP) but built entirely on **open, keyless data** so it costs
nothing and needs no account.

Lives in the suite at `…/b737-asu-pwa/xcsky-pwa/` (folder name is historical).

## What it shows

- **7-day time-height thermal plot** — each hour of the day is a column coloured
  by achievable climb rate, from the ground up to the working top, with the
  cumulus cloud-base line and terrain drawn in.
- **Day summary** — flyability score (0–100), the soarable window, max thermal
  strength and max height for each of the next 7 days.
- **Hour detail** — thermal top, cloud base (cumulus vs blue), net climb + star
  rating, surface wind & gust, wind at the working top, freezing level, and an
  over-development / thunderstorm risk gauge.
- **Wind profile** — standard barbs up the height axis for the selected hour.
- **Full map** — satellite & topo bases, **KK7 thermal hotspots** and **KK7
  skyways** overlays (thermal.kk7.ch), and **live pilots** with heading, altitude,
  climb and age, tap any point → "Forecast here".
- **Location** — GPS, place search, saved spots, map picking. Metric/imperial
  toggle (m·km/h ↔ ft·kt).

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
  map.js       full map: bases, KK7 overlays, live pilots, pick-a-point
  pilots.js    OGN live-pilot fetch/parse (lxml), type colours
  resume.js    iOS PWA resume-hardening
```

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
