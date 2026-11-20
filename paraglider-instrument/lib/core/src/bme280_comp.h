// Bosch BME280 / BMP280 calibration and compensation (double-precision
// formulas from Bosch's BME280_SensorAPI, compensate_*()). The BMP280 is the
// same pressure/temperature core without humidity. Desktop-testable; the I2C
// part is src/drivers/bme280.*.
#pragma once
#include <cstdint>

namespace pg {

struct Bme280Calib {
  uint16_t t1;
  int16_t t2, t3;
  uint16_t p1;
  int16_t p2, p3, p4, p5, p6, p7, p8, p9;
  uint8_t h1, h3;
  int16_t h2, h4, h5;
  int8_t h6;
  bool hasHumidity = false;
};

// `tp` = 26 bytes from 0x88..0xA1. `hum` = 7 bytes from 0xE1..0xE7, or
// nullptr on a BMP280.
Bme280Calib bme280ParseCalib(const uint8_t tp[26], const uint8_t* hum);

struct Bme280Reading {
  double tempC, pressurePa, humidity;  // humidity in %RH, NaN-free: 0 if absent
};

// Raw ADC values: 20-bit temperature and pressure, 16-bit humidity.
Bme280Reading bme280Compensate(const Bme280Calib& c, int32_t adcT, int32_t adcP, int32_t adcH);

}  // namespace pg
