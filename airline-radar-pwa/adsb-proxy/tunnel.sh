#!/usr/bin/env bash
# Run the ADS-B proxy on this machine and publish it through a Cloudflare quick
# tunnel.
#
# Why this exists: airplanes.live withdrew its free API, and the mirrors that
# replaced it (adsb.lol, adsb.fi) send no CORS header, so the page can't read
# them directly — something has to ask on its behalf. A Cloudflare *Worker*
# can't: adsb.fi refuses Worker subrequests at the edge and adsb.lol rate-limits
# the address every Worker shares. Asked from an ordinary domestic connection,
# both answer 200.
#
# Note what the tunnel is and isn't doing. It carries traffic *inbound* to this
# machine; the request out to the mirrors still leaves from this connection.
# That's the entire trick — same company, opposite direction.
#
# (localhost.run was tried first and served exactly one request before going
# quiet, which is why this uses cloudflared instead.)
#
#   ./tunnel.sh          # prints the public URL, then stays in the foreground
#   Ctrl-C               # stops both the tunnel and the proxy
#
# It is a stopgap and should feel like one: it answers only while this machine
# is awake, and the tunnel hands out a new hostname every restart — which then
# has to go into TUNNEL_PROXY in ../modules/adsb.js and be shipped. The
# permanent version is the same main.ts on Deno Deploy, needing neither a
# laptop nor a rotating name.
#
# Nothing is exposed but the four ADS-B routes in main.ts, which accept only
# numbers and identifiers they re-validate. Still: this publishes a service from
# this machine to the internet, so don't leave it up longer than it's useful.

set -euo pipefail
cd "$(dirname "$0")"

DENO="${DENO:-$HOME/.deno/bin/deno}"
CLOUDFLARED="${CLOUDFLARED:-$HOME/.local/bin/cloudflared}"
PORT="${PORT:-8000}"

[ -x "$DENO" ] || { echo "deno not found at $DENO — set DENO=/path/to/deno" >&2; exit 1; }
[ -x "$CLOUDFLARED" ] || {
  echo "cloudflared not found at $CLOUDFLARED." >&2
  echo "Get it from https://github.com/cloudflare/cloudflared/releases (darwin-arm64.tgz)." >&2
  exit 1; }

cleanup() { [ -n "${PROXY_PID:-}" ] && kill "$PROXY_PID" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

echo "starting proxy on :$PORT"
DENO_SERVE_PORT="$PORT" "$DENO" run --allow-net main.ts &
PROXY_PID=$!

# Make sure it actually came up before publishing it to the internet.
for _ in $(seq 1 20); do
  sleep 0.5
  curl -fsS -m 2 "http://localhost:$PORT/healthz" >/dev/null 2>&1 && break
done
curl -fsS -m 3 "http://localhost:$PORT/healthz" >/dev/null || {
  echo "proxy failed to start — see the output above" >&2; exit 1; }

echo
echo "opening tunnel — look for the https://….trycloudflare.com line below."
echo "Paste it into TUNNEL_PROXY in ../modules/adsb.js (keep the /adsb suffix),"
echo "then: node ../../scripts/stamp-version.mjs airline-radar-pwa <next-version>"
echo
exec "$CLOUDFLARED" tunnel --url "http://localhost:$PORT" --no-autoupdate
