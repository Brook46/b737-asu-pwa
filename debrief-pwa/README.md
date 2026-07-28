# Thermal Debrief

A 3D paragliding flight debriefing and analytics PWA. Drop in `.igc` logs and
replay the flight over real terrain: climb-rate colouring, up to four tracks
compared side by side, automatic highlight detection, and shareable replay clips
and stat cards.

Part of the [b737-asu-pwa](../README.md) suite — vanilla ES modules, no bundler,
no build step, no API key, no account. Everything runs on the device; flight
logs are never uploaded.

## What it does

**3D flight canvas.** MapLibre GL JS renders real terrain from AWS's open
Terrain Tiles (terrarium-encoded DEM), with satellite, topographic and hillshade
overlays. deck.gl draws the tracks *interleaved* in MapLibre's WebGL context, so
a line behind a ridge is genuinely occluded by it. Each track is drawn at its
true altitude, with an optional ground shadow projected onto the terrain.

**Colour modes.** The track colour encodes a live flight metric, and the chart
below uses the same ramp so the two always agree:

| Mode | Meaning |
|---|---|
| Climb | red = lift above +0.5 m/s · green = neutral · blue = sink below −1.0 m/s |
| Turn | red = left-hand rotation · blue = right-hand · grey = straight |
| Speed | ground speed, 0 → 60 km/h |
| Glide | glide ratio over the ground |
| Pilot | one flat colour per pilot |

**Multi-track comparison.** Two to four flights at once, with one master clock:

- **Absolute Time Sync** — the clock is UTC. Two pilots who flew together appear
  where they actually were relative to each other.
- **Relative Start Sync** — the clock is seconds since *each pilot's own detected
  launch*, so flights from different days line up at T=0.

Transport is play/pause, 1×/2×/5×/10×, a scrubber, and skip-to-next-highlight.
The profile chart is draggable to scrub. Keyboard: `space`, `←`/`→` (shift for
a minute), `[`/`]` for highlights, `c` to cycle the camera, `Home`, `Esc`.

**Automatic highlights.** Four event types are detected per flight:

- `BEST_CLIMB` — the thermal with the best *average* climb (not a one-second gust)
- `LOW_SAVE` — got below 150 m AGL after having been high, then climbed back out
- `FAST_GLIDE` — the longest glide line, and the peak-speed moment
- `HEAVY_SINK` — the steepest sustained sink, and the roughest air (highest vario
  standard deviation over 20 s)

**Insights & grades.** A separate panel answers the debrief questions:

- **The day** — average climb pooled across every loaded flight, the best
  sustained climb and who got it, the band the best climbs were in, the working
  band (middle half of all climbing), and where climbs topped out.
- **Where the lift was** — average climb achieved in each 250 m altitude band,
  one bar per pilot. Bands with under a minute of climbing are faded, because a
  12-second surge would otherwise send you to the wrong height tomorrow.
- **Scorecard** — A+ to E across Climb, Centring, Glide, Height and Speed, with
  one actionable sentence aimed at the weakest category. Heuristic, and labelled
  as such. With two or more pilots from the same day, Climb and Height are
  re-based against what the others actually achieved rather than a fixed scale.
- **You vs the day** — each pilot's own numbers next to what everyone managed:
  *"average climb was 1.3, yours was 1.4."* Deltas are coloured, and anything
  within 2% of the day's mean reads as `=` rather than a fake win. Only appears
  with two or more flights loaded — with one, there is no "day" to compare to.
- **Head to head** — average climb, core conversion, gain per climb, transition
  glide, free distance, XC speed, time climbing, where climbs topped out, plus
  **turn bias** and **left/right thermal counts** side by side.
- **Time split** — climbing vs transitions vs unclassified, plus left/right turn
  bias and how many thermals were turned each way.
- **Transitions** — every glide from the top of one thermal to the bottom of the
  next (plus the run out from launch and the final glide), with distance,
  achieved glide, speed and height lost, coloured against that pilot's own
  average.

Three measurement choices are worth knowing about, because the obvious ones are
wrong:

- **Distance is free distance over five points** — start, up to three turnpoints
  and end, in flight order. This is what XC leagues score, and the alternatives
  are all wrong: ground-track distance counts every 360 (so the pilot who circles
  most posts the fastest "speed"), launch-to-landing collapses an out-and-return,
  and two-point open distance loses every corner. On two real flights in this
  app's storage the same day reads **29 km** straight-line, **52 km** open, and
  **89 km** free — only the last is what those pilots actually flew. Solved by
  dynamic programming, `best[k][j] = max_{i≤j}(best[k-1][i] + d(i,j))`, which is
  O(legs·n²) instead of the O(n⁵) of brute force: 9 ms on a 16 000-fix track.
  Track distance is deliberately not displayed anywhere.
