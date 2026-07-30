# Airline Radar

Live airline traffic on a map — a Flightradar24-shaped view of the sky that
shows **airline flights only**. No flight-school Cessnas, no bizjets, no
military transports, no helicopters: just the traffic that carries a flight
number.

Part of the b737-asu-pwa suite. Vanilla ES modules, no build step, no API key.

## What it shows

- Every airliner within the map view, as a rotated symbol coloured by altitude
  (grey on the ground → cyan climbing → green → amber → pink at cruise levels).
- Each symbol is labelled with its **tail number**, altitude underneath — the
  registration names the aeroplane itself, which is what a crew recognises. The
  callsign stays in the list and on the detail card.
- A trail of where each aircraft has been since the app opened.
- **Runways**, once you're zoomed in past z12: drawn to scale with centreline
  markings, threshold numbers at the correct ends, and length in metres and
  feet. Tap one for width, surface and lighting.
- A live list of the flights in view, nearest first, with airline, route and
  aircraft type.
- Tap any flight for the detail sheet — headed by the **tail number**, with
  flight level and vertical speed beneath it: airline and flight number, origin →
  destination with progress and minutes to run, altitude, ground speed, IAS and
  Mach, track, selected altitude, QNH, wind aloft, OAT, squawk, registration,
  Mode-S address and an airframe photo where one exists.
- **Airline filter** (the funnel button): every operator in view, busiest first,
  with counts. Pick one or several; the choice persists and shows as a chip you
  can tap to clear.
- Emergency squawks (7500 / 7600 / 7700) are called out in red, in the list and
  at the top of the detail sheet.
- **Follow** keeps the map on the selected aircraft; **Show route** frames the
  whole city pair. Follow re-centres four times a second, so it stands down the
  moment you take the wheel — dragging the map, or asking for your own position
  with the Me button, both cancel it.
- Both panels **fold by dragging their top edge** up or down (or tapping it).
  There's no fold button: the gesture is the affordance.

## A card that doesn't move under your finger

The aircraft card refreshes every five seconds, and the first version rebuilt
its HTML each time. Rows for unknown values vanished and came back, the photo
arrived late, and the whole thing reflowed — text moved while you were reading
it and a tap could land on a button that had just shifted.

Now the card's structure is built once per aircraft and only its values are
patched in. The grid always carries the same fourteen rows in the same order,
showing "—" for anything unknown, so nothing can change height. A photo that
fails to load stays gone instead of returning on every refresh.

## Data sources — both keyless, both CORS-open

| What | Where | Why this one |
|---|---|---|
| Live positions | `api.airplanes.live/v2/point/…` | The only free community ADS-B aggregator that sends `Access-Control-Allow-Origin: *`, so the page can fetch it directly. `adsb.lol` and `opendata.adsb.fi` serve identical JSON but no CORS header — usable only behind a proxy, which this suite doesn't need. |
| Routes, airlines, airframes | `api.adsbdb.com/v0/…` | ADS-B carries no route: an aircraft broadcasts position and callsign, never its city pair. adsbdb maps callsign → airline + origin/destination, and hex/registration → type, owner and photo. |
| Runways | `overpass-api.de` (OpenStreetMap) | `aeroway=runway` ways carry geometry, `ref`, `length`, `width` and `surface`. Keyless and CORS-open. The public mirrors are no use: `overpass.osm.ch` is a Switzerland-only extract, the others were unreachable — so a 504 gets two backed-off retries and otherwise degrades to no runways. |

Politeness: one position request per 5-second refresh (the feed's guidance is
max 1/s), and route lookups go through a single serial queue at ≤ 2/s, cached in
`localStorage` so a callsign is asked about once, not once per refresh.

## Live, DR, or no feed

The badge in the corner says what the display is actually doing:

- **Live** — positions are current, refreshed every 5 s.
- **DR** — no new data has arrived, so the symbols are being *dead-reckoned*:
  flown on from their last fix at their last known ground speed and track.
  The picture keeps moving the right way through a dropped refresh or a lost
  signal, which is what you want, but it is not a position report — hence the
  name rather than a green "Live".
