# Airline Radar — app notes

"Airline Radar": live airline traffic on a map, Flightradar24-shaped but **airliners only**. Keyless like xcsky: positions from `api.airplanes.live` (the one free ADS-B aggregator that sends `Access-Control-Allow-Origin: *` — `adsb.lol`/`adsb.fi` serve the same JSON but no CORS header, so they'd need a proxy), routes/airlines/airframe photos from `api.adsbdb.com`, runways from OpenStreetMap via `overpass-api.de`.

`modules/airlines.js` sorts every record into a **kind** (airline / military / heli / bizjet / light) and the Filter sheet decides which layers are drawn — airlines alone by default. Order matters: an aircraft is judged on what it *is* (category A7, military type) before what its callsign looks like, or a C-17 on a `RCH` callsign reads as a scheduled flight. Airline traffic needs an ICAO flight-number callsign that isn't just the registration, from a known airline **or** on an airliner-sized airframe; one exception, an airliner-sized airframe with no usable callsign is still filed as an airline (unidentified), because putting an A350 under "light & private" is worse than leaving its operator blank. Widen the airline table freely; loosening the callsign or exclusion rules is what floods the airline layer with GA.

Selecting an aircraft draws its **flown track** (altitude-coloured, from the app's own recorded positions) instead of a straight line from the origin. There is no track-history feed to use: `globe.airplanes.live`/`globe.adsb.fi` trace files are Cloudflare-blocked with no CORS, adsb.lol redirects, OpenSky needs OAuth — so the track only ever covers what the app watched, the gap back to the departure airport is drawn faint and dashed, and the card says the span in words. Don't replace that dashed gap with a confident line.

Routes from adsbdb are keyed on callsign alone and callsigns get reused, so `routeSanity()` (routes.js) checks the claimed destination against the aircraft's own track and position and flags a contradiction instead of stating a wrong destination confidently. Its thresholds are deliberately loose (>10,000 ft, >40 NM, >100° off the nose) because departures turn and arrivals manoeuvre — tightening them will flag every SID and every hold.

Search is two things at once (`modules/search.js`): a local filter, *and* a global lookup against the feed's `/v2/reg/` + `/v2/callsign/` endpoints so a named aircraft is found anywhere in the world — plus a bare three-letter query means a `4X-` tail (fleet shorthand; `HOME_PREFIX`). Terms stack like email recipients, and naming an aircraft outranks the airline filter.

`modules/history.js` remembers last-known positions for 24 h so a tail that stopped transmitting is still findable; it only calls something a *lost contact* after 3 consecutive misses in the same area, never on a mass disappearance (>35% at once = feed hiccup or map move) and never near the query-circle edge or on the ground — relaxing those guards makes it report hundreds of bogus "went dark" aircraft on every pan.

Deep links (`?reg=` / `?tail=` / `?flight=`, plus `?sta=&from=`) open the app straight onto one aircraft — **flight-card-pwa's tail button (`doRadar()`) is the caller**, replacing its old Flightradar24 link, and it passes the roster's scheduled arrival because ADS-B has no schedule and no keyless schedule feed exists: ETA is computed from ground speed, STA is only ever shown when handed in, and it's anchored to the ETA so the day is chosen correctly.

`modules/runways.js`: OSM splits a runway into separate ways at every crossing, so same-`ref` segments are merged and stubs under 500 m dropped; threshold numbers are matched against the bearing along the geometry (runway 08 is the *west* end), never assumed in order.

The detail card is built once per aircraft and patched in place — rebuilding its HTML every refresh made it reflow under the reader's finger. The SW deliberately doesn't register on localhost (cache-first + dev-server = debugging stale modules).

See `README.md` in this directory for the full feature and data-source rundown.
