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
check "gpws index"         "$BASE/gpws-pwa/"
check "pdf-knowledge index" "$BASE/pdf-knowledge-pwa/"
check "pdf-knowledge sw.js" "$BASE/pdf-knowledge-pwa/sw.js"
check "thermals index"     "$BASE/thermals-pwa/"

echo "== Cloudflare worker =="
check "worker /healthz"    "$WORKER/healthz"
check "worker /taf KJFK"   "$WORKER/taf?icao=KJFK"

if [ "$FAIL" = "0" ]; then
  echo "ALL CHECKS PASSED"
else
  echo "SOME CHECKS FAILED"
fi
exit "$FAIL"