- **Speed is only graded on cross-country flights.** A ridge-soaring session is
  detected as local and its speed left ungraded, since marking it down for being
  slow is noise, not feedback.
- **Glide ratio needs a real height band.** A leg that drifts 1.9 km while losing
  16 m computes to 118:1 — that is lift, not glide performance. Legs losing under
  50 m read as "level", and only proper transitions can claim "best glide".

**XC score.** Alongside the letter grade, each flight gets a 0–100 competition
score weighted toward distance (45%) and speed (30%), with climb (15%) and glide
(10%) behind them, plus an open-distance points figure. This deliberately asks a
different question from the scorecard: the grade asks "how well did you fly the
day you were given" — a beautifully flown 20 km day can earn an A — while the XC
score asks "how big was the flight". It is *not* the real XContest formula, which
optimises up to three turnpoints and multiplies by 1.4 for a flat triangle and
1.6 for an FAI triangle; turnpoint optimisation is O(n³), so this uses open
distance with no multiplier and therefore understates a triangle.

**Import from XContest** — ⚠️ *unverified against the live API; see below.*

**Export.** A replay clip is recorded straight off the live WebGL canvas with
`MediaRecorder` + `captureStream()` — MP4 where the browser can encode it,
WebM/VP9 otherwise. The PNG summary card puts every loaded flight side by side
over a still of the current 3D view. Both go through the native share sheet when
one is available, which is the only reliable way to save a file from a
standalone iOS PWA.

## Data sources — all keyless

