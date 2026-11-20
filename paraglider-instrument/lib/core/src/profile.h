// The day's vertical profile, built while you fly: for every 100 m band,
// the wind (from circling), the climb you found, and the air temperature and
// dew point (case sensor, offset-corrected).
//
// Uses: glide arrival heights with the winds you'll actually meet on the way
// down, and the PROFILE page (where the good climbs were, where the wind
// changes, where the air gets stable). The case sensor is too slow to map
// lift around a single circle (it lags tens of seconds), but it is right for
// this: a slow, altitude-by-altitude picture.
#pragma once
#include "types.h"

namespace pg {

struct ProfileBand {
  float windN = 0, windE = 0;  // vector the air moves toward, m/s
  float climb = 0;             // m/s while circling here
  float temp = 0, dew = 0;     // °C
  uint16_t nWind = 0, nClimb = 0, nAir = 0;
  TimeMs t = 0;
};

class Profile {
 public:
  static constexpr int kBands = 60;  // 0..6000 m MSL
  static constexpr float kBandM = 100;
  void reset();
  void addWind(TimeMs t, float altMsl, float toN, float toE);
  void addClimb(TimeMs t, float altMsl, float vario);
  void addAir(TimeMs t, float altMsl, float temp, float dew);
  // Mean wind over the bands between two altitudes (either order). False
  // when no band in between has a wind yet.
  bool windBetween(float a, float b, float& toN, float& toE) const;
  const ProfileBand& band(int i) const { return b_[i]; }
  int lowest() const { return lo_; }
  int highest() const { return hi_; }  // -1 if empty

 private:
  int idx(float alt) const;
  void touch(int i);
  ProfileBand b_[kBands];
  int lo_ = kBands, hi_ = -1;
};

}  // namespace pg
