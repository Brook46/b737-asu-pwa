#!/bin/bash
# ---------------------------------------------------------------------------
# Install (or re-install) the Social notes sync on this Mac.
#
#   bash install-social-sync.sh <token>     first install
#   bash install-social-sync.sh             re-install, keeping the saved token
#
# What it sets up:
#   ~/.config/flightcard/social.env   the feed token, readable only by you
#   ~/Library/LaunchAgents/com.alonbrookstein.flightcard.social.plist
#       runs social-notes-sync.sh at login and every 2 hours after. If the Mac
#       is asleep, it runs on wake. It only uploads when a note changed.
#   ~/Library/Logs/FlightCard/social-sync.log   one line per run
#
# The token is the UUID in Flight Card → Settings → Social notes:
#   https://b737-asu-pwa.alonbrookstein.workers.dev/social/<TOKEN>.json
#
# Uninstall:
#   launchctl bootout gui/$(id -u)/com.alonbrookstein.flightcard.social
#   rm ~/Library/LaunchAgents/com.alonbrookstein.flightcard.social.plist
# ---------------------------------------------------------------------------
set -euo pipefail

LABEL="com.alonbrookstein.flightcard.social"
HERE="$(cd "$(dirname "$0")" && pwd)"
CONF_DIR="$HOME/.config/flightcard"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs/FlightCard"

mkdir -p "$CONF_DIR" "$LOG_DIR" "$HOME/Library/LaunchAgents"
chmod 700 "$CONF_DIR"

if [[ -n "${1:-}" ]]; then
  if ! [[ "$1" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]]; then
    echo "That isn't a token — expected a UUID like 1b4e28ba-2fa1-11d2-883f-0016d3cca427" >&2
    exit 1
  fi
  ( umask 077; printf 'FC_SOCIAL_TOKEN=%s\n' "$(echo "$1" | tr 'A-F' 'a-f')" > "$CONF_DIR/social.env" )
elif [[ ! -f "$CONF_DIR/social.env" ]]; then
  echo "First install needs the token:  bash install-social-sync.sh <token>" >&2
  exit 1
fi
chmod 600 "$CONF_DIR/social.env"

# The plist is generated, not copied, so it always points at wherever this
# folder actually lives (the repo path has a space in it).
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$HERE/social-notes-sync.sh</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>7200</integer>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/social-sync.out</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/social-sync.err</string>
</dict>
</plist>
PLIST
plutil -lint "$PLIST" >/dev/null

# Replace any running copy, then start it.
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installed: runs at login and every 2 hours. Log: $LOG_DIR/social-sync.log"
