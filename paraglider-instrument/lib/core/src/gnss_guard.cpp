#include "gnss_guard.h"

#include <cmath>

#include "circling.h"

namespace pg {

namespace {
constexpr int kMinSats = 5;
constexpr float kMaxHAcc = 40.0f;           // m
constexpr float kMaxGroundSpeed = 35.0f;    // m/s ≈ 126 km/h
constexpr float kJumpBaseM = 40.0f, kJumpPerS = 20.0f;
constexpr float kMaxAltDisagreeM = 150.0f;
constexpr TimeMs kMotionWindowMs = 25000;
constexpr float kMotionTurnDeg = 270.0f, kMotionAgreeDeg = 60.0f;
constexpr int kBadToTrip = 3;
constexpr TimeMs kBadWindowMs = 5000;
constexpr TimeMs kRecoverMs = 20000, kFirstFixMs = 2000;
constexpr TimeMs kSilentMs = 3000;
constexpr float kDrErrPerS = 2.0f, kDrErrNoHeadingPerS = 8.0f, kDrMaxErr = 5000.0f;
constexpr double kMPerDeg = 111195.0;

double distM(double lat1, double lon1, double lat2, double lon2) {
  const double dN = (lat2 - lat1) * kMPerDeg;
  const double dE = (lon2 - lon1) * kMPerDeg * std::cos(lat1 * 0.0174533);
  return std::sqrt(dN * dN + dE * dE);
}
}  // namespace

const char* gpsStateName(GpsState s) {
  switch (s) {
    case GpsState::NoData: return "searching";
    case GpsState::Ok: return "ok";
    case GpsState::Lost: return "LOST";
    case GpsState::Spoofed: return "SPOOFED";
  }
  return "?";
}

const char* gpsReasonName(GpsReason r) {
  switch (r) {
    case GpsReason::None: return "";
    case GpsReason::NoFix: return "no fix";
    case GpsReason::Weak: return "weak fix";
    case GpsReason::Jump: return "position jumps";
    case GpsReason::Speed: return "impossible speed";
    case GpsReason::Altitude: return "altitude disagrees with baro";
    case GpsReason::Motion: return "track disagrees with gyro";
  }
  return "?";
}

void GnssGuard::reset() { *this = GnssGuard(); }

void GnssGuard::setState(TimeMs t, GpsState s, GpsReason r) {
  if (s != state_) since_ = t;
  state_ = s;
  reason_ = r;
}

void GnssGuard::bad(TimeMs t, GpsReason r) {
  if (!firstBad_ || t - firstBad_ > kBadWindowMs) {
    firstBad_ = t;
    badCount_ = 0;
  }
  ++badCount_;
  goodRunStart_ = 0;
  const bool spoofy = r == GpsReason::Altitude || r == GpsReason::Motion;
  if (state_ == GpsState::Ok) {
    // A gyro/track contradiction over a whole window is conclusive on its own.
    if (badCount_ >= kBadToTrip || r == GpsReason::Motion)
      setState(t, spoofy ? GpsState::Spoofed : GpsState::Lost, r);
  } else if (state_ != GpsState::NoData) {
    if (spoofy && state_ == GpsState::Lost) setState(t, GpsState::Spoofed, r);
    else reason_ = r;
  }
}

bool GnssGuard::check(const GnssFix& f, float baroAlt, float gyroTurnDeg) {
  const TimeMs t = f.t;
  lastFixT_ = t;
  GpsReason r = GpsReason::None;
  if (!f.valid()) {
    r = GpsReason::NoFix;
  } else if (f.sats < kMinSats || f.hAcc > kMaxHAcc) {
    r = GpsReason::Weak;
  } else if (f.groundSpeed > kMaxGroundSpeed) {
    r = GpsReason::Speed;
  } else {
    if (havePrev_ && t > prev_.t && t - prev_.t < 3000) {
      const float dt = (t - prev_.t) / 1000.0f;
      const double pLat = prev_.lat + prev_.velN * dt / kMPerDeg;
      const double pLon = prev_.lon + prev_.velE * dt / (kMPerDeg * std::cos(prev_.lat * 0.0174533));
      if (distM(pLat, pLon, f.lat, f.lon) > kJumpBaseM + kJumpPerS * dt) r = GpsReason::Jump;
    }
    if (r == GpsReason::None && haveOffset_ && !std::isnan(baroAlt) &&
        std::fabs(f.altMsl - baroAlt - altOffset_) > kMaxAltDisagreeM)
      r = GpsReason::Altitude;
    // Gyro vs track over a window: the gyro can't be spoofed.
    if (havePrev_ && !std::isnan(gyroTurnDeg)) {
      if (!motionStart_) motionStart_ = t;
      gyroAcc_ += gyroTurnDeg;
      if (f.groundSpeed > 2.0f && prev_.groundSpeed > 2.0f) trackAcc_ += angleDiffDeg(prev_.trackDeg, f.trackDeg);
      if (t - motionStart_ >= kMotionWindowMs) {
        const float g = std::fabs(gyroAcc_), k = std::fabs(trackAcc_);
        if (r == GpsReason::None && ((g >= kMotionTurnDeg && k < kMotionAgreeDeg) || (k >= kMotionTurnDeg && g < kMotionAgreeDeg)))
          r = GpsReason::Motion;
        gyroAcc_ = trackAcc_ = 0;
        motionStart_ = t;
      }
    }
  }
  prev_ = f;
  havePrev_ = f.valid();

  if (r != GpsReason::None) {
    bad(t, r);
    return false;
  }
  if (state_ == GpsState::Ok) {
    good_ = f;
    haveGood_ = true;
    if (!std::isnan(baroAlt)) {
      const float off = f.altMsl - baroAlt;
      altOffset_ = haveOffset_ ? altOffset_ + 0.02f * (off - altOffset_) : off;
      haveOffset_ = true;
    }
    pos_ = {f.lat, f.lon, true, false, f.hAcc};
    return true;
  }
  // Not trusted yet: need a consistent run first.
  if (!goodRunStart_) goodRunStart_ = t;
  const TimeMs need = state_ == GpsState::NoData ? kFirstFixMs : kRecoverMs;
  if (t - goodRunStart_ >= need) {
    setState(t, GpsState::Ok, GpsReason::None);
    good_ = f;
    haveGood_ = true;
    if (!haveOffset_ && !std::isnan(baroAlt)) {
      altOffset_ = f.altMsl - baroAlt;
      haveOffset_ = true;
    }
    pos_ = {f.lat, f.lon, true, false, f.hAcc};
    badCount_ = 0;
    gyroAcc_ = trackAcc_ = 0;
    motionStart_ = 0;
    return true;
  }
  return false;
}

void GnssGuard::propagate(TimeMs t, float hdg, float airspeed, float wN, float wE) {
  const float dt = lastProp_ && t > lastProp_ ? (t - lastProp_) / 1000.0f : 0.0f;
  lastProp_ = t;
  if (state_ == GpsState::Ok && lastFixT_ && t - lastFixT_ > kSilentMs) setState(t, GpsState::Lost, GpsReason::NoFix);
  if (state_ == GpsState::Ok || !haveGood_ || dt <= 0) return;
  if (!pos_.deadReckoned) pos_ = {good_.lat, good_.lon, true, true, good_.hAcc};
  float vN = wN, vE = wE;
  if (!std::isnan(hdg)) {
    vN += airspeed * std::cos(hdg * 0.0174533f);
    vE += airspeed * std::sin(hdg * 0.0174533f);
    pos_.errorM += kDrErrPerS * dt;
  } else {
    pos_.errorM += kDrErrNoHeadingPerS * dt;
  }
  pos_.lat += vN * dt / kMPerDeg;
  pos_.lon += vE * dt / (kMPerDeg * std::cos(pos_.lat * 0.0174533));
  pos_.valid = pos_.errorM < kDrMaxErr;
}

}  // namespace pg
