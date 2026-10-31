// Synthetic flight generator: a scripted glide → thermal → decaying thermal →
// glide, with wind drift and sensor noise. Used by the tests and by
// `tools/sim --synthetic`. Header-only, desktop only.
#pragma once
#include <cmath>
#include <cstdint>

#include "flight_computer.h"
#include "sensors.h"

namespace synth {

struct Segment {
  uint32_t untilMs;
  float liftStart, liftEnd;  // airmass vertical speed, m/s, linear over the segment
  float turnRateDeg;         // 0 = straight
  float airspeed;            // m/s
};

struct Script {
  float windFromDeg = 270, windSpeed = 4.0f;
  float startAlt = 1500;
  float startHeadingDeg = 0;
  float baroNoise = 0.2f;     // m, 1σ
  float circlingSinkExtra = 0.25f;  // bank penalty on top of the straight polar
  bool imu = false;           // also emit 100 Hz IMU samples (level sensor, yaw from turn)
  const Segment* segs = nullptr;
  int nSegs = 0;
};

// Default script: what the advisor tests expect.
inline const Segment kDefault[] = {
    {60000, -0.5f, -0.5f, 0, 10.5f},    // glide in sink
    {75000, 2.8f, 2.8f, 0, 10.5f},      // fly into a good thermal, straight
    {300000, 2.8f, 2.8f, 15.0f, 9.5f},  // circle in it
    {420000, 2.8f, 0.6f, 15.0f, 9.5f},  // thermal dies off; pilot keeps turning
    {500000, -0.3f, -0.3f, 0, 10.5f},   // leave, glide
};

class Flight {
 public:
  explicit Flight(const Script& s) : s_(s), alt_(s.startAlt), hdg_(s.startHeadingDeg) {
    const float to = (s.windFromDeg + 180.0f) * pg::kDegToRad;
    wN_ = s.windSpeed * std::cos(to);
    wE_ = s.windSpeed * std::sin(to);
  }

  uint32_t duration() const { return s_.segs[s_.nSegs - 1].untilMs; }
  float trueAltitude() const { return alt_; }
  float trueClimb() const { return climb_; }

  // Advances 10 ms and feeds whatever sensors fire at this instant.
  void step(pg::FlightComputer& fc) {
    t_ += 10;
    const Segment& sg = seg();
    const uint32_t start = segStart();
    const float k = sg.untilMs > start ? float(t_ - start) / float(sg.untilMs - start) : 0;
    const float lift = sg.liftStart + (sg.liftEnd - sg.liftStart) * k;
    const pg::Polar& p = fc.config().polar;
    const float sink = p.sink(sg.airspeed) + (sg.turnRateDeg != 0 ? s_.circlingSinkExtra : 0);
    const float prevClimb = climb_;
    climb_ = lift - sink;
    alt_ += climb_ * 0.01f;
    hdg_ = std::fmod(hdg_ + sg.turnRateDeg * 0.01f + 360.0f, 360.0f);

    if (t_ % 40 == 0) {  // 25 Hz baro
      pg::BaroSample b;
      b.t = t_;
      b.pressurePa = pg::altitudeToPressure(alt_ + noise() * s_.baroNoise);
      b.tempC = 20;
      b.valid = true;
      fc.onBaro(b);
    }
    if (t_ > 10) accSum_ += (climb_ - prevClimb) / 0.01f;  // no spike from the initial state
    if (s_.imu && t_ % 10 == 0) {  // 100 Hz IMU: z up, yaw about +z is counter-clockwise
      pg::ImuSample m;
      m.t = t_;
      m.az = pg::kGravity + accSum_;
      m.gz = -sg.turnRateDeg * pg::kDegToRad;
      m.valid = true;
      fc.onImu(m);
      accSum_ = 0;
    }
    if (t_ % 200 == 0) {  // 5 Hz GNSS
      const float h = hdg_ * pg::kDegToRad;
      pg::GnssFix g;
      g.t = t_;
      g.velN = sg.airspeed * std::cos(h) + wN_;
      g.velE = sg.airspeed * std::sin(h) + wE_;
      g.groundSpeed = std::hypot(g.velN, g.velE);
      g.trackDeg = std::fmod(std::atan2(g.velE, g.velN) * pg::kRadToDeg + 360.0f, 360.0f);
      g.altMsl = alt_;
      g.fix = pg::FixType::Fix3D;
      g.sats = 12;
      g.hAcc = 2;
      fc.onGnss(g);
    }
  }
  uint32_t now() const { return t_; }
  bool done() const { return t_ >= duration(); }

 private:
  const Segment& seg() const {
    for (int i = 0; i < s_.nSegs; ++i)
      if (t_ < s_.segs[i].untilMs) return s_.segs[i];
    return s_.segs[s_.nSegs - 1];
  }
  uint32_t segStart() const {
    uint32_t st = 0;
    for (int i = 0; i < s_.nSegs; ++i) {
      if (t_ < s_.segs[i].untilMs) return st;
      st = s_.segs[i].untilMs;
    }
    return st;
  }
  // Deterministic approx-Gaussian noise (sum of uniforms, xorshift).
  float noise() {
    float s = 0;
    for (int i = 0; i < 6; ++i) {
      rng_ ^= rng_ << 13;
      rng_ ^= rng_ >> 17;
      rng_ ^= rng_ << 5;
      s += (rng_ & 0xFFFF) / 65535.0f;
    }
    return (s - 3.0f) * 1.41f;
  }
  Script s_;
  uint32_t t_ = 0;
  float alt_, hdg_, climb_ = 0;
  float wN_ = 0, wE_ = 0;
  float accSum_ = 0;
  uint32_t rng_ = 0x12345678u;
};

inline Script defaultScript() {
  Script s;
  s.segs = kDefault;
  s.nSegs = static_cast<int>(sizeof(kDefault) / sizeof(kDefault[0]));
  return s;
}

}  // namespace synth
