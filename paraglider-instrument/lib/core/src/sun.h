// Where the sun is, and where it heats the ground enough to start thermals.
//
// sunPosition(): NOAA solar-position approximation (azimuth clockwise from
// true north, elevation above the horizon), good to a fraction of a degree.
//
// ThermalSources: on a grid around you, from the terrain grid,
//   * sun on each slope = cos(angle between the sun and the slope's normal),
//     zero where a ridge between the cell and the sun casts shade, almost
//     zero on water;
//   * heating builds up with a lag (ground and air take ~45 min to respond),
//     so the morning's east faces stay warm into midday;
//   * thermals start where heating is strong AND stronger than around it,
//     helped by prominence (spurs, peaks and edges release the warm air);
//   * wind pushes the warm air up the slope to the crest downwind: in wind the
//     release point moves there, and strong wind (> 6 m/s) breaks thermals up.
// The strongest release points are the thermal sources.
//
// thermalColumnAt(): a thermal leaves its source and rises (a bubble rises at
// roughly half to two thirds of its core updraft) while drifting with the
// wind at each height. At your
// altitude it is downwind of the source by (wind × height above the source /
// rise speed), using the profile's wind for each layer when known. That's
// where to fly to, not to the trigger on the ground.
#pragma once
#include "types.h"

namespace pg {

class Terrain;
class Profile;

struct SunPos {
  float azDeg = 0;    // clockwise from true north
  float elevDeg = 0;  // above the horizon; < 0 at night
};
SunPos sunPosition(int year, int month, int day, int utcMin, double lat, double lon);

struct ThermalSource {
  double lat = 0, lon = 0;  // release point
  float ground = 0;         // m MSL
  float strength = 0;       // 0..1
};

class ThermalSources {
 public:
  static constexpr int kN = 48;            // grid cells per side
  static constexpr float kCellM = 500;     // → a 24 km square around you
  static constexpr int kMax = 40;          // sources kept
  void reset();
  // Recompute around (lat, lon). Call every ~10 min of clock time; heating
  // carries over between calls while the grid stays put.
  void update(const Terrain& terrain, double lat, double lon, int year, int month, int day, int utcMin,
              float windN, float windE);
  bool valid() const { return valid_; }
  int count() const { return n_; }
  const ThermalSource& at(int i) const { return s_[i]; }
  // Heating 0..1 at a position (0 outside the grid). For KK7 points: today's sun on that spot.
  float heatingAt(double lat, double lon) const;
  double centreLat() const { return lat0_; }
  double centreLon() const { return lon0_; }
  int lastUtcMin() const { return lastUtc_; }
  SunPos sun() const { return sun_; }
  // For the simulator's map: heating in cell (i = east index, j = north index).
  float cellHeat(int i, int j) const { return heat_[j][i]; }

 private:
  void cellLatLon(int i, int j, double& lat, double& lon) const;
  float heat_[kN][kN] = {};
  float elev_[kN][kN] = {};
  ThermalSource s_[kMax];
  int n_ = 0;
  bool valid_ = false;
  double lat0_ = 0, lon0_ = 0;
  int lastUtc_ = -1, lastDay_ = -1;
  SunPos sun_;
};

// Where a thermal from a source at `groundMsl` is at altitude `altMsl`:
// downwind by the wind (profile layers if known, else windN/E) × climb time
// at `rise` m/s, plus `halfDepth` m for the middle of a rising bubble.
void thermalColumnAt(double srcLat, double srcLon, float groundMsl, float altMsl, float rise, const Profile* profile,
                     float windN, float windE, double& lat, double& lon, float halfDepth = 300);

}  // namespace pg
