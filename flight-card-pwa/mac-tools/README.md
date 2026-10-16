# Social notes sync (Mac)

Apple Notes folder **AIRPORTS B** → Flight Card's per-airport **Social** tab.

Apple Notes has no API, so the Mac reads the folder (edits made on the
iPad/iPhone arrive through iCloud) and publishes it to the worker feed the
app reads. No iOS Shortcut involved — that route never produced a working
sync.

| file | what it does |
|---|---|
| `install-social-sync.sh` | one-time setup: token file + launchd agent |
| `social-notes-sync.sh` | one run: read → convert → upload if changed |
| `read-notes.js` | JXA: the folder's notes as `[{title, html}]` (read-only) |
| `notes-to-feed.py` | titles → IATA keys, Apple HTML → clean plain text |

```bash
bash install-social-sync.sh <token>   # first time; token = UUID in the app's feed URL
bash social-notes-sync.sh --dry-run   # what would be sent
bash social-notes-sync.sh --force     # push now even if unchanged
tail ~/Library/Logs/FlightCard/social-sync.log
```

Runs at login and at 5 past every even hour; if the Mac slept through one
of those times it runs once on wake. (Clock times, deliberately: an
"every 2 hours" interval counts awake time only, and on a Mac that mostly
sleeps it ran once in 11.5 hours.) Uploads only when a note changed.

**Read-only by construction.** `read-notes.js` is the only thing that talks
to Notes, and it only reads titles and text. Verified across a full forced
sync: all 51 notes' modification times and contents unchanged. Nothing in
Flight Card writes to Notes either — the app only downloads the feed, and
highlights live in the app's own storage on that device. The token lives in `~/.config/flightcard/social.env`
(mode 600), never in this repo.

Titles are matched by their leading codes (`LFMN  NCE  ניס…`). Each note is
keyed by IATA — the code the roster and the app use — translating ICAO
through `b737-systems-pwa/data/navdb.json`, so ICAO-only titles and typos
(`HESH SHM` → `SSH`) still land. A prose title naming one code
(`תהליך De ice ב-JFK`) is appended to that airport; titles naming none
(`פורמט שדה`) are skipped and logged.
