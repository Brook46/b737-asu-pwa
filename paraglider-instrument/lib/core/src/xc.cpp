#include "xc.h"

#include <cmath>

namespace pg {

const char* leaveReasonName(LeaveReason r) {
  switch (r) {
    case LeaveReason::Weak: return "weak";
    case LeaveReason::Base: return "at base";
    case LeaveReason::FinalGlide: return "final glide";
    case LeaveReason::Better: return "better lift";
    case LeaveReason::None: break;
  }
  return "";
}

const char* barLimitName(BarLimit b) {
  switch (b) {
    case BarLimit::Low: return "low";
    case BarLimit::Turbulence: return "turbulent";
    case BarLimit::Lift: return "in lift";
    case BarLimit::Circling: return "circling";
    case BarLimit::None: break;
  }
  return "";
}

XcOutput XcAdvisor::update(const XcInput& in, const Polar& polar) {
  XcOutput o;
  // Working band, in metres above the ground: floor .. ceiling.
  if (in.aglValid && in.ceilingValid) {
    const float ground = in.altMsl - in.agl;
    const float top = in.ceilingMsl - ground;
    if (top > cfg_.floorAgl + 200) {
      float f = (in.agl - cfg_.floorAgl) / (top - cfg_.floorAgl);
      o.band = f < 0 ? 0 : (f > 1 ? 1 : f);
      o.bandValid = true;
    }
  } else if (in.aglValid) {
    // No ceiling yet: assume a 1200 m working band.
    float f = (in.agl - cfg_.floorAgl) / 1200.0f;
    o.band = f < 0 ? 0 : (f > 1 ? 1 : f);
    o.bandValid = true;
  }

  float k;
  if (in.race) {
    k = 0.5f + 0.5f * o.band;  // racing: full MC high, halve it near the floor
  } else {
    k = cfg_.xcFactor * (cfg_.bandMinFactor + (1 - cfg_.bandMinFactor) * o.band);
    if (in.hoursToSunset < cfg_.lateHours) k *= cfg_.lateFactor;
  }
  if (!o.bandValid) k = in.race ? 1.0f : cfg_.xcFactor;
  o.mc = in.mcBase * k;
  if (o.mc < 0.1f) o.mc = 0.1f;

  // When to leave, beyond the advisor's "climb fell below MC".
  if (in.circling) {
    if (in.finalGlide && in.race) o.leave = LeaveReason::FinalGlide;
    else if (in.finalGlide && in.thermalWarm) o.leave = LeaveReason::FinalGlide;
    else if (in.ceilingIsBase && in.altMsl > in.ceilingMsl - cfg_.baseMargin) o.leave = LeaveReason::Base;
    else if (in.betterNearby && in.thermalWarm) o.leave = LeaveReason::Better;
  }

  // Speed to fly and bar.
  o.stf = polar.speedToFly(o.mc, in.netto, in.headwind);
  const float range = polar.vMax() - cfg_.trimSpeed;
  float raw = range > 0 ? (o.stf - cfg_.trimSpeed) / range : 0;
  o.slow = raw < -0.15f;
  raw = raw < 0 ? 0 : (raw > 1 ? 1 : raw);
  o.barRaw = raw;
  float cap = 1;
  if (in.circling) {
    cap = 0;
    o.barLimit = BarLimit::Circling;
  } else if (in.aglValid && in.agl < cfg_.barNoAgl) {
    cap = 0;
    o.barLimit = BarLimit::Low;
  } else if (in.turbulence > cfg_.turbAccel) {
    cap = 0.25f;
    o.barLimit = BarLimit::Turbulence;
  } else if (in.aglValid && in.agl < cfg_.barHalfAgl) {
    cap = 0.5f;
    o.barLimit = BarLimit::Low;
  }
  if (raw > cap) {
    raw = cap;
  } else if (o.barLimit == BarLimit::None && in.netto > 0.8f) {
    o.barLimit = BarLimit::Lift;  // informational: the bar came off because the air is rising
  }
  // Quarters, with hysteresis so it doesn't flicker between steps.
  const float q = std::round(raw * 4) / 4;
  if (std::fabs(raw - bar_) > 0.18f || q == 0 || cap < bar_) bar_ = q > cap ? cap : q;
  o.bar = bar_;
  return o;
}

}  // namespace pg
