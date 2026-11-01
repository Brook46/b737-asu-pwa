# Paragliding instrument (headless)

A small flight computer that sits **beside** an XCTracer Maxx II and adds what
the XCTracer doesn't do well or at all: better averaging, wind from circling
drift, a MacCready STAY/GLIDE advisor in audio, cloud base and air
stability from temperature and humidity, a brake-handle remote, and FANET
(LoRa) messaging with other pilots.

All electronics are Seeed Studio parts in one order: see
[docs/hardware.md](docs/hardware.md) for the shopping list, and
[docs/assembly.html](docs/assembly.html) for how to wire, solder and power it.

No screen in v1. Everything is a sound from the buzzer or a blink of the LED.
The XCTracer stays the primary vario. Its firmware is closed and untouched;
this unit only *listens* to its Bluetooth stream.

## Status

| Part | State |
|---|---|
| Logic layer (`lib/core`) | Written, **46 desktop tests pass** (`make test`) |
| Flight replay tool (`tools/sim`) | Works on IGC files, XCTracer captures, synthetic flights |
| Firmware (`src/`) | Written against pinned library versions; every library call was checked against those tags' headers, and a host compile against signature stubs is clean. **Not yet built with the real ESP32 toolchain, not flashed.** |
| LoRa transmit | **Compiled out** (`PG_LORA_TX_ENABLED=0`) until the legal check in Israel is done. Receive works. |

## Layout

```
lib/core/src/        hardware-free logic — builds with desktop g++ and on the ESP32
  types.h sensors.h    data types, Baro/Gnss/Imu source interfaces, ISA altitude
  kalman_vario.*       3-state Kalman (altitude, climb, accel bias), optional IMU assist
  ahrs.*               Mahony attitude filter → earth-frame vertical accel, yaw rate
  averager.h           time-window averages, thermal gain average
  circling.*           circling detector with time hysteresis
  wind.*               wind from circle drift (Kåsa circle fit on ground velocity)
  polar.*              wing polar, MacCready speed-to-fly, glide ratio, arrival height
  advisor.*            STAY / GLIDE advisor, auto-MC from recent thermals
  audio.*              vario tones, alert jingles, LED patterns (pure state machines)
  nmea.*               LK8EX1 / XCTRC parsers, GNSS GGA/RMC parser, line reassembly
  atmosphere.*         dew point, cloud base, lapse rate, inversion detection
  fanet.*              FANET frame/tracking/message codec, region table (IL918, EU868, …)
  remote.*             brake-handle remote command bytes
  bme280_comp.*        BME280/BMP280 calibration math (checked against Bosch's example)
  dps310_comp.*        DPS310 calibration math (fallback barometer)
  flight_computer.*    wires it all together; firmware and sim drive it the same way
src/                 firmware (Arduino-ESP32 2.0.17 via PlatformIO)
  main.cpp             loop, serial console, settings
  drivers/             bme280 (also BMP280), dps310, lsm6ds3, gnss_l76k: all own drivers, no libraries
  io/                  ble_link (NimBLE central + peripheral), xctracer_source, lora_fanet (RadioLib), buzzer/LED
include/             pins.h, build_config.h
test/                desktop tests + synthetic flight generator
tools/sim/           flight replay
docs/                hardware.md (parts, pins), assembly.html (wiring diagram, soldering, battery), bringup.md (milestone tests), build-sketch.html (to-scale layout)
```

## Build

```sh
make test                          # logic tests, desktop
make sim && build/sim --synthetic  # scripted thermal, prints the cues
build/sim --mc 1.0 --csv flight.igc > timeline.csv
build/sim --xct capture.txt        # replay a BLE capture made with `show xct`

pio run -e xiao_esp32s3            # firmware (needs PlatformIO)
pio run -e xiao_esp32s3 -t upload  # ONLY after docs/bringup.md says so
pio device monitor
```

## What it does in flight

* **Vario tone**: beeps above +0.15 m/s; pitch and rate rise with climb.
  Continuous low tone below −2.5 m/s. All in `VarioToneConfig`.
* **STAY** (two rising notes): gliding through air whose netto lift, minus
  your circling sink, beats MacCready. Turn here. Cued after 1.5 s of it,
  about 15 m at trim speed.
* **GLIDE** (three falling notes): after a thermal's first ~40 s, the last
  circle's average has been under 75 % of MC for 15 s. Repeated every 60 s
  while you keep turning, and stops as soon as you roll out.
* **Auto-MC**: MC follows 0.8 × the mean of your last three thermals (over
  60 s each). Touching MC on the remote switches to manual.
* **Wind**: one estimate per full circle, blended over circles by fit quality.
  Feeds airspeed (ground speed minus wind), so netto, so STAY.
* **Cloud base**: from the temperature and dew point of thermal air (125 m
  per °C of spread), smoothed over about a minute. A double-double high beep
  when you climb within ~300 m of it. The case reads warm, so the first time
  you're really at base, press the remote's at-base button (or type `base`)
  and it learns the offset.
* **Air stability**: the temperature lapse rate from your glides. Above
  8.5 °C/km is unstable (good thermals), below 6.5 is stable. A low warble
  when the climb starts warming with height, meaning an inversion and the top
  of the lift is near. Both show in `air` and the remote's status text.
* **FANET**: tracking from other pilots and messages are received and logged;
  a message to you chirps three times. Canned messages from the remote ("OK",
  "Thermal here" + position + climb, "Landing", "NEED HELP") go out only when
  TX is compiled in **and** armed.

## Open questions (hardware or legal)

1. **FANET in Israel is 918.5 MHz, not 868.** The FANET reference stack has
   an `IL918` zone (918.5 MHz, BW 125 kHz, 15 dBm) covering lat 29–34°N,
   lon 34–36°E. The firmware follows the zone automatically from GPS. The
   XIAO Wio-SX1262 kit covers 862–930 MHz, so the hardware is fine. The legal
   check should be about 918.5 MHz.
2. **One BLE central at a time.** While this unit is connected to the
   XCTracer, a phone running XCTrack may not be able to connect to it as well.
   Bring-up step 5 tests this. If it's a problem, this unit can later relay
   the stream to the phone as its own BLE UART.
3. **Which Wio-SX1262?** `pins.h` assumes the XIAO ESP32S3 kit, which plugs
   into the bottom B2B connector. The header-mounted "Wio-SX1262 for XIAO"
   uses D-pins and would collide with the L76K.
4. **Outside air sensor (future).** A second BME280 on a cable in shade and
   airflow would give true air temperature, with no calibration needed. It
   would go on the same I²C bus at address 0x77.
