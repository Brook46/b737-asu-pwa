#include "xctracer_source.h"

#include <Arduino.h>

#include <cmath>

void XcTracerSource::service() {
  uint8_t buf[128];
  size_t n;
  while ((n = ble_.readXct(buf, sizeof buf)) > 0) {
    la_.feed(buf, n, [this](const char* line, size_t) { onLine(line); });
  }
}

void XcTracerSource::onLine(const char* line) {
  if (echo) {
    // "<ms> <sentence>" — exactly the capture format tools/sim --xct replays.
    Serial.printf("%lu %s\n", static_cast<unsigned long>(millis()), line);
  }
  const uint32_t now = millis();
  pg::Lk8ex1 lk;
  pg::Xctrc xc;
  if (pg::parseLk8ex1(line, lk)) {
    ++good_;
    if (lk.hasPressure) {
      baro_.t = now;
      baro_.pressurePa = lk.pressurePa;
      baro_.tempC = lk.hasTemp ? lk.tempC : 0;
      baro_.valid = true;
      baroNew_ = true;
    } else if (lk.hasAltitude) {
      altT_ = now;
      alt_ = lk.altitude;
      altNew_ = true;
    }
    if (lk.hasVario) vario_ = lk.vario;
    if (lk.batteryPct >= 0) battery_ = lk.batteryPct;
  } else if (pg::parseXctrc(line, xc)) {
    ++good_;
    if (xc.rawPressure > 0) {
      baro_.t = now;
      baro_.pressurePa = xc.rawPressure;
      baro_.valid = true;
      baroNew_ = true;
    }
    vario_ = xc.climb;
    if (xc.batteryPct >= 0) battery_ = xc.batteryPct;
    gnss_ = pg::GnssFix{};
    gnss_.t = now;
    if (xc.hasFix) {
      gnss_.fix = pg::FixType::Fix3D;  // XCTRC carries no fix type; a position means a fix
      gnss_.lat = xc.lat;
      gnss_.lon = xc.lon;
      gnss_.altMsl = xc.altitude;
      gnss_.groundSpeed = xc.speedKmh / 3.6f;
      gnss_.trackDeg = xc.course;
      gnss_.velN = gnss_.groundSpeed * std::cos(xc.course * pg::kDegToRad);
      gnss_.velE = gnss_.groundSpeed * std::sin(xc.course * pg::kDegToRad);
    }
    gnssNew_ = true;
  } else if (line[0] == '$') {
    ++bad_;
  }
}

bool XcTracerSource::poll(pg::BaroSample& out) {
  if (!baroNew_) return false;
  baroNew_ = false;
  out = baro_;
  return true;
}

bool XcTracerSource::poll(pg::GnssFix& out) {
  if (!gnssNew_) return false;
  gnssNew_ = false;
  out = gnss_;
  return true;
}

bool XcTracerSource::pollAltitude(uint32_t& t, float& alt) {
  if (!altNew_) return false;
  altNew_ = false;
  t = altT_;
  alt = alt_;
  return true;
}
