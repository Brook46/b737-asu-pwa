// Infineon DPS310 barometer (Grove "High Precision Barometer", 0x77 / 0x76),
// I2C, background mode: pressure 32 Hz with 8× oversampling, temperature
// 2 Hz. Non-blocking: poll() reads whatever finished since the last call.
// Register map and math checked against Infineon's arduino-xensiv-dps3xx.
#pragma once
#include <Wire.h>

#include "dps310_comp.h"
#include "sensors.h"

class Dps310 : public pg::BaroSource {
 public:
  bool begin(TwoWire& wire);
  const char* name() const override { return "DPS310"; }
  bool poll(pg::BaroSample& out) override;
  uint8_t address() const { return addr_; }
  bool present() const { return ok_; }

 private:
  bool write(uint8_t reg, uint8_t v);
  bool read(uint8_t reg, uint8_t* buf, size_t n);
  bool probe(uint8_t addr);
  TwoWire* wire_ = nullptr;
  uint8_t addr_ = 0;
  bool ok_ = false;
  pg::Dps310Calib cal_{};
  double tRawSc_ = 0;  // last scaled raw temperature, used to compensate pressure
  double tempC_ = 0;
  bool haveTemp_ = false;
  uint32_t lastPoll_ = 0;
};
