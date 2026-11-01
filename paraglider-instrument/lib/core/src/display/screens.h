// Screen pages for the optional Sharp Memory display (400 × 240, 1-bit).
// Pure logic: renders a FlightComputer Status into a gfx::Canvas. The
// browser simulator and (later) the firmware call exactly this code.
#pragma once
#include "../flight_computer.h"
#include "gfx.h"

namespace pg::display {

enum class Page : uint8_t { Thermal = 0, Glide, Air, System, Count };
const char* pageName(Page p);

// Things the screen shows that aren't in the flight computer's Status.
struct DeviceInfo {
  int batteryPct = -1;       // -1 = unknown
  bool xctLinked = false;
  const char* baroName = "BME280";
  const char* fanetRegion = "IL918";
  uint32_t fanetRx = 0;
  bool txEnabled = false;
  int clockMin = -1;         // minutes since midnight, local; -1 = unknown
  bool simulated = false;
};

// History the pages draw from: a 1 Hz vario trace, a glide-ratio window and
// recent event banners. Feed it every tick.
class Model {
 public:
  static constexpr int kTrace = 225;  // seconds of vario trace (1 px each)
  void update(TimeMs t, const Status& s);
  void noteAlert(Alert a, TimeMs t);
  float trace(int i) const;           // i = 0 oldest … kTrace-1 newest
  int traceCount() const { return n_; }
  bool glideRatio(float& ld) const;   // over the last 30 s of straight flight
  Alert banner(TimeMs t) const;       // NearBase / Inversion / Message shown for a while

 private:
  float tr_[kTrace] = {};
  int head_ = 0, n_ = 0;
  TimeMs lastSample_ = 0;
  static constexpr int kGlideN = 31;
  float gAlt_[kGlideN] = {};
  double gLat_[kGlideN] = {}, gLon_[kGlideN] = {};
  bool gCircling_[kGlideN] = {};
  int gHead_ = 0, gN_ = 0;
  Alert banner_ = Alert::None;
  TimeMs bannerT_ = 0;
};

void render(gfx::Canvas& c, Page p, const Status& s, const Model& m, const DeviceInfo& d,
            TimeMs t);

}  // namespace pg::display