- **No feed** — 90 seconds without data. Extrapolating further would be
  invention, so the symbols stop where they were last actually known.

## Runways

Past zoom 12 the map draws the runways in view from OpenStreetMap. Two details
that are easy to get wrong and matter:

- **OSM splits a runway into several ways** wherever another runway or taxiway
  crosses it. Drawn naively that yields a "77 m runway" label mid-strip and
  threshold numbers repeated at every junction. Segments sharing a `ref` at the
  same airport are merged into one runway: its ends are the furthest-apart
  endpoints, and anything under 500 m is treated as a stub and skipped.
- **Threshold numbers must land on the right ends.** Runway 08 is the one you
  line up on heading ~080°, so its threshold is at the *west* end. The tagged
  numbers are matched against the bearing along the geometry rather than
  assumed in order. Verified against Ben Gurion: 03 south, 08 west, 12
  north-west, with 4,062 m / 3,112 m / 2,772 m matching the published figures.

Where a runway has no `ref`, the numbers are derived from its bearing and shown
in italics to mark them as computed rather than surveyed.

## Arrival times: what is real and what isn't

Each flight shows an **ETA** and, where it can, an **STA**. They come from very
different places, and the UI labels them so they can't be confused:

- **ETA · ground speed** is computed here: great-circle distance still to fly,
  divided by the speed the aircraft is doing right now. No descent profile, no
  arrival routing, no wind change — so it runs a few minutes optimistic, and it
  says where it came from rather than pretending to be an airline's estimate.
A clock time carries no date, so the STA's day is chosen against the *estimated
arrival*, not against the current moment — anchoring to "now" is what produced
deltas of several hours. If the two are still more than six hours apart the
scheduled time can't belong to this leg, and the card says so instead of
printing a confident-looking nonsense figure.

- **STA** is *not* available. ADS-B carries position and callsign, never a
  schedule, and there is no free keyless schedule feed (adsbdb has routes but no
  times; the schedule APIs all want a key). So the app never invents one: the
  STA row shows "no schedule feed" unless somebody who knows it says so.

The one thing that does know it is the flight card, which has the duty roster.
When it opens this app it passes the leg's scheduled arrival in the link, the
STA row fills in, and the sheet shows the difference — *on schedule*, *12 min
late*, *1h07 early*. A scheduled time belongs to one flight, so if a link names
several aircraft the STA is left off rather than pinned to the wrong one.

## Opening on one aircraft (deep links)

    airline-radar-pwa/?reg=4X-EKM
    airline-radar-pwa/?tail=EKM              # three letters ⇒ 4X-EKM
    airline-radar-pwa/?flight=ELY348
    airline-radar-pwa/?tail=EKM,EHH          # several, comma-separated
    airline-radar-pwa/?reg=4X-EKM&sta=21:15&from=roster

The app runs the query, finds the aircraft anywhere in the world, moves the map
to it and opens its card — once. If it isn't transmitting, it opens on the last
known position instead of an empty map.

This is how **Flight Card** hands over: its tail button (`doRadar()` in
`flight-card-pwa/app.js`) used to open Flightradar24 and now opens this, on the
tail from the card, with the roster's scheduled arrival attached.

## Search: filtering vs. finding

Searching a traffic display is two different jobs, and only one of them is
filtering:

1. **Filter what's on screen** — "show me the El Al flights in view". Instant,
   local, matches callsign, airline, type, registration and route airports.
