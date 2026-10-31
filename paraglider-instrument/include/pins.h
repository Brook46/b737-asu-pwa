// Pin plan — Seeed XIAO ESP32-S3.
//
// XIAO label → ESP32-S3 GPIO (from the Seeed XIAO ESP32S3 pinout):
//   D0=GPIO1  D1=GPIO2  D2=GPIO3*  D3=GPIO4  D4=GPIO5  D5=GPIO6
//   D6=GPIO43 D7=GPIO44 D8=GPIO7   D9=GPIO8  D10=GPIO9
//   * GPIO3 is a strapping pin (JTAG source select) — left unused.
// Not used anywhere: strapping GPIO0/3/45/46, native USB GPIO19/20.
//
// ⚠ VERIFY EVERY LINE against the Seeed wiki pinout and your actual LoRa board
//   before wiring. See docs/hardware.md for the checklist.
#pragma once

// ---- I2C: BMP390 (0x77, or 0x76 with SDO jumper) + MAX-M10S (0x42)
#define PIN_I2C_SDA 5   // D4
#define PIN_I2C_SCL 6   // D5
#define I2C_FREQ_HZ 400000

// ---- SPI: shared by the ICM-42688-P and the SX1262
#define PIN_SPI_SCK 7   // D8
#define PIN_SPI_MISO 8  // D9
#define PIN_SPI_MOSI 9  // D10
#define PIN_IMU_CS 44   // D7 (it's also U0RXD; the console runs over native USB CDC, so it's free)

// ---- Wio-SX1262 — values for the "XIAO ESP32S3 & Wio-SX1262 kit", where the
// radio sits on the XIAO's bottom B2B connector (same as Meshtastic's
// seeed_xiao_s3 variant). The header-mounted "Wio-SX1262 for XIAO" board uses
// D-pins instead and may collide with I2C on D4/D5 — re-map if that's yours.
#define PIN_LORA_NSS 41
#define PIN_LORA_DIO1 39
#define PIN_LORA_RESET 42
#define PIN_LORA_BUSY 40
#define PIN_LORA_RXEN 38        // RF switch; DIO2 drives the TX side
#define LORA_TCXO_VOLTAGE 1.8f  // TCXO on DIO3

// ---- Feedback
#define PIN_PIEZO 1             // D0 → 1 kΩ → NPN base (2N3904 / S8050), piezo between 3V3 and collector
#define PIN_LED 21              // on-board user LED (yellow)
#define LED_ACTIVE_LOW 1        // XIAO S3 user LED lights when the pin is LOW — verify on your board
