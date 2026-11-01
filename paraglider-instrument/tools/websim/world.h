// The simulator's world: real terrain around the Gilboa (baked from AWS
// Terrain Tiles), wind with ridge lift off the slopes, thermals that rise
// where the terrain or a hotspot pack says they should, drifting with the
// wind, a cloud base set by surface temperature and dew point, a date and
// time of day, and a GPS that can be jammed or spoofed.
//
// It produces exactly the sensor samples the firmware gets (baro 25 Hz, GNSS
// 5 Hz, IMU 100 Hz, air 1 Hz) and feeds them to the real FlightComputer.
//
// The autopilot deliberately obeys the instrument: it starts circling on
// STAY and leaves on GLIDE, so a flight shows whether the cues are any good.
// It "sees" thermals the way a pilot sees cumulus, to pick where to glide.
#pragma once
#include <cmath>
#include <cstdint>

#include "atmosphere.h"
#include "flight_computer.h"
#include "hotspots.h"
#include "sensors.h"
#include "terrain.h"

namespace world {

// Launch: the Gilboa ridge above the Harod valley.
constexpr double kOriginLat = 32.4585, kOriginLon = 35.4120;
constexpr double kMPerDegLat = 111195.0;
constexpr double kBeirutLat = 33.8209, kBeirutLon = 35.4884;  // where spoofers put you

enum class GpsMode : uint8_t { Normal = 0, Jammed = 1, Spoofed = 2, Noisy = 3 };

struct Thermal {
  double x = 0, y = 0;   // m, east/north of the origin
  float strength = 2.5f; // m/s at the core, before ramp
  float radius = 80;     // m, core 1/e radius
  float age = 0, life = 900;  // s
  float now() const {
    const float ramp = age < 60 ? age / 60 : (life - age < 120 ? (life - age) / 120 : 1.0f);
    return strength * (ramp < 0 ? 0 : ramp);
  }
};

struct Params {
  float windFromDeg = 300, windSpeed = 4.0f;  // m/s; NW is the Valley's afternoon breeze
  // Source air near sea level (the Valley floor): base ≈ 125 m × (T − Td) MSL.
  float surfaceT = 30, surfaceTd = 13;
  float envLapse = 9.0f;      // °C/km between thermals (cumulus day: near dry)
  float inversionAlt = 0;     // m MSL, 0 = none; above it the air warms and lift dies
  float caseOffset = 2.0f;    // case reads warm by this
  float strength = 2.8f;      // mean core strength, m/s
  bool imu = true;
  bool autopilot = true;
  GpsMode gps = GpsMode::Normal;
  int year = 2026, month = 7, day = 15;
  int startLocalMin = 12 * 60;  // clock at reset
};

class World {
 public:
  static constexpr int kThermals = 14;
  static constexpr int kSpots = 160;
  // Start already off the ridge with some height (a ground launch and ridge
  // scratch is not what the simulator is for).
  static constexpr float kLaunchAgl = 450;
  bool relaunched = false;
  Params p;
  Thermal th[kThermals];
  pg::Terrain terrain;
  pg::HotspotMap spots;       // thermal sources: a loaded KK7 pack, or derived from terrain
  bool spotsFromPack = false;
  // pilot
  double x = 0, y = 0;
  float alt = 600, hdg = 0, airspeed = 10.5f;
  float turnCmd = 0;   // deg/s requested (manual), + = right
  float speedBar = 0;  // 0..1
  float lift = 0, climb = 0, ground = 0;
  int landings = 0;
  // autopilot state
  bool apCircling = false;
  int apTarget = -1, apLeft = -1;
  uint32_t apIgnoreUntil = 0;
  uint32_t t = 0;  // ms

  float ridgeNow() const { return ridge_; }
  float cloudBase() const { return 125.0f * (p.surfaceT - p.surfaceTd); }
  void windVec(float& wN, float& wE) const {
    const float to = (p.windFromDeg + 180.0f) * pg::kDegToRad;
    wN = p.windSpeed * std::cos(to);
    wE = p.windSpeed * std::sin(to);
  }
  double lat() const { return kOriginLat + y / kMPerDegLat; }
  double lon() const { return kOriginLon + x / (kMPerDegLat * std::cos(kOriginLat * pg::kDegToRad)); }
  void toXY(double la, double lo, double& ox, double& oy) const {
    oy = (la - kOriginLat) * kMPerDegLat;
    ox = (lo - kOriginLon) * kMPerDegLat * std::cos(kOriginLat * pg::kDegToRad);
  }
  float elevAt(double px, double py) const {
    float e = 0;
    terrain.elevation(kOriginLat + py / kMPerDegLat,
                      kOriginLon + px / (kMPerDegLat * std::cos(kOriginLat * pg::kDegToRad)), e);
    return e;
  }
  // Local time and UTC minutes since midnight (Israel: UTC+3 in summer time, +2 otherwise).
  int localMin() const { return p.startLocalMin + static_cast<int>(t / 60000); }
  int utcOffsetMin() const { return (p.month >= 4 && p.month <= 10) ? 180 : 120; }
  int utcMin() const { return localMin() - utcOffsetMin(); }

