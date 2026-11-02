#include "kalman_vario.h"

namespace pg {

KalmanVario::KalmanVario(const KalmanVarioConfig& cfg) : cfg_(cfg) {}

void KalmanVario::configure(const KalmanVarioConfig& cfg) {
  const bool wasAssist = cfg_.accelAssist;
  cfg_ = cfg;
  if (wasAssist && !cfg_.accelAssist) {
    // Drop the bias state: pin it at zero with no uncertainty.
    x_[2] = 0;
    for (int i = 0; i < 3; ++i) P_[i][2] = P_[2][i] = 0;
  } else if (!wasAssist && cfg_.accelAssist) {
    P_[2][2] = 0.25f;  // let the bias converge
  }
}

void KalmanVario::reset(float altitude) {
  x_[0] = altitude;
  x_[1] = 0;
  x_[2] = 0;
  for (auto& row : P_)
    for (float& p : row) p = 0;
  P_[0][0] = cfg_.baroNoise * cfg_.baroNoise;
  P_[1][1] = 1.0f;
  P_[2][2] = cfg_.accelAssist ? 0.25f : 0.0f;
  init_ = true;
}

void KalmanVario::predict(float dt, float accelUp) {
  if (!init_ || dt <= 0) return;
  if (dt > 1.0f) dt = 1.0f;  // a long gap: don't extrapolate wildly
  const bool assist = cfg_.accelAssist;
  const float a = assist ? accelUp - x_[2] : 0.0f;
  const float dt2 = dt * dt;

  x_[0] += x_[1] * dt + 0.5f * a * dt2;
  x_[1] += a * dt;

  // F = [[1, dt, -dt²/2], [0, 1, -dt], [0, 0, 1]]  (bias columns only with assist)
  const float f02 = assist ? -0.5f * dt2 : 0.0f;
  const float f12 = assist ? -dt : 0.0f;
  float F[3][3] = {{1, dt, f02}, {0, 1, f12}, {0, 0, 1}};

  float FP[3][3];
  for (int i = 0; i < 3; ++i)
    for (int j = 0; j < 3; ++j) {
      FP[i][j] = 0;
      for (int k = 0; k < 3; ++k) FP[i][j] += F[i][k] * P_[k][j];
    }
  float Pn[3][3];
  for (int i = 0; i < 3; ++i)
    for (int j = 0; j < 3; ++j) {
      Pn[i][j] = 0;
      for (int k = 0; k < 3; ++k) Pn[i][j] += FP[i][k] * F[j][k];
    }

  // Process noise: acceleration white noise through G = [dt²/2, dt, 0].
  const float qa = cfg_.accelNoise * cfg_.accelNoise;
  const float g0 = 0.5f * dt2, g1 = dt;
  Pn[0][0] += qa * g0 * g0;
  Pn[0][1] += qa * g0 * g1;
  Pn[1][0] += qa * g0 * g1;
  Pn[1][1] += qa * g1 * g1;
  if (assist) Pn[2][2] += cfg_.biasDrift * cfg_.biasDrift * dt;

  for (int i = 0; i < 3; ++i)
    for (int j = 0; j < 3; ++j) P_[i][j] = Pn[i][j];
}

void KalmanVario::updateAltitude(float z) {
  if (!init_) {
    reset(z);
    return;
  }
  const float r = cfg_.baroNoise * cfg_.baroNoise;
  const float y = z - x_[0];
  const float s = P_[0][0] + r;
  if (s <= 0) return;
  float K[3];
  for (int i = 0; i < 3; ++i) K[i] = P_[i][0] / s;
  for (int i = 0; i < 3; ++i) x_[i] += K[i] * y;
  // P = (I - K H) P, H = [1 0 0]
  float row0[3] = {P_[0][0], P_[0][1], P_[0][2]};
  for (int i = 0; i < 3; ++i)
    for (int j = 0; j < 3; ++j) P_[i][j] -= K[i] * row0[j];
}

}  // namespace pg
