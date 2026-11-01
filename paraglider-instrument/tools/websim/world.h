// A small soaring world for the simulator: drifting thermals with a core and a
// sink ring, wind, a cloud base set by surface temperature and dew point, and
// a paraglider that you steer or that flies itself. It produces exactly the
// sensor samples the firmware gets (baro 25 Hz, GNSS 5 Hz, IMU 100 Hz, air
// 1 Hz) and feeds them to the real FlightComputer.
//
// The autopilot deliberately obeys the instrument: it starts circling on
// STAY and leaves on GLIDE, so a flight shows whether the cues are any good.
// It "sees" thermals the way a pilot sees cumulus, to pick where to glide.
#pragma once
#include <cmath>
#include <cstdint>

#include "atmosphere.h"
#include "flight_computer.h"
#include "sensors.h"

namespace world {

constexpr double kOriginLat = 32.53, kOriginLon = 35.40;  // over the Gilboa
constexpr double kMPerDegLat = 111195.0;

struct Thermal {
  double x = 0, y = 0;   // m, east/north
  float strength = 2.5f; // m/s at the core, before ramp
  float radius = 80;     // m, core 1/e radius
  float age = 0, life = 900;  // s
  float now() const {
    const float ramp = age < 60 ? age / 60 : (life - age < 120 ? (life - age) / 120 : 1.0f);
    return strength * (ramp < 0 ? 0 : ramp);
  }
};

struct Params {
  float windFromDeg = 270, windSpeed = 4.0f;    // m/s
  // Thermal source air at the ground: base = ground + 125 m × (T − Td).
  float surfaceT = 30, surfaceTd = 13;
  float groundElev = 200;                       // m (the Valley floor)
  float envLapse = 9.0f;                        // °C/km between thermals (cumulus day: near dry)
  float inversionAlt = 0;                       // m MSL, 0 = none; above it the air warms and lift dies
  float caseOffset = 2.0f;                      // case reads warm by this
  float strength = 2.8f;                        // mean core strength, m/s
  bool imu = true;
  bool autopilot = true;
};

class World {
 public:
  static constexpr int kThermals = 14;
  Params p;
  Thermal th[kThermals];
  // pilot
  double x = 0, y = 0;
  float alt = 1400, hdg = 0, airspeed = 10.5f;
  float turnCmd = 0;   // deg/s requested (manual), + = right
  float speedBar = 0;  // 0..1
  float lift = 0, climb = 0;
  int landings = 0;
  // autopilot state
  bool apCircling = false;
  int apTarget = -1, apLeft = -1;
  uint32_t apIgnoreUntil = 0;
  uint32_t t = 0;  // ms

  float cloudBase() const { return p.groundElev + 125.0f * (p.surfaceT - p.surfaceTd); }
  void windVec(float& wN, float& wE) const {
    const float to = (p.windFromDeg + 180.0f) * pg::kDegToRad;
    wN = p.windSpeed * std::cos(to);
    wE = p.windSpeed * std::sin(to);
  }

  void reset(uint32_t seed) {
    rng_ = seed ? seed : 1;
    x = y = 0;
    alt = 1400;
    hdg = 0;
    t = 0;
    landings = 0;
    apCircling = false;
    apTarget = apLeft = -1;
    for (auto& v : visitedUntil_) v = 0;
    climb = 0;
    started_ = false;
    caseT_ = 0;
    for (auto& h : th) spawn(h, true);
    // one thermal near the start so something happens soon
    th[0].x = 0;
    th[0].y = 700;
    th[0].age = 120;
  }

  // Air temperature and dew point the case sees, outside or inside a thermal
  // (`f` = 0 environment … 1 thermal core). Thermal air follows the dry
  // adiabat from the surface and stays warmer than its surroundings up to
  // cloud base; the environment cools at envLapse and warms above an
  // inversion.
  void air(float z, float f, float& temp, float& td) const {
    const float h = (z - p.groundElev) / 1000.0f;
    const float H = (cloudBase() - p.groundElev) / 1000.0f;
    const float excess0 = (9.8f - p.envLapse) * (H > 0.3f ? H : 0.3f) + 0.3f;
    const float tp = p.surfaceT - 9.8f * h;
    float te = p.surfaceT - excess0 - p.envLapse * h;
    if (p.inversionAlt > 0 && z > p.inversionAlt) te += (p.envLapse + 3.0f) * (z - p.inversionAlt) / 1000.0f;  // net +3 °C/km above it
    const float tdp = p.surfaceTd - 1.8f * h;
    const float tde = tdp - 2.5f;  // the air between thermals is drier
    temp = f * tp + (1 - f) * te;
    td = f * tdp + (1 - f) * tde;
    if (td > temp) td = temp;
  }

