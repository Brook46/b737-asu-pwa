#include "icm42688.h"

#include <Arduino.h>

namespace {
// Bank 0 registers (ICM-42688-P datasheet DS-000347 §14)
constexpr uint8_t kDeviceConfig = 0x11;
constexpr uint8_t kTempData1 = 0x1D;  // burst: temp(2) accel xyz(6) gyro xyz(6), big-endian
constexpr uint8_t kIntStatus = 0x2D;  // bit3 DATA_RDY_INT, cleared on read
constexpr uint8_t kPwrMgmt0 = 0x4E;
constexpr uint8_t kGyroConfig0 = 0x4F;
constexpr uint8_t kAccelConfig0 = 0x50;
constexpr uint8_t kWhoAmI = 0x75;
constexpr uint8_t kBankSel = 0x76;
constexpr uint8_t kWhoAmIValue = 0x47;

// FS_SEL in bits 7:5, ODR in bits 3:0. ODR 0x7 = 200 Hz.
constexpr uint8_t kGyro1000dps200Hz = (1 << 5) | 0x07;
constexpr uint8_t kAccel8g200Hz = (1 << 5) | 0x07;
constexpr float kAccelLsbPerG = 4096.0f;   // ±8 g
constexpr float kGyroLsbPerDps = 32.8f;    // ±1000 dps

const SPISettings kSpi(8000000, MSBFIRST, SPI_MODE0);

int16_t be16(const uint8_t* p) { return static_cast<int16_t>((p[0] << 8) | p[1]); }
}  // namespace

void Icm42688::write(uint8_t reg, uint8_t v) {
  spi_->beginTransaction(kSpi);
  digitalWrite(cs_, LOW);
  spi_->transfer(reg & 0x7F);
  spi_->transfer(v);
  digitalWrite(cs_, HIGH);
  spi_->endTransaction();
}

uint8_t Icm42688::read(uint8_t reg) {
  spi_->beginTransaction(kSpi);
  digitalWrite(cs_, LOW);
  spi_->transfer(reg | 0x80);
  const uint8_t v = spi_->transfer(0);
  digitalWrite(cs_, HIGH);
  spi_->endTransaction();
  return v;
}

void Icm42688::readBurst(uint8_t reg, uint8_t* buf, size_t n) {
  spi_->beginTransaction(kSpi);
  digitalWrite(cs_, LOW);
  spi_->transfer(reg | 0x80);
  for (size_t i = 0; i < n; ++i) buf[i] = spi_->transfer(0);
  digitalWrite(cs_, HIGH);
  spi_->endTransaction();
}

uint8_t Icm42688::whoAmI() { return spi_ ? read(kWhoAmI) : 0; }

bool Icm42688::begin(SPIClass& spi, int csPin) {
  spi_ = &spi;
  cs_ = csPin;
  ok_ = false;
  pinMode(cs_, OUTPUT);
  digitalWrite(cs_, HIGH);
  delay(2);
  write(kBankSel, 0);
  write(kDeviceConfig, 0x01);  // soft reset
  delay(2);                    // datasheet: 1 ms
  write(kBankSel, 0);
  if (read(kWhoAmI) != kWhoAmIValue) return false;
  write(kGyroConfig0, kGyro1000dps200Hz);
  write(kAccelConfig0, kAccel8g200Hz);
  write(kPwrMgmt0, 0x0F);  // gyro + accel low-noise mode
  delayMicroseconds(300);  // no register writes for 200 µs after PWR_MGMT0
  delay(50);               // gyro start-up time ~45 ms
  ok_ = true;
  return true;
}

bool Icm42688::poll(pg::ImuSample& out) {
  if (!ok_) return false;
  if (!(read(kIntStatus) & 0x08)) return false;
  uint8_t d[14];
  readBurst(kTempData1, d, sizeof d);
  const int16_t ax = be16(d + 2), ay = be16(d + 4), az = be16(d + 6);
  if (ax == -32768 && ay == -32768 && az == -32768) return false;  // "no data" marker
  out.t = millis();
  out.tempC = be16(d) / 132.48f + 25.0f;
  const float a = pg::kGravity / kAccelLsbPerG;
  const float g = pg::kDegToRad / kGyroLsbPerDps;
  out.ax = ax * a;
  out.ay = ay * a;
  out.az = az * a;
  out.gx = be16(d + 8) * g;
  out.gy = be16(d + 10) * g;
  out.gz = be16(d + 12) * g;
  out.valid = true;
  return true;
}
