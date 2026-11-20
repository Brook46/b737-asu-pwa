# Bring-up, one milestone at a time

Rule from the brief: **don't flash until the sensors are wired and
confirmed.** Build everything with [assembly.html](assembly.html), do its
meter checks, power on from USB once, and only then flash. The steps below
then verify each part in turn on the running firmware. Anything absent is
reported at boot and skipped, so a fault in one module doesn't block testing
the others.

Serial console: `pio device monitor` (115200, USB CDC). `help` lists the
commands, `health` shows what's alive.

## 0. Before the hardware arrives, and once it's wired

```sh
make test          # 46 cases, 0 failed
pio run            # first real ESP32 build. Fix anything it finds now.
```

After assembly.html's checks pass, flash once: `pio run -t upload`. Expect
the boot banner, each sensor reported, `SX1262 ok (receive), IL918 918.5 MHz
BW 125`, and `BLE advertising`.

## 1. Toolchain, repo, CLAUDE.md

Done in this folder. `pio run` must succeed.

## 2. BME280: altitude, vario, temperature, humidity

* `i2c` → `0x76 (BME280?)`
* reboot → `BME280 ok at 0x76 (pressure, temperature, humidity)`
* `show baro` → pressure about 1013 hPa less ~12 hPa per 100 m of
  elevation, steady to about ±3 Pa
* `show fc` → `vario` within ±0.15 m/s on the desk. Lift the board 1 m:
  a short climb and the beeps.
* `qnh 1016` (today's QNH) → `alt` reads the field elevation.
* `air` → temperature, RH and dew point. Compare with a weather app. The
  temperature reads a little high and the dew point should be close.

## 3. L76K: position and fix

Antenna attached, outside or at a window.

* `health` → `gnss: L76K`, with the fix count rising.
* `show nmea` → raw `$GNGGA` / `$GNRMC` sentences, five per second.
* `show gnss` → `fix 3` with 6+ satellites within about a minute. Position
  matches a phone map.
* The LED goes from a slow blip (searching) to a 3-second heartbeat (ready).

## 4. LSM6DS3: accel and gyro

* `i2c` → also `0x6A (LSM6DS3?)`
* reboot → `LSM6DS3 ok (WHO_AM_I 0x69)` or `0x6A` (the TR-C version)
* `show imu` → flat on the desk, `a` ≈ (0, 0, +9.8), gyro under ±1 dps.
  Rotate it: the gyro axis follows.

## 5. XCTracer Maxx II over BLE

In `XCTracerConfig.txt`, set the BLE protocol to XCTRC (or LK8EX1).

* `health` → `xctracer: connected <addr>` within ~10 s, the sentence count
  rising and `bad` staying at 0.
* `show xct` echoes raw sentences. **Save a few minutes of this to a file**:
  it's the format `build/sim --xct` replays.
* **Phone test**: with this unit connected, try connecting XCTrack on the
  phone to the XCTracer. Note whether both can hold the link.

## 6. Buzzer and LED

* `tone 2700` → loud (the buzzer's resonance). `tone 0` → off.
* `vario 1.5` / `vario -3` / `vario` (back to live) → climb beeps / sink tone.
* `beep stay`, `beep glide`, `beep msg` → the cue jingles.
* `vol 0…3`, `mute`.
* Remote stand-in: in nRF Connect, write `+` to characteristic `…0002` →
  MC up blip.

## 7. LoRa / FANET

Receiving needs no legal clearance:

* With a GPS fix the zone is checked every 30 s. Near other pilots' FANET
  devices, `[fanet] rx type 1 …` lines show their positions.

Transmit, **only after the legal check**: set `-DPG_LORA_TX_ENABLED=1`,
rebuild, `tx arm` after each boot, then `send hello`.

## 8. Cloud base in flight (after the first flights)

* Fly a few thermals. `air` (or the remote's status button) shows `cloud base
  ~N m (from thermal air)`.
* The first time you're actually at base, type `base` or press the remote's
  at-base button. That learns the case's warm bias, and from then on the
  estimate should hold within about ±150–250 m.
* After a few long glides through 250 m or more of altitude, `air` also shows
  the lapse rate: above 8.5 °C/km is unstable (good thermals), below 6.5 is
  stable.
