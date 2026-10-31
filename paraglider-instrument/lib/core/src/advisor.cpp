#include "advisor.h"

namespace pg {

Advisor::Advisor(const AdvisorConfig& cfg) : cfg_(cfg) {}

void Advisor::reset() {
  circle_.clear();
  short_.clear();
  thermal_.stop();
  wasCircling_ = false;
  advice_ = Advice::None;
  belowActive_ = aboveActive_ = false;
  nThermals_ = 0;
}

void Advisor::setMc(float mc) {
  if (mc < 0) mc = 0;
  if (mc > cfg_.mcMax) mc = cfg_.mcMax;
  cfg_.mc = mc;
}

float Advisor::mc() const {
  if (!cfg_.autoMc || nThermals_ == 0) return cfg_.mc;
  const int n = nThermals_ < kHistory ? nThermals_ : kHistory;
  float s = 0;
  for (int i = 0; i < n; ++i) s += history_[i];
  float m = cfg_.autoMcFactor * s / n;
  if (m < cfg_.mcMin) m = cfg_.mcMin;
  if (m > cfg_.mcMax) m = cfg_.mcMax;
  return m;
}

void Advisor::finishThermal(TimeMs t, float alt) {
  if (thermal_.elapsed(t) >= cfg_.minThermalMs) {
    const float avg = thermal_.rate(t, alt);
    if (avg > 0) {
      history_[nThermals_ % kHistory] = avg;
      ++nThermals_;
    }
  }
  thermal_.stop();
}

AdvisorOutput Advisor::update(const AdvisorInput& in) {
  AdvisorOutput out;
  const Advice before = advice_;
  const float m = mc();

  if (in.circling && !wasCircling_) {
    thermal_.start(in.t, in.altitude);
    circle_.clear();
    belowActive_ = aboveActive_ = false;
    advice_ = Advice::None;  // a STAY that led into this turn has been obeyed
  } else if (!in.circling && wasCircling_) {
    finishThermal(in.t, in.altitude);
    short_.clear();
    belowActive_ = aboveActive_ = false;
    advice_ = Advice::None;  // left the thermal: GLIDE obeyed
  }
  wasCircling_ = in.circling;

  bool recue = false;
  if (in.circling) {
    circle_.add(in.t, in.vario);
    const bool warm = thermal_.elapsed(in.t) >= cfg_.warmupMs && circle_.full();
    if (warm) {
      const float cc = circle_.mean();
      if (cc < cfg_.leaveRatio * m) {
        if (!belowActive_) {
          belowActive_ = true;
          below_ = in.t;
        }
        if (in.t - below_ >= cfg_.leaveHoldMs) advice_ = Advice::Glide;
      } else {
        belowActive_ = false;
        if (advice_ == Advice::Glide && cc >= m) advice_ = Advice::Stay;  // it came back
      }
      if (advice_ == Advice::Glide && before == Advice::Glide && !in.leaving &&
          in.t - lastCue_ >= cfg_.recueMs)
        recue = true;
    }
    out.circleClimb = circle_.mean();
    out.thermalAvg = thermal_.rate(in.t, in.altitude);
    out.thermalGain = thermal_.gain(in.altitude);
  } else {
    short_.add(in.t, in.netto);
    const float expected = short_.mean() - cfg_.circlingSink;
    out.expectedClimb = expected;
    if (expected >= m + cfg_.enterMargin) {
      if (!aboveActive_) {
        aboveActive_ = true;
        above_ = in.t;
      }
      if (in.t - above_ >= cfg_.enterHoldMs) advice_ = Advice::Stay;
    } else {
      aboveActive_ = false;
      // Flew through it without turning: drop the advice quietly.
      if (advice_ == Advice::Stay && expected < 0.5f * m) advice_ = Advice::None;
    }
  }

  out.advice = advice_;
  out.changed = (advice_ != before && advice_ != Advice::None) || recue;
  if (out.changed) lastCue_ = in.t;
  out.mc = m;
  return out;
}

}  // namespace pg
