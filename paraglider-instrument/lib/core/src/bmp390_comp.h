// BMP390 calibration and compensation (floating-point formulas, Bosch BMP390
// datasheet §8.4–8.6 / BMP3 SensorAPI). Lives in lib/core so it builds and
// runs on the desktop; the I2C part is in src/drivers/bmp390.*.
#pragma once
#include <cstdint>

namespace pg {

struct Bmp390Calib {
  double t1, t2, t3;
  double p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11;
};

// `nvm` = the 21 bytes read from register 0x31..0x45.
Bmp390Calib bmp390ParseCalib(const uint8_t nvm[21]);
// Raw 24-bit ADC values → °C and Pa.
double bmp390Temperature(const Bmp390Calib& c, uint32_t rawT);
double bmp390Pressure(const Bmp390Calib& c, uint32_t rawP, double tempC);

}  // namespace pg
