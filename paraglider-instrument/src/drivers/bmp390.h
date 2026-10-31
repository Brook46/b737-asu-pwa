// BMP390 over I2C, normal (free-running) mode, non-blocking poll.
// Pressure x8, temperature x1, 25 Hz ODR, IIR coefficient 1 — the Kalman
// filter does the smoothing, so the sensor's own IIR is kept short (less lag).
#pragma once
#include <Wire.h>

#include "bmp390_comp.h"
#include "sensors.h"

class Bmp390 : public pg::BaroSource {
 public:
  // Tries 0x77 (Adafruit default) then 0x76.
  bool begin(TwoWire& wire);
  const char* name() const override { return "BMP390"; }
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
  pg::Bmp390Calib cal_{};
  uint32_t lastPoll_ = 0;
  uint32_t errors_ = 0;
};
