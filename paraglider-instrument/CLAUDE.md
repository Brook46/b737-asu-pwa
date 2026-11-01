# CLAUDE.md: paraglider-instrument

Firmware and logic for a headless paragliding flight instrument, all-Seeed
parts: XIAO ESP32S3 + Wio-SX1262 kit, L76K GNSS (UART), Grove BME280
(pressure, temperature, humidity, inside the case), Grove LSM6DS3 IMU, Grove
passive buzzer. It sits beside an XCTracer Maxx II and reads its BLE stream.
See README.md for the feature list and docs/ for wiring and bring-up.

This is **not** a PWA. None of the repo-root PWA rules (stamp-version, service
workers, Pages deploy) apply here.

## Layers and rules

* `lib/core/src/` is the logic layer. **No Arduino or ESP-IDF headers, ever.**
  It must build with desktop g++ (`make test`). Sensors come in through
  `BaroSource`/`GnssSource`/`ImuSource`, or as samples pushed into
  `FlightComputer`. Everything audible is a pure state machine
  (`AudioEngine::tick(t)`).
* `src/` is thin hardware glue. Logic that can live in core goes in core, with
  a test.
* Changes to vario, advisor, wind or circling: add or adjust a case in
  `test/test_core.cpp`, and check `build/sim --synthetic` still cues STAY on
  thermal entry and GLIDE as it dies (and no GLIDE after roll-out).
* `WindowAverage<N>` drops samples once full. N must cover window × feed rate.
  Feed long windows at the 5 Hz advisor rate, not at the 25 Hz baro rate.

## Hard constraints

* **LoRa TX stays compiled out** (`PG_LORA_TX_ENABLED=0`) until the user
  confirms it's legal in Israel. Don't flip it, and don't add a TX path that
  bypasses `LoraFanet::send()` (compile gate + runtime `tx arm` + 1 % airtime
  budget).
* FANET zone comes from GPS (`fanet::regionFor`). Israel is `IL918` (918.5
  MHz/BW125), per the FANET reference stack. Don't hard-code 868.
* The XCTracer's firmware is closed. Only read its BLE stream.
* Don't tell the user to flash before the sensors are wired and confirmed
  (docs/bringup.md).
* The barometer is auto-detected at boot (BME280/BMP280, then DPS310). Keep
  that: the user may swap sensors.
* The BME280 is **inside the case**. Its dew point is trustworthy, but its
  temperature reads warm. Cloud base depends on `Atmosphere`'s
  `tempOffset`, which is learned by calibrateAtBase(). Don't present
  cloud-base numbers as accurate before calibration.
* Library versions are pinned exactly in `platformio.ini`, and the code was
  checked against those tags' headers. NimBLE 1.4 trap: never
  `chr->setValue(const char*)`, since the template stores the pointer bytes.
  Use `setValue(ptr, len)`.

## GPS guard, terrain, thermal packs

* **GPS is untrusted by default.** `GnssGuard` decides; FlightComputer only
  uses a fix (position, wind, heading correction, home, clock) when
  `status().gps == GpsState::Ok`. Anything that sends, stores or acts on a
  position (FANET region/tracking/messages, marks) must use the guarded
  `status().pos` or check the GPS state: never `status().gnss` raw. The user
  flies where GPS jamming and spoofing (to Beirut) are routine.
* Vario, STAY/GLIDE, circling, cloud base and the thermal assistant must keep
  working with no GPS at all (test: "jammed from takeoff"). The assistant uses
  `assistHeading`, a gyro-only frame; north (`headingValid`) is only claimed
  once GPS has given it.
* Terrain (`*.ter`, `tools/terrain/build_terrain.py`) and the thermal pack
  (`hotspots.pghs`, `sim/pack.html`) live in `data/` → LittleFS
  (`pio run -t uploadfs`). Both optional. `sim/terrain.ter` is a copy of
  `data/gilboa.ter` for the browser simulator.
* KK7 hotspot data is CC BY-NC-SA 4.0: keep the attribution in pack.html and
  never bundle KK7-derived packs in the repo. The pack builder's KK7 reader
  is unverified against live data (blocked from the build environment);
  don't describe it as verified until the user confirms a real pack.

## Display and simulator

* `lib/core/src/display/` draws the optional 400 × 240 Sharp Memory LCD
  (LS027B7DH01) into a 1-bit framebuffer in the LCD's own format. It's pure
  logic; there's no firmware driver yet (the user may never fit the screen).
  Fonts are generated: `python3 tools/fontgen/fontgen.py`.
* `sim/` is the browser simulator. `sim/sim.wasm` is a **committed build
  artifact** of lib/core + `tools/websim/`, so **rebuild it (`make websim`,
  needs `pip install ziglang`) whenever lib/core changes**, or the simulator
  will show stale behaviour. `make websim-native && build/sim_native 30 build
  [inversion m] [gps mode] [at min]` (run from this folder; SEED=n env) runs the same world natively and writes PBM screenshots.
* Pages: FLIGHT (switches itself: thermal page while circling, glide page
  otherwise) and INFO. Keep them sparse: the user asked for fewer, more
  useful numbers.
* The simulator's world (`tools/websim/world.h`) is real terrain with ridge
  lift and terrain-triggered thermals; GPS modes (sim_set 12) jam/spoof it.
  A landing relaunches and starts a new flight on the instrument.
* The simulator's autopilot obeys STAY/GLIDE on purpose. Use it to judge cue
  quality, and fix what it finds in lib/core (with a test), not in the world.

## Commands

```sh
make test                      # desktop tests (must stay green)
make websim                    # rebuild the browser simulator (sim/sim.wasm)
make sim && build/sim --synthetic | --xct capture.txt | [--mc X] [--csv] flight.igc
pio run -e xiao_esp32s3        # firmware build
```
