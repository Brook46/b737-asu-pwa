// Bosch BME280 (Grove "Temp & Humi & Barometer", 0x76 / 0x77) — also drives
// the BMP280 (same core, no humidity). Normal mode: pressure ×8, temperature
// ×1, humidity ×1, IIR 2, ~40 Hz; poll() reads at most every 40 ms.
// Registers and math checked against Bosch's BME280_SensorAPI.
#pragma once
#include <Wire.h>

#include "bme280_comp.h"
#include "sensors.h"

class Bme280 : public pg::BaroSource {
 public:
  bool begin(TwoWire& wire);
  const char* name() const override { return humidity_ ? "BME280" : "BMP280"; }
  bool poll(pg::BaroSample& out) override;
  bool present() const { return ok_; }
  bool hasHumidity() const { return humidity_; }
  uint8_t address() const { return addr_; }
  // Latest case temperature and humidity (valid after the first poll).
  float tempC() const { return tempC_; }
  float humidity() const { return rh_; }

 private:
  bool write(uint8_t reg, uint8_t v);
  bool read(uint8_t reg, uint8_t* buf, size_t n);
  TwoWire* wire_ = nullptr;
  uint8_t addr_ = 0;
  bool ok_ = false, humidity_ = false;
  pg::Bme280Calib cal_{};
  float tempC_ = 0, rh_ = 0;
  uint32_t lastPoll_ = 0;
};
