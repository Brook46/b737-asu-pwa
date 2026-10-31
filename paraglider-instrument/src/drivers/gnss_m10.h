// u-blox MAX-M10S over I2C (0x42), via the SparkFun u-blox GNSS v3 library.
// UBX-only output, 5 Hz NAV-PVT, airborne <1 g dynamic model. The M10 only
// accepts the VALSET configuration interface, which the v3 library uses.
#pragma once
#include <SparkFun_u-blox_GNSS_v3.h>
#include <Wire.h>

#include "sensors.h"

class GnssM10 : public pg::GnssSource {
 public:
  bool begin(TwoWire& wire, uint8_t rateHz = 5);
  const char* name() const override { return "MAX-M10S"; }
  bool poll(pg::GnssFix& out) override;
  bool present() const { return ok_; }
  // UTC from the last PVT (valid once the receiver has time).
  bool utc(int& y, int& mo, int& d, int& h, int& mi, int& s);

 private:
  SFE_UBLOX_GNSS gnss_;
  bool ok_ = false;
};
