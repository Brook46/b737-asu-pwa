# Airspeed Unreliable — B737NG

A Progressive Web App (PWA) quick-reference for the Boeing 737NG **Airspeed Unreliable** non-normal procedure. Pick variant, enter gross weight, pick flight phase → see the recommended pitch attitude, V/S or N1, and KIAS target straight from the QRH.

Runs installable on iPad (Add to Home Screen) and works fully offline after the first load.

> **Reference only.** This app is for training and personal reference. Always follow your current approved QRH and operator procedures. Data source: `D6-27370-858-ELA Rev.57` (4X-EK fleet).

## Features

- **Both variants**: 737-800W (CFM56-7B26) and 737-900ERW (CFM56-7B27).
- **Gross weight**: type exact tonnage or vertical-drag to scrub. Nearest weight column in every table is highlighted.
- **All seven phases**: Climb, Cruise, Descent, Holding, Terminal Area (5000 ft AGL), Final Approach (1500 ft AGL), Go‑Around.
- **Terminal / Final**: airport-pressure-altitude picker; full flap-config table per altitude.
- **Go‑Around**: three flap configurations (1, 5, 15 — all Gear Up) per QRH.
- **Display-all policy**: when a phase has one value it is shown directly; when it has options, every option is shown so you can cross-read.
- **Sensor footer**: GPS ground speed, track, GPS altitude, position accuracy, live G-force from iPad motion sensors.
- **Touchdown capture**: when GS drops below 60 kt after having flown above it, the G cell switches from live g to the peak |G| recorded over the last 2 minutes — the landing G figure. Double-tap the G cell to reset.
- **Themes**: Auto / Light / Dark, cycles from a single button.
- **Fully offline**: once cached, the app works on airplane mode with no network.
- **22-step QRH procedure** from §10.1 reachable in one tap.

## Install on iPad

1. Host the files (see "Run locally" below) or push to any static host (GitHub Pages, Netlify, Cloudflare Pages).
2. Open the URL in **Safari** on the iPad.
3. Share → **Add to Home Screen**.
4. Launch from the home-screen icon — it opens in standalone mode (no Safari chrome).

> Sensor permissions (GPS + motion) must be granted on first run. Tap the **Enable sensors** button in the footer.

## Run locally

No build step. Any static-file server works. From the repo root:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000/` on the iPad (same Wi‑Fi, using the Mac's LAN IP) or on desktop Safari/Chrome.

The `.claude/launch.json` config exposes this server to Claude's preview runner.

### iOS motion permission caveat

DeviceMotion and Geolocation on iOS Safari require:
- **User gesture** — hence the "Enable sensors" button.
- **Secure context** for motion — `https://` or `http://localhost`. Over plain LAN `http://`, motion-sensor prompts will be blocked on some iOS versions. For testing G-force on-device, use a tunnel (e.g. `ngrok http 8000`) that gives you an HTTPS URL, then Add to Home Screen.

## Project layout

```
.
├── index.html              # App shell
├── app.css                 # Theme vars, responsive grid, cockpit palette
├── app.js                  # State, rendering, sensors, SW registration
├── manifest.json           # PWA manifest
├── sw.js                   # Service worker (cache-first, app shell + data)
├── icon.svg                # Master icon (attitude indicator + ASU chevron)
├── icons/                  # Generated PNGs: 152, 167, 180, 192, 512, 1024
├── data/
│   ├── qrh-800.json        # Parsed QRH tables, 737-800W
│   └── qrh-900.json        # Parsed QRH tables, 737-900ERW
├── scripts/
│   └── parse_qrh.py        # Regenerates data/*.json from Boeing QRH PDF
└── .claude/launch.json     # Claude dev-server config
```

## Regenerate QRH data

Requires `pypdf` (Python 3.9+):

```bash
pip3 install --user pypdf
python3 scripts/parse_qrh.py path/to/QRH.pdf data/
```

The parser targets Boeing PI-QRH §10 "Performance Inflight — Airspeed Unreliable" and will emit `qrh-800.json` and `qrh-900.json`. Counts to expect:

| section       | entries |
|---------------|:-------:|
| climb         |   5     |
| cruise        |   6     |
| descent       |   5     |
| holding       |   3     |
| terminal      |  18     |
| approach      |  18     |
| go_around (×3 flap configs) | 5 each |

## Tech

- Vanilla HTML/CSS/JS — no bundler, no framework.
- Service Worker + Web App Manifest for PWA install & offline.
- `navigator.geolocation.watchPosition` for GPS; `DeviceMotionEvent` (with iOS permission request) for G.
- CSS variables for theming; `prefers-color-scheme` drives Auto.
- LocalStorage persists variant, phase, weight, airport-altitude pick, and go-around flap pick.

## Disclaimer

This is an unofficial training tool. It is not a replacement for the approved QRH. GPS and G-force readings are taken from iPad sensors and are **not certified** for flight use. Verify all numbers against the current approved QRH before use.

## License

Personal / training use. Boeing QRH content is the intellectual property of The Boeing Company; extracted numeric data is included here solely for reference by the fleet covered by `D6-27370-858-ELA Rev.57`.
