// Heading from the gyro, kept honest by GPS while GPS is trustworthy.
//
// The IMU's earth-frame yaw rate is integrated at IMU rate. Each trusted GPS
// fix supplies the air heading (direction of ground velocity minus wind, or
// the track when no wind is known yet); a small proportional-integral
// correction pulls the heading toward it and learns the gyro's bias. When GPS
// is jammed the corrections stop and the heading coasts on the learned bias:
// good to a few degrees per minute, which is what the thermal assistant and
// dead reckoning need.
#pragma once
#include "types.h"

namespace pg {

class HeadingEstimator {
 public:
  void reset();
  // Earth-frame yaw rate, deg/s, + = clockwise (right turn).
  void onYawRate(float dt, float rateDeg);
  // A trusted reference heading (deg). `weight` 0..1 scales the correction.
  void correct(float refDeg, float weight = 1.0f);
  // No IMU: use the reference directly.
  void setDirect(float refDeg);
  bool valid() const { return valid_; }
  float heading() const { return hdg_; }
  float biasDegS() const { return bias_; }
  float rate() const { return rate_; }

 private:
  float hdg_ = 0, bias_ = 0, rate_ = 0;
  bool valid_ = false;
};

}  // namespace pg
