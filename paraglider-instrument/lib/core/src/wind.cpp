#include "wind.h"

#include <cmath>

#include "circling.h"

namespace pg {

namespace {
double det3(double a, double b, double c, double d, double e, double f, double g, double h, double i) {
  return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
}
constexpr float kMinRadius = 4.0f;   // m/s — slower than any paraglider flies
constexpr float kMaxRadius = 25.0f;  // m/s
constexpr float kMaxRelRms = 0.15f;  // residual / radius
constexpr int kMinPoints = 8;
constexpr TimeMs kMinSpacingMs = 400;
}  // namespace

CircleFit fitCircle(const float* n, const float* e, int count) {
  CircleFit out;
  if (count < 3) return out;
  double mx = 0, my = 0;
  for (int i = 0; i < count; ++i) {
    mx += n[i];
    my += e[i];
  }
  mx /= count;
  my /= count;
  double sxx = 0, sxy = 0, syy = 0, sx = 0, sy = 0, sxz = 0, syz = 0, sz = 0;
  for (int i = 0; i < count; ++i) {
    const double x = n[i] - mx, y = e[i] - my, z = x * x + y * y;
    sxx += x * x;
    sxy += x * y;
    syy += y * y;
    sx += x;
    sy += y;
    sxz += x * z;
    syz += y * z;
    sz += z;
  }
  const double N = count;
  const double d = det3(sxx, sxy, sx, sxy, syy, sy, sx, sy, N);
  if (std::fabs(d) < 1e-9) return out;
  const double D = det3(-sxz, sxy, sx, -syz, syy, sy, -sz, sy, N) / d;
  const double E = det3(sxx, -sxz, sx, sxy, -syz, sy, sx, -sz, N) / d;
  const double F = det3(sxx, sxy, -sxz, sxy, syy, -syz, sx, sy, -sz) / d;
  const double cx = -D / 2, cy = -E / 2;
  const double r2 = cx * cx + cy * cy - F;
  if (r2 <= 0) return out;
  out.radius = static_cast<float>(std::sqrt(r2));
  out.cN = static_cast<float>(cx + mx);
  out.cE = static_cast<float>(cy + my);
  double ss = 0;
  for (int i = 0; i < count; ++i) {
    const double dr = std::hypot(n[i] - out.cN, e[i] - out.cE) - out.radius;
    ss += dr * dr;
  }
  out.rms = static_cast<float>(std::sqrt(ss / count));
  out.ok = true;
  return out;
}

void WindEstimator::reset() {
  count_ = 0;
  turned_ = 0;
  haveTrack_ = false;
  last_ = {};
  est_ = {};
}

void WindEstimator::endCircling() {
  count_ = 0;
  turned_ = 0;
  haveTrack_ = false;
}

bool WindEstimator::addSample(TimeMs t, float velN, float velE, float trackDeg) {
  if (count_ > 0 && t - lastT_ < kMinSpacingMs) return false;
  lastT_ = t;
  if (haveTrack_) turned_ += angleDiffDeg(lastTrack_, trackDeg);
  lastTrack_ = trackDeg;
  haveTrack_ = true;
  if (count_ < kMaxSamples) {
    n_[count_] = velN;
    e_[count_] = velE;
    ++count_;
  }
  if (std::fabs(turned_) < 360.0f) return false;

  const CircleFit f = fitCircle(n_, e_, count_);
  const int used = count_;
  count_ = 0;
  turned_ = 0;
  last_ = f;
  if (!f.ok || used < kMinPoints) return false;
  if (f.radius < kMinRadius || f.radius > kMaxRadius) return false;
  if (f.rms > kMaxRelRms * f.radius) return false;
  fold(f, t);
  return true;
}

void WindEstimator::fold(const CircleFit& f, TimeMs t) {
  float q = 1.0f - f.rms / (kMaxRelRms * f.radius);
  if (q < 0.05f) q = 0.05f;
  // Fresh estimate (or a stale one, > 20 min): take the fit outright.
  const bool fresh = !est_.valid || t - est_.t > 20u * 60u * 1000u;
  const float w = fresh ? 1.0f : 0.25f + 0.5f * q;
  est_.toN = est_.toN * (1 - w) + f.cN * w;
  est_.toE = est_.toE * (1 - w) + f.cE * w;
  est_.speed = std::hypot(est_.toN, est_.toE);
  float from = std::atan2(-est_.toE, -est_.toN) * kRadToDeg;
  if (from < 0) from += 360.0f;
  est_.fromDeg = from;
  est_.airspeed = f.radius;
  est_.quality = fresh ? q : est_.quality * (1 - w) + q * w;
  est_.t = t;
  est_.valid = true;
}

}  // namespace pg
