#!/bin/bash
# ---------------------------------------------------------------------------
# Flight Card — Social notes sync (runs on the pilot's Mac, every 2 hours)
#
# Apple Notes folder "AIRPORTS B"  →  Flight Card's per-airport Social tab.
#
# Why the Mac and not an iOS Shortcut: Apple Notes has no API, so something
# signed in to the same iCloud has to read it. A Shortcut can, but building
# one by hand on the iPad never produced a working sync (the live feed held a
# single 5-character test note). The Mac reads Notes directly, needs no
# Shortcuts at all, and gets every iPad/iPhone edit through iCloud anyway.
#
# It only READS notes — never writes, moves or deletes one.
#
# Setup (done once — install-social-sync.sh does all of it):
#   ~/.config/flightcard/social.env   FC_SOCIAL_TOKEN=<uuid>   (chmod 600)
#   ~/Library/LaunchAgents/com.alonbrookstein.flightcard.social.plist
#
# Usage:  social-notes-sync.sh            push if anything changed
#         social-notes-sync.sh --force    push even if nothing changed
#         social-notes-sync.sh --dry-run  show what would be sent, send nothing
#
# Note convention, read off the real folder: the title is the airport codes
# then the city, e.g.  "LFMN     NCE        ניס קוט דה אזור"  or
# "EIDW.  DUB   Dublin    דבלין". EVERY leading code is used as a key, so a
# note reaches the app under both its ICAO and IATA codes — the app looks
# legs up by IATA, and airports missing from its own table (Nice, Paphos,
# Batumi, Rhodes…) could otherwise never be matched from the ICAO alone.
# A note whose title isn't codes-first ("תהליך De ice ב-JFK") is attached to
# the one airport code its title names, as an extra section. Titles naming
# no code (the "פורמט שדה" template) are skipped.
# ---------------------------------------------------------------------------

set -euo pipefail

MODE="${1:-}"
CONF_DIR="$HOME/.config/flightcard"
LOG_DIR="$HOME/Library/Logs/FlightCard"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/social-sync.log"
log() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG"; }

# The token is a secret (anyone holding it can overwrite the feed), so it
# lives in a 600 file outside the repo rather than in this script or the plist.
if [[ -f "$CONF_DIR/social.env" ]]; then
  # shellcheck disable=SC1091
  source "$CONF_DIR/social.env"
fi
WORKER_BASE="${FC_WORKER_BASE:-https://b737-asu-pwa.alonbrookstein.workers.dev}"
FOLDER="${FC_NOTES_FOLDER:-AIRPORTS B}"
if [[ -z "${FC_SOCIAL_TOKEN:-}" ]]; then
  log "ERROR: no FC_SOCIAL_TOKEN in $CONF_DIR/social.env — run install-social-sync.sh"
  exit 1
fi

# Data moves between steps through files, not shell variables: the notes come
# out of Notes as HTML in the hundreds of KB, past what macOS will hand a
# program through its environment ("Argument list too long").
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
HERE="$(cd "$(dirname "$0")" && pwd)"

# 1) Read the folder with JavaScript for Automation: title + HTML body per
#    note, straight out as JSON. The HTML is what keeps bold, underline and
#    colours — the old script read plaintext.
if ! FC_FOLDER="$FOLDER" osascript -l JavaScript "$HERE/read-notes.js" > "$TMP/notes.json" 2>>"$LOG"; then
  log "ERROR: couldn't read Notes. If macOS asked whether this may control Notes, allow it; see $LOG"
  exit 1
fi
if [[ ! -s "$TMP/notes.json" ]]; then
  log "ERROR: reading Notes returned nothing"
  exit 1
fi

# 2) Titles → codes, Apple's HTML → the subset Flight Card renders.
if ! python3 "$HERE/notes-to-feed.py" "$TMP/notes.json" > "$TMP/payload.json" 2>>"$LOG"; then
  log "ERROR: converting the notes failed; see $LOG"
  exit 1
fi

COUNT="$(python3 -c 'import sys,json; print(len(json.load(open(sys.argv[1]))["notes"]))' "$TMP/payload.json")"
SKIPPED="$(python3 -c 'import sys,json; print("; ".join(json.load(open(sys.argv[1]))["skipped"]) or "none")' "$TMP/payload.json")"
python3 -c 'import sys,json; sys.stdout.write(json.dumps(json.load(open(sys.argv[1]))["notes"], ensure_ascii=False, sort_keys=True))' \
  "$TMP/payload.json" > "$TMP/body.json"

if [[ "$MODE" == "--dry-run" ]]; then
  python3 -c '
import sys, json
d = json.load(open(sys.argv[1]))
print("keys:", len(d), "| bytes:", len(open(sys.argv[1], "rb").read()))
print("codes:", " ".join(sorted(d)))
' "$TMP/body.json"
  echo "skipped: $SKIPPED"
  exit 0
fi

# 3) Only push when something changed. Runs every 2 hours; without this each
#    run would rewrite the feed for nothing.
HASH="$(shasum -a 256 < "$TMP/body.json" | cut -c1-16)"
LAST="$(cat "$CONF_DIR/social.lasthash" 2>/dev/null || true)"
if [[ "$HASH" == "$LAST" && "$MODE" != "--force" ]]; then
  log "No change ($COUNT airport keys) — nothing sent."
  exit 0
fi

# 4) Replace the whole feed in one write. The bare route is authoritative: it
#    also drops the per-note keys the iOS Shortcut wrote, so a note deleted
#    from the folder disappears from the app too.
if ! RESP="$(curl -sS --max-time 30 -X POST \
      -H 'content-type: application/json; charset=utf-8' \
      --data-binary @"$TMP/body.json" \
      "$WORKER_BASE/social/$FC_SOCIAL_TOKEN" 2>&1)"; then
  log "ERROR: upload failed (offline?) — will retry next run: $RESP"
  exit 1
fi

if printf '%s' "$RESP" | grep -q '"ok":true'; then
  printf '%s' "$HASH" > "$CONF_DIR/social.lasthash"
  log "Pushed $COUNT airport keys. Skipped: $SKIPPED. Worker: $RESP"
else
  log "ERROR: worker said: $RESP"
  exit 1
fi
