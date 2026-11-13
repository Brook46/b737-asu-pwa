// Altitude / vertical-speed Kalman filter.
//
// State x = [h, v, b]: altitude (m), vertical speed (m/s), accelerometer bias
// (m/s^2). The prediction step takes an optional earth-frame vertical
// acceleration from the IMU (gravity removed, up positive). Without an IMU the
// filter runs as a plain constant-velocity baro filter: the bias state is
// pinned at zero and a larger process noise lets the climb rate move.
//
// Tuning (all standard deviations):
//   baroNoise   — altitude measurement noise. BMP390 at x8/x16 oversampling with
//                 IIR is roughly 0.1–0.3 m; XCTracer-forwarded altitude is
//                 already smoothed, use ~0.5 m.
//   accelNoise  — how hard the airmass/pilot can shake vertical speed. Baro
//                 only: 0.6–1.2 m/s^2 (higher = snappier, noisier). With IMU
//                 assist: 0.1–0.3 m/s^2 (the IMU carries the fast part).
//   biasDrift   — random walk of the accel bias, m/s^2/sqrt(s). ~0.02.
#pragma once
#include "types.h"

namespace pg {

struct KalmanVarioConfig {
  float baroNoise = 0.25f;
  float accelNoise = 0.9f;
  float biasDrift = 0.02f;
  bool accelAssist = false;
};

class KalmanVario {
 public:
  explicit KalmanVario(const KalmanVarioConfig& cfg = {});
  void reset(float altitude);
  void configure(const KalmanVarioConfig& cfg);
  // dt in seconds; accelUp in m/s^2 (ignored unless accelAssist).
  void predict(float dt, float accelUp = 0.0f);
  void updateAltitude(float altitude);
  bool initialized() const { return init_; }
  float altitude() const { return x_[0]; }
  float vario() const { return x_[1]; }
  float accelBias() const { return x_[2]; }
  const KalmanVarioConfig& config() const { return cfg_; }

 private:
  KalmanVarioConfig cfg_;
  float x_[3] = {0, 0, 0};
  float P_[3][3] = {};
  bool init_ = false;
};

}  // namespace pg