  float liftAt(double px, double py, float z) const {
    if (z > cloudBase() - 20) return -0.5f;  // in cloud / above base: no climb
    if (p.inversionAlt > 0 && z > p.inversionAlt + 30) return -0.4f;
    float w = -0.45f;                        // background sink between thermals
    for (const auto& h : th) {
      const double dx = px - h.x, dy = py - h.y;
      const float d2 = static_cast<float>(dx * dx + dy * dy);
      const float r2 = h.radius * h.radius;
      const float s = h.now();
      w += s * std::exp(-d2 / r2);
      // a sink ring around the core
      const float d = std::sqrt(d2);
      const float ring = (d - 1.8f * h.radius) / (0.6f * h.radius);
      w -= 0.35f * s * std::exp(-ring * ring);
    }
    // lift fades in the top 300 m below base or an inversion
    float top = cloudBase() - z;
    if (p.inversionAlt > 0 && p.inversionAlt - z < top) top = p.inversionAlt - z;
    if (top < 300 && w > 0) w *= top / 300.0f;
    return w;
  }

  // Advance 10 ms and feed whatever sensors fire now. `adviceFc` lets the
  // autopilot react to the instrument.
  void step(pg::FlightComputer& fc) {
    const float dt = 0.01f;
    t += 10;
    float wN, wE;
    windVec(wN, wE);
    for (auto& h : th) {
      h.age += dt;
      h.x += wE * dt;
      h.y += wN * dt;
      const double dx = h.x - x, dy = h.y - y;
      if (h.age > h.life || dx * dx + dy * dy > 6000.0 * 6000.0) spawn(h, false);
    }

    if (p.autopilot) autopilot(fc);
    const bool turning = std::fabs(turnCmd) > 1.0f;
    airspeed = turning ? 9.6f : 10.5f + speedBar * 3.8f;
    hdg = std::fmod(hdg + turnCmd * dt + 360.0f, 360.0f);

    const float h = hdg * pg::kDegToRad;
    const float vN = airspeed * std::cos(h) + wN, vE = airspeed * std::sin(h) + wE;
    x += vE * dt;
    y += vN * dt;
    turb_ += (gauss() * 0.35f - turb_) * 0.02f;  // slow random gusts
    lift = liftAt(x, y, alt) + turb_;
    const float sink = fc.config().polar.sink(airspeed) + (turning ? 0.25f + std::fabs(turnCmd) * 0.004f : 0.0f);
    const float prevClimb = started_ ? climb : lift - sink;  // no acceleration spike at start
    started_ = true;
    climb = lift - sink;
    alt += climb * dt;
    if (alt < p.groundElev + 30) {  // landed out: relaunch
      ++landings;
      alt = p.groundElev + 1100;
      apCircling = false;
    }

    if (t % 40 == 0) {
      pg::BaroSample b;
      b.t = t;
      b.pressurePa = pg::altitudeToPressure(alt + gauss() * 0.25f);
      b.tempC = 25;
      b.valid = true;
      fc.onBaro(b);
    }
    if (p.imu) {
      accSum_ += (climb - prevClimb) / dt;
      if (t % 10 == 0) {
        // Level-ish sensor: bank adds centripetal load; yaw about up = −turn.
        pg::ImuSample m;
        m.t = t;
        const float bank = std::atan(airspeed * turnCmd * pg::kDegToRad / pg::kGravity);
        m.az = pg::kGravity / std::cos(bank) + accSum_ + gauss() * 0.15f;
        m.ax = gauss() * 0.15f;
        m.ay = gauss() * 0.15f;
        m.gz = -turnCmd * pg::kDegToRad + gauss() * 0.005f;
        m.valid = true;
        fc.onImu(m);
        accSum_ = 0;
      }
    }
    if (t % 200 == 0) {
      pg::GnssFix g;
      g.t = t;
      g.lat = kOriginLat + y / kMPerDegLat;
      g.lon = kOriginLon + x / (kMPerDegLat * std::cos(kOriginLat * pg::kDegToRad));
      g.velN = vN + gauss() * 0.1f;
      g.velE = vE + gauss() * 0.1f;
      g.groundSpeed = std::hypot(g.velN, g.velE);
      g.trackDeg = std::fmod(std::atan2(g.velE, g.velN) * pg::kRadToDeg + 360.0f, 360.0f);
      g.altMsl = alt + 4;
      g.fix = pg::FixType::Fix3D;
      g.sats = 11;
      g.hAcc = 2.5f;
      fc.onGnss(g);
    }
    if (t % 1000 == 0) {
      float f = (lift + 0.45f) / 2.5f;  // how much of this air is thermal air
      f = f < 0 ? 0 : (f > 1 ? 1 : f);
      float temp, td;
      air(alt, f, temp, td);
      // The case lags the air (~20 s) and runs warm by caseOffset.
      const float target = temp + p.caseOffset;
      caseT_ = caseT_ == 0 ? target : caseT_ + (target - caseT_) * 0.05f;
      fc.onAir(t, caseT_, pg::relativeHumidity(caseT_, td));
    }
  }

