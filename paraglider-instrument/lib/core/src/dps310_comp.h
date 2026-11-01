// DPS310 calibration and compensation (Infineon DPS310 datasheet §4.9, the
// same math as Infineon's arduino-xensiv-dps3xx library). Lives in lib/core so
// it builds and is tested on the desktop; the I2C part is src/drivers/dps310.*.
#pragma once
#include <cstdint>

namespace pg {

struct Dps310Calib {
  int32_t c0, c1, c00, c10, c01, c11, c20, c21, c30;
};

// `coef` = the 18 bytes read from register 0x10..0x21.
Dps310Calib dps310ParseCalib(const uint8_t coef[18]);
// Scale factor kP/kT for an oversampling setting (register value 0..7).
int32_t dps310ScaleFactor(uint8_t osr);
// 24-bit two's-complement raw value from three bytes, MSB first.
int32_t dps310Raw24(const uint8_t b[3]);
// Compensated temperature (°C) from the scaled raw temperature.
double dps310Temperature(const Dps310Calib& c, double tRawSc);
// Compensated pressure (Pa) from scaled raw pressure and temperature.
double dps310Pressure(const Dps310Calib& c, double pRawSc, double tRawSc);

}  // namespace pg