| What | Source |
|---|---|
| Terrain mesh | [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (terrarium) |
| Satellite / hillshade | Esri World Imagery, World Hillshade |
| Topographic | [OpenTopoMap](https://opentopomap.org) (CC-BY-SA) |
| Ground elevation (AGL) | [Open-Meteo elevation](https://open-meteo.com) (Copernicus DEM GLO-90) |
| Rendering | [MapLibre GL JS](https://maplibre.org) + [deck.gl](https://deck.gl), from unpkg |

No token, no account, no rate limit to manage.

## How the numbers are derived

Two rules keep the analysis honest, both in `modules/metrics.js`:

1. **Time-based windows, never index-based.** Loggers record at 1 s, 2 s, 4 s or
   irregularly. A "5-sample average" would silently mean 5 s on one file and
   20 s on another.
2. **Least-squares slope for vario, not first difference.** Barometric altitude
   is quantised to 1 m, so a raw difference over a 1 s interval is ±1 m/s of
   pure quantisation noise.

Barometric altitude is preferred over GPS, but the parser falls back to GPS when
the logger left the baro field at zero or flat-lined it.

**A note on AGL.** The DEM is 90 m data. While ridge soaring, the cell you are
flying *beside* contains the ridge itself, so a pilot working lift 40 m off the
face reads as 0 m AGL — and every completed flight ends at 0 m AGL, because that
is what landing is. So "Lowest AGL" is measured only between the first and last
time the pilot was genuinely clear of the ground (200 m), and `LOW_SAVE`
additionally requires that the pilot had been well above that height earlier in
the flight. Without those guards, every flight reports a low save at launch.

## Data model

TypeScript interfaces live in [`types.d.ts`](types.d.ts) — tooling only, since
there is no build step. `IGCPoint.timestamp` is **epoch milliseconds** (what
`Date.getTime()` returns), not seconds.

## Files

```
index.html          shell + all sheets
app.js              orchestration: one refresh path, one clock
app.css             dark glass over a full-viewport map
modules/
  igc.js            IGC parser (tolerant of real-world logger quirks)
  metrics.js        vario / heading / turn rate / glide, phase segmentation
  highlights.js     the four event detectors
  insights.js       day summary, climb-by-height, transitions, grading, XC score
  xcontest.js       XContest import adapter (see the caveat above)
  terrain.js        batched DEM lookup + AGL, cached in IndexedDB
  colors.js         colour ramps + legends
  map3d.js          MapLibre terrain + deck.gl track layers
  timeline.js       the master clock and both sync modes
  charts.js         canvas profile chart (static + per-frame overlay)
  exporter.js       MediaRecorder clips, PNG summary cards
  store.js          IndexedDB persistence
  demo.js           two synthetic flights, emitted as real IGC
  format.js         every number that reaches the screen
  resume.js         iOS PWA resume-hardening
```

## Development

```bash
python3 dev-server.py 8094 debrief-pwa
```

Or use the **Thermal Debrief** entry in `.claude/launch.json`. The service worker
deliberately does **not** register on `localhost` — it precaches every module by
name, so in development it would serve yesterday's code no matter how hard you
reload. Any worker a previous run installed is torn down instead.

### Ship checklist

Per the repo's [CLAUDE.md](../CLAUDE.md): bump `CACHE_VERSION` in `sw.js`, bump
the `?v=` on `app.js`/`app.css` in `index.html`, add any new module to the
service worker precache list, and run `scripts/check-deploy.sh` after merging.

## Flying days

Flights from different dates are **separated by default**. Loading a second
day adds a day selector to the dock, and only the selected day is on screen —
overlaying two days puts gliders in the air together that never were, and
stretches the UTC clock across the gap between them.

**All days** is the explicit opt-in when you do want to compare lines flown on
different days; sync switches to launch-relative automatically, because a UTC
clock spanning two dates is meaningless. Hiding a pilot and switching day are
tracked separately, so changing day doesn't forget that you hid someone.

## Importing other pilots' flights

Three routes in, none of which needs an API:

1. **Drop the files** — up to four at once, or "Open with Debrief" from a file
   manager where the browser supports it (Chrome/Edge desktop; iOS Safari uses
   the picker).
2. **Paste the file contents** (Flights → Import from a link → *…or paste the
   file contents*) — needs nothing at all: no key, no server, not even a
   connection. An IGC is plain ASCII, so it survives being copied out of a
   message or an email body, which is how one pilot actually sends another a
   track.
3. **Paste an IGC link** — any publicly served `.igc` URL: a club site, a
   competition results page, a league's own download button. The Worker fetches
   it and only returns content that parses as a flight log, so a login page or
   an HTML error comes back as a clear message rather than a broken import.

No flight database offers a usable search API, and this was checked rather than
assumed:

| Platform | API | robots.txt | Verdict |
|---|---|---|---|
| XContest | none public; partner API undocumented | disallows flight-search + `track.php` | ✗ |
| DHV-XC | excellent, keyless, CORS-open (`d[]=date`, `cc[]=country`, 1.98 M flights) | **`Disallow: /`** whole site | ✗ |
| WeGlide | exists, documented | allows all | 403s non-browser traffic, no CORS |
| SkyLines | open source, works | allows all | almost entirely sailplanes |

DHV-XC was the painful one — its API is genuinely excellent and would have done
exactly what was wanted, but a site-wide `Disallow: /` is a site-wide
`Disallow: /`, and it gets the same answer XContest got.

For comparing with friends, the **share link** is better than any of them: full
IGC fidelity, no third party, and it works in both directions.

## XContest import — read before relying on it

The UI (date → country → pick pilots), the Worker proxy, the download pipeline
and the error handling are all built and exercised. **The API contract is not.**

XContest publishes no open API. Their `robots.txt` explicitly disallows
`/world/en/flights-search/` — the exact date-and-country search this feature
wants — along with the `track.php` / `trackml.php` / `trackmz.php` download
endpoints. `/api/data/` rejects external callers with *"Invalid website"*, and
the flight list is rendered client-side. So scraping is both forbidden and
brittle, and this app does not do it.

What does exist is XContest's partner API on `api.xcontest.org`, which needs a
key. The host answers, but its request and response contracts are not publicly
documented, so `modules/xcontest.js` is written defensively rather than against a
spec that could be tested:

- `SEARCH_PATHS` lists candidate endpoints; the first returning JSON wins.
- `readFlights()` accepts any of the usual envelope shapes.
- `readFlight()` looks for pilot, distance and IGC link under conventional names.

**When you have a key and their docs, expect to adjust exactly two things:**
`SEARCH_PATHS` and `readFlight()`. Nothing else depends on the shape. If neither
matches, the UI says so and names the file to edit rather than failing silently.

Two deploy steps are required before it can work at all:

1. **Redeploy the Worker.** The `/xc` and `/xcigc` routes were added to
   `flight-card-pwa/cloudflare-worker/taf-proxy.js` but the live Worker still
   returns 404 for them — follow the redeploy steps in that file's header.
2. **Add your key** in Flights → Import from XContest → API key. It is stored on
   this device only (same pattern as the OpenAIP/Windy keys in Sky Monkeys) and
   forwarded per request; the Worker never stores it.

Both Worker routes are host-locked (`api.xcontest.org`, `www.xcontest.org`,
`xcontest.org`) so they cannot be repurposed as an open relay, and `/xcigc`
verifies the response actually contains B-records before returning it.

## Limitations

- Video export needs `MediaRecorder` with canvas capture. Where it is missing the
  button explains why and the PNG card still works.
- Recording captures the canvas in real time, so switching tabs mid-recording
  will stall the frames — the UI says so before you start.
- Ground elevation needs one network round trip per flight (2–5 requests). It is
  cached in IndexedDB, so a reload or a no-signal launch site costs nothing, but
  the first load of a brand-new flight offline will have no AGL.
- Metric units throughout (m, km, km/h, m/s) — no unit toggle.
