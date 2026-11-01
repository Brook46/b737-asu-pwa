// Pin plan — Seeed XIAO ESP32-S3 with the all-Seeed parts set:
//   XIAO ESP32S3 & Wio-SX1262 kit, L76K GNSS for XIAO, Grove DPS310,
//   Grove 6-Axis (LSM6DS3), Grove Passive Buzzer.
//
// XIAO label → ESP32-S3 GPIO (from the Seeed XIAO ESP32S3 pinout):
//   D0=GPIO1  D1=GPIO2  D2=GPIO3*  D3=GPIO4  D4=GPIO5  D5=GPIO6
//   D6=GPIO43 D7=GPIO44 D8=GPIO7   D9=GPIO8  D10=GPIO9
//   * GPIO3 is a strapping pin (JTAG source select) — left unused.
// Not used anywhere: strapping GPIO0/3/45/46, native USB GPIO19/20.
//
// ⚠ Check against the Seeed wiki pinout before wiring. docs/hardware.md has
//   the wiring table.
#pragma once

// ---- I2C (Grove cables): DPS310 (0x77) + LSM6DS3 (0x6A)
#define PIN_I2C_SDA 5   // D4 — Grove white wire
#define PIN_I2C_SCL 6   // D5 — Grove yellow wire
#define I2C_FREQ_HZ 400000

// ---- UART: L76K GNSS (the module plugs onto these XIAO pins)
#define PIN_GNSS_RX 44  // D7 = XIAO RX, from the module's TX
#define PIN_GNSS_TX 43  // D6 = XIAO TX, to the module's RX

// ---- SPI: Wio-SX1262 only (on the XIAO's B2B connector, per the kit)
#define PIN_SPI_SCK 7   // D8
#define PIN_SPI_MISO 8  // D9
#define PIN_SPI_MOSI 9  // D10

// ---- Wio-SX1262 (XIAO ESP32S3 kit, B2B connector; same as Meshtastic's
// seeed_xiao_s3 variant). The kit covers 862–930 MHz, so Israel's 918.5 works.
#define PIN_LORA_NSS 41
#define PIN_LORA_DIO1 39
#define PIN_LORA_RESET 42
#define PIN_LORA_BUSY 40
#define PIN_LORA_RXEN 38        // RF switch; DIO2 drives the TX side
#define LORA_TCXO_VOLTAGE 1.8f  // TCXO on DIO3

// ---- Feedback
#define PIN_PIEZO 1             // D0 → Grove Passive Buzzer SIG (yellow); it has its own driver transistor
#define PIN_LED 21              // on-board user LED (yellow)
#define LED_ACTIVE_LOW 1        // XIAO S3 user LED lights when the pin is LOW — verify on your board
