//
//  FlightCardApp.swift
//  Flight Card — native iOS shell
//
//  A thin WKWebView wrapper around the hosted PWA
//  (https://brook46.github.io/b737-asu-pwa/flight-card-pwa/).
//
//  What the native shell adds over "installed PWA in Safari":
//   • Immune to the iOS Safari PWA suspension bug (the whole reason
//     Phases 10–12 exist) — a native process keeps its JS + listeners.
//   • BACKGROUND GPS: CoreLocation keeps feeding takeoff/landing detection
//     while the app is backgrounded during a flight, so actual flight time
//     records even if the pilot switches apps. (Requires the "location"
//     UIBackgroundMode + "When In Use" auth, both set in Info.plist.)
//   • CoreMotion for the touchdown-G reading with no in-web permission dance.
//
//  The web app is the single source of truth for all UI and logic — this
//  file only bridges native sensors into the PWA's navigator.geolocation /
//  devicemotion APIs and hosts it chrome-free.
//

import SwiftUI
import WebKit
import CoreLocation
import CoreMotion

// MARK: - App entry

@main
struct FlightCardApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
                .ignoresSafeArea()
                .statusBarHidden(false)          // keep the clock/battery — cockpit context
                .preferredColorScheme(nil)        // follow the iPad's light/dark
                .background(Color(red: 0.043, green: 0.063, blue: 0.086))
        }
    }
}

// MARK: - Root view

private let kFlightCardURL = URL(string: "https://brook46.github.io/b737-asu-pwa/flight-card-pwa/")!

struct RootView: View {
    var body: some View {
        WebViewContainer(url: kFlightCardURL)
            .ignoresSafeArea()
            .background(Color(red: 0.043, green: 0.063, blue: 0.086))  // #0b1016 dark theme
    }
}

// MARK: - WKWebView wrapper

struct WebViewContainer: UIViewRepresentable {
    let url: URL

    func makeCoordinator() -> Bridge { Bridge() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()

        // Sensor bridge runs at document-start on every load and monkey-
        // patches navigator.geolocation + DeviceMotion so the PWA's existing
        // gps.js / g.js modules transparently receive CoreLocation / CoreMotion.
        let userContent = WKUserContentController()
        userContent.add(context.coordinator, name: "fc")
        let bridgeScript = WKUserScript(
            source: Bridge.injectedJS,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        userContent.addUserScript(bridgeScript)
        config.userContentController = userContent
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.websiteDataStore = .default()   // persistent — keeps the SW cache + fc.state

        let web = WKWebView(frame: .zero, configuration: config)
        web.scrollView.bounces = false
        web.isOpaque = false
        web.backgroundColor = UIColor(red: 0.043, green: 0.063, blue: 0.086, alpha: 1)
        web.scrollView.backgroundColor = web.backgroundColor
        web.allowsBackForwardNavigationGestures = false

        context.coordinator.webView = web
        context.coordinator.start()

        web.load(URLRequest(url: url))
        return web
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}
}

// MARK: - Native-to-JS sensor bridge

final class Bridge: NSObject, WKScriptMessageHandler, CLLocationManagerDelegate {

    weak var webView: WKWebView?

    private let locationManager = CLLocationManager()
    private let motionManager = CMMotionManager()
    private var gpsActive = false
    private var motionActive = false
    private var lastHeading: CLLocationDirection = -1

    // Injected at document-start on every page load. Intercepts the PWA's
    // sensor APIs and routes them through native via
    // window.webkit.messageHandlers.fc.postMessage(...).
    static let injectedJS = """
    (() => {
      const send = (op, data) =>
        window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.fc
          ? window.webkit.messageHandlers.fc.postMessage(Object.assign({ op }, data || {}))
          : null;

      // ── Geolocation override ────────────────────────────────────
      const gpsCallbacks = new Map();
      let nextGpsId = 1;
      const nativeGeo = {
        getCurrentPosition: (success, error) => {
          const id = nextGpsId++;
          gpsCallbacks.set(id, { success, error, once: true });
          send('gps_get', { id });
        },
        watchPosition: (success, error) => {
          const id = nextGpsId++;
          gpsCallbacks.set(id, { success, error, once: false });
          send('gps_watch', { id });
          return id;
        },
        clearWatch: (id) => {
          gpsCallbacks.delete(id);
          send('gps_clear', { id });
        },
      };
      try { Object.defineProperty(navigator, 'geolocation', { value: nativeGeo, configurable: true }); }
      catch (e) { navigator.geolocation = nativeGeo; }

      // Native pushes a position (or an error) to every live callback. The
      // Flight Card GPS module only ever runs one watch, but iterate to be safe.
      window.__fcGpsPush = (payload) => {
        gpsCallbacks.forEach((cb) => {
          if (payload.error) {
            if (cb.error) cb.error({ code: payload.code || 2, message: payload.error });
          } else {
            cb.success({
              coords: {
                latitude: payload.lat, longitude: payload.lng,
                altitude: payload.alt, altitudeAccuracy: payload.vacc ?? null,
                accuracy: payload.acc, heading: payload.trk,
                speed: payload.gs, speedAccuracy: null,
              },
              timestamp: Date.now(),
            });
            if (cb.once) { /* getCurrentPosition — caller drops its own ref */ }
          }
        });
      };

      // ── DeviceMotion override ───────────────────────────────────
      const motionHandlers = new Set();
      const origAdd = window.addEventListener.bind(window);
      const origRemove = window.removeEventListener.bind(window);
      window.addEventListener = (type, h, opts) => {
        if (type === 'devicemotion') { motionHandlers.add(h); send('motion_start'); return; }
        return origAdd(type, h, opts);
      };
      window.removeEventListener = (type, h, opts) => {
        if (type === 'devicemotion') { motionHandlers.delete(h); return; }
        return origRemove(type, h, opts);
      };
      if (typeof DeviceMotionEvent !== 'undefined') {
        DeviceMotionEvent.requestPermission = () => Promise.resolve('granted');
      } else {
        window.DeviceMotionEvent = { requestPermission: () => Promise.resolve('granted') };
      }
      window.__fcMotionPush = (ax, ay, az) => {
        const ev = {
          acceleration: { x: 0, y: 0, z: 0 },
          accelerationIncludingGravity: { x: ax, y: ay, z: az },
          rotationRate: null,
          interval: 100,
        };
        motionHandlers.forEach(h => { try { h(ev); } catch (e) {} });
      };
    })();
    """

