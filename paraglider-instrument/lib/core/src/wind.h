// Wind from circling drift.
//
// While circling at roughly constant airspeed, the ground-velocity vectors lie
// on a circle whose centre is the wind vector and whose radius is the airspeed.
// Each completed turn (360° of track change) gets an algebraic least-squares
// circle fit (Kåsa); fits that look bad are rejected, good ones are blended
// into a running estimate weighted by fit quality.
#pragma once
#include "types.h"

namespace pg {

struct WindEstimate {
  float fromDeg = 0;   // meteorological: direction the wind blows FROM, true
  float speed = 0;     // m/s
  float toN = 0, toE = 0;  // vector the air moves toward, m/s
  float airspeed = 0;  // m/s, circle radius of the last good fit
  float quality = 0;   // 0..1
  TimeMs t = 0;        // time of last good fit
  bool valid = false;
};

struct CircleFit {
  float cN = 0, cE = 0, radius = 0, rms = 0;
  bool ok = false;
};

// Kåsa algebraic fit of points (n[i], e[i]). Needs >= 3 non-collinear points.
CircleFit fitCircle(const float* n, const float* e, int count);

class WindEstimator {
 public:
  static constexpr int kMaxSamples = 96;
  void reset();
  // Feed every GNSS fix while circling; call endCircling() when the thermal ends.
  // Returns true when a new wind estimate was produced.
  bool addSample(TimeMs t, float velN, float velE, float trackDeg);
  void endCircling();
  const WindEstimate& estimate() const { return est_; }
  const CircleFit& lastFit() const { return last_; }

 private:
  void fold(const CircleFit& f, TimeMs t);
  float n_[kMaxSamples] = {};
  float e_[kMaxSamples] = {};
  int count_ = 0;
  float turned_ = 0;  // accumulated signed track change in this circle, deg
  float lastTrack_ = 0;
  TimeMs lastT_ = 0;
  bool haveTrack_ = false;
  CircleFit last_;
  WindEstimate est_;
};

}  // namespace pg
