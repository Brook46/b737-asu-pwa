#include "thermal_assist.h"

#include <cmath>

#include "circling.h"

namespace pg {

namespace {
constexpr TimeMs kStaleMs = 45000;  // ~2 circles: older samples no longer describe the thermal
constexpr float kAlpha = 0.5f;      // weight of a new sample in its bin
constexpr int kMinBins = 18;        // half a circle before saying anything
}  // namespace

void ThermalAssist::reset() {
  v_ = AssistView{};
  for (auto& s : stamp_) s = 0;
}

void ThermalAssist::update(TimeMs t, bool circling, float hdg, int dir, float vario) {
  if (!circling || dir == 0) {
    if (v_.active) reset();
    return;
  }
  if (v_.active && dir != v_.dir) reset();  // reversed the turn: the old map is mirrored
  v_.active = true;
  v_.dir = dir;
  const int b = static_cast<int>(std::fmod(hdg + 360.0f, 360.0f) / 10.0f) % 36;
  v_.lift[b] = v_.have[b] ? v_.lift[b] + kAlpha * (vario - v_.lift[b]) : vario;
  v_.have[b] = true;
  stamp_[b] = t;

  int n = 0;
  float sum = 0, best = -99;
  for (int i = 0; i < 36; ++i) {
    if (v_.have[i] && t - stamp_[i] > kStaleMs) v_.have[i] = false;
    if (!v_.have[i]) continue;
    ++n;
    sum += v_.lift[i];
    if (v_.lift[i] > best) best = v_.lift[i];
  }
  v_.best = n ? best : 0;
  v_.mean = n ? sum / n : 0;
  if (n < kMinBins) {
    v_.strength = 0;
    v_.straightenNow = false;
    return;
  }
  // Where on the circle each bin was flown: in a right turn the centre is to
  // your right, so you are at heading − 90° from it (left turn: + 90°).
  float sx = 0, sy = 0, spread = 0;
  for (int i = 0; i < 36; ++i) {
    if (!v_.have[i]) continue;
    const float w = v_.lift[i] - v_.mean;
    const float pos = (i * 10.0f + 5.0f - 90.0f * dir) * kDegToRad;
    sx += w * std::sin(pos);
    sy += w * std::cos(pos);
    spread += std::fabs(w);
  }
  v_.coreDeg = std::fmod(std::atan2(sx, sy) * kRadToDeg + 360.0f, 360.0f);
  v_.strength = spread > 0.05f ? std::sqrt(sx * sx + sy * sy) / spread : 0;
  if (v_.strength > 1) v_.strength = 1;
  // To move the circle toward the core, straighten while heading that way.
  v_.straightenNow = v_.strength > 0.3f && std::fabs(angleDiffDeg(hdg, v_.coreDeg)) < 20.0f;
}

}  // namespace pg
