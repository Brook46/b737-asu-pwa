// Cross-country tactics: what MacCready to fly, when to leave a thermal, and
// how much speed bar. Built on MacCready theory as XC and competition pilots
// apply it (sources and reasoning: docs/xc-tactics.md):
//
//  * Take climbs better than MC, leave when the climb drops below it. When to
//    stop and when to leave matter far more than the exact glide speed.
//  * MC is set below the climbs you expect (here: auto-MC ≈ 0.8 × recent
//    thermals, then × 0.75 for XC), and lowered as you get low in the
//    working band (Cochrane: the expected value of the next climb falls when
//    altitude is limited). Low = survival: take anything, glide at best L/D.
//  * XC distance (the default) is conservative: secure the climbs, use the
//    whole band, lower MC late in the day. RACE (a task with a start, after
//    the start) flies the full MC and leaves the moment final glide is made.
//  * Bar = the MacCready speed for the air you're in (netto) and the
//    headwind on course, as a fraction of the trim→full-bar range, in
//    quarters. Never near the ground or in turbulence: a collapse on bar is
//    the price, and near terrain there's no height to recover.
#pragma once
#include "polar.h"
#include "types.h"

namespace pg {

enum class LeaveReason : uint8_t { None, Weak, Base, FinalGlide, Better };
enum class BarLimit : uint8_t { None, Low, Turbulence, Lift, Circling };
const char* leaveReasonName(LeaveReason r);
const char* barLimitName(BarLimit b);

struct XcConfig {
  float xcFactor = 0.75f;      // XC: fly this fraction of the base MC
  float floorAgl = 300;        // bottom of the working band (m AGL)
  float bandMinFactor = 0.25f; // MC multiplier at the floor (survival)
  float lateHours = 1.5f;      // hours before sunset: thermals dying
  float lateFactor = 0.7f;
  float trimSpeed = 38.0f / 3.6f;  // your wing's hands-up speed (m/s)
  float barNoAgl = 150;        // no bar below this AGL
  float barHalfAgl = 350;      // at most half bar below this AGL
  float turbAccel = 2.2f;      // m/s² RMS vertical: active-piloting air, ≤ ¼ bar
  float baseMargin = 120;      // leave within this of cloud base / the ceiling
  float betterBy = 0.7f;       // a live thermal this much better (m/s) → leave
};

struct XcInput {
  TimeMs t = 0;
  bool circling = false;
  float altMsl = 0;
  float agl = 0;
  bool aglValid = false;
  float ceilingMsl = 0;        // cloud base, or the best top reached today
  bool ceilingValid = false;
  bool ceilingIsBase = false;  // a measured cloud base: leave when you reach it
  float mcBase = 1;            // auto or manual MC
  float netto = 0;             // smoothed airmass climb while gliding (m/s)
  float headwind = 0;          // on course (m/s, + against)
  float hoursToSunset = 99;
  bool race = false;           // task started and has a start: racing
  bool finalGlide = false;     // on final glide to goal at the current MC
  float circleClimb = 0;       // last circle, m/s
  bool thermalWarm = false;    // circling long enough to judge
  bool betterNearby = false;   // a reachable live thermal beats this one by betterBy
  float turbulence = 0;        // RMS vertical accel, m/s²
};

struct XcOutput {
  float mc = 0;                // effective MC: STF, STAY, GLIDE all use it
  float band = 1;              // 0 = at the floor, 1 = at the ceiling
  bool bandValid = false;
  LeaveReason leave = LeaveReason::None;  // beyond "climb < MC" (the advisor's job)
  float stf = 0;               // m/s
  float bar = 0;               // 0, .25, .5, .75, 1
  float barRaw = 0;
  BarLimit barLimit = BarLimit::None;
  bool slow = false;           // STF well below trim: in lift, fly slow (brakes)
};

class XcAdvisor {
 public:
  explicit XcAdvisor(const XcConfig& c = {}) : cfg_(c) {}
  void configure(const XcConfig& c) { cfg_ = c; }
  const XcConfig& config() const { return cfg_; }
  void reset() { bar_ = 0; }
  XcOutput update(const XcInput& in, const Polar& polar);

 private:
  XcConfig cfg_;
  float bar_ = 0;
};

}  // namespace pg
