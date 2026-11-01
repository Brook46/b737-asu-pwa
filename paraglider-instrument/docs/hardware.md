# Hardware: parts, wiring, checks

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

* LiPo 3.7 V, 400–500 mAh, **with protection circuit**, about 35 × 30 × 5 mm
* Small slide switch for the battery's + lead
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
| UART RX | D7 | 44 | L76K TX (the module plugs onto these pins) |
| UART TX | D6 | 43 | L76K RX |
| Buzzer | D0 | 1 | Grove Passive Buzzer SIG: **yellow** |
| SPI SCK / MISO / MOSI | D8 / D9 / D10 | 7 / 8 / 9 | Wio-SX1262 (via the kit's B2B connector) |
| LoRa NSS / DIO1 / RST / BUSY / RXEN | B2B | 41 / 39 / 42 / 40 / 38 | Wio-SX1262 |
| User LED | — | 21 | on-board |
| 3V3 / GND | 3V3 / GND | — | every Grove module: **red** / **black** |

Free for later: D1 (GPIO2) and D3 (GPIO4), for example a battery-voltage
divider or a second I²C sensor outside the case. Leave D2 (GPIO3) alone; it's
a strapping pin.

## Wiring notes

* **The stack**: the Wio-SX1262 sits under the XIAO on the B2B connector, and
  the L76K plugs onto the XIAO's header pins above it. Seeed's Meshtastic
  "4-layer sandwich" kit appears to use this stack; check its wiki photos
  before soldering headers. Mind the L76K's
  orientation: the wiki warns that plugging it in backwards can damage the
  module or the XIAO.
* **Grove modules**: cut a Grove-to-female-jumper cable short. Both I²C
  modules share SDA/SCL/3V3/GND, so join their wires at the XIAO pins. The
  modules have their own pull-ups, which is fine at 400 kHz on short wires.
* **Barometer in the case**: put the BME280 right behind a Ø 3 mm vent hole
  with open-cell foam over it. The foam stops gusts, sun and rain while
  pressure passes through. Keep it as far as you can from the ESP32 and the
  battery charger, since they warm the air around the sensor.
* **Buzzer**: face it at a ring of 1.6 mm holes in the lid. Volume is PWM
  duty, levels 0–3.
* **Power**: XIAO BAT+/BAT− pads on the underside, with the slide switch in
  the + lead. USB-C charges the cell.
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

Planned upgrade: a second BME280 **outside**, on a 30–50 cm Grove cable in
shade and airflow, gives true air temperature without calibration. It goes on
the same I²C bus, set to the other address (0x77).

## Interfaces

* **XCTracer → this unit**: BLE. Set the XCTracer's own config file
  (`XCTracerConfig.txt`) to **XCTRC** or **LK8EX1**.
* **Remote → this unit**: BLE GATT write, one byte per press. Service
  `7d2a0001-6c39-4b8e-9f4e-3a1c5b8e2f10`, command `…0002`, status text
  `…0003` (read/notify; includes cloud base and lapse rate). The bytes are in
  `lib/core/src/remote.h`, including `0x0C` / `'b'` for "at cloud base".
