#include "bmp390_comp.h"

#include <cmath>

namespace pg {

namespace {
uint16_t u16(const uint8_t* p) { return static_cast<uint16_t>(p[0] | (p[1] << 8)); }
int16_t s16(const uint8_t* p) { return static_cast<int16_t>(u16(p)); }
int8_t s8(const uint8_t* p) { return static_cast<int8_t>(p[0]); }
}  // namespace

Bmp390Calib bmp390ParseCalib(const uint8_t n[21]) {
  // Register map (offsets from 0x31):
  //  0 T1 u16 | 2 T2 u16 | 4 T3 s8 | 5 P1 s16 | 7 P2 s16 | 9 P3 s8 | 10 P4 s8
  // 11 P5 u16 | 13 P6 u16 | 15 P7 s8 | 16 P8 s8 | 17 P9 s16 | 19 P10 s8 | 20 P11 s8
  Bmp390Calib c;
  c.t1 = u16(n + 0) / std::pow(2.0, -8);
  c.t2 = u16(n + 2) / std::pow(2.0, 30);
  c.t3 = s8(n + 4) / std::pow(2.0, 48);
  c.p1 = (s16(n + 5) - 16384) / std::pow(2.0, 20);
  c.p2 = (s16(n + 7) - 16384) / std::pow(2.0, 29);
  c.p3 = s8(n + 9) / std::pow(2.0, 32);
  c.p4 = s8(n + 10) / std::pow(2.0, 37);
  c.p5 = u16(n + 11) / std::pow(2.0, -3);
  c.p6 = u16(n + 13) / std::pow(2.0, 6);
  c.p7 = s8(n + 15) / std::pow(2.0, 8);
  c.p8 = s8(n + 16) / std::pow(2.0, 15);
  c.p9 = s16(n + 17) / std::pow(2.0, 48);
  c.p10 = s8(n + 19) / std::pow(2.0, 48);
  c.p11 = s8(n + 20) / std::pow(2.0, 65);
  return c;
}

double bmp390Temperature(const Bmp390Calib& c, uint32_t rawT) {
  const double d1 = static_cast<double>(rawT) - c.t1;
  const double d2 = d1 * c.t2;
  return d2 + d1 * d1 * c.t3;
}

double bmp390Pressure(const Bmp390Calib& c, uint32_t rawP, double t) {
  const double up = rawP;
  const double t2 = t * t, t3 = t2 * t;
  const double out1 = c.p5 + c.p6 * t + c.p7 * t2 + c.p8 * t3;
  const double out2 = up * (c.p1 + c.p2 * t + c.p3 * t2 + c.p4 * t3);
  const double up2 = up * up;
  const double out3 = up2 * (c.p9 + c.p10 * t) + up2 * up * c.p11;
  return out1 + out2 + out3;
}

}  // namespace pg
