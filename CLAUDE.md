# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A suite of vanilla-JS Progressive Web Apps for a 737 pilot, all served from one GitHub Pages site (`https://brook46.github.io/b737-asu-pwa/`). No bundler, no framework, no build step — plain HTML/CSS/ES-modules with a service worker per app.

- **Root** (`index.html`, `app.js`) — Airspeed Unreliable QRH quick-reference (see README.md)
- **flight-card-pwa/** — flight card with roster OCR, weather (TAF/METAR), logbook, calendar sync; the most complex app (`modules/` holds ~19 ES modules)
- **duty-cal-pwa/** — duty roster calendar (parses duty-plan PDFs)
- **gpws-pwa/** — GPWS warning simulator/trainer
- **pdf-knowledge-pwa/** — PDF study/annotation companion
- **thermals-pwa/** — live in-flight thermals map (has its own separate Cloudflare worker; `config.js` holds its API base)

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