    func start() {
        locationManager.delegate = self
        locationManager.desiredAccuracy = kCLLocationAccuracyBest
        locationManager.headingFilter = 2.0
        // Keep feeding positions while backgrounded during a flight. Safe
        // with When-In-Use auth as long as the app was foregrounded to start
        // the watch (which the Flight Card GPS arm always is).
        locationManager.allowsBackgroundLocationUpdates = true
        locationManager.pausesLocationUpdatesAutomatically = false
    }

    // MARK: JS → native

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard let dict = message.body as? [String: Any],
              let op = dict["op"] as? String else { return }
        switch op {
        case "gps_watch", "gps_get": startGPS()
        case "gps_clear":            stopGPS()
        case "motion_start":         startMotion()
        default: break
        }
    }

    // MARK: GPS

    private func startGPS() {
        guard !gpsActive else { return }
        gpsActive = true
        let status = locationManager.authorizationStatus
        if status == .notDetermined {
            locationManager.requestWhenInUseAuthorization()
        } else if status == .denied || status == .restricted {
            pushGPSError("User denied Geolocation", code: 1); return
        }
        locationManager.startUpdatingLocation()
        locationManager.startUpdatingHeading()
    }
    private func stopGPS() {
        gpsActive = false
        locationManager.stopUpdatingLocation()
        locationManager.stopUpdatingHeading()
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let s = manager.authorizationStatus
        if s == .authorizedWhenInUse || s == .authorizedAlways {
            if gpsActive { manager.startUpdatingLocation(); manager.startUpdatingHeading() }
        } else if s == .denied || s == .restricted {
            pushGPSError("User denied Geolocation", code: 1)
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last else { return }
        let speed = loc.speed >= 0 ? loc.speed : 0
        let heading = (loc.course >= 0) ? loc.course
                    : (lastHeading >= 0 ? lastHeading : Double.nan)
        pushToJS("""
          if (window.__fcGpsPush) window.__fcGpsPush({
            lat: \(loc.coordinate.latitude),
            lng: \(loc.coordinate.longitude),
            alt: \(loc.altitude),
            acc: \(max(loc.horizontalAccuracy, 0)),
            vacc: \(loc.verticalAccuracy >= 0 ? "\(loc.verticalAccuracy)" : "null"),
            trk: \(heading.isFinite ? "\(heading)" : "null"),
            gs:  \(speed)
          });
        """)
    }
    func locationManager(_ manager: CLLocationManager, didUpdateHeading newHeading: CLHeading) {
        let h = newHeading.trueHeading >= 0 ? newHeading.trueHeading : newHeading.magneticHeading
        lastHeading = h
    }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        pushGPSError("GPS unavailable — \(error.localizedDescription)", code: 2)
    }
    private func pushGPSError(_ msg: String, code: Int) {
        let escaped = msg.replacingOccurrences(of: "\"", with: "\\\"")
        pushToJS("if (window.__fcGpsPush) window.__fcGpsPush({ error: \"\(escaped)\", code: \(code) });")
    }

    // MARK: Motion

    private func startMotion() {
        guard !motionActive, motionManager.isDeviceMotionAvailable else { return }
        motionActive = true
        motionManager.deviceMotionUpdateInterval = 1.0 / 15.0
        motionManager.startDeviceMotionUpdates(to: .main) { [weak self] m, _ in
            guard let m = m, let self = self else { return }
            let G = 9.80665
            let x = (m.gravity.x + m.userAcceleration.x) * G
            let y = (m.gravity.y + m.userAcceleration.y) * G
            let z = (m.gravity.z + m.userAcceleration.z) * G
            self.pushToJS("if (window.__fcMotionPush) window.__fcMotionPush(\(x),\(y),\(z));")
        }
    }

    // MARK: Helpers

    private func pushToJS(_ js: String) {
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript(js, completionHandler: nil)
        }
    }
}
