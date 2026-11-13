#include "polar.h"

#include <cmath>

namespace pg {

Polar::Polar(PolarPoint p1, PolarPoint p2, PolarPoint p3, float vMin, float vMax)
    : vMin_(vMin), vMax_(vMax) {
  // Solve the 3×3 Vandermonde system for a, b, c.
  const double x1 = p1.speed, x2 = p2.speed, x3 = p3.speed;
  const double y1 = p1.sink, y2 = p2.sink, y3 = p3.sink;
  const double d = (x1 - x2) * (x1 - x3) * (x2 - x3);
  if (std::fabs(d) < 1e-9) return;
  a_ = static_cast<float>((x3 * (y2 - y1) + x2 * (y1 - y3) + x1 * (y3 - y2)) / d);
  b_ = static_cast<float>((x3 * x3 * (y1 - y2) + x2 * x2 * (y3 - y1) + x1 * x1 * (y2 - y3)) / d);
  c_ = static_cast<float>((x2 * x3 * (x2 - x3) * y1 + x3 * x1 * (x3 - x1) * y2 +
                           x1 * x2 * (x1 - x2) * y3) / d);
}

float Polar::minSinkSpeed() const {
  if (a_ <= 0) return vMin_;
  float v = -b_ / (2 * a_);
  if (v < vMin_) v = vMin_;
  if (v > vMax_) v = vMax_;
  return v;
}

// Minimise time per distance: d/dv [ (sink(v) - netto + mc) / (v - h) ] = 0
//   → a·v² − 2a·h·v − (b·h + c + mc − netto) = 0
//   → v = h + sqrt(h² + (b·h + c + mc − netto)/a)
float Polar::speedToFly(float mc, float netto, float headwind) const {
  if (a_ <= 0) return vMin_;
  const float h = headwind;
  const float disc = h * h + (b_ * h + c_ + mc - netto) / a_;
  float v = disc > 0 ? h + std::sqrt(disc) : minSinkSpeed();
  if (v < vMin_) v = vMin_;
  if (v > vMax_) v = vMax_;
  return v;
}

float Polar::groundGlideRatio(float v, float netto, float headwind) const {
  const float gs = v - headwind;
  if (gs <= 0) return 0;
  const float s = sink(v) - netto;
  if (s <= 0.01f) return 999.0f;
  return gs / s;
}

Polar defaultParagliderPolar() {
  const float k = 1.0f / 3.6f;
  return Polar({31 * k, 1.05f}, {38 * k, 1.15f}, {52 * k, 2.0f}, 28 * k, 52 * k);
}

float arrivalHeight(const Polar& polar, float altM, float targetAltM, float distM, float mc,
                    float headwind, float safetyM) {
  const float v = polar.speedToFly(mc, 0, headwind);
  const float ld = polar.groundGlideRatio(v, 0, headwind);
  if (ld <= 0) return -1e6f;
  return altM - targetAltM - safetyM - distM / ld;
}

}  // namespace pg
