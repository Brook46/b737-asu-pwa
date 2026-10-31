#include "ahrs.h"

#include <cmath>

namespace pg {

void MahonyAhrs::reset() {
  q_[0] = 1;
  q_[1] = q_[2] = q_[3] = 0;
  ib_[0] = ib_[1] = ib_[2] = 0;
  init_ = false;
}

void MahonyAhrs::upVector(float& x, float& y, float& z) const {
  const float q0 = q_[0], q1 = q_[1], q2 = q_[2], q3 = q_[3];
  x = 2.0f * (q1 * q3 - q0 * q2);
  y = 2.0f * (q0 * q1 + q2 * q3);
  z = q0 * q0 - q1 * q1 - q2 * q2 + q3 * q3;
}

void MahonyAhrs::update(float ax, float ay, float az, float gx, float gy, float gz, float dt) {
  const float an = std::sqrt(ax * ax + ay * ay + az * az);
  if (!init_ && an > 0.5f * kGravity) {
    // Seed roll/pitch straight from gravity so the filter starts converged.
    const float roll = std::atan2(ay, az);
    const float pitch = std::atan2(-ax, std::sqrt(ay * ay + az * az));
    const float cr = std::cos(roll * 0.5f), sr = std::sin(roll * 0.5f);
    const float cp = std::cos(pitch * 0.5f), sp = std::sin(pitch * 0.5f);
    q_[0] = cr * cp;
    q_[1] = sr * cp;
    q_[2] = cr * sp;
    q_[3] = -sr * sp;
    init_ = true;
    return;
  }
  if (dt <= 0) return;

  // Only trust the accelerometer as a gravity reference when |a| is near 1 g;
  // in a hard spiral it is mostly centripetal and would tilt the estimate.
  if (an > 0.7f * kGravity && an < 1.3f * kGravity) {
    const float nx = ax / an, ny = ay / an, nz = az / an;
    float vx, vy, vz;
    upVector(vx, vy, vz);
    const float ex = ny * vz - nz * vy;
    const float ey = nz * vx - nx * vz;
    const float ez = nx * vy - ny * vx;
    ib_[0] += ki_ * ex * dt;
    ib_[1] += ki_ * ey * dt;
    ib_[2] += ki_ * ez * dt;
    gx += kp_ * ex + ib_[0];
    gy += kp_ * ey + ib_[1];
    gz += kp_ * ez + ib_[2];
  }

  const float h = 0.5f * dt;
  const float q0 = q_[0], q1 = q_[1], q2 = q_[2], q3 = q_[3];
  q_[0] += (-q1 * gx - q2 * gy - q3 * gz) * h;
  q_[1] += (q0 * gx + q2 * gz - q3 * gy) * h;
  q_[2] += (q0 * gy - q1 * gz + q3 * gx) * h;
  q_[3] += (q0 * gz + q1 * gy - q2 * gx) * h;
  const float n = std::sqrt(q_[0] * q_[0] + q_[1] * q_[1] + q_[2] * q_[2] + q_[3] * q_[3]);
  if (n > 0)
    for (float& q : q_) q /= n;
}

float MahonyAhrs::verticalAccel(float ax, float ay, float az) const {
  float vx, vy, vz;
  upVector(vx, vy, vz);
  return ax * vx + ay * vy + az * vz - kGravity;
}

float MahonyAhrs::rollDeg() const {
  float x, y, z;
  upVector(x, y, z);
  return std::atan2(y, z) * kRadToDeg;
}

float MahonyAhrs::pitchDeg() const {
  float x, y, z;
  upVector(x, y, z);
  return std::atan2(-x, std::sqrt(y * y + z * z)) * kRadToDeg;
}

}  // namespace pg
