// Thermal chances: where thermals have historically been, how likely at this
// time of year and day, and how good today looks. The device can't reach the
// internet in flight, so a pre-flight "area pack" (sim/pack.html builds it
// from KK7 thermal hotspots and an Open-Meteo forecast) is loaded onto it.
//
// Pack format (little-endian), version 1:
//   "PGHS" | u16 version | u16 count | u8 dayFactor[24] (per local hour,
//   0..200 = 0..2.0×, 255 = unknown) | i16 utcOffsetMin | u16 reserved
//   then count × { i32 lat·1e6 | i32 lon·1e6 | u8 prob[4 seasons][3 slots] }
//   seasons: 0 Dec–Feb, 1 Mar–May, 2 Jun–Aug, 3 Sep–Nov
//   slots by hours after sunrise: 0 = < 5.5 h, 1 = 5.5–8.5 h, 2 = later
//   (KK7's 04 / 07 / 10 layers). prob: 0..100 %.
#pragma once
#include <cstddef>
#include <cstdint>

#include "polar.h"
#include "terrain.h"
#include "types.h"

namespace pg {

struct Hotspot {
  double lat = 0, lon = 0;
  uint8_t prob[4][3] = {};
};

// Approximate sunrise, minutes after 00:00 UTC, for the date and place
// (NOAA solar-position approximation; good to a few minutes).
int sunriseUtcMin(int year, int month, int day, double lat, double lon);
int seasonOf(int month);
int slotOf(float hoursAfterSunrise);

class HotspotMap {
 public:
  static constexpr int kMax = 600;
  bool load(const uint8_t* data, size_t len);
  void add(const Hotspot& h);
  void clear() { n_ = 0; }
  int count() const { return n_; }
  const Hotspot& at(int i) const { return h_[i]; }
  void setDayFactor(int hour, float f);  // f < 0 = unknown
  // Chance 0..1 of a usable thermal at hotspot i, for a UTC date/time.
  float chance(int i, int year, int month, int day, int utcMin) const;
  int utcOffsetMin() const { return utcOffsetMin_; }

 private:
  Hotspot h_[kMax];
  int n_ = 0;
  int16_t dayFactor_[24];  // ×100, −1 unknown
  int utcOffsetMin_ = 120;
  bool dayInit_ = false;
};

struct Target {
  bool valid = false;
  bool isHome = false;
  int index = -1;
  double lat = 0, lon = 0;
  float bearingDeg = 0, distM = 0;
  float arrivalAgl = 0;  // m above the ground there, at best glide in this wind
  float chance = 0;      // 0..1
};

// Glide arrival height (m AGL) at a point, flying best L/D through the wind.
float arrivalAgl(const Polar& p, const Terrain* terr, double lat, double lon, float alt, double tLat,
                 double tLon, float windN, float windE, float& bearing, float& dist);

// Best hotspot to glide to: highest chance among those reachable with at least
// `minArrival` m AGL, discounted by distance; ignores the one under you.
Target bestHotspot(const HotspotMap& m, const Polar& p, const Terrain* terr, double lat, double lon, float alt,
                   float windN, float windE, int year, int month, int day, int utcMin, float minArrival);

}  // namespace pg