  // Thermal sources from the terrain: sun-facing slopes and high ground
  // trigger, flat water doesn't. Used when no KK7 pack is loaded.
  void deriveSpots() {
    spots.clear();
    spotsFromPack = false;
    if (!terrain.valid()) return;
    struct Cand { double x, y; float score; };
    static Cand c[2000];
    int n = 0;
    const float sunAz = 225 * pg::kDegToRad;  // early-afternoon sun, SW
    for (double cy = -16000; cy <= 16000 && n < 2000; cy += 800)
      for (double cx = -16000; cx <= 16000 && n < 2000; cx += 800) {
        const float h = elevAt(cx, cy);
        const float dzdx = (elevAt(cx + 100, cy) - elevAt(cx - 100, cy)) / 200;
        const float dzdy = (elevAt(cx, cy + 100) - elevAt(cx, cy - 100)) / 200;
        const float slope = std::sqrt(dzdx * dzdx + dzdy * dzdy);
        if (h < -200 && slope < 0.01f) continue;  // the Kinneret / flat water
        // Slope facing the sun: downhill direction is −gradient.
        const float face = -(dzdx * std::sin(sunAz) + dzdy * std::cos(sunAz));
        float around = 0;
        for (int k = 0; k < 8; ++k) {
          const float a = k * 0.785f;
          around += elevAt(cx + 1500 * std::sin(a), cy + 1500 * std::cos(a));
        }
        const float prominence = h - around / 8;
        const float score = 0.25f + 2.5f * (face > 0 ? face : 0) + (prominence > 0 ? prominence / 150 : 0);
        c[n++] = {cx, cy, score};
      }
    // keep the best kSpots
    for (int k = 0; k < kSpots && k < n; ++k) {
      int bi = k;
      for (int i = k + 1; i < n; ++i)
        if (c[i].score > c[bi].score) bi = i;
      const Cand tmp = c[k];
      c[k] = c[bi];
      c[bi] = tmp;
      pg::Hotspot hs;
      hs.lat = kOriginLat + c[k].y / kMPerDegLat;
      hs.lon = kOriginLon + c[k].x / (kMPerDegLat * std::cos(kOriginLat * pg::kDegToRad));
      const float pr = c[k].score / (c[0].score > 0 ? c[0].score : 1);
      for (int s = 0; s < 4; ++s)
        for (int sl = 0; sl < 3; ++sl) {
          const float season = s == 2 ? 1.0f : (s == 0 ? 0.45f : 0.8f);
          const float slot = sl == 0 ? 0.6f : (sl == 1 ? 1.0f : 0.85f);
          hs.prob[s][sl] = static_cast<uint8_t>(90 * pr * season * slot);
        }
      spots.add(hs);
    }
  }

  void reset(uint32_t seed) {
    rng_ = seed ? seed : 1;
    x = y = 0;
    ground = elevAt(0, 0);
    alt = ground + kLaunchAgl;
    hdg = 300;
    t = 0;
    landings = 0;
    apCircling = false;
    apTarget = apLeft = -1;
    for (auto& v : visitedUntil_) v = 0;
    climb = 0;
    started_ = false;
    caseT_ = 0;
    if (!spotsFromPack) deriveSpots();
    for (auto& h : th) spawn(h, true);
  }

  // Air temperature and dew point the case sees (`f` = 0 environment … 1
  // thermal core). Thermal air follows the dry adiabat and stays warmer than
  // its surroundings up to cloud base; the environment cools at envLapse and
  // warms above an inversion.
  void air(float z, float f, float& temp, float& td) const {
    const float h = z / 1000.0f;
    const float H = cloudBase() / 1000.0f;
    const float excess0 = (9.8f - p.envLapse) * (H > 0.3f ? H : 0.3f) + 0.3f;
    const float tp = p.surfaceT - 9.8f * h;
    float te = p.surfaceT - excess0 - p.envLapse * h;
    if (p.inversionAlt > 0 && z > p.inversionAlt) te += (p.envLapse + 3.0f) * (z - p.inversionAlt) / 1000.0f;
    const float tdp = p.surfaceTd - 1.8f * h;
    const float tde = tdp - 2.5f;
    temp = f * tp + (1 - f) * te;
    td = f * tdp + (1 - f) * tde;
    if (td > temp) td = temp;
  }

