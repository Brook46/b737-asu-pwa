// Thermal assistant: where in your circle is the lift?
//
// While circling, each vario sample is filed under the heading you had (36
// bins of 10°). From the heading and turn direction we know where on the
// circle you were, so the bins form a lift map around the circle. The
// weighted direction of above-average lift is where the core is: to move the
// circle onto it, straighten briefly when your heading points that way.
//
// Uses heading only (gyro), never GPS position, so it keeps working when GPS
// is jammed.
#pragma once
#include "types.h"

namespace pg {

struct AssistView {
  bool active = false;
  int dir = 0;                 // +1 right turns, −1 left
  float lift[36] = {};         // m/s per 10° heading bin
  bool have[36] = {};
  float coreDeg = 0;           // direction from circle centre toward the core (true bearing)
  float strength = 0;          // 0..1, how lopsided the lift is (0 = centred or unknown)
  float best = 0, mean = 0;    // m/s
  bool straightenNow = false;  // heading points at the core: straighten 2–3 s
};

class ThermalAssist {
 public:
  void reset();
  // Call at ~5 Hz. heading in degrees (true), vario m/s, dir = turn direction.
  void update(TimeMs t, bool circling, float headingDeg, int dir, float vario);
  const AssistView& view() const { return v_; }

 private:
  AssistView v_;
  TimeMs stamp_[36] = {};
};

}  // namespace pg
