// Screens for the optional Sharp Memory display (400 × 240, 1-bit).
//
// Two pages, chosen for the moment rather than browsed:
//   * FLIGHT (default) switches itself: circling → the thermal page (thermal
//     assistant first), gliding → the glide page (where to go, can I get there).
//   * INFO (Page button): the slower numbers: cloud base, stability, wind,
//     home, GPS detail.
// Every page: a status bar that turns loud when GPS is jammed or spoofed, and
// a bottom banner for cues (STAY, GLIDE, cloud base, GPS).
//
// Pure logic: renders a FlightComputer Status into a gfx::Canvas. The
// browser simulator and (later) the firmware call exactly this code.
#pragma once
#include "../flight_computer.h"
#include "gfx.h"

namespace pg::display {

enum class Page : uint8_t { Flight = 0, Info, Count };
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
  int flightMin = -1;        // minutes since takeoff; -1 = unknown
  bool simulated = false;
};

// Short history the pages draw from: glide ratio over the last 30 s and
// recent event banners. Feed it every tick.
class Model {
 public:
  void update(TimeMs t, const Status& s);
  void noteAlert(Alert a, TimeMs t);
  bool glideRatio(float& ld) const;   // over the last 30 s of straight flight
  Alert banner(TimeMs t) const;       // event banners shown for a while
  int traceCount() const { return n_; }

 private:
  int n_ = 0;
  TimeMs lastSample_ = 0;
  static constexpr int kGlideN = 31;
  float gAlt_[kGlideN] = {};
  double gLat_[kGlideN] = {}, gLon_[kGlideN] = {};
  bool gBad_[kGlideN] = {};
  int gHead_ = 0, gN_ = 0;
  Alert banner_ = Alert::None;
  TimeMs bannerT_ = 0;
};

void render(gfx::Canvas& c, Page p, const Status& s, const Model& m, const DeviceInfo& d, TimeMs t);

}  // namespace pg::display
