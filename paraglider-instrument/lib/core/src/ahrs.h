// Mahony complementary attitude filter (gyro + accelerometer, no magnetometer).
// Used for one thing: projecting the IMU acceleration onto earth-up so the
// Kalman vario can react to a thermal edge before the barometer sees it.
// Heading is not observable without a magnetometer and is not needed here.
#pragma once
#include "types.h"

namespace pg {

class MahonyAhrs {
 public:
  // kp: proportional gain toward accel-gravity, ki: gyro-bias integral gain.
  explicit MahonyAhrs(float kp = 1.0f, float ki = 0.02f) : kp_(kp), ki_(ki) {}
  void reset();
  // ax..az in m/s^2 (specific force: +g on the axis pointing up at rest),
  // gx..gz in rad/s, dt in seconds.
  void update(float ax, float ay, float az, float gx, float gy, float gz, float dt);
  // Earth-frame vertical acceleration, gravity removed, up positive (m/s^2).
  float verticalAccel(float ax, float ay, float az) const;
  // Body-frame unit vector pointing to earth-up.
  void upVector(float& x, float& y, float& z) const;
  float rollDeg() const;
  float pitchDeg() const;
  bool initialized() const { return init_; }

 private:
  float q_[4] = {1, 0, 0, 0};
  float ib_[3] = {0, 0, 0};
  float kp_, ki_;
  bool init_ = false;
};

}  // namespace pg
