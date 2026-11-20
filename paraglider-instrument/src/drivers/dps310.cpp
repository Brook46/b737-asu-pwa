#include "dps310.h"

#include <Arduino.h>

namespace {
constexpr uint8_t kRegPsr = 0x00;     // PSR_B2..B0, then TMP_B2..B0
constexpr uint8_t kRegTmp = 0x03;
constexpr uint8_t kRegPrsCfg = 0x06;  // PM_RATE[6:4] PM_PRC[3:0]
constexpr uint8_t kRegTmpCfg = 0x07;  // TMP_EXT[7] TMP_RATE[6:4] TMP_PRC[3:0]
constexpr uint8_t kRegMeasCfg = 0x08; // COEF_RDY[7] SENSOR_RDY[6] TMP_RDY[5] PRS_RDY[4] MEAS_CTRL[2:0]
constexpr uint8_t kRegCfg = 0x09;     // T_SHIFT[3] P_SHIFT[2]
constexpr uint8_t kRegReset = 0x0C;
constexpr uint8_t kRegProdId = 0x0D;
constexpr uint8_t kRegCoef = 0x10;    // 18 bytes
constexpr uint8_t kRegCoefSrc = 0x28; // TMP_COEF_SRCE[7]

constexpr uint8_t kPrsRate = 5;  // 32 Hz
constexpr uint8_t kPrsOsr = 3;   // 8×, 14.8 ms per measurement
constexpr uint8_t kTmpRate = 1;  // 2 Hz
constexpr uint8_t kTmpOsr = 0;   // 1×
constexpr uint8_t kContBoth = 0x07;
}  // namespace

bool Dps310::write(uint8_t reg, uint8_t v) {
  wire_->beginTransmission(addr_);
  wire_->write(reg);
  wire_->write(v);
  return wire_->endTransmission() == 0;
}

bool Dps310::read(uint8_t reg, uint8_t* buf, size_t n) {
  wire_->beginTransmission(addr_);
  wire_->write(reg);
  if (wire_->endTransmission(false) != 0) return false;
  if (wire_->requestFrom(addr_, static_cast<uint8_t>(n)) != n) return false;
  for (size_t i = 0; i < n; ++i) buf[i] = wire_->read();
  return true;
}

bool Dps310::probe(uint8_t addr) {
  addr_ = addr;
  uint8_t id = 0;
  // PROD_ID = 0x10 on the DPS310 (product 0, revision 1). Accept any revision.
  return read(kRegProdId, &id, 1) && (id & 0x0F) == 0x00 && id != 0x00;
}

bool Dps310::begin(TwoWire& wire) {
  wire_ = &wire;
  ok_ = false;
  if (!probe(0x77) && !probe(0x76)) return false;
  write(kRegReset, 0x09);  // soft reset + FIFO flush
  delay(40);

  // Wait for calibration coefficients and sensor init (datasheet: ≤ 40 ms).
  uint8_t meas = 0;
  for (int i = 0; i < 20; ++i) {
    if (read(kRegMeasCfg, &meas, 1) && (meas & 0xC0) == 0xC0) break;
    delay(5);
  }
  if ((meas & 0xC0) != 0xC0) return false;

  uint8_t coef[18];
  if (!read(kRegCoef, coef, sizeof coef)) return false;
  cal_ = pg::dps310ParseCalib(coef);

  // Use the temperature sensor the coefficients were calibrated against.
  uint8_t src = 0;
  read(kRegCoefSrc, &src, 1);
  const uint8_t tmpExt = src & 0x80;

  // Fix for parts with a temperature fuse bit problem (same sequence as
  // Infineon's correctTemp(); harmless on good parts).
  write(0x0E, 0xA5);
  write(0x0F, 0x96);
  write(0x62, 0x02);
  write(0x0E, 0x00);
  write(0x0F, 0x00);

  write(kRegPrsCfg, (kPrsRate << 4) | kPrsOsr);
  write(kRegTmpCfg, tmpExt | (kTmpRate << 4) | kTmpOsr);
  // Result bit-shift is required for oversampling > 8×; off here.
  write(kRegCfg, (kTmpOsr > 3 ? 0x08 : 0) | (kPrsOsr > 3 ? 0x04 : 0));
  write(kRegMeasCfg, kContBoth);
  ok_ = true;
  return true;
}

bool Dps310::poll(pg::BaroSample& out) {
  if (!ok_) return false;
  const uint32_t now = millis();
  if (now - lastPoll_ < 5) return false;
  lastPoll_ = now;
  uint8_t meas = 0;
  if (!read(kRegMeasCfg, &meas, 1)) return false;

  if (meas & 0x20) {  // TMP_RDY
    uint8_t b[3];
    if (read(kRegTmp, b, 3)) {
      tRawSc_ = static_cast<double>(pg::dps310Raw24(b)) / pg::dps310ScaleFactor(kTmpOsr);
      tempC_ = pg::dps310Temperature(cal_, tRawSc_);
      haveTemp_ = true;
    }
  }
  if (!(meas & 0x10) || !haveTemp_) return false;  // PRS_RDY, and we need a temperature first
  uint8_t b[3];
  if (!read(kRegPsr, b, 3)) return false;
  const double pRawSc = static_cast<double>(pg::dps310Raw24(b)) / pg::dps310ScaleFactor(kPrsOsr);
  out.t = now;
  out.tempC = static_cast<float>(tempC_);
  out.pressurePa = static_cast<float>(pg::dps310Pressure(cal_, pRawSc, tRawSc_));
  out.valid = out.pressurePa > 30000 && out.pressurePa < 125000;
  return out.valid;
}
