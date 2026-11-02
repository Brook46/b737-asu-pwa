# Hardware: parts, wiring, checks

**Building it?** Follow [assembly.html](assembly.html): the wiring diagram,
soldering technique, step-by-step build order and battery handling. Then
[physical-build.html](physical-build.html): the printed case (headless or
with the screen), strap mount, brake-handle remote and sensor shield. The
models are in `hardware/enclosure/` (OpenSCAD) and the STLs in `hardware/stl/`.

Every electronic part comes from one Seeed Studio order. Buy the battery and
switch locally in Israel (lithium cells ship slowly and awkwardly by air).
Prices are approximate. Seeed shows the shipping cost to Israel at checkout.

## Shopping list

### Seeed Studio (one cart)

| Part | Seeed SKU | ≈ USD | Role |
|---|---|---|---|
| [XIAO ESP32S3 & Wio-SX1262 Kit](https://www.seeedstudio.com/Wio-SX1262-with-XIAO-ESP32S3-p-5982.html) (not the 3D-case version) | 102010611 | 9.90 | MCU + LoRa radio + both antennas. Radio covers 862–930 MHz, which includes Israel's FANET 918.5 MHz. |
| [L76K GNSS Module for XIAO](https://www.seeedstudio.com/L76K-GNSS-Module-for-Seeed-Studio-XIAO-p-5864.html) | 109100021 | ~12 | GPS + BeiDou + GLONASS, with an active patch antenna |
| Grove – Temp & Humi & Barometer Sensor (BME280) | 101020193 | ~20 | Vario pressure, plus temperature and humidity for cloud base |
| Grove – 6-Axis Accelerometer & Gyroscope (LSM6DS3) | 105020012 | ~13 | IMU: faster vario response, turn detection |
| [Grove – Passive Buzzer](https://www.seeedstudio.com/Grove-Passive-Buzzer-p-4525.html) | 107020109 | 2.10 | Audio (has its own driver transistor) |
| Grove – 4-pin Female Jumper to Grove cable, 5-pack | 110990028 | ~3.50 | Grove modules → XIAO pins |

Total about **$60** before shipping.

### Local (Israel)

* LiPo 1-cell 3.7 V **with a protection board** and a JST-PH 2.0 plug, plus a
  matching socket lead. 500 mAh ≈ 4–6 h of flying, 1000 mAh ≈ 8–12 h (estimated
  80–130 mA draw; measure yours). Take 1000 mAh for long XC days if it fits.
* Small slide switch (SPDT, ≥ 0.5 A) for the battery's + lead
* Stripboard, about 25 × 35 mm, for the distribution board
* 2 × 10 kΩ resistors (L76K D0/D2 pull-ups)
* 26–28 AWG silicone wire, heat-shrink, Kapton tape
* Open-cell foam scrap for the vent, M2 screws, a 3D-printed case

### Alternatives the firmware also accepts

The barometer is detected at boot, so these work without code changes:
**BMP280** (Grove 101020192, about half the price, no humidity, so no cloud
base) and **DPS310** (Grove 101020812, discontinued). The BMP390 driver is in
git history if you ever want it back.

## Pin map (`include/pins.h`)

| Signal | XIAO | GPIO | Goes to |
|---|---|---|---|
| I²C SDA | D4 | 5 | BME280, LSM6DS3: Grove **white** |
| I²C SCL | D5 | 6 | BME280, LSM6DS3: Grove **yellow** |
| UART RX | D7 | 44 | L76K's D7 pad (wired, same name to same name) |
| UART TX | D6 | 43 | L76K's D6 pad |
| Buzzer | D0 | 1 | Grove Passive Buzzer SIG: **yellow** |
| SPI SCK / MISO / MOSI | D8 / D9 / D10 | 7 / 8 / 9 | Wio-SX1262 (via the kit's B2B connector) |
| LoRa NSS / DIO1 / RST / BUSY / RXEN | B2B | 41 / 39 / 42 / 40 / 38 | Wio-SX1262 |
| User LED | — | 21 | on-board |
| 3V3 / GND | 3V3 / GND | — | every Grove module: **red** / **black** |

Free for later: D1 (GPIO2) and D3 (GPIO4), for example a battery-voltage
divider or a second I²C sensor outside the case. Leave D2 (GPIO3) alone; it's
a strapping pin.

## Wiring notes

* **The L76K is wired, not stacked**: four wires, same pad name to same pad
  name (3V3, GND, D6, D7), so the XIAO's pads stay free for the other wires.
  The module's D0 and D2 pads each get a 10 kΩ pull-up to its 3V3, because
  Seeed's FAQ says the module misbehaves when those lines aren't held high.
* **The Wio-SX1262** sits under the XIAO on the B2B connector. Unplug it while
  soldering the XIAO. D8–D10 carry its SPI bus: leave those pads alone.
* **Grove modules**: keep the Grove plug end, cut off the jumper end. Power
  and I²C go through a small stripboard distribution board (4 strips: 3V3,
  GND, SDA, SCL), so no XIAO pad carries more than one wire. The modules have
  their own I²C pull-ups, which is fine at 400 kHz on short wires.
* **Barometer in the case**: put the BME280 right behind a Ø 3 mm vent hole
  with open-cell foam over it. The foam stops gusts, sun and rain while
  pressure passes through. Keep it as far as you can from the ESP32 and the
  battery charger, since they warm the air around the sensor.
* **Buzzer**: face it at a ring of 1.6 mm holes in the lid. Volume is PWM
  duty, levels 0–3.
* **Power**: XIAO BAT+/BAT− pads on the underside (BAT− is the one nearest
  the USB port), with the slide switch in the + lead. USB-C charges the cell
  at 100 mA, and only while the switch is on. JST-PH polarity isn't
  standardised: check it with a meter before the first connection.
* **IMU mounting**: any orientation works, as long as it's power-on still.

## The case sensor and cloud base

With the BME280 inside the case:

* **The dew point is trustworthy.** The vented case holds the same moisture as
  the outside air.
* **The temperature reads warm**, by roughly 1–3 °C. Each 1 °C of warm bias
  puts the cloud-base estimate about 125 m too high. The fix: when you're
  actually at cloud base, press the remote's "at base" button, or type `base`
  on the console. The unit learns the offset and keeps it.
* **It reacts slowly**, with tens of seconds of lag. Fine for cloud base and
  the lapse rate; inversion cues arrive about 100 m late.

### Better: a temperature/humidity sensor on the remote

The brake-handle remote is already outside the case, in the airflow. A small
sensor there reads **true air temperature within seconds**, needs no
calibration, and makes cloud base, lapse rate and inversion cues sharper.
The instrument takes it automatically whenever the remote is sending, and
falls back to the case BME280 when it stops (for more than 6 s).

* **Sensor:** a Sensirion **SHT40** (or SHT41/SHT45). It's accurate (about
  ±0.2 °C, ±2 %RH), small, and responds in seconds. Seeed sells it as a
  Grove board ("Grove - Temperature & Humidity Sensor (SHT40)"); check stock
  when ordering. A BME280 works too, but it is bigger and slower.
* **Wiring:** to the XIAO ESP32-C6's I²C pins (D4 SDA, D5 SCL, 3V3, GND), the
  same Grove cable as on the main unit.
* **Placement matters more than the sensor:**
  * In the airflow, **out of direct sun**: under the remote's body, or in a
    small white vented cap. Sun on a bare sensor reads several °C high.
  * Away from your hand and glove: on a 10–20 cm lead up the brake line or
    riser, not inside the handle.
  * Don't turn on the SHT4x's built-in heater.
* **Protocol:** every ~2 s the remote writes a 5-byte frame to the same
  command characteristic: `0xA1`, temperature × 100 (int16), RH × 100
  (uint16), little-endian (`encodeAirFrame()` in `lib/core/src/remote.h`).
  `air` on the console shows which sensor is in use.
* **Remote firmware:** not written yet. The XIAO ESP32-C6 needs Arduino-ESP32
  3.x (the pioarduino platform), not the 2.0.17 core this firmware is pinned
  to, so the remote will be its own small PlatformIO project: buttons → BLE
  writes, plus the SHT40 every 2 s.

## Interfaces

* **XCTracer → this unit**: BLE. Set the XCTracer's own config file
  (`XCTracerConfig.txt`) to **XCTRC** or **LK8EX1**.
* **Remote → this unit**: BLE GATT write, one byte per press (and the
  5-byte air frame above). Service
  `7d2a0001-6c39-4b8e-9f4e-3a1c5b8e2f10`, command `…0002`, status text
  `…0003` (read/notify; includes cloud base and lapse rate). The bytes are in
  `lib/core/src/remote.h`, including `0x0C` / `'b'` for "at cloud base".