 private:
  void spawn(Thermal& h, bool initial) {
    visitedUntil_[&h - th] = 0;
    const float ang = uniform() * 6.2832f;
    const float dist = initial ? 300 + uniform() * 2500 : 900 + uniform() * 2200;
    h.x = x + dist * std::sin(ang);
    h.y = y + dist * std::cos(ang);
    h.strength = p.strength * (0.55f + uniform() * 0.9f);
    h.radius = 60 + uniform() * 60;
    h.life = 600 + uniform() * 900;
    h.age = initial ? uniform() * h.life * 0.6f : 0;
  }

  void autopilot(pg::FlightComputer& fc) {
    const pg::Status& s = fc.status();
    const pg::Advice adv = s.advisor.advice;
    if (!apCircling) {
      // Arrived at a thermal that didn't earn a STAY: it's not worth it, move on.
      if (apTarget >= 0) {
        const double dx = th[apTarget].x - x, dy = th[apTarget].y - y;
        if (dx * dx + dy * dy < 35.0 * 35.0) {  // flown through the core
          visitedUntil_[apTarget] = t + 240000;
          apTarget = -1;
        }
      }
      // Start turning when the instrument says STAY (and we're not ignoring
      // the thermal we just left).
      if (adv == pg::Advice::Stay && t > apIgnoreUntil) {
        apCircling = true;
        apTarget = nearest(-1);
      }
    } else {
      const bool nearBase = alt > cloudBase() - 120;
      if (adv == pg::Advice::Glide || nearBase) {
        apCircling = false;
        apLeft = nearest(-1);
        if (apLeft >= 0) visitedUntil_[apLeft] = t + 300000;
        apIgnoreUntil = t + 30000;
        apTarget = -1;
      }
    }
    if (apCircling) {
      // Circle right; widen when pointing at the core so the circle drifts
      // onto it (the classic centering technique).
      float base = 17.0f;
      if (apTarget >= 0) {
        const float brg = bearingTo(th[apTarget]);
        const float diff = pg::angleDiffDeg(hdg, brg);
        base = 17.0f - 7.0f * std::cos(diff * pg::kDegToRad);
      }
      turnCmd = base;
      speedBar = 0;
      return;
    }
    // Glide: toward the best-looking thermal ahead (not the one we just left).
    if (apTarget < 0 || th[apTarget].now() < 0.6f) apTarget = best(apLeft);
    if (apTarget >= 0) {
      const float diff = pg::angleDiffDeg(hdg, bearingTo(th[apTarget]));
      turnCmd = diff > 4 ? 12.0f : (diff < -4 ? -12.0f : diff * 2.0f);
    } else {
      turnCmd = 0;
    }
    speedBar = s.stf > 45 ? 0.6f : 0.0f;
  }

  float bearingTo(const Thermal& h) const {
    return std::fmod(std::atan2(static_cast<float>(h.x - x), static_cast<float>(h.y - y)) * pg::kRadToDeg + 360.0f,
                     360.0f);
  }
  int nearest(int exclude) const {
    int bi = -1;
    double bd = 1e18;
    for (int i = 0; i < kThermals; ++i) {
      if (i == exclude) continue;
      const double dx = th[i].x - x, dy = th[i].y - y, d = dx * dx + dy * dy;
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    return bi;
  }
  int best(int exclude) const {
    int bi = -1;
    float bs = -1e9f;
    for (int i = 0; i < kThermals; ++i) {
      if (i == exclude || th[i].now() < 0.8f || visitedUntil_[i] > t) continue;
      const double dx = th[i].x - x, dy = th[i].y - y;
      const float d = static_cast<float>(std::sqrt(dx * dx + dy * dy));
      const float score = th[i].now() * 400.0f - d;
      if (score > bs) {
        bs = score;
        bi = i;
      }
    }
    return bi;
  }
  float uniform() {
    rng_ ^= rng_ << 13;
    rng_ ^= rng_ >> 17;
    rng_ ^= rng_ << 5;
    return (rng_ & 0xFFFFFF) / 16777216.0f;
  }
  float gauss() {
    float s = 0;
    for (int i = 0; i < 4; ++i) s += uniform();
    return (s - 2.0f) * 1.732f;
  }
  uint32_t rng_ = 1;
  float turb_ = 0, accSum_ = 0;
  float caseT_ = 0;
  bool started_ = false;
  uint32_t visitedUntil_[kThermals] = {};
};

}  // namespace world
