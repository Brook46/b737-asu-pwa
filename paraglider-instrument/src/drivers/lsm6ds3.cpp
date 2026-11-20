#include "lsm6ds3.h"

#include <Arduino.h>

namespace {
constexpr uint8_t kWhoAmI = 0x0F;
constexpr uint8_t kCtrl1Xl = 0x10;  // ODR_XL[7:4] FS_XL[3:2] BW_XL[1:0]
constexpr uint8_t kCtrl2G = 0x11;   // ODR_G[7:4] FS_G[3:2]
constexpr uint8_t kCtrl3C = 0x12;   // BDU[6] IF_INC[2] SW_RESET[0]
constexpr uint8_t kStatus = 0x1E;   // TDA[2] GDA[1] XLDA[0]
constexpr uint8_t kOutTempL = 0x20; // burst: temp(2) gyro xyz(6) accel xyz(6), little-endian
constexpr uint8_t kIdLsm6ds3 = 0x69;
constexpr uint8_t kIdLsm6ds3c = 0x6A;  // LSM6DS3TR-C

constexpr uint8_t kAccel208Hz8g = 0x50 | 0x0C;
constexpr uint8_t kGyro208Hz1000dps = 0x50 | 0x08;
constexpr float kAccelGPerLsb = 0.244e-3f;  // ±8 g
constexpr float kGyroDpsPerLsb = 35e-3f;    // ±1000 dps

int16_t le16(const uint8_t* p) { return static_cast<int16_t>(p[0] | (p[1] << 8)); }
}  // namespace

bool Lsm6ds3::write(uint8_t reg, uint8_t v) {
  wire_->beginTransmission(addr_);
  wire_->write(reg);
  wire_->write(v);
  return wire_->endTransmission() == 0;
}

bool Lsm6ds3::read(uint8_t reg, uint8_t* buf, size_t n) {
  wire_->beginTransmission(addr_);
  wire_->write(reg);
  if (wire_->endTransmission(false) != 0) return false;
  if (wire_->requestFrom(addr_, static_cast<uint8_t>(n)) != n) return false;
  for (size_t i = 0; i < n; ++i) buf[i] = wire_->read();
  return true;
}

bool Lsm6ds3::begin(TwoWire& wire) {
  wire_ = &wire;
  ok_ = false;
  static const uint8_t kAddrs[] = {0x6A, 0x6B};
  for (uint8_t a : kAddrs) {
    addr_ = a;
    who_ = 0;
    if (read(kWhoAmI, &who_, 1) && (who_ == kIdLsm6ds3 || who_ == kIdLsm6ds3c)) break;
    who_ = 0;
  }
  if (!who_) return false;
  // Temperature sensitivity differs between the two parts (Seeed's library:
  // 16 LSB/°C on the LSM6DS3, 256 LSB/°C on the -C).
  tempLsbPerC_ = who_ == kIdLsm6ds3c ? 256.0f : 16.0f;
  write(kCtrl3C, 0x01);  // software reset
  delay(10);
  write(kCtrl3C, 0x44);  // block data update + register auto-increment
  write(kCtrl1Xl, kAccel208Hz8g);
  write(kCtrl2G, kGyro208Hz1000dps);
  delay(80);  // gyro turn-on time
  ok_ = true;
  return true;
}

bool Lsm6ds3::poll(pg::ImuSample& out) {
  if (!ok_) return false;
  uint8_t st = 0;
  if (!read(kStatus, &st, 1) || (st & 0x03) != 0x03) return false;  // need both accel and gyro
  uint8_t d[14];
  if (!read(kOutTempL, d, sizeof d)) return false;
  out.t = millis();
  out.tempC = 25.0f + le16(d) / tempLsbPerC_;
  const float g = pg::kDegToRad * kGyroDpsPerLsb;
  out.gx = le16(d + 2) * g;
  out.gy = le16(d + 4) * g;
  out.gz = le16(d + 6) * g;
  const float a = pg::kGravity * kAccelGPerLsb;
  out.ax = le16(d + 8) * a;
  out.ay = le16(d + 10) * a;
  out.az = le16(d + 12) * a;
  out.valid = true;
  return true;
}
