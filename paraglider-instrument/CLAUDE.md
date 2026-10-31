# CLAUDE.md: paraglider-instrument

Firmware and logic for a headless paragliding flight instrument (XIAO ESP32-S3,
BMP390, MAX-M10S, ICM-42688-P, Wio-SX1262, piezo). It sits beside an XCTracer
Maxx II and reads its BLE stream. See README.md for the feature list and
docs/ for wiring and bring-up.

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
* Library versions are pinned exactly in `platformio.ini`, and the code was
  checked against those tags' headers. NimBLE 1.4 trap: never
  `chr->setValue(const char*)`, since the template stores the pointer bytes.
  Use `setValue(ptr, len)`.

## Commands

```sh
make test                      # desktop tests (must stay green)
make sim && build/sim --synthetic | --xct capture.txt | [--mc X] [--csv] flight.igc
pio run -e xiao_esp32s3        # firmware build
```
