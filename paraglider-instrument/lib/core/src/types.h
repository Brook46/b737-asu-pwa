// Plain data types shared by the logic layer, the drivers and the desktop tools.
// No Arduino headers here: everything in lib/core must build with a desktop g++.
#pragma once
#include <cstdint>

namespace pg {

// Milliseconds since boot (firmware) or since start of replay (desktop).
using TimeMs = uint32_t;

struct BaroSample {
  TimeMs t = 0;
  float pressurePa = 0;   // static pressure
  float tempC = 0;
  bool valid = false;
};

enum class FixType : uint8_t { None = 0, Fix2D = 2, Fix3D = 3 };

struct GnssFix {
  TimeMs t = 0;
  double lat = 0, lon = 0;  // degrees, WGS84
  float altMsl = 0;         // m
  float groundSpeed = 0;    // m/s
  float trackDeg = 0;       // course over ground, 0..360, true north
  float velN = 0, velE = 0; // m/s ground velocity (derived from speed+track if the receiver has no NED)
  float hAcc = 99;          // horizontal accuracy estimate, m
  uint8_t sats = 0;
  FixType fix = FixType::None;
  bool valid() const { return fix != FixType::None; }
};

struct ImuSample {
  TimeMs t = 0;
  float ax = 0, ay = 0, az = 0;  // m/s^2, sensor frame
  float gx = 0, gy = 0, gz = 0;  // rad/s, sensor frame
  float tempC = 0;
  bool valid = false;
};

// What the vario filter publishes each update.
struct VarioState {
  TimeMs t = 0;
  float altitude = 0;   // m, pressure altitude (QNH-adjusted if set)
  float vario = 0;      // m/s, filtered instantaneous climb
  bool valid = false;
};

constexpr float kGravity = 9.80665f;
constexpr float kPi = 3.14159265358979f;
constexpr float kDegToRad = kPi / 180.0f;
constexpr float kRadToDeg = 180.0f / kPi;

}  // namespace pg
