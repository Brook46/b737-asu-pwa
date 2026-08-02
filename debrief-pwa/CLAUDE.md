# Thermal Debrief — app notes

"Thermal Debrief": post-flight IGC analysis. Replays `.igc` logs in 3D over real terrain (MapLibre GL JS + AWS Terrain Tiles DEM, deck.gl track layers interleaved so ridges occlude tracks), 2–4 flights at once on one master clock with Absolute (UTC) or Relative (launch-aligned) sync, automatic highlight detection (best climb / low save / fast glide / heavy sink), an Insights panel (day summary, climb-by-altitude-band, transitions, A+–E scorecard + 0–100 XC score, head-to-head), XCTSK competition-task overlay with cylinder tagging (tools.xcontest.org — keyless and CORS-open, the one usable XContest API), and export of MediaRecorder replay clips + PNG stat cards. Keyless like xcsky, except the optional XContest import.

**XContest import is unverified** — they publish no open API (robots.txt disallows the flight-search and track endpoints), so `modules/xcontest.js` targets their partner API defensively; adjusting `SEARCH_PATHS` + `readFlight()` there is the only client change needed once real docs exist, and the worker's `/xc` + `/xcigc` routes need a manual redeploy before it works at all.

`types.d.ts` holds the data model for tooling only — there's no build step, so it never ships.

**AGL caveat:** the DEM is 90 m, so ridge soaring and every landing read as 0 m AGL; `metrics.lowestAglInFlight()` and the `LOW_SAVE` detector both guard against this, and changing those guards will make every flight report a bogus save at launch.
