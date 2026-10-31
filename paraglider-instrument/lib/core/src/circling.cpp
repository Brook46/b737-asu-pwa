#include "circling.h"

#include <cmath>

namespace pg {

float angleDiffDeg(float a, float b) {
  float d = std::fmod(b - a, 360.0f);
  if (d > 180.0f) d -= 360.0f;
  if (d <= -180.0f) d += 360.0f;
  return d;
}

void CirclingDetector::reset() {
  mode_ = FlightMode::Cruise;
  rate_ = 0;
  dir_ = 0;
  pending_ = since_ = 0;
  haveTrack_ = false;
}

bool CirclingDetector::update(TimeMs t, float turnRateDeg) {
  rate_ += cfg_.smoothing * (turnRateDeg - rate_);
  const bool turning = std::fabs(rate_) > cfg_.minTurnRateDeg;
  const bool wasCircling = circling();

  switch (mode_) {
    case FlightMode::Cruise:
      if (turning) {
        mode_ = FlightMode::MaybeCircling;
        pending_ = t;
        dir_ = rate_ > 0 ? 1 : -1;
      }
      break;
    case FlightMode::MaybeCircling:
      // A reversal of direction is an S-turn, not a thermal: restart the clock.
      if (!turning || (rate_ > 0 ? 1 : -1) != dir_) {
        mode_ = turning ? FlightMode::MaybeCircling : FlightMode::Cruise;
        pending_ = t;
        dir_ = turning ? (rate_ > 0 ? 1 : -1) : 0;
      } else if (t - pending_ >= cfg_.enterMs) {
        mode_ = FlightMode::Circling;
        since_ = pending_;
      }
      break;
    case FlightMode::Circling:
      if (!turning) {
        mode_ = FlightMode::MaybeCruise;
        pending_ = t;
      } else {
        dir_ = rate_ > 0 ? 1 : -1;  // direction may legitimately change when re-centring
      }
      break;
    case FlightMode::MaybeCruise:
      if (turning) {
        mode_ = FlightMode::Circling;
      } else if (t - pending_ >= cfg_.exitMs) {
        mode_ = FlightMode::Cruise;
        dir_ = 0;
      }
      break;
  }
  return circling() != wasCircling;
}

bool CirclingDetector::updateTrack(TimeMs t, float trackDeg) {
  if (!haveTrack_) {
    haveTrack_ = true;
    lastTrack_ = trackDeg;
    lastTrackT_ = t;
    return false;
  }
  const TimeMs dtMs = t - lastTrackT_;
  if (dtMs == 0) return false;
  if (dtMs > 5000) {  // gap in fixes: restart the derivative
    lastTrack_ = trackDeg;
    lastTrackT_ = t;
    return false;
  }
  const float rate = angleDiffDeg(lastTrack_, trackDeg) / (dtMs / 1000.0f);
  lastTrack_ = trackDeg;
  lastTrackT_ = t;
  return update(t, rate);
}

}  // namespace pg
