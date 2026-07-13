# Flight Card — Social notes: weekly Mac → PWA sync

Push your per-airport notes from **Apple Notes on your Mac** to the Flight
Card **Social** tab, automatically, once a week. The PWA can't read your Mac
(sandboxing) — this little script on your Mac is the bridge. It only *reads*
your notes; it never edits or deletes them.

## How it flows

```
Apple Notes  →  social-notes-sync.sh  →  Cloudflare worker (/social/<token>)  →  PWA pulls weekly
 (your Mac)      (reads + POSTs JSON)      (stores in KV)                         (Social tab)
```

## One-time setup

1. **Pick a token** (any UUID):
   ```sh
   uuidgen | tr 'A-Z' 'a-z'
   ```
2. **Put it in the script** — edit `FC_SOCIAL_TOKEN` at the top of
   `social-notes-sync.sh` (or `export FC_SOCIAL_TOKEN=…`).
3. **Point the PWA at the feed** — Flight Card → Settings → *Social notes*,
   paste (same token):
   ```
   https://b737-asu-pwa.alonbrookstein.workers.dev/social/<TOKEN>.json
   ```
4. **Test it**:
   ```sh
   bash social-notes-sync.sh
   ```
   macOS will ask once to let the script read Notes — allow it. You should
   see `Worker: {"ok":true,"airports":N}`.
5. **Schedule it weekly** — edit `social-notes-sync.plist` (paths + token),
   then:
   ```sh
   cp social-notes-sync.plist ~/Library/LaunchAgents/com.alonbrookstein.flightcard.social.plist
   launchctl load ~/Library/LaunchAgents/com.alonbrookstein.flightcard.social.plist
   ```
   Runs every Monday 08:00 (change in the plist). Logs to `/tmp/fc-social-sync.log`.

## Notes convention

One note per airport, **titled by code** (IATA or ICAO):

```
TLV            LLBG           TLV / LLBG        CDG - Paris
```

The first 3–4-letter code in the title is the key; the note body is the
value. Titles that aren't codes (e.g. "Shopping list") are ignored. Both
IATA and ICAO work — the PWA stores each note under both so it matches
whichever code your flights use.
