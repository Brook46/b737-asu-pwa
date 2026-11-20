// Other pilots, from FANET tracking: who's near, and who's climbing.
//
// A pilot who is turning and climbing marks a live thermal. Live thermals
// beat any historical map: the instrument offers them as glide targets, and
// pilots near you in the same thermal feed the thermal model.
//
// Their positions come from their GPS, which can be jammed or spoofed like
// ours: reports implausibly far from us are dropped by the FlightComputer,
// and none of this is used while our own GPS is untrusted (we wouldn't know
// where they are relative to us).
#pragma once
#include <cstdint>

#include "fanet.h"
#include "types.h"

namespace pg {

struct OtherPilot {
  uint32_t id = 0;
  TimeMs t = 0;               // last report
  double lat = 0, lon = 0;
  float alt = 0, climb = 0, climbAvg = 0, headingDeg = 0, turnRateDeg = 0;
  bool turning = false;
  TimeMs prevT = 0;
  float prevHeading = 0;
};

struct LiveThermal {
  double lat = 0, lon = 0;    // where it was marked (drifts with the wind since)
  float alt = 0;              // top seen so far, m
  float climb = 0;            // m/s, smoothed
  TimeMs t = 0;               // last confirmed
  uint32_t by = 0;
};

class Traffic {
 public:
  static constexpr int kPilots = 16, kThermals = 12;
  static constexpr TimeMs kPilotTimeoutMs = 90000;
  static constexpr TimeMs kThermalTimeoutMs = 20 * 60000;
  void reset() { nP_ = nT_ = 0; }
  void onTracking(TimeMs t, uint32_t id, const fanet::Tracking& tr);
  void expire(TimeMs t);
  int pilots() const { return nP_; }
  const OtherPilot& pilot(int i) const { return p_[i]; }
  int thermals() const { return nT_; }
  const LiveThermal& thermal(int i) const { return th_[i]; }

 private:
  void mark(TimeMs t, const OtherPilot& p);
  OtherPilot p_[kPilots];
  LiveThermal th_[kThermals];
  int nP_ = 0, nT_ = 0;
};

// Metres north/east from (lat0, lon0) to (lat, lon); fine within ~100 km.
void offsetMeters(double lat0, double lon0, double lat, double lon, float& north, float& east);

}  // namespace pg