  float thermalLift(double px, double py, float z) const {
    if (z > cloudBase() - 20) return -0.5f;
    if (p.inversionAlt > 0 && z > p.inversionAlt + 30) return -0.4f;
    float w = -0.45f;
    for (const auto& h : th) {
      const double dx = px - h.x, dy = py - h.y;
      const float d2 = static_cast<float>(dx * dx + dy * dy);
      const float s = h.now();
      w += s * std::exp(-d2 / (h.radius * h.radius));
      const float ring = (std::sqrt(d2) - 1.8f * h.radius) / (0.6f * h.radius);
      w -= 0.35f * s * std::exp(-ring * ring);
    }
    float top = cloudBase() - z;
    if (p.inversionAlt > 0 && p.inversionAlt - z < top) top = p.inversionAlt - z;
    if (top < 300 && w > 0) w *= top / 300.0f;
    // Thermals need room to form: weak in the lowest 150 m above the ground.
    const float agl = z - elevAt(px, py);
    if (w > 0 && agl < 150) w *= agl > 0 ? 0.4f + 0.6f * agl / 150 : 0.4f;
    return w;
  }

  // Air forced up the slopes: wind · terrain gradient, fading with height.
  float ridgeLift(double px, double py, float z) const {
    float wN, wE;
    windVec(wN, wE);
    const float dzdx = (elevAt(px + 60, py) - elevAt(px - 60, py)) / 120;
    const float dzdy = (elevAt(px, py + 60) - elevAt(px, py - 60)) / 120;
    const float agl = z - elevAt(px, py);
    float w = (wE * dzdx + wN * dzdy) * std::exp(-(agl > 0 ? agl : 0) / 220.0f);
    if (w > 3.5f) w = 3.5f;
    if (w < -2.5f) w = -2.5f;
    return w;
  }

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
      if (h.age > h.life || dx * dx + dy * dy > 7000.0 * 7000.0) spawn(h, false);
    }

    if (p.autopilot) autopilot(fc);
    const bool turning = std::fabs(turnCmd) > 1.0f;
    airspeed = turning ? 9.6f : 10.5f + speedBar * 3.8f;
    hdg = std::fmod(hdg + turnCmd * dt + 360.0f, 360.0f);