2. **Find one aeroplane** — "where is EKM right now?" — which has nothing to do
   with where the map happens to be pointed. When the query names a specific
   aircraft, the app also asks the feed's global `/v2/reg/` and `/v2/callsign/`
   endpoints, and if it's airborne anywhere in the world it appears on the map
   (and the map moves to it, once, when it's off-screen).

**Several aircraft at once.** Terms stack like addresses on an email: type one,
press Enter (or a comma), and it becomes a chip; type the next. Each chip is
searched for in its own right — its own global lookup — and the results are the
union, so you can watch six aeroplanes at the same time. Backspace in an empty
box takes the last one back off, and each chip has an ✕.

Naming an aircraft outranks the airline filter. If you've filtered to El Al and
then search a tail belonging to someone else, you get that aircraft: you asked
for it by name, so hiding it would just look like the search was broken.

**Three-letter shorthand.** A 737 fleet is talked about by the last three
letters of the tail — "EKM", "EHH", "EDL" — so a bare three-letter query is read
as `4X-EKM` by default (`HOME_PREFIX` in `modules/search.js`), on top of the
ordinary text match. Typing `ELY` still finds El Al, because both readings are
applied.

If nothing matches, the app says which reading it used rather than showing an
empty list with no explanation.

## Aircraft that stop transmitting

`modules/history.js` remembers where every aircraft was last seen, for 24 hours,
in `localStorage`. Search finds those too — so looking for a tail that has gone
quiet shows its last known position, dimmed, inside a dashed ring, labelled with
how long ago that was. It is drawn hollow and never dead-reckoned forward: it is
a memory, not a contact.

Calling something a *lost contact* is the delicate part, because a missing
record usually means nothing at all — aggregated ADS-B is stitched from
volunteer receivers, so in a busy area the returned set breathes by dozens of
aircraft between polls, and panning the map changes the question. Three filters
before the app will say it:

- missing from **3 consecutive** polls;
- the polls must cover the **same patch of sky** it was last seen in;
- and if more than **35%** of the previous snapshot vanishes at once, that's the
  feed hiccupping or the map moving — nobody switched off a transponder.

An aircraft near the edge of the query circle, or one that was on the ground, is
remembered but never flagged as having gone dark: it flew out of the area, or it
landed. Without these guards a single pan across Europe reports ~300 aircraft as
having gone dark, which is what the first cut of this feature did.

## The airline filter

`modules/airlines.js` is the whole point of the app. An aircraft reaches the map
only if:

1. it has an ICAO flight-number callsign — three letters plus digits (`ELY5412`,
   not `4X-EKI`, and not blank);
2. its operator code isn't on the bizjet/military exclusion list (`NJE`, `RCH`,
   `RRR`, …) — those fly airline-shaped callsigns in airliner-sized aircraft;
3. **and** either the operator is in the local airline table, or the aircraft
   itself is an airliner (known airliner type code, or ADS-B category A3/A4/A5).

Rule 3 is what keeps coverage honest: a carrier missing from the table still
gets on the map on the strength of its aircraft, and `routes.js` fills in the
airline's real name from adsbdb a moment later. The table only has to be good,
not complete.

Measured against a live 200 NM snapshot over Israel: 53 of 64 targets passed;
the 11 rejected were two AT-802 firefighters, a Learjet, an Embraer Legacy, two
helicopters, a C208, a PA-31, and airframes squawking with no callsign at all.

## Development

```bash
python3 dev-server.py 8098 airline-radar-pwa
```

(or the "Airline Radar" entry in `.claude/launch.json`). The service worker
deliberately does **not** register on `localhost` — a cache-first worker in
front of the dev server hands back stale modules and you end up debugging code
that isn't running.

## Shipping

Per the suite checklist: bump `CACHE_VERSION` in `sw.js`, bump the `?v=` on
`app.js` / `app.css` in `index.html`, add any new module to the worker's
precache list, and run `scripts/check-deploy.sh` after merging to `main`.

## Known limits

- **Coverage is receiver coverage.** ADS-B aggregation is volunteer-fed, so
  mid-ocean and parts of Africa and Asia are thin. Nothing on the map is a lie;
  the gaps are just gaps.
- **No route on file** is normal for charters, ferry and repositioning flights —
  adsbdb only knows scheduled city pairs.
- The API caps a query at 250 NM; zoomed out beyond that, the app says so rather
  than pretending the edges are empty.
