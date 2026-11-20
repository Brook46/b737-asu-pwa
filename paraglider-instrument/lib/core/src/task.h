// Optional competition / XC task: turnpoint cylinders to goal.
//
// Loaded from an XCTrack task file (.xctsk, JSON, version 1: the format
// XCTrack exports and most competitions publish). Only what navigation needs
// is read: each turnpoint's name, position, radius and type (TAKEOFF / SSS /
// ESS), and the start direction (ENTER / EXIT). Distances are centre to
// centre minus the cylinders' radii: simple and slightly conservative, not
// the optimised route.
//
// Final glide: the height needed to reach goal from here, leg by leg, flying
// MacCready speed for each leg's head/tailwind, plus a safety margin over
// goal's ground. MC on final glide is the climb you'd otherwise expect: if
// you have the height at that MC, leaving now beats climbing more.
#pragma once
#include <cstddef>
#include <cstdint>

#include "polar.h"
#include "types.h"

namespace pg {

class Terrain;
class Profile;

enum class TpType : uint8_t { Turnpoint, Takeoff, Start, EndOfSpeed };

struct Turnpoint {
  char name[16] = {};
  double lat = 0, lon = 0;
  float radius = 400;  // m
  float alt = 0;       // ground there, if the file gives it
  TpType type = TpType::Turnpoint;
};

struct TaskView {
  bool active = false;     // a task is loaded
  bool started = false;    // past the start
  bool finished = false;   // goal reached
  int next = 0;            // index of the next turnpoint
  const char* nextName = "";
  float nextDist = 0;      // m to the next cylinder's edge
  float nextBearing = 0;   // deg true, to its centre
  bool insideStart = false; // next is an exit start and you're inside it
  float toGoal = 0;        // m, remaining task distance
  bool finalValid = false;
  float finalSurplus = 0;  // m above the final-glide line at the current MC (+ = on glide)
  float finalMc = 0;       // MC that exactly uses your height (if on glide)
};

class Task {
 public:
  static constexpr int kMax = 24;
  bool parseXctsk(const char* json, size_t len);
  void add(const Turnpoint& tp) {
    if (n_ < kMax) tp_[n_++] = tp;
  }
  void clear() { n_ = 0, next_ = 0, inside_ = false; }
  void setStartExit(bool exit) { startExit_ = exit; }
  int count() const { return n_; }
  const Turnpoint& at(int i) const { return tp_[i]; }
  int next() const { return next_; }
  // Advance through cylinders. Returns true when a turnpoint was just reached.
  bool update(double lat, double lon);
  // Remaining distance via the remaining turnpoints.
  float remaining(double lat, double lon) const;
  // Height (m MSL) needed to reach goal at MacCready `mc`, with this wind
  // (or the profile's wind for each altitude), arriving `safety` m above goal.
  float requiredAltitude(const Polar& p, double lat, double lon, float mc, float windN, float windE,
                         const Terrain* terrain, float safety) const;
  TaskView view(double lat, double lon) const;

 private:
  Turnpoint tp_[kMax];
  int n_ = 0, next_ = 0;
  bool inside_ = false, startExit_ = true;
};

}  // namespace pg
