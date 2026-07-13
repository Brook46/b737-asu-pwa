#!/bin/bash
# ---------------------------------------------------------------------------
# Flight Card — Social notes weekly sync (runs on YOUR Mac)
#
# Reads your Apple Notes titled by airport code (TLV, LLBG, "TLV / LLBG", …),
# turns them into a JSON map { "TLV": "…", "LLBG": "…" }, and POSTs them to
# the Flight Card worker. The PWA then pulls that feed and fills each
# airport's "Social" tab.
#
# The PWA never reads your Mac — this script is the bridge. It only READS
# your notes (never writes/deletes) and only sends the ones whose title
# looks like an airport code.
#
# ── SETUP (once) ──────────────────────────────────────────────────────────
# 1. Pick a secret token (any UUID). Generate one with:  uuidgen | tr A-Z a-z
# 2. Put it in FC_SOCIAL_TOKEN below (or export it in your shell).
# 3. In Flight Card → Settings → Social notes, paste this feed URL
#    (SAME token):
#      https://b737-asu-pwa.alonbrookstein.workers.dev/social/<TOKEN>.json
# 4. Run it once to test:   bash social-notes-sync.sh
#    The first run pops a macOS prompt to allow Terminal to read Notes — allow it.
# 5. Schedule it weekly — see social-notes-sync.plist in this folder.
#
# ── NOTES CONVENTION ──────────────────────────────────────────────────────
# One note per airport, titled with the code. Accepted title shapes:
#   TLV            LLBG           TLV / LLBG        CDG - Paris
# The first 3–4 letter code in the title becomes the key; the note body is
# the value. Notes whose title isn't a code are ignored.
# ---------------------------------------------------------------------------

set -euo pipefail

WORKER_BASE="${FC_WORKER_BASE:-https://b737-asu-pwa.alonbrookstein.workers.dev}"
FC_SOCIAL_TOKEN="${FC_SOCIAL_TOKEN:-PUT-YOUR-UUID-HERE}"
# Optional: restrict to one Notes folder (leave empty to scan all notes).
FC_NOTES_FOLDER="${FC_NOTES_FOLDER:-}"

if [[ "$FC_SOCIAL_TOKEN" == "PUT-YOUR-UUID-HERE" ]]; then
  echo "Set FC_SOCIAL_TOKEN first (edit this file or export it). Generate one with: uuidgen | tr A-Z a-z" >&2
  exit 1
fi

# 1) Dump notes as records. Field separator = US (\x1f), record sep = RS (\x1e).
#    AppleScript reads title + plaintext body for each note.
read -r -d '' OSA <<'APPLESCRIPT' || true
on joinList(theList, delim)
  set AppleScript's text item delimiters to delim
  set s to theList as text
  set AppleScript's text item delimiters to ""
  return s
end joinList

set US to (ASCII character 31)
set RS to (ASCII character 30)
set outRecords to {}
set folderName to (system attribute "FC_NOTES_FOLDER")

tell application "Notes"
  if folderName is not "" then
    try
      set src to notes of folder folderName
    on error
      set src to notes
    end try
  else
    set src to notes
  end if
  repeat with n in src
    set t to name of n
    set b to plaintext of n
    set end of outRecords to (t & US & b)
  end repeat
end tell

return my joinList(outRecords, RS)
APPLESCRIPT

RAW="$(FC_NOTES_FOLDER="$FC_NOTES_FOLDER" osascript -e "$OSA")"

# 2) Convert the record stream → JSON { CODE: body } with python3.
JSON="$(RAW="$RAW" python3 - <<'PY'
import os, json, re
raw = os.environ.get("RAW", "")
US, RS = "\x1f", "\x1e"
out = {}
# The title must START with a 3–4 letter code, followed by end-of-title or a
# separator ( space / · - ). This ignores prose titles like "Shopping list".
code_re = re.compile(r'^([A-Za-z]{3,4})(?=$|[\s/·\-])')
for rec in raw.split(RS):
    if US not in rec:
        continue
    title, body = rec.split(US, 1)
    title = title.strip()
    body = body.strip()
    if not title or not body:
        continue
    m = code_re.match(title)
    if not m:
        continue
    out[m.group(1).upper()] = body
print(json.dumps(out, ensure_ascii=False))
PY
)"

COUNT="$(echo "$JSON" | python3 -c 'import sys,json; print(len(json.load(sys.stdin)))')"
echo "Collected $COUNT airport note(s)."

# 3) POST to the worker.
RESP="$(printf '%s' "$JSON" | curl -sS -X POST \
  -H 'content-type: application/json' \
  --data-binary @- \
  "$WORKER_BASE/social/$FC_SOCIAL_TOKEN")"

echo "Worker: $RESP"
