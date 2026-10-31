// TDK ICM-42688-P over SPI — minimal register driver, no library.
// Accel ±8 g, gyro ±1000 dps, both 200 Hz low-noise mode; polled via the
// data-ready bit, one 14-byte burst read per sample.
#pragma once
#include <SPI.h>

#include "sensors.h"

class Icm42688 : public pg::ImuSource {
 public:
  bool begin(SPIClass& spi, int csPin);
  const char* name() const override { return "ICM-42688-P"; }
  bool poll(pg::ImuSample& out) override;
  bool present() const { return ok_; }
  uint8_t whoAmI();

 private:
  void write(uint8_t reg, uint8_t v);
  uint8_t read(uint8_t reg);
  void readBurst(uint8_t reg, uint8_t* buf, size_t n);
  SPIClass* spi_ = nullptr;
  int cs_ = -1;
  bool ok_ = false;
};
