#include "dps310_comp.h"

namespace pg {

namespace {
int32_t twos(uint32_t v, int bits) {
  if (v & (1u << (bits - 1))) return static_cast<int32_t>(v) - static_cast<int32_t>(1u << bits);
  return static_cast<int32_t>(v);
}
const int32_t kScale[8] = {524288, 1572864, 3670016, 7864320, 253952, 516096, 1040384, 2088960};
}  // namespace

Dps310Calib dps310ParseCalib(const uint8_t b[18]) {
  Dps310Calib c;
  c.c0 = twos((static_cast<uint32_t>(b[0]) << 4) | (b[1] >> 4), 12);
  c.c1 = twos((static_cast<uint32_t>(b[1] & 0x0F) << 8) | b[2], 12);
  c.c00 = twos((static_cast<uint32_t>(b[3]) << 12) | (static_cast<uint32_t>(b[4]) << 4) | (b[5] >> 4), 20);
  c.c10 = twos((static_cast<uint32_t>(b[5] & 0x0F) << 16) | (static_cast<uint32_t>(b[6]) << 8) | b[7], 20);
  c.c01 = twos((static_cast<uint32_t>(b[8]) << 8) | b[9], 16);
  c.c11 = twos((static_cast<uint32_t>(b[10]) << 8) | b[11], 16);
  c.c20 = twos((static_cast<uint32_t>(b[12]) << 8) | b[13], 16);
  c.c21 = twos((static_cast<uint32_t>(b[14]) << 8) | b[15], 16);
  c.c30 = twos((static_cast<uint32_t>(b[16]) << 8) | b[17], 16);
  return c;
}

int32_t dps310ScaleFactor(uint8_t osr) { return kScale[osr & 7]; }

int32_t dps310Raw24(const uint8_t b[3]) {
  return twos((static_cast<uint32_t>(b[0]) << 16) | (static_cast<uint32_t>(b[1]) << 8) | b[2], 24);
}

double dps310Temperature(const Dps310Calib& c, double t) { return c.c0 * 0.5 + c.c1 * t; }

double dps310Pressure(const Dps310Calib& c, double p, double t) {
  return c.c00 + p * (c.c10 + p * (c.c20 + p * c.c30)) + t * (c.c01 + p * (c.c11 + p * c.c21));
}

}  // namespace pg
