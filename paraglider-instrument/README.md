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
| Logic layer (`lib/core`) | Written, **81 desktop tests pass** (`make test`) |
| Flight replay tool (`tools/sim`) | Works on IGC files, XCTracer captures, synthetic flights |
| Firmware (`src/`) | Written against pinned library versions; every library call was checked against those tags' headers, and a host compile against signature stubs is clean. **Not yet built with the real ESP32 toolchain, not flashed.** |
| Thermal pack builder (`sim/pack.html`) | Written and tested against mocked replies; **not yet run against live KK7** (this build environment can't reach it) |
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
  terrain.*            elevation grid (.ter) → height above ground, arrival heights
  heading.*            gyro heading, bias learned from GPS while GPS is trusted
  gnss_guard.*         GPS jamming / spoofing detector + dead reckoning while it's out
  thermal_assist.*     maps lift around the circle (gyro only) → lift dots on the screen
  thermal_model.*      fits a round thermal in the air-mass frame → MOVE / TIGHTEN / WIDEN
  xc.*                 XC tactics: MC by height band, XC vs race, when to leave, speed bar
  task.*               XCTrack .xctsk tasks: turnpoints, final glide
  traffic.*            other pilots (FANET): live thermals, pilots in your thermal
  profile.*            wind, climb, temperature and dew point per 100 m
  sun.*                sun position; sun on the terrain → thermal triggers; drift with height
  hotspots.*           thermal pack (KK7 history × day forecast), best reachable thermal
  fanet.*              FANET frame/tracking/message codec, region table (IL918, EU868, …)
  remote.*             brake-handle remote command bytes
  bme280_comp.*        BME280/BMP280 calibration math (checked against Bosch's example)
  dps310_comp.*        DPS310 calibration math (fallback barometer)
  flight_computer.*    wires it all together; firmware and sim drive it the same way
  display/             optional Sharp LCD: 1-bit canvas, fonts; flight / side / info / profile pages,
                       each in landscape and portrait (docs/screens.md)
src/                 firmware (Arduino-ESP32 2.0.17 via PlatformIO)
  main.cpp             loop, serial console, settings
  drivers/             bme280 (also BMP280), dps310, lsm6ds3, gnss_l76k: all own drivers, no libraries
  io/                  ble_link (NimBLE central + peripheral), xctracer_source, lora_fanet (RadioLib), buzzer/LED
include/             pins.h, build_config.h
test/                desktop tests + synthetic flight generator
tools/sim/           flight replay (IGC, XCTracer captures, synthetic)
tools/websim/        simulator world + C API, build.sh → sim/sim.wasm
hardware/enclosure/  OpenSCAD models: case + lids (headless / screen), strap plate, remote, sensor shield;
                     build.sh exports hardware/stl/ and renders docs/build/
tools/fontgen/       generates the display fonts from DejaVu Sans
tools/terrain/       build_terrain.py: AWS Terrain Tiles → .ter grid for an area
data/                files for the device's LittleFS (`pio run -t uploadfs`): gilboa.ter, hotspots.pghs
sim/                 browser simulator (index.html + sim.wasm + terrain.ter), pack.html (thermal pack builder)
docs/                physical-build.html (print, buy, build, mount), screens.md (every page, both orientations, vs Flymaster/Naviter), xc-tactics.md (speed to fly, when to leave, bar: sources and rules), hardware.md (parts, pins), assembly.html (wiring diagram, soldering, battery), bringup.md (milestone tests), build-sketch.html (to-scale layout)
```

## Simulator

`sim/index.html` + `sim/sim.wasm`: the real flight logic and screen code,
compiled to WebAssembly, flying a simulated thermal day over the real terrain
around the Gilboa: ridge lift from the wind against the slopes, thermals that
rise from sun-facing slopes and high ground (or from a loaded thermal pack),
none over the Kinneret, weaker in the morning and in winter. It shows the
optional Sharp screen, plays the buzzer's actual tones, has the remote's
buttons and a steerable glider (or an autopilot that obeys STAY/GLIDE), and
compares every instrument number with the truth. The GPS can be **jammed,
spoofed to Beirut or made noisy** to watch the instrument cope. Serve the folder over http
(`python3 -m http.server -d sim`) or open it from GitHub Pages.

## Thermal packs

`sim/pack.html` builds `hotspots.pghs` for an area and a day, in your browser:
KK7's thermal hotspots (by season and by hours after sunrise) give each
source a historical chance; an Open-Meteo forecast for the day (mixing depth,
sunshine, low cloud, rain) scales it hour by hour. Copy the file into `data/`
and `pio run -t uploadfs`. In the air the instrument points to the best
thermal it can reach with 250 m to spare. KK7 data is CC BY-NC-SA 4.0:
personal, non-commercial use, with attribution. Without a pack, the
simulator derives sources from the terrain; the device just shows home.

New area: `python3 tools/terrain/build_terrain.py south west north east [step_m] data/site.ter`
(the device loads the first `.ter` it finds).

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

Made for cross-country: when to stop, when to leave, how much bar, and how
to turn in the thermal, mostly by sound (the screen is optional). The
reasoning and sources are in [docs/xc-tactics.md](docs/xc-tactics.md).

| Sound | Means |
|---|---|
| two rising notes | **STAY**: this air beats MC, turn here |
| three falling notes | **GLIDE**: leave (climb below MC, at cloud base, or better lift nearby) |
| one long tone | **MOVE**: straighten now, toward the core; a double blip = turn again |
| two up-chirps / down-chirps | **TIGHTEN** / **WIDEN** the circle |
| low rising / falling pair | **more bar** / **less bar** |
| rising four-note run | **FINAL GLIDE**: goal is made from here |
| three rising notes | turnpoint reached |

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
* **GPS jamming and spoofing**: every fix is checked against the other
  sensors. No fix, weak fixes, jumps, impossible speed, an altitude that
  disagrees with the barometer, or a track that disagrees with the gyro's
  turning all mark GPS as untrusted (LOST or SPOOFED, three falling notes).
  The instrument then keeps going on the barometer, IMU and wind: the vario,
  STAY/GLIDE, circling, the thermal assistant and cloud base need no GPS at
  all; position is dead reckoned from gyro heading, airspeed and the last
  wind, with a growing error shown ("~300 m"). GPS comes back only after 20 s
  of consistent fixes (two rising notes). A spoofed position is never used:
  not for the FANET region, not in tracking or "Thermal here" messages.
  Console: `gps`.
* **Thermal assistant**: lift around the circle, heading up, and a fitted
  thermal (core and size) to the scale of your circle. It says MOVE (with how
  many seconds to straighten), TIGHTEN or WIDEN (with the bank now → best),
  and stays quiet when the data can't tell. Uses only the gyro and airspeed,
  so it works jammed, even jammed from takeoff. Pilots near you (FANET) add
  their climbs to the fit.
* **Speed to fly and bar**: MacCready speed for the air you're in and the
  headwind on course, shown and sounded as bar in quarters. Never near the
  ground or in turbulence. MC is the effective one: set below your recent
  climbs, lower when you're low in the band, lower late in the day; a task
  race flies fuller MC.
* **Tasks** (optional): an XCTrack `.xctsk` in `data/`. Turnpoint cylinders,
  start, distance to the next one, and final glide (height over the glide to
  goal at your MC, and the MC you can afford). Console: `task`, `xc`.
* **Other pilots** (FANET receive): a pilot turning and climbing marks a live
  thermal, preferred over history as the glide target.
* **Sun on the terrain**: from the date, time and terrain grid, which faces
  the sun is heating now (with shade from ridges and a ~45 min lag), where
  the warm air releases (crests, spurs; pushed downwind in wind), and where
  that thermal will be **at the height you'd arrive**: downwind of its
  trigger by the wind in each layer. The glide page shows "SUN 40% - 1.2 km
  downwind". Works without a KK7 pack; weights a pack when there is one.
* **Remote air sensor** (optional): an SHT40 on the brake-handle remote gives
  true outside air temperature for cloud base and stability, in place of the
  warm case sensor (docs/hardware.md).
* **Profile page**: climb, wind, temperature and dew point at every 100 m
  you've flown through. Glide arrival heights use these winds.
* **Terrain**: height above ground, and glide arrival heights at home and at
  the suggested thermal, subtracting the ground there.
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
