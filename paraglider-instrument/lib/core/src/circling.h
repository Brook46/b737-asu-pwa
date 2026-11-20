// Circling (thermalling) detector.
//
// Fed a turn rate — from successive GPS tracks or from the gyro projected on
// earth-up — it runs a four-state machine with time hysteresis so one S-turn
// doesn't start a thermal and one straight leg out of a broken core doesn't end
// it. Defaults are close to what XCSoar uses for gliders, shortened a little for
// paragliders, whose circles take ~20–25 s.
#pragma once
#include "types.h"

namespace pg {

struct CirclingConfig {
  float minTurnRateDeg = 4.0f;  // |turn rate| above this counts as turning
  TimeMs enterMs = 12000;       // turning this long → circling
  TimeMs exitMs = 12000;        // straight this long → cruising
  float smoothing = 0.3f;       // EMA factor applied to the raw turn rate (0..1, 1 = none)
};

enum class FlightMode : uint8_t { Cruise, MaybeCircling, Circling, MaybeCruise };

class CirclingDetector {
 public:
  explicit CirclingDetector(const CirclingConfig& cfg = {}) : cfg_(cfg) {}
  void configure(const CirclingConfig& cfg) { cfg_ = cfg; }
  void reset();
  // Turn rate in deg/s, positive = turning right (clockwise seen from above).
  // Returns true if the circling/cruise state flipped on this update.
  bool update(TimeMs t, float turnRateDeg);
  // Convenience: derive turn rate from consecutive GPS tracks.
  bool updateTrack(TimeMs t, float trackDeg);

  bool circling() const { return mode_ == FlightMode::Circling || mode_ == FlightMode::MaybeCruise; }
  FlightMode mode() const { return mode_; }
  float turnRate() const { return rate_; }
  int direction() const { return dir_; }  // +1 right, -1 left, 0 unknown
  TimeMs circlingSince() const { return since_; }

 private:
  CirclingConfig cfg_;
  FlightMode mode_ = FlightMode::Cruise;
  float rate_ = 0;
  int dir_ = 0;
  TimeMs pending_ = 0;  // when the Maybe* state began
  TimeMs since_ = 0;    // when circling was declared (back-dated to first turn)
  bool haveTrack_ = false;
  float lastTrack_ = 0;
  TimeMs lastTrackT_ = 0;
};

// Signed smallest difference b - a in degrees, result in (-180, 180].
float angleDiffDeg(float a, float b);

}  // namespace pg
