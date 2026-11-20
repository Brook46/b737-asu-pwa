// Thermal model: where the core is, how wide it is, and how to fly it.
//
// While circling, every vario sample is placed where it was flown in the
// AIR-MASS frame (integrated gyro heading × airspeed: the thermal drifts with
// the air, so in this frame it stands still, and no GPS is needed). The air's
// own vertical speed there is netto = vario + the wing's sink at the current
// bank. A round thermal is fitted to those samples:
//
//     w(x, y) = W · exp(−((x − cx)² + (y − cy)²) / R²) + B
//
// (core strength W, core radius R, surrounding air B), by a coarse-to-fine
// search over the centre and R with W and B solved exactly at each step.
//
// From the fit:
//   * MOVE: your circle is off the core → straighten when the heading points
//     at it, for about `moveSeconds`.
//   * TIGHTEN / WIDEN: centred, but a smaller (steeper) or larger (flatter)
//     circle climbs better: the lift gained nearer the core against the extra
//     sink of a steeper bank, from the wing's polar.
// Advice is only given when every core radius that fits the data about
// equally well agrees on it; a perfectly steady circle can't tell a narrow
// strong core from a wide weak one, and then the model says nothing.
//
// Other pilots' climbs (FANET) can be added as samples too.
#pragma once
#include "polar.h"
#include "types.h"

namespace pg {

enum class TurnAdvice : uint8_t { None, Good, Move, Tighten, Widen };
const char* turnAdviceName(TurnAdvice a);

struct ThermalFit {
  bool valid = false;
  float cx = 0, cy = 0;     // core, air frame (m)
  float radius = 0;         // R, 1/e radius (m)
  float strength = 0;       // W, m/s at the core above the surroundings
  float around = 0;         // B, m/s
  float quality = 0;        // fraction of variance explained, 0..1
  int samples = 0;
};

struct TurnView {
  ThermalFit fit;
  TurnAdvice advice = TurnAdvice::None;
  float myRadius = 0;       // m, your circle now
  float bestRadius = 0;     // m, best circle by the fit
  float bankNow = 0;        // deg
  float bankBest = 0;       // deg
  float gain = 0;           // m/s more climb if you follow the advice
  float climbNow = 0;       // m/s the fit predicts on your circle
  float coreDist = 0;       // m, your circle's centre to the core
  float coreBearing = 0;    // deg, circle centre → core, in the heading frame
  float moveSeconds = 0;    // how long to straighten for MOVE
  bool moveNow = false;     // heading points at the core: straighten now
  float coreRelX = 0, coreRelY = 0;  // core minus your position now, air frame (m)
  bool settled = false;     // the fit has stopped moving: advice is given only then
};

class ThermalModel {
 public:
  explicit ThermalModel(const Polar& p) : polar_(p) {}
  void setPolar(const Polar& p) { polar_ = p; }
  void reset();
  // ~5 Hz while circling. x/y: your air-frame position (m), heading in the
  // same frame, airspeed m/s, turn rate deg/s (+ right), vario m/s.
  void add(TimeMs t, float x, float y, float headingDeg, float airspeed, float turnRateDeg, float vario);
  // Another pilot's climb at an air-frame position (their vario; their sink is
  // assumed to be a typical circling sink).
  void addOther(TimeMs t, float x, float y, float climb);
  // Refit (call every ~2 s; costs ~150k exp() on the ESP32).
  void update(TimeMs t, bool circling);
  const TurnView& view() const { return v_; }

  // Sink in a steady turn of radius r at airspeed v (polar sink / cos^1.5 bank).
  float turnSink(float v, float radius) const;
  static float bankFor(float v, float radius);

 private:
  struct S {
    TimeMs t;
    float x, y, w;
    bool other;
  };
  static constexpr int kN = 400;      // 80 s at 5 Hz
  static constexpr TimeMs kWindowMs = 70000;
  static constexpr int kRadii = 8;
  float fitAt(float cx, float cy, float R, float& W, float& B) const;
  void fitSearch(float cx0, float cy0, float R, ThermalFit& f) const;
  Polar polar_;
  S s_[kN];
  int head_ = 0, n_ = 0;
  TimeMs firstCircling_ = 0, lastFit_ = 0, straightAt_ = 0;
  int stable_ = 0;
  float prevCx_ = 1e9f, prevCy_ = 1e9f;
  float x_ = 0, y_ = 0, hdg_ = 0, v_air_ = 0, rate_ = 0;
  float sse_[kRadii] = {};
  ThermalFit fits_[kRadii];
  TurnView v_;
};

}  // namespace pg
