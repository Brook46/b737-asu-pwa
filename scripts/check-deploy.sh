#!/usr/bin/env bash
# Post-deploy health check for all PWAs on GitHub Pages + the Cloudflare worker.
# Usage: scripts/check-deploy.sh
# Exits 0 if every endpoint returns 200, 1 otherwise.

set -u
BASE="https://brook46.github.io/b737-asu-pwa"
WORKER="https://b737-asu-pwa.alonbrookstein.workers.dev"
FAIL=0

check() {
  local label="$1" url="$2" code
  code=$(curl -sS -m 20 -o /dev/null -w "%{http_code}" "$url" 2>/dev/null)
  if [ "$code" = "200" ]; then
    printf 'PASS  %-3s  %s\n' "$code" "$label"
  else
    printf 'FAIL  %-3s  %s  (%s)\n' "${code:-ERR}" "$label" "$url"
    FAIL=1
  fi
}

echo "== ASU (root) =="
check "index"          "$BASE/"
check "app.js"         "$BASE/app.js"
check "sw.js"          "$BASE/sw.js"
check "qrh-800.json"   "$BASE/data/qrh-800.json"

echo "== Sub-apps =="
check "flight-card index"  "$BASE/flight-card-pwa/"
check "flight-card app.js" "$BASE/flight-card-pwa/app.js"
check "flight-card sw.js"  "$BASE/flight-card-pwa/sw.js"
check "duty-cal index"     "$BASE/duty-cal-pwa/"
check "duty-cal app.js"    "$BASE/duty-cal-pwa/app.js"
check "duty-cal kinds.js"  "$BASE/duty-cal-pwa/kinds.js"
check "duty-cal sw.js"     "$BASE/duty-cal-pwa/sw.js"
check "swap index"         "$BASE/swap-pwa/"
check "swap swap.js"       "$BASE/swap-pwa/swap.js"
check "swap roster.js"     "$BASE/swap-pwa/roster.js"
check "swap sw.js"         "$BASE/swap-pwa/sw.js"
check "gpws index"         "$BASE/gpws-pwa/"
check "pdf-knowledge index" "$BASE/pdf-knowledge-pwa/"
check "pdf-knowledge sw.js" "$BASE/pdf-knowledge-pwa/sw.js"
check "thermals index"     "$BASE/thermals-pwa/"
check "xcsky index"        "$BASE/xcsky-pwa/"
check "xcsky app.js"       "$BASE/xcsky-pwa/app.js"
check "xcsky sw.js"        "$BASE/xcsky-pwa/sw.js"
check "debrief index"      "$BASE/debrief-pwa/"
check "debrief app.js"     "$BASE/debrief-pwa/app.js"
check "debrief sw.js"      "$BASE/debrief-pwa/sw.js"
check "debrief igc.js"     "$BASE/debrief-pwa/modules/igc.js"
check "debrief map3d.js"   "$BASE/debrief-pwa/modules/map3d.js"
check "debrief timeline.js" "$BASE/debrief-pwa/modules/timeline.js"

echo "== Cloudflare worker =="
check "worker /healthz"    "$WORKER/healthz"
check "worker /taf KJFK"   "$WORKER/taf?icao=KJFK"

if [ "$FAIL" = "0" ]; then
  echo "ALL CHECKS PASSED"
else
  echo "SOME CHECKS FAILED"
fi
exit "$FAIL"
