// ST LSM6DS3 / LSM6DS3TR-C 6-axis IMU (Grove "6-Axis Accelerometer &
// Gyroscope", I2C 0x6A, or 0x6B). Accel ±8 g and gyro ±1000 dps at 208 Hz,
// polled through the status register, one 14-byte burst per sample.
// Registers checked against Seeed_Arduino_LSM6DS3.
#pragma once
#include <Wire.h>

#include "sensors.h"

class Lsm6ds3 : public pg::ImuSource {
 public:
  bool begin(TwoWire& wire);
  const char* name() const override { return "LSM6DS3"; }
  bool poll(pg::ImuSample& out) override;
  bool present() const { return ok_; }
  uint8_t whoAmI() const { return who_; }

 private:
  bool write(uint8_t reg, uint8_t v);
  bool read(uint8_t reg, uint8_t* buf, size_t n);
  TwoWire* wire_ = nullptr;
  uint8_t addr_ = 0x6A;
  uint8_t who_ = 0;
  float tempLsbPerC_ = 16.0f;
  bool ok_ = false;
};
