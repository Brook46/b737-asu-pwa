#include "atmosphere.h"

#include <cmath>

namespace pg {

namespace {
constexpr float kA = 17.62f, kB = 243.12f;  // Magnus, over water
constexpr float kMPerDegSpread = 125.0f;
constexpr TimeMs kLapseEveryMs = 5000;
constexpr int kLapseMinN = 20;
constexpr float kInvTauS = 45.0f;   // smoothing, s (~2 circles)
constexpr float kInvWarmC = 0.5f;   // warming above the climb's coldest point, °C
constexpr float kInvGainM = 100.0f; // ...measured at least this much higher
constexpr TimeMs kInvWarmupMs = 90000;  // ignore the first 90 s of a climb (2 × kInvTauS)

// Least-squares slope of y over x.
bool slope(const float* x, const float* y, int n, float& out, float& span) {
  if (n < 2) return false;
  double mx = 0, my = 0, lo = x[0], hi = x[0];
  for (int i = 0; i < n; ++i) {
    mx += x[i];
    my += y[i];
    if (x[i] < lo) lo = x[i];
    if (x[i] > hi) hi = x[i];
  }
  mx /= n;
  my /= n;
  double sxx = 0, sxy = 0;
  for (int i = 0; i < n; ++i) {
    sxx += (x[i] - mx) * (x[i] - mx);
    sxy += (x[i] - mx) * (y[i] - my);
  }
  span = static_cast<float>(hi - lo);
  if (sxx <= 0) return false;
  out = static_cast<float>(sxy / sxx);
  return true;
}
}  // namespace

float dewPointC(float t, float rh) {
  if (rh < 1.0f) rh = 1.0f;
  if (rh > 100.0f) rh = 100.0f;
  const float g = std::log(rh / 100.0f) + kA * t / (kB + t);
  return kB * g / (kA - g);
}

float relativeHumidity(float t, float td) {
  return 100.0f * std::exp(kA * td / (kB + td) - kA * t / (kB + t));
}

float condensationHeight(float t, float td) {
  const float spread = t - td;
  return spread > 0 ? spread * kMPerDegSpread : 0.0f;
}

AtmosphereEvent Atmosphere::update(TimeMs t, float alt, float caseT, float rh, bool circling,
                                   float vario, bool ventilated) {
  AtmosphereEvent ev = AtmosphereEvent::None;
  if (!ventilated) caseT_ = caseT;
  dew_ = dewPointC(caseT, rh);
  st_.rh = rh;
  st_.dewPointC = dew_;
  st_.tempC = ventilated ? caseT : caseT - cfg_.tempOffset;
  st_.ventilated = ventilated;
  st_.haveAir = true;
  const float dt = lastT_ && t > lastT_ ? (t - lastT_) / 1000.0f : 0.0f;
  lastT_ = t;

  if (circling && !wasCircling_) {
    circlingSince_ = t;
    climbTracking_ = false;
    inversionCued_ = false;
  }
  wasCircling_ = circling;

  // ---- cloud base: altitude + 125 m × spread, smoothed.
  // Thermal air is what actually forms the cloud, so once a thermal has run
  // for a while, only climbing-in-thermal samples update the estimate.
  const float raw = alt + condensationHeight(st_.tempC, dew_);
  const bool inThermal = circling && t - circlingSince_ >= cfg_.thermalWarmupMs && vario > 0.3f;
  const bool take = inThermal || !st_.baseFromThermal;
  if (take) {
    if (!st_.baseValid || (inThermal && !st_.baseFromThermal)) {
      st_.cloudBase = raw;  // first value, or first value from thermal air: jump to it
    } else if (dt > 0) {
      const float k = 1.0f - std::exp(-dt * 1000.0f / static_cast<float>(cfg_.baseTauMs));
      st_.cloudBase += k * (raw - st_.cloudBase);
    }
    st_.baseValid = true;
    if (inThermal) st_.baseFromThermal = true;
  }

  // Near-base cue: once per approach, climbing, within nearBaseM below.
  if (st_.baseValid && st_.baseFromThermal) {
    const float below = st_.cloudBase - alt;
    if (!nearBaseCued_ && vario > 0.3f && below < cfg_.nearBaseM && below > -cfg_.nearBaseM) {
      nearBaseCued_ = true;
      ev = AtmosphereEvent::NearBase;
    } else if (below > 2.0f * cfg_.nearBaseM) {
      nearBaseCued_ = false;
    }
  }

  // ---- lapse rate from glide samples (environment air, not thermal air)
  if (!circling) addLapseSample(t, alt, st_.tempC);
  fitLapse(t);

  // ---- inversion: inside a thermal, rising air cools ~9.8 °C/km. Real
  // warming with height means an inversion layer. Circling swings the reading
  // by about a degree between core and edge, so the temperature is smoothed
  // over ~2 circles and the cue needs ≥ kInvWarmC of warming above the
  // coldest point of this climb, at least kInvGainM higher up.
  if (dt > 0) {
    const float k = 1.0f - std::exp(-dt / kInvTauS);
    smoothT_ = smoothInit_ ? smoothT_ + k * (st_.tempC - smoothT_) : st_.tempC;
  } else if (!smoothInit_) {
    smoothT_ = st_.tempC;
  }
  smoothInit_ = true;
  // Thermal air is warmer than the air around it, so the first minute or so
  // of a climb reads as warming: start judging only once the smoothed value
  // reflects thermal air.
  if (circling && vario > 0.2f && t - circlingSince_ >= kInvWarmupMs) {
    if (!climbTracking_ || smoothT_ < minT_) {
      climbTracking_ = true;
      minT_ = smoothT_;
      minTAlt_ = alt;
    }
    st_.inversion = smoothT_ - minT_ >= kInvWarmC && alt - minTAlt_ >= kInvGainM;
    if (st_.inversion && !inversionCued_) {
      inversionCued_ = true;
      if (ev == AtmosphereEvent::None) ev = AtmosphereEvent::Inversion;
    }
  } else if (!circling) {
    climbTracking_ = false;
    st_.inversion = false;
  }
  return ev;
}

float Atmosphere::calibrateAtBase() {
  // At base the thermal air is saturated: air temperature = dew point.
  float off = caseT_ - dew_;
  if (off < 0) off = 0;
  if (off > 10) off = 10;
  cfg_.tempOffset = off;
  st_.tempC = caseT_ - off;
  return off;
}

void Atmosphere::addLapseSample(TimeMs t, float alt, float temp) {
  if (lCount_ && t - lastLapseSample_ < kLapseEveryMs) return;
  lastLapseSample_ = t;
  const int idx = (lHead_ + lCount_) % kLapseN;
  lt_[idx] = t;
  la_[idx] = alt;
  lT_[idx] = temp;
  if (lCount_ < kLapseN) ++lCount_;
  else lHead_ = (lHead_ + 1) % kLapseN;
}

void Atmosphere::fitLapse(TimeMs t) {
  while (lCount_ && t - lt_[lHead_] > cfg_.lapseWindowMs) {
    lHead_ = (lHead_ + 1) % kLapseN;
    --lCount_;
  }
  if (lCount_ < kLapseMinN) return;
  float x[kLapseN], y[kLapseN];
  for (int i = 0; i < lCount_; ++i) {
    const int idx = (lHead_ + i) % kLapseN;
    x[i] = la_[idx];
    y[i] = lT_[idx];
  }
  float s, span;
  if (!slope(x, y, lCount_, s, span) || span < cfg_.lapseMinSpanM) return;
  st_.lapseRate = -s * 1000.0f;
  st_.lapseValid = true;
  const float g = st_.lapseRate;
  st_.stability = g < 0.0f   ? Stability::Inversion
                  : g < 6.5f ? Stability::Stable
                  : g < 8.5f ? Stability::Moderate
                             : Stability::Unstable;
}

}  // namespace pg
