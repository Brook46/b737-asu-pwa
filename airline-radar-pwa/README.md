# Airline Radar

Live airline traffic on a map — a Flightradar24-shaped view of the sky that
shows **airline flights only**. No flight-school Cessnas, no bizjets, no
military transports, no helicopters: just the traffic that carries a flight
number.

Part of the b737-asu-pwa suite. Vanilla ES modules, no build step, no API key.

## What it shows

- Every airliner within the map view, as a rotated symbol coloured by altitude
  (grey on the ground → cyan climbing → green → amber → pink at cruise levels).
- Callsign + altitude labels, and a trail of where each aircraft has been since
  the app opened.
- A live list of the flights in view, nearest first, with airline, route and
  aircraft type.
- Tap any flight for the detail sheet: airline and flight number, origin →
  destination with progress and minutes to run, altitude, ground speed, IAS and
  Mach, track, selected altitude, QNH, wind aloft, OAT, squawk, registration,
  Mode-S address and an airframe photo where one exists.
- **Airline filter** (the funnel button): every operator in view, busiest first,
  with counts. Pick one or several; the choice persists and shows as a chip you
  can tap to clear.
- Emergency squawks (7500 / 7600 / 7700) are called out in red, in the list and
  at the top of the detail sheet.
- **Follow** keeps the map on the selected aircraft; **Show route** frames the
  whole city pair.

## Data sources — both keyless, both CORS-open

| What | Where | Why this one |
|---|---|---|
| Live positions | `api.airplanes.live/v2/point/…` | The only free community ADS-B aggregator that sends `Access-Control-Allow-Origin: *`, so the page can fetch it directly. `adsb.lol` and `opendata.adsb.fi` serve identical JSON but no CORS header — usable only behind a proxy, which this suite doesn't need. |
| Routes, airlines, airframes | `api.adsbdb.com/v0/…` | ADS-B carries no route: an aircraft broadcasts position and callsign, never its city pair. adsbdb maps callsign → airline + origin/destination, and hex/registration → type, owner and photo. |

Politeness: one position request per 5-second refresh (the feed's guidance is
max 1/s), and route lookups go through a single serial queue at ≤ 2/s, cached in
`localStorage` so a callsign is asked about once, not once per refresh.

## Arrival times: what is real and what isn't

Each flight shows an **ETA** and, where it can, an **STA**. They come from very
different places, and the UI labels them so they can't be confused:

- **ETA · ground speed** is computed here: great-circle distance still to fly,
  divided by the speed the aircraft is doing right now. No descent profile, no
  arrival routing, no wind change — so it runs a few minutes optimistic, and it
  says where it came from rather than pretending to be an airline's estimate.
- **STA** is *not* available. ADS-B carries position and callsign, never a
  schedule, and there is no free keyless schedule feed (adsbdb has routes but no
  times; the schedule APIs all want a key). So the app never invents one: the
  STA row shows "no schedule feed" unless somebody who knows it says so.

The one thing that does know it is the flight card, which has the duty roster.
When it opens this app it passes the leg's scheduled arrival in the link, the
STA row fills in, and the sheet shows the difference — *on schedule*, *12 min
late*, *8 min early*.

## Opening on one aircraft (deep links)

    airline-radar-pwa/?reg=4X-EKM
    airline-radar-pwa/?tail=EKM              # three letters ⇒ 4X-EKM
    airline-radar-pwa/?flight=ELY348
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
