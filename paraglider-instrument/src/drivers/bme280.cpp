#include "bme280.h"

#include <Arduino.h>

namespace {
constexpr uint8_t kRegCalibTp = 0x88;  // 26 bytes
constexpr uint8_t kRegChipId = 0xD0;
constexpr uint8_t kRegReset = 0xE0;
constexpr uint8_t kRegCalibH = 0xE1;   // 7 bytes
constexpr uint8_t kRegCtrlHum = 0xF2;  // must be written before CTRL_MEAS
constexpr uint8_t kRegStatus = 0xF3;   // im_update[0]
constexpr uint8_t kRegCtrlMeas = 0xF4; // osrs_t[7:5] osrs_p[4:2] mode[1:0]
constexpr uint8_t kRegConfig = 0xF5;   // t_sb[7:5] filter[4:2]
constexpr uint8_t kRegData = 0xF7;     // press(3) temp(3) hum(2)
constexpr uint8_t kIdBme280 = 0x60;
constexpr uint8_t kIdBmp280 = 0x58;

// osrs: 1 = ×1, 4 = ×8. Measurement ≈ 1 + 2·1 + (2·8+0.5) + (2·1+0.5) = 22 ms,
// standby 0.5 ms → ~44 Hz, comfortably above the 25 Hz we read.
constexpr uint8_t kCtrlMeas = (1 << 5) | (4 << 2) | 0x03;  // T×1, P×8, normal mode
constexpr uint8_t kConfig = (0 << 5) | (1 << 2);           // t_sb 0.5 ms, IIR 2
constexpr uint32_t kReadEveryMs = 40;
}  // namespace

bool Bme280::write(uint8_t reg, uint8_t v) {
  wire_->beginTransmission(addr_);
  wire_->write(reg);
  wire_->write(v);
  return wire_->endTransmission() == 0;
}

bool Bme280::read(uint8_t reg, uint8_t* buf, size_t n) {
  wire_->beginTransmission(addr_);
  wire_->write(reg);
  if (wire_->endTransmission(false) != 0) return false;
  if (wire_->requestFrom(addr_, static_cast<uint8_t>(n)) != n) return false;
  for (size_t i = 0; i < n; ++i) buf[i] = wire_->read();
  return true;
}

bool Bme280::begin(TwoWire& wire) {
  wire_ = &wire;
  ok_ = humidity_ = false;
  uint8_t id = 0;
  static const uint8_t kAddrs[] = {0x76, 0x77};  // Grove BME280 ships at 0x76
  for (uint8_t a : kAddrs) {
    addr_ = a;
    id = 0;
    if (read(kRegChipId, &id, 1) && (id == kIdBme280 || id == kIdBmp280)) break;
    id = 0;
  }
  if (!id) return false;
  humidity_ = id == kIdBme280;
  write(kRegReset, 0xB6);
  delay(5);
  for (int i = 0; i < 20; ++i) {  // wait for the NVM copy to finish
    uint8_t st = 0;
    if (read(kRegStatus, &st, 1) && !(st & 0x01)) break;
    delay(2);
  }
  uint8_t tp[26], h[7];
  if (!read(kRegCalibTp, tp, sizeof tp)) return false;
  if (humidity_ && !read(kRegCalibH, h, sizeof h)) return false;
  cal_ = pg::bme280ParseCalib(tp, humidity_ ? h : nullptr);
  if (humidity_) write(kRegCtrlHum, 0x01);  // H×1
  write(kRegConfig, kConfig);
  write(kRegCtrlMeas, kCtrlMeas);
  delay(30);
  ok_ = true;
  return true;
}

bool Bme280::poll(pg::BaroSample& out) {
  if (!ok_) return false;
  const uint32_t now = millis();
  if (now - lastPoll_ < kReadEveryMs) return false;
  lastPoll_ = now;
  uint8_t d[8];
  const size_t n = humidity_ ? 8 : 6;
  if (!read(kRegData, d, n)) return false;
  const int32_t adcP = (static_cast<int32_t>(d[0]) << 12) | (d[1] << 4) | (d[2] >> 4);
  const int32_t adcT = (static_cast<int32_t>(d[3]) << 12) | (d[4] << 4) | (d[5] >> 4);
  const int32_t adcH = humidity_ ? ((d[6] << 8) | d[7]) : 0;
  if (adcP == 0x80000) return false;  // "skipped" marker before the first conversion
  const pg::Bme280Reading r = pg::bme280Compensate(cal_, adcT, adcP, adcH);
  tempC_ = static_cast<float>(r.tempC);
  rh_ = static_cast<float>(r.humidity);
  out.t = now;
  out.tempC = tempC_;
  out.pressurePa = static_cast<float>(r.pressurePa);
  out.valid = out.pressurePa > 30000 && out.pressurePa < 125000;
  return out.valid;
}
