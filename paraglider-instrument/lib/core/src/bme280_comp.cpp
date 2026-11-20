#include "bme280_comp.h"

namespace pg {

namespace {
uint16_t u16(const uint8_t* p) { return static_cast<uint16_t>(p[0] | (p[1] << 8)); }
int16_t s16(const uint8_t* p) { return static_cast<int16_t>(u16(p)); }
}  // namespace

Bme280Calib bme280ParseCalib(const uint8_t tp[26], const uint8_t* hum) {
  Bme280Calib c{};
  c.t1 = u16(tp + 0);
  c.t2 = s16(tp + 2);
  c.t3 = s16(tp + 4);
  c.p1 = u16(tp + 6);
  c.p2 = s16(tp + 8);
  c.p3 = s16(tp + 10);
  c.p4 = s16(tp + 12);
  c.p5 = s16(tp + 14);
  c.p6 = s16(tp + 16);
  c.p7 = s16(tp + 18);
  c.p8 = s16(tp + 20);
  c.p9 = s16(tp + 22);
  c.h1 = tp[25];  // 0xA1 (0xA0 is reserved)
  if (hum) {
    c.h2 = s16(hum + 0);
    c.h3 = hum[2];
    c.h4 = static_cast<int16_t>(static_cast<int16_t>(static_cast<int8_t>(hum[3])) * 16 | (hum[4] & 0x0F));
    c.h5 = static_cast<int16_t>(static_cast<int16_t>(static_cast<int8_t>(hum[5])) * 16 | (hum[4] >> 4));
    c.h6 = static_cast<int8_t>(hum[6]);
    c.hasHumidity = true;
  }
  return c;
}

Bme280Reading bme280Compensate(const Bme280Calib& c, int32_t adcT, int32_t adcP, int32_t adcH) {
  Bme280Reading r{0, 0, 0};
  double v1 = (adcT / 16384.0 - c.t1 / 1024.0) * c.t2;
  double v2 = (adcT / 131072.0 - c.t1 / 8192.0);
  v2 = v2 * v2 * c.t3;
  const int32_t tFine = static_cast<int32_t>(v1 + v2);
  r.tempC = (v1 + v2) / 5120.0;

  v1 = tFine / 2.0 - 64000.0;
  v2 = v1 * v1 * c.p6 / 32768.0;
  v2 = v2 + v1 * c.p5 * 2.0;
  v2 = v2 / 4.0 + c.p4 * 65536.0;
  const double v3 = c.p3 * v1 * v1 / 524288.0;
  v1 = (v3 + c.p2 * v1) / 524288.0;
  v1 = (1.0 + v1 / 32768.0) * c.p1;
  if (v1 > 0.0) {
    double p = 1048576.0 - adcP;
    p = (p - v2 / 4096.0) * 6250.0 / v1;
    const double a = c.p9 * p * p / 2147483648.0;
    const double b = p * c.p8 / 32768.0;
    r.pressurePa = p + (a + b + c.p7) / 16.0;
  }

  if (c.hasHumidity) {
    const double h1 = tFine - 76800.0;
    const double h2 = c.h4 * 64.0 + (c.h5 / 16384.0) * h1;
    const double h3 = adcH - h2;
    const double h4 = c.h2 / 65536.0;
    const double h5 = 1.0 + (c.h3 / 67108864.0) * h1;
    double h6 = 1.0 + (c.h6 / 67108864.0) * h1 * h5;
    h6 = h3 * h4 * (h5 * h6);
    double h = h6 * (1.0 - c.h1 * h6 / 524288.0);
    if (h > 100.0) h = 100.0;
    if (h < 0.0) h = 0.0;
    r.humidity = h;
  }
  return r;
}

}  // namespace pg
