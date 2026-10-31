# Hardware: wiring and checks before ordering

Everything here comes from datasheets and vendor pages as I understood them.
Some details came from search summaries. **Check each ⚠ item against the
actual product page or board before you order or solder.**

## Bill of materials

| Part | Notes | ⚠ Check before ordering |
|---|---|---|
| Seeed XIAO ESP32-S3 | Main board. Non-Sense version is enough. | Has the bottom B2B connector, if you go with the LoRa kit. |
| Wio-SX1262 (XIAO kit) | SX1262 + TCXO + RF switch, on the B2B connector | **Covers 918 MHz** (Israel's FANET zone), not only 868. Which antenna ships with it, and its band. |
| Adafruit BMP390 (STEMMA QT, #4816) | I2C address 0x77 (0x76 with the SDO jumper) | Board has its own 3.3 V regulator and level shifting, so it's safe on 3V3. |
| SparkFun MAX-M10S Qwiic + SMA (GPS-18037 family) | I2C 0x42 | Comes with a backup battery for fast fixes. Active vs passive antenna and LNA. |
| ICM-42688-P breakout (header, SPI) | 3.3 V only | Breakout pin names (CS / SCLK / SDI / SDO). Whether it has its own regulator. |
| Passive piezo (e.g. 12 mm, 2–4 kHz resonant) | Loudest near resonance | A *passive* one. An active buzzer only beeps at one pitch. |
| NPN (2N3904 / S8050 / BC547), 1 kΩ, 1 kΩ | Piezo driver | — |
| LiPo 1S, 300–600 mAh, with protection | XIAO battery pads; charges over USB-C | Connector polarity. Pads on the XIAO underside. |

## Pin map (`include/pins.h`)

| Signal | XIAO | GPIO | Device |
|---|---|---|---|
| I2C SDA | D4 | 5 | BMP390, MAX-M10S |
| I2C SCL | D5 | 6 | BMP390, MAX-M10S |
| SPI SCK | D8 | 7 | ICM-42688-P, SX1262 |
| SPI MISO | D9 | 8 | ICM-42688-P, SX1262 |
| SPI MOSI | D10 | 9 | ICM-42688-P, SX1262 |
| IMU CS | D7 | 44 | ICM-42688-P |
| Piezo | D0 | 1 | NPN base via 1 kΩ |
| User LED | — | 21 | on-board |
| LoRa NSS / DIO1 / RST / BUSY / RXEN | B2B | 41 / 39 / 42 / 40 / 38 | Wio-SX1262 kit |

Not used: GPIO0, 3, 45, 46 (strapping) and 19, 20 (native USB, also the serial
console). D2 (GPIO3) is free but is a strapping pin, so leave it alone. D1
(GPIO2), D3 (GPIO4) and D6 (GPIO43) are free for later, e.g. a battery
divider or an e-paper display.

The IMU and the radio share SPI with separate chip selects. Firmware drives
both CS lines high before talking to either.

## Wiring notes

* **I2C**: the Qwiic/STEMMA QT boards carry their own pull-ups. Two boards in
  parallel come to about 5 kΩ, which is fine at 400 kHz on short wires. If you
  add more Qwiic boards, cut the extra pull-up jumpers.
* **Piezo driver**: GPIO1 → 1 kΩ → NPN base, emitter to GND. Piezo from 3V3
  to the collector, **with 1 kΩ across the piezo**. A piezo is a capacitor:
  without that resistor it charges once and goes quiet. For more volume, run
  the piezo from the battery (VBAT, 3.7–4.2 V) instead of 3V3. Volume is PWM
  duty (`Buzzer`, levels 0–3).
* **IMU mounting**: any orientation works. The attitude filter learns where
  "up" is from gravity at power-on, so power on with the unit roughly still.
* **GNSS antenna**: SMA patch on top, clear sky view, away from the ESP32
  antenna.
* **Power**: XIAO battery pads (BAT+/BAT−). USB-C charges the cell. The XIAO
  S3 has no on-board battery voltage divider. Add two 220 kΩ resistors to a
  free ADC pin later if you want battery level.

## Interfaces

* **XCTracer → this unit**: BLE. The XCTracer's own config file
  (`XCTracerConfig.txt` on its USB drive) picks the sentence format. Use
  **XCTRC** (pressure, position, speed, course) or **LK8EX1** (pressure only).
  The firmware connects to whatever advertises the Nordic UART Service, or
  whose name contains "XC".
* **Remote → this unit**: BLE GATT write, one byte per press. Service
  `7d2a0001-6c39-4b8e-9f4e-3a1c5b8e2f10`, command characteristic `…0002`,
  status text (read/notify) `…0003`. Bytes are in `lib/core/src/remote.h`.
  ASCII aliases work too, so nRF Connect can stand in for the remote.
