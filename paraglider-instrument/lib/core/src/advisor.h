// STAY / GLIDE advisor — MacCready logic turned into two audio cues.
//
// While circling: once the thermal has had time to prove itself, compare the
// last circle's climb against MC. Below `leaveRatio`·MC for `leaveHoldMs` →
// GLIDE ("this one is no longer worth your time"). Recovering above MC → STAY.
//
// While gliding: estimate what this air would give in a circle
//   expected = netto − circlingSink
// and if that beats MC for `enterHoldMs` → STAY ("turn here").
//
// Auto-MC (optional): MC tracks the mean of the last few completed thermals,
// scaled by `autoMcFactor`. Most pilots never touch the MC knob in flight; this
// keeps the advisor honest on a weak day and ambitious on a strong one.
#pragma once
#include "averager.h"
#include "types.h"

namespace pg {

enum class Advice : uint8_t { None, Stay, Glide };

struct AdvisorConfig {
  float mc = 1.0f;               // m/s, manual MacCready
  bool autoMc = true;
  float autoMcFactor = 0.8f;
  float mcMin = 0.3f, mcMax = 4.0f;
  TimeMs warmupMs = 40000;       // ignore a new thermal's first ~2 circles
  float leaveRatio = 0.75f;      // last-circle climb below this × MC → GLIDE
  TimeMs leaveHoldMs = 15000;
  float circlingSink = 1.3f;     // m/s, own sink while turning
  float enterMargin = 0.0f;      // expected climb must beat MC by this
  TimeMs enterHoldMs = 1500;     // ~1.5 s at 35 km/h ≈ 15 m: still inside a core
  TimeMs recueMs = 60000;        // repeat an unheeded GLIDE after this long
  TimeMs minThermalMs = 60000;   // thermals shorter than this don't feed auto-MC
};

struct AdvisorInput {
  TimeMs t = 0;
  bool circling = false;
  float altitude = 0;
  float vario = 0;      // filtered instantaneous climb, m/s
  float netto = 0;      // airmass vertical speed (vario + own sink at current airspeed)
  bool leaving = false; // circling, but already flying straight (exit hysteresis)
};

struct AdvisorOutput {
  Advice advice = Advice::None;
  bool changed = false;     // advice differs from the previous update → play a cue
  float mc = 0;             // MC actually in use
  float circleClimb = 0;    // last ~circle average while circling, m/s
  float thermalAvg = 0;     // since thermal start, m/s
  float thermalGain = 0;    // m
  float expectedClimb = 0;  // while gliding: what circling here should give
};

class Advisor {
 public:
  explicit Advisor(const AdvisorConfig& cfg = {});
  void configure(const AdvisorConfig& cfg) { cfg_ = cfg; }
  const AdvisorConfig& config() const { return cfg_; }
  void reset();
  AdvisorOutput update(const AdvisorInput& in);
  float mc() const;
  void setMc(float mc);
  void nudgeMc(float delta) { setMc(cfg_.mc + delta); }
  int thermalCount() const { return nThermals_; }

 private:
  void finishThermal(TimeMs t, float alt);
  AdvisorConfig cfg_;
  WindowAverage<256> circle_{25000};  // ~one paraglider circle
  WindowAverage<64> short_{2000};
  GainAverage thermal_;
  bool wasCircling_ = false;
  Advice advice_ = Advice::None;
  TimeMs below_ = 0, above_ = 0, lastCue_ = 0;
  bool belowActive_ = false, aboveActive_ = false;
  static constexpr int kHistory = 3;
  float history_[kHistory] = {};
  int nThermals_ = 0;
};

}  // namespace pg
