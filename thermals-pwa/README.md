# Sky Club — daily social paragliding

See who's flying today. A live 3D map of your paragliding crew: each pilot's
nickname, colour, and a state-changing icon (🪂 flying · 🚶 on the ground ·
🚗 driving · ↩️ retrieve · 🚌 bus · 👍 needs a ride), plus shared safety info,
group chat, an SOS distress button, and a one-tap WhatsApp link to any pilot.

You can't see the crew without sharing your own location — the app is gated on
an active location share.

**Flying ⇄ on-the-ground switches automatically** from motion (airborne ⇒
flying, stationary ⇒ walking); the vehicle/hitch states are manual. The **SOS**
button gives a 10-second cancel countdown, then sounds a siren and alerts every
pilot in today's room with your distress + location.

> The first rule of Sky Club: you don't talk about Sky Club.

## Architecture

- **Frontend** — vanilla-JS, no-build PWA (GitHub Pages), MapLibre GL JS for the
  3D terrain map. Same idiom as the sibling apps in this repo.
- **Backend** — one Cloudflare Worker + a `DayRoom` Durable Object **per calendar
  day** that holds live presence, locations, profiles, and the day's chat over
  hibernatable WebSockets. SMS sign-in via Twilio Verify.

```
thermals-pwa/
  index.html  app.css  app.js  config.js  manifest.json  sw.js  icon.svg
  modules/    geo · icons · state · profile · map · presence · auth · roster · chat · sos · ui
  cloudflare-worker/   index.js · day-room.js · wrangler.jsonc
```

## Run locally (frontend)

```sh
python3 dev-server.py 8092 thermals-pwa      # from repo root
# open http://localhost:8092  (localhost is a secure context, so geolocation works)
```

Without the backend deployed you can still explore the map: on the sign-in gate
tap **“Map preview without signing in.”** Two dev-only helpers exist on
`window` for testing without GPS/backend:

- `thermalsSimulate(lat, lng, speed)` — inject a synthetic location fix.
- `thermalsDemo()` — populate the roster/map/chat with fake pilots.

> Heads-up for local dev: the service worker caches modules **cache-first**, so
> after editing a module either bump `CACHE_VERSION` in `sw.js`, or in DevTools
> unregister the SW + clear storage before reloading.

## Deploy the backend (one-time)

Requires only a Cloudflare account (free tier; Durable Objects with SQLite
storage are free-tier eligible). No SMS provider — sign-in is keyless WhatsApp.

```sh
cd thermals-pwa/cloudflare-worker
wrangler secret put SESSION_HMAC_SECRET      # any long random string
wrangler deploy
```

Then put the resulting `*.workers.dev` URL into `config.js` (`API_BASE`), or set
it at runtime: `localStorage.setItem('thermals.apiBase', 'https://…workers.dev')`.

### Sign-in model

You sign in with your **WhatsApp number** — it's your identity *and* your contact
link. This is keyless and free but trust-based (no OTP), which suits a small
known crew where every field is already shared. To add real ownership proof
later, put a WhatsApp Business webhook in front of `authWhatsApp` in
`cloudflare-worker/index.js`; nothing else needs to change.

## Map tiles

Defaults to keyless [OpenFreeMap](https://openfreemap.org) vector tiles +
free AWS Terrarium elevation tiles for 3D terrain. For a cleaner basemap, drop a
free [MapTiler](https://maptiler.com) key into `config.js` (`MAPTILER_KEY`).

## Live verification (two phones / two tabs)

1. `wrangler dev` in `cloudflare-worker/`; set `thermals.apiBase` to the dev URL.
2. Open two tabs, sign in with two numbers, set different nicknames/colours.
3. Spoof geolocation in DevTools (Sensors) and move one — the other sees it move
   within a few seconds. Close a tab → that pilot disappears.
