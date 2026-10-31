# Bring-up, one milestone at a time

Rule from the brief: **don't flash until the sensors are wired and
confirmed.** In practice: wire, check the wiring against `docs/hardware.md`
with a meter (3V3/GND not shorted, nothing on 5 V), then flash. The firmware
tolerates missing parts. Anything absent is reported at boot and skipped, so
you can add one breakout at a time and re-run the same image.

Serial console: `pio device monitor` (115200, USB CDC). `help` lists the
commands, `health` shows what's alive.

## 0. Before anything is wired

```sh
make test          # 34 cases, 0 failed
pio run            # first real ESP32 build. Fix anything it finds before flashing.
```

Flash the bare XIAO. Expect the boot banner, every sensor "not found", the
boot jingle (if the piezo is wired) and `BLE advertising`.

## 1. Toolchain, repo, CLAUDE.md

Done in this folder. `pio run` must succeed.

## 2. BMP390: altitude and vario

Wire STEMMA QT → XIAO D4/D5/3V3/GND.

* `i2c` → `0x77 (BMP390?)`
* reboot → `BMP390 ok at 0x77`
* `show baro` → pressure about 1013 hPa less ~12 hPa per 100 m of elevation,
  steady to about ±2 Pa
* `show fc` → `vario` within ±0.1 m/s on the desk. Lift the board 1 m:
  roughly +0.5…+1 m/s for a second, and the climb beeps.
* `qnh 1016` (today's QNH) → `alt` reads the field elevation.

## 3. MAX-M10S: position and fix

Plug in Qwiic (same bus). Antenna outside or at a window.

* `i2c` → also `0x42 (u-blox GNSS)`
* `show gnss` → `fix 0` at first, then `fix 3` with 6+ sats in about 30 s
  (cold) and a few seconds after that (warm, backup battery). Position
  matches a phone map.
* The LED goes from a slow blip (searching) to a 3-second heartbeat (ready).

## 4. ICM-42688-P: accel and gyro

Wire SPI (D8/D9/D10) and CS → D7, 3V3, GND.

* reboot → `ICM-42688 ok (WHO_AM_I 0x47)`. `0x00` or `0xFF` means wiring or
  CS problem.
* `show imu` → flat on the desk, `a` ≈ (0, 0, +9.8), gyro under ±1 dps.
  Rotate it: the gyro axis follows.
* With baro + IMU: `health` shows `imu: ICM42688`, and the vario now reacts
  faster to a quick lift.

## 5. XCTracer Maxx II over BLE

In `XCTracerConfig.txt`, set the BLE protocol to XCTRC (or LK8EX1). Power
the XCTracer on with no phone connected.

* `health` → `xctracer: connected <addr>` within ~10 s, sentence count rising
  and `bad` staying at 0.
* `show xct` echoes raw sentences. **Save a few minutes of this to a file**:
  it's the capture format `build/sim --xct` replays. That's how parser
  questions get answered without the hardware.
* With the BMP390 unplugged, `vario source: XCTracer`. Compare `status` with
  the XCTracer's own beeps.
* **Phone test**: with this unit connected, try connecting XCTrack on the
  phone to the XCTracer. Write down whether both can hold the link.

## 6. Piezo and LED from the vario

* `tone 2000` → steady tone. `tone 0` → off. Find the loudest frequency of
  your piezo and tell me, so the tone range can move toward it.
* `vario 1.5` / `vario -3` / `vario` (no argument returns to live) → climb
  beeps / sink tone.
* `beep stay`, `beep glide`, `beep msg` → the cue jingles.
* `vol 0…3`, `mute`.
* Remote: from nRF Connect, write `+` to characteristic `…0002` → MC up blip,
  and `status` shows the new MC.

## 7. LoRa / FANET

Receive needs no legal clearance:

* boot → `SX1262 ok (receive), IL918 918.5 MHz BW 125`. With a GPS fix it
  switches zone if needed and logs it.
* Near other pilots' FANET devices (Skytraxx, XCTracer with FANET, Flarm
  with FANET+), `[fanet] rx type 1 …` lines should appear with their
  positions.

Transmit, **only after the legal check**:

1. Set `-DPG_LORA_TX_ENABLED=1` in `platformio.ini`, rebuild.
2. After each boot, `tx arm` on the console.
3. `send hello`. A second FANET device should show the message. Then the
   remote's canned messages work.

The TX path enforces a 1 % per-hour airtime budget and the zone's power
limit (capped by `PG_LORA_TX_DBM`).
