# Flight Card — native iOS shell

A thin native wrapper around the hosted Flight Card PWA. Adds background GPS
(takeoff/landing detection keeps running while the app is backgrounded during
a flight), CoreMotion touchdown-G, and immunity to the iOS Safari PWA
suspension bug. The web app stays the single source of truth — this is just
a `WKWebView` + a CoreLocation/CoreMotion → JS bridge.

Verified: `xcodebuild ... build` → BUILD SUCCEEDED; launches in the iOS 26
simulator and loads the live PWA.

## Install on your own iPhone/iPad (free Apple ID)

1. Open `FlightCard.xcodeproj` in Xcode.
2. Select the **FlightCard** target → **Signing & Capabilities**:
   - Check **Automatically manage signing**.
   - **Team** → add / pick your Apple ID (free is fine).
   - If it complains the bundle ID is taken, change
     `PRODUCT_BUNDLE_IDENTIFIER` (e.g. `com.<yourname>.flightcard2`).
3. Plug in the device, pick it as the run destination, press **▶ (Cmd-R)**.
4. On the device once: **Settings → General → VPN & Device Management →**
   trust your developer certificate.
5. First launch: accept the Location prompt. Choose **"While Using"**; the
   `location` background mode + `allowsBackgroundLocationUpdates` keep GPS
   feeding takeoff/landing detection when the app is backgrounded mid-flight.

### Free-account caveat
A free Apple ID signing cert **expires after 7 days** — the app stops opening
and must be re-run from Xcode (Cmd-R) to re-sign. A paid Apple Developer
account ($99/yr) removes this (TestFlight, 90-day builds, no cable).

## Config
- Loads `https://brook46.github.io/b737-asu-pwa/flight-card-pwa/`
  (`kFlightCardURL` in `FlightCard/FlightCardApp.swift`).
- Deployment target iOS 16. iPhone + iPad (`TARGETED_DEVICE_FAMILY = 1,2`).
