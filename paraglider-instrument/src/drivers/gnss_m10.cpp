#include "gnss_m10.h"

#include <Arduino.h>

bool GnssM10::begin(TwoWire& wire, uint8_t rateHz) {
  ok_ = false;
  if (!gnss_.begin(wire, 0x42)) return false;
  // Every setter below is best-effort: a failure leaves the receiver on its
  // defaults (1 Hz, portable model), which still works for bring-up.
  gnss_.setI2COutput(COM_TYPE_UBX);
  gnss_.setDynamicModel(DYN_MODEL_AIRBORNE1g);
  gnss_.setNavigationFrequency(rateHz);
  gnss_.setAutoPVT(true);
  ok_ = true;
  return true;
}

bool GnssM10::poll(pg::GnssFix& out) {
  if (!ok_) return false;
  // With auto-PVT, getPVT() returns true once per new navigation solution and
  // never blocks waiting for one.
  if (!gnss_.getPVT()) return false;
  out.t = millis();
  const uint8_t ft = gnss_.getFixType();  // 0 none, 2 2D, 3 3D, 4 GNSS+DR
  const bool fixOk = gnss_.getGnssFixOk();
  out.fix = !fixOk ? pg::FixType::None : (ft >= 3 ? pg::FixType::Fix3D : ft == 2 ? pg::FixType::Fix2D : pg::FixType::None);
  out.sats = gnss_.getSIV();
  out.lat = gnss_.getLatitude() * 1e-7;
  out.lon = gnss_.getLongitude() * 1e-7;
  out.altMsl = gnss_.getAltitudeMSL() * 1e-3f;
  out.groundSpeed = gnss_.getGroundSpeed() * 1e-3f;  // mm/s → m/s
  out.trackDeg = gnss_.getHeading() * 1e-5f;         // motion heading, 1e-5 deg
  out.velN = gnss_.getNedNorthVel() * 1e-3f;
  out.velE = gnss_.getNedEastVel() * 1e-3f;
  out.hAcc = gnss_.getHorizontalAccEst() * 1e-3f;
  return true;
}

bool GnssM10::utc(int& y, int& mo, int& d, int& h, int& mi, int& s) {
  if (!ok_ || !gnss_.getTimeValid() || !gnss_.getDateValid()) return false;
  y = gnss_.getYear();
  mo = gnss_.getMonth();
  d = gnss_.getDay();
  h = gnss_.getHour();
  mi = gnss_.getMinute();
  s = gnss_.getSecond();
  return true;
}
