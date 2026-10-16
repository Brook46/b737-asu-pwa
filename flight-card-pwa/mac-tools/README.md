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

Runs at login and every 2 hours (on wake if the Mac was asleep); uploads
only when a note changed. The token lives in `~/.config/flightcard/social.env`
(mode 600), never in this repo.

Titles are matched by their leading codes (`LFMN  NCE  ניס…`). Each note is
keyed by IATA — the code the roster and the app use — translating ICAO
through `b737-systems-pwa/data/navdb.json`, so ICAO-only titles and typos
(`HESH SHM` → `SSH`) still land. A prose title naming one code
(`תהליך De ice ב-JFK`) is appended to that airport; titles naming none
(`פורמט שדה`) are skipped and logged.
