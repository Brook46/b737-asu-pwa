// Glider polar, MacCready speed-to-fly and glide computations.
//
// The polar is the usual quadratic sink(v) = a·v² + b·v + c fitted through
// three measured points (sink positive down). Paraglider speeds are clamped to
// [vMin, vMax]: vMin is the slowest sensible braked speed, vMax is full bar.
#pragma once

namespace pg {

struct PolarPoint {
  float speed;  // m/s airspeed
  float sink;   // m/s, positive down
};

class Polar {
 public:
  Polar() = default;
  // Three points, e.g. min-sink, trim, full bar.
  Polar(PolarPoint p1, PolarPoint p2, PolarPoint p3, float vMin, float vMax);
  float sink(float v) const { return a_ * v * v + b_ * v + c_; }
  float vMin() const { return vMin_; }
  float vMax() const { return vMax_; }
  float minSinkSpeed() const;
  float bestGlideSpeed() const { return speedToFly(0, 0, 0); }
  // MacCready speed to fly (m/s airspeed).
  //   mc       — expected climb in the next thermal, m/s
  //   netto    — airmass vertical speed now, m/s (+ up)
  //   headwind — along-track headwind component, m/s (+ against you; negative = tailwind)
  float speedToFly(float mc, float netto, float headwind) const;
  // Glide ratio over the ground (distance per height lost) at airspeed v.
  // Returns a large number in rising air and 0 when not making progress.
  float groundGlideRatio(float v, float netto, float headwind) const;
  bool valid() const { return a_ > 0; }

 private:
  float a_ = 0, b_ = 0, c_ = 0;
  float vMin_ = 0, vMax_ = 0;
};

// Polar for a typical EN-B paraglider: min sink 1.05 m/s at 31 km/h, trim
// 1.15 m/s at 38 km/h, full bar 2.0 m/s at 52 km/h. Replace with your wing.
Polar defaultParagliderPolar();

// Altitude left over at a target `distM` away when flying at the MacCready
// speed with the given wind and MacCready setting (MC adds no climb on final
// glide, it only changes the speed). Negative = short.
float arrivalHeight(const Polar& polar, float altM, float targetAltM, float distM, float mc,
                    float headwind, float safetyM);

}  // namespace pg
