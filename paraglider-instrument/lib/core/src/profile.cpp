#include "profile.h"

namespace pg {

void Profile::reset() {
  for (auto& b : b_) b = ProfileBand{};
  lo_ = kBands;
  hi_ = -1;
}

int Profile::idx(float alt) const {
  int i = static_cast<int>(alt / kBandM);
  if (i < 0) i = 0;
  if (i >= kBands) i = kBands - 1;
  return i;
}

void Profile::touch(int i) {
  if (i < lo_) lo_ = i;
  if (i > hi_) hi_ = i;
}

void Profile::addWind(TimeMs t, float alt, float toN, float toE) {
  ProfileBand& b = b_[idx(alt)];
  const float a = b.nWind ? 0.3f : 1.0f;
  b.windN += a * (toN - b.windN);
  b.windE += a * (toE - b.windE);
  if (b.nWind < 65535) ++b.nWind;
  b.t = t;
  touch(idx(alt));
}

void Profile::addClimb(TimeMs t, float alt, float vario) {
  ProfileBand& b = b_[idx(alt)];
  const float a = b.nClimb ? 0.03f : 1.0f;  // ~7 s at 5 Hz per band crossing: smooth
  b.climb += a * (vario - b.climb);
  if (b.nClimb < 65535) ++b.nClimb;
  b.t = t;
  touch(idx(alt));
}

void Profile::addAir(TimeMs t, float alt, float temp, float dew) {
  ProfileBand& b = b_[idx(alt)];
  const float a = b.nAir ? 0.2f : 1.0f;
  b.temp += a * (temp - b.temp);
  b.dew += a * (dew - b.dew);
  if (b.nAir < 65535) ++b.nAir;
  b.t = t;
  touch(idx(alt));
}

bool Profile::windBetween(float a, float b, float& toN, float& toE) const {
  int i0 = idx(a < b ? a : b), i1 = idx(a < b ? b : a);
  float n = 0, e = 0;
  int k = 0;
  for (int i = i0; i <= i1; ++i) {
    if (!b_[i].nWind) continue;
    n += b_[i].windN;
    e += b_[i].windE;
    ++k;
  }
  if (!k) return false;
  toN = n / k;
  toE = e / k;
  return true;
}

}  // namespace pg
