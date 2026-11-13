#include "heading.h"

#include <cmath>

#include "circling.h"

namespace pg {

namespace {
float wrap(float d) {
  d = std::fmod(d, 360.0f);
  return d < 0 ? d + 360.0f : d;
}
constexpr float kP = 0.08f;    // per fix (5 Hz) → time constant ~2.5 s
constexpr float kI = 0.004f;   // deg/s of bias per degree of error per fix
constexpr float kMaxBias = 3.0f;
}  // namespace

void HeadingEstimator::reset() {
  hdg_ = bias_ = rate_ = 0;
  valid_ = false;
}

void HeadingEstimator::onYawRate(float dt, float rateDeg) {
  rate_ = rateDeg - bias_;
  if (!valid_ || dt <= 0 || dt > 0.5f) return;
  hdg_ = wrap(hdg_ + rate_ * dt);
}

void HeadingEstimator::correct(float ref, float weight) {
  if (!valid_) {
    hdg_ = wrap(ref);
    valid_ = true;
    return;
  }
  const float err = angleDiffDeg(hdg_, ref);  // ref − hdg
  hdg_ = wrap(hdg_ + kP * weight * err);
  // Heading falling behind → gyro reads low → bias too high.
  bias_ -= kI * weight * err;
  if (bias_ > kMaxBias) bias_ = kMaxBias;
  if (bias_ < -kMaxBias) bias_ = -kMaxBias;
}

void HeadingEstimator::setDirect(float ref) {
  hdg_ = wrap(ref);
  valid_ = true;
}

}  // namespace pg