    const float h = hdg * pg::kDegToRad;
    const float vN = airspeed * std::cos(h) + wN, vE = airspeed * std::sin(h) + wE;
    x += vE * dt;
    y += vN * dt;
    turb_ += (gauss() * 0.35f - turb_) * 0.02f;
    if (t % 100 == 0) {  // terrain-dependent terms at 10 Hz
      ground = elevAt(x, y);
      ridge_ = ridgeLift(x, y, alt);
    }
    lift = thermalLift(x, y, alt) + ridge_ + turb_;
    const float sink = fc.config().polar.sink(airspeed) + (turning ? 0.25f + std::fabs(turnCmd) * 0.004f : 0.0f);
    const float prevClimb = started_ ? climb : lift - sink;
    started_ = true;
    climb = lift - sink;
    alt += climb * dt;
    if (alt < ground + 3) {  // landed: relaunch from the Gilboa
      ++landings;
      x = y = 0;
      ground = elevAt(0, 0);
      alt = ground + kLaunchAgl;
      hdg = 300;
      apCircling = false;
      apTarget = -1;
      relaunched = true;  // sim_api starts a new flight on the instrument
      started_ = false;   // no acceleration spike from the teleport
      climb = prevClimb;
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
        pg::ImuSample m;
        m.t = t;
        const float bank = std::atan(airspeed * turnCmd * pg::kDegToRad / pg::kGravity);
        m.az = pg::kGravity / std::cos(bank) + accSum_ + gauss() * 0.15f;
        m.ax = gauss() * 0.15f;
        m.ay = gauss() * 0.15f;
        // A real gyro has a bias: 0.4 °/s here, which the heading filter must learn.
        m.gz = (-turnCmd - 0.4f) * pg::kDegToRad + gauss() * 0.005f;
        m.valid = true;
        fc.onImu(m);
        accSum_ = 0;
      }
    }
    if (t % 200 == 0) gnss(fc, vN, vE);
    if (t % 1000 == 0) {
      float f = (lift + 0.45f) / 2.5f;
      f = f < 0 ? 0 : (f > 1 ? 1 : f);
      float temp, td;
      air(alt, f, temp, td);
      const float target = temp + p.caseOffset;
      caseT_ = caseT_ == 0 ? target : caseT_ + (target - caseT_) * 0.05f;
      fc.onAir(t, caseT_, pg::relativeHumidity(caseT_, td));
    }
    if (t % 60000 == 10) fc.setClock(p.year, p.month, p.day, utcMin());
  }

 private:
  void gnss(pg::FlightComputer& fc, float vN, float vE) {
    pg::GnssFix g;
    g.t = t;
    switch (p.gps) {
      case GpsMode::Jammed:
        fc.onGnss(g);  // the receiver reports "no fix"
        return;
      case GpsMode::Spoofed: {
        // A confident fix at Beirut airport, sea level, barely moving.
        g.lat = kBeirutLat + gauss() * 2e-6;
        g.lon = kBeirutLon + gauss() * 2e-6;
        g.altMsl = 25;
        g.velN = gauss() * 0.1f;
        g.velE = gauss() * 0.1f;
        g.groundSpeed = std::hypot(g.velN, g.velE);
        g.trackDeg = 0;
        g.fix = pg::FixType::Fix3D;
        g.sats = 9;
        g.hAcc = 3;
        fc.onGnss(g);
        return;
      }
      case GpsMode::Noisy:
        if (uniform() < 0.5f) {  // half the epochs: no fix; the rest: wildly wrong
          fc.onGnss(g);
          return;
        }
        break;
      case GpsMode::Normal: break;
    }
    g.lat = lat();
    g.lon = lon();
    if (p.gps == GpsMode::Noisy) {
      g.lat += gauss() * 0.004;
      g.lon += gauss() * 0.004;
    }
    g.velN = vN + gauss() * 0.1f;
    g.velE = vE + gauss() * 0.1f;
    g.groundSpeed = std::hypot(g.velN, g.velE);
    g.trackDeg = std::fmod(std::atan2(g.velE, g.velN) * pg::kRadToDeg + 360.0f, 360.0f);
    g.altMsl = alt + 4;
    g.fix = pg::FixType::Fix3D;
    g.sats = p.gps == GpsMode::Noisy ? 4 : 11;
    g.hAcc = p.gps == GpsMode::Noisy ? 60.0f : 2.5f;
    fc.onGnss(g);
  }

  void spawn(Thermal& h, bool initial) {
    visitedUntil_[&h - th] = 0;
    // Pick a source: weighted by its chance now (KK7 pack or terrain).
    int pick = -1;
    const int um = utcMin();
    for (int tries = 0; tries < 40 && spots.count() > 0; ++tries) {
      const int i = static_cast<int>(uniform() * spots.count()) % spots.count();
      double sx, sy;
      toXY(spots.at(i).lat, spots.at(i).lon, sx, sy);
      const double dx = sx - x, dy = sy - y;
      const double d = std::sqrt(dx * dx + dy * dy);
      if (d > 4500 || (!initial && d < 600)) continue;
      if (uniform() < spots.chance(i, p.year, p.month, p.day, um)) {
        pick = i;
        break;
      }
    }
    if (pick >= 0) {
      toXY(spots.at(pick).lat, spots.at(pick).lon, h.x, h.y);
    } else {  // nothing suitable: a random spot in the area
      const float ang = uniform() * 6.2832f;
      const float dist = initial ? 300 + uniform() * 2500 : 900 + uniform() * 2200;
      h.x = x + dist * std::sin(ang);
      h.y = y + dist * std::cos(ang);
    }
    // Weaker in the morning and late afternoon.
    const float hrs = (localMin() - 6 * 60) / 60.0f;
    const float tod = hrs < 2 ? 0.2f : (hrs < 5 ? 0.2f + 0.8f * (hrs - 2) / 3 : (hrs > 10 ? 0.5f : 1.0f));
    h.strength = p.strength * tod * (0.55f + uniform() * 0.9f);
    h.radius = 60 + uniform() * 60;
    h.life = 600 + uniform() * 900;
    h.age = initial ? uniform() * h.life * 0.6f : 0;
  }

  void autopilot(pg::FlightComputer& fc) {
    const pg::Status& s = fc.status();
    const pg::Advice adv = s.advisor.advice;
    if (!apCircling) {
      if (apTarget >= 0) {
        const double dx = th[apTarget].x - x, dy = th[apTarget].y - y;
        if (dx * dx + dy * dy < 35.0 * 35.0) {  // flown through the core without a STAY
          visitedUntil_[apTarget] = t + 240000;
          apTarget = -1;
        }
      }
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
      float base = 17.0f;
      if (apTarget >= 0) {
        const float diff = pg::angleDiffDeg(hdg, bearingTo(th[apTarget]));
        base = 17.0f - 7.0f * std::cos(diff * pg::kDegToRad);
      }
      turnCmd = base;
      speedBar = 0;
      return;
    }
    // Low over the ground with nothing below: soar the ridge if it works,
    // otherwise head for the best thermal anyway.
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
      // Like a pilot: only clouds you can reach (glide ~7:1 with margin).
      if (d > (alt - ground - 60) * 7.0f) continue;
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
  float turb_ = 0, accSum_ = 0, ridge_ = 0;
  float caseT_ = 0;
  bool started_ = false;
  uint32_t visitedUntil_[kThermals] = {};
};

}  // namespace world
