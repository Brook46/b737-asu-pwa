# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A suite of vanilla-JS Progressive Web Apps for a 737 pilot, all served from one GitHub Pages site (`https://brook46.github.io/b737-asu-pwa/`). No bundler, no framework, no build step — plain HTML/CSS/ES-modules with a service worker per app.

- **Root** (`index.html`, `app.js`) — Airspeed Unreliable QRH quick-reference (see README.md)
- **flight-card-pwa/** — flight card with roster OCR, weather (TAF/METAR), logbook, calendar sync; the most complex app (`modules/` holds ~19 ES modules)
- **duty-cal-pwa/** — duty roster calendar (parses duty-plan PDFs). Day/week/month views, all-day lane, FTL counters, .ics export. `kinds.js` is the single source of truth for the duty taxonomy (kind / subtype / roster codes / colours) — parser, renderer, summary and ICS all read from it, so a new duty category is one entry there plus one CSS variable.
- **swap-pwa/** — "Roster Swap": crew flight-exchange board, a **separate app at its own URL**. Reads the calendar's roster read-only from shared `localStorage` (`duty-cal:events`, same origin) via its own `roster.js`; it never imports calendar code and never writes `duty-cal:*`. Talks to a Google Apps Script backend (`swap-pwa/backend/Code.gs`). Availability rules in `roster.js` are an allow-list — an unrecognised duty kind counts as *busy*, so a new calendar category can never advertise the pilot as free by mistake.
- **gpws-pwa/** — GPWS warning simulator/trainer
- **pdf-knowledge-pwa/** — PDF study/annotation companion
- **thermals-pwa/** — live in-flight thermals map (has its own separate Cloudflare worker; `config.js` holds its API base)
- **debrief-pwa/** — "Thermal Debrief": post-flight IGC analysis. Replays `.igc` logs in 3D over real terrain (MapLibre GL JS + AWS Terrain Tiles DEM, deck.gl track layers interleaved so ridges occlude tracks), 2–4 flights at once on one master clock with Absolute (UTC) or Relative (launch-aligned) sync, automatic highlight detection (best climb / low save / fast glide / heavy sink), an Insights panel (day summary, climb-by-altitude-band, transitions, A+–E scorecard + 0–100 XC score, head-to-head), XCTSK competition-task overlay with cylinder tagging (tools.xcontest.org — keyless and CORS-open, the one usable XContest API), and export of MediaRecorder replay clips + PNG stat cards. Keyless like xcsky, except the optional XContest import. **XContest import is unverified** — they publish no open API (robots.txt disallows the flight-search and track endpoints), so `modules/xcontest.js` targets their partner API defensively; adjusting `SEARCH_PATHS` + `readFlight()` there is the only client change needed once real docs exist, and the worker's `/xc` + `/xcigc` routes need a manual redeploy before it works at all. `types.d.ts` holds the data model for tooling only — there's no build step, so it never ships. **AGL caveat:** the DEM is 90 m, so ridge soaring and every landing read as 0 m AGL; `metrics.lowestAglInFlight()` and the `LOW_SAVE` detector both guard against this, and changing those guards will make every flight report a bogus save at launch.
- **airline-radar-pwa/** — "Airline Radar": live airline traffic on a map, Flightradar24-shaped but **airliners only**. Keyless like xcsky: positions from `api.airplanes.live` (the one free ADS-B aggregator that sends `Access-Control-Allow-Origin: *` — `adsb.lol`/`adsb.fi` serve the same JSON but no CORS header, so they'd need a proxy), routes/airlines/airframe photos from `api.adsbdb.com`. `modules/airlines.js` is the app: an aircraft reaches the map only with an ICAO flight-number callsign, not on the bizjet/military exclusion list, and either a known airline code **or** airliner-sized (known type, or ADS-B category A3/A4/A5) — so an unlisted carrier still shows and a NetJets Global still doesn't. Widen the table freely; loosening the callsign or exclusion rules is what floods it with GA. Search is two things at once (`modules/search.js`): a local filter, *and* a global lookup against the feed's `/v2/reg/` + `/v2/callsign/` endpoints so a named aircraft is found anywhere in the world — plus a bare three-letter query means a `4X-` tail (fleet shorthand; `HOME_PREFIX`). `modules/history.js` remembers last-known positions for 24 h so a tail that stopped transmitting is still findable; it only calls something a *lost contact* after 3 consecutive misses in the same area, never on a mass disappearance (>35% at once = feed hiccup or map move) and never near the query-circle edge or on the ground — relaxing those guards makes it report hundreds of bogus "went dark" aircraft on every pan. Deep links (`?reg=` / `?tail=` / `?flight=`, plus `?sta=&from=`) open the app straight onto one aircraft — **flight-card-pwa's tail button (`doRadar()`) is the caller**, replacing its old Flightradar24 link, and it passes the roster's scheduled arrival because ADS-B has no schedule and no keyless schedule feed exists: ETA is computed from ground speed, STA is only ever shown when handed in. The SW deliberately doesn't register on localhost (cache-first + dev-server = debugging stale modules).
- **xcsky-pwa/** — "Sky Monkeys": free soaring/XC weather, map-first (SkySight-style). Main screen is a full-map gridded forecast overlay (batched multi-point Open-Meteo → climb/top/base/wind layers, 7-day time scrub), plus KK7 thermal/skyways overlays, live pilots via OGN, and a tap-anywhere point forecast (time-height plot) in a bottom sheet. Entirely keyless: Open-Meteo weather, Leaflet + Esri/OpenTopoMap tiles, thermal.kk7.ch overlays, live.glidernet.org pilots. No worker, no key, no build step.

## Branch & deploy flow

Work on `sky-club`, merge to `main`. GitHub Pages serves `main`. The root `wrangler.jsonc` deploys the Cloudflare Worker (`flight-card-pwa/cloudflare-worker/taf-proxy.js`) automatically on push to `main` via the Cloudflare GitHub integration.

- Live worker: `https://b737-asu-pwa.alonbrookstein.workers.dev` (referenced as `WORKER_BASE` in `flight-card-pwa/modules/proxy.js`). A stale duplicate exists at `b737-asu-pwa.zy7ps9scwm.workers.dev` in another Cloudflare account — never point `WORKER_BASE` at it.
- The worker is API-only (CORS shim for aviationweather.gov + Google Calendar iCal, plus `/logbook/<token>` backed by the `LOGBOOK` KV namespace). The PWAs themselves are served by GitHub Pages, never by the worker.
- After merging to main, verify with `scripts/check-deploy.sh` (checks every app's index/sw.js plus worker `/healthz` and `/taf`).

### Ship checklist (every app change)

1. Bump `CACHE_VERSION` in that app's `sw.js`.
2. Bump the `?v=` query on `app.js` (and `app.css` if changed) in that app's `index.html`.
3. New JS modules must be added to the service worker's precache list.
4. `node --check` any edited JS (a PostToolUse hook does this automatically).
5. After merge to main: `scripts/check-deploy.sh`.

## Running locally

Dev servers are defined in `.claude/launch.json` (one per app; use the preview tools, not raw Bash). `dev-server.py` is a no-cache static server — prefer it over `python -m http.server` because browsers heuristically cache ES modules and serve stale code otherwise.

Regenerate root QRH data: `python3 scripts/parse_qrh.py path/to/QRH.pdf data/` (needs `pypdf`).

## Hard constraints

- **Calendar is pull-only.** The pilot's duty roster comes from secret read-only iCal URLs. Never write to Google Calendar or El Al systems. Calendar sync prunes only *future* legs; past flown legs are the logbook and are kept forever.
- **iOS is the primary target.** Apps run as Home-Screen PWAs on iPad/iPhone Safari. Motion/GPS sensors need a user gesture and a secure context (https or localhost); over plain LAN http use an ngrok tunnel.
- **A boot-time TDZ/ReferenceError in any ES module halts all evaluation past it** — symptom is "some buttons frozen, others work". All apps carry resume-hardening (bfcache reload, long-away reload, freeze detector) except thermals-pwa, which uses a reduced variant (no forced reloads — it must preserve live in-flight map state).
- GPWS logic/displays follow the 737 FCOM (D6-27370-858-ELA); don't invent warning behavior — check the FCOM before changing callout logic.
