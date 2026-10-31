#include "bmp390.h"

#include <Arduino.h>

namespace {
constexpr uint8_t kRegChipId = 0x00;
constexpr uint8_t kRegErr = 0x02;
constexpr uint8_t kRegStatus = 0x03;
constexpr uint8_t kRegData = 0x04;  // press xlsb..msb, temp xlsb..msb
constexpr uint8_t kRegPwrCtrl = 0x1B;
constexpr uint8_t kRegOsr = 0x1C;
constexpr uint8_t kRegOdr = 0x1D;
constexpr uint8_t kRegConfig = 0x1F;
constexpr uint8_t kRegCalib = 0x31;
constexpr uint8_t kRegCmd = 0x7E;
constexpr uint8_t kChipIdBmp390 = 0x60;
constexpr uint8_t kChipIdBmp388 = 0x50;  // also accepted: same register map
}  // namespace

bool Bmp390::write(uint8_t reg, uint8_t v) {
  wire_->beginTransmission(addr_);
  wire_->write(reg);
  wire_->write(v);
  return wire_->endTransmission() == 0;
}

bool Bmp390::read(uint8_t reg, uint8_t* buf, size_t n) {
  wire_->beginTransmission(addr_);
  wire_->write(reg);
  if (wire_->endTransmission(false) != 0) return false;
  if (wire_->requestFrom(addr_, static_cast<uint8_t>(n)) != n) return false;
  for (size_t i = 0; i < n; ++i) buf[i] = wire_->read();
  return true;
}

bool Bmp390::probe(uint8_t addr) {
  addr_ = addr;
  uint8_t id = 0;
  return read(kRegChipId, &id, 1) && (id == kChipIdBmp390 || id == kChipIdBmp388);
}

bool Bmp390::begin(TwoWire& wire) {
  wire_ = &wire;
  ok_ = false;
  if (!probe(0x77) && !probe(0x76)) return false;
  write(kRegCmd, 0xB6);  // soft reset
  delay(10);
  uint8_t nvm[21];
  if (!read(kRegCalib, nvm, sizeof nvm)) return false;
  cal_ = pg::bmp390ParseCalib(nvm);
  // OSR: pressure x8 (3), temperature x1 (0) → ~19 ms per conversion, fits 25 Hz.
  write(kRegOsr, 0x03);
  write(kRegOdr, 0x03);            // 25 Hz
  write(kRegConfig, 1 << 1);       // IIR coefficient 1
  write(kRegPwrCtrl, 0x33);        // press + temp enabled, normal mode
  delay(5);
  uint8_t err = 0;
  read(kRegErr, &err, 1);
  if (err & 0x07) return false;    // fatal / cmd / conf error
  ok_ = true;
  return true;
}

bool Bmp390::poll(pg::BaroSample& out) {
  if (!ok_) return false;
  const uint32_t now = millis();
  if (now - lastPoll_ < 5) return false;  // don't hammer the bus
  lastPoll_ = now;
  uint8_t st = 0;
  if (!read(kRegStatus, &st, 1)) {
    ++errors_;
    return false;
  }
  if ((st & 0x60) != 0x60) return false;  // drdy_press | drdy_temp
  uint8_t d[6];
  if (!read(kRegData, d, sizeof d)) {
    ++errors_;
    return false;
  }
  const uint32_t rawP = d[0] | (d[1] << 8) | (static_cast<uint32_t>(d[2]) << 16);
  const uint32_t rawT = d[3] | (d[4] << 8) | (static_cast<uint32_t>(d[5]) << 16);
  const double t = pg::bmp390Temperature(cal_, rawT);
  out.t = now;
  out.tempC = static_cast<float>(t);
  out.pressurePa = static_cast<float>(pg::bmp390Pressure(cal_, rawP, t));
  out.valid = out.pressurePa > 30000 && out.pressurePa < 125000;
  return out.valid;
}
