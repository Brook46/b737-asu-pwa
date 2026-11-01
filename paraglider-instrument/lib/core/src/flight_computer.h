// FlightComputer wires the logic layer together. Firmware and desktop tools
// both drive it the same way: push samples in as they arrive, call tick() at
// ~50 Hz, apply the returned tone/LED. Nothing in here touches hardware.
#pragma once
#include "advisor.h"
#include "ahrs.h"
#include "atmosphere.h"
#include "audio.h"
#include "averager.h"
#include "circling.h"
#include "gnss_guard.h"
#include "heading.h"
#include "hotspots.h"
#include "terrain.h"
#include "thermal_assist.h"
#include "kalman_vario.h"
#include "polar.h"
#include "remote.h"
#include "types.h"
#include "wind.h"

namespace pg {

struct FlightComputerConfig {
  KalmanVarioConfig vario;
  KalmanVarioConfig varioWithImu{0.25f, 0.2f, 0.02f, true};
  CirclingConfig circling;
  AtmosphereConfig air;
  AdvisorConfig advisor;
  VarioToneConfig tone;
  Polar polar = defaultParagliderPolar();
  float qnhPa = 101325.0f;
  TimeMs audioAvgMs = 0;  // >0: beep the N-ms average instead of the instant vario
  bool useImu = true;     // IMU-assisted vario + gyro turn rate when an IMU is present
};

enum class BaroOrigin : uint8_t { None, Onboard, XcTracer };

struct Status {
  TimeMs t = 0;
  float altitude = 0;
  float vario = 0;
  float avg = 0;           // integrated climb, last 20 s
  float netto = 0;
  bool circling = false;
  FlightMode mode = FlightMode::Cruise;
  float turnRate = 0;
  WindEstimate wind;
  AdvisorOutput advisor;
  float stf = 0;           // MacCready speed to fly, km/h
  float airspeed = 0;      // m/s, estimated (GPS − wind) or trim
  GnssFix gnss;
  bool imu = false;
  BaroOrigin baro = BaroOrigin::None;
  AtmosphereState air;
  int volume = 2;
  bool muted = false;
  // Position and navigation (all survive GPS jamming, with growing error).
  GpsState gps = GpsState::NoData;
  GpsReason gpsReason = GpsReason::None;
  TimeMs gpsSince = 0;
  GuardedPosition pos;       // GPS when trusted, dead-reckoned otherwise
  float heading = 0;         // deg true, gyro (GPS-corrected while trusted)
  bool headingValid = false;
  // Frame the thermal assistant works in: the gyro alone, so it works with no
  // GPS at all (then its zero is arbitrary and north is unknown).
  float assistHeading = 0;
  bool assistHeadingValid = false;
  float altMsl = 0;          // vario altitude aligned to GPS altitude while GPS is trusted
  float agl = 0;             // above terrain, if a terrain grid is loaded
  bool aglValid = false;
  Target home;               // first trusted fix of the flight
  Target best;               // best hotspot to glide to (needs a hotspot pack + date)
  AssistView assist;
  bool clockValid = false;
  int year = 0, month = 0, day = 0, utcMin = 0;
};

struct Outputs {
  uint16_t toneHz = 0;
  bool led = false;
  Alert alertStarted = Alert::None;  // for logging
};

class FlightComputer {
 public:
  explicit FlightComputer(const FlightComputerConfig& cfg = {});
  void reset();

  void onBaro(const BaroSample& s, BaroOrigin origin = BaroOrigin::Onboard);
  // Direct altitude (e.g. XCTracer LK8EX1 without pressure). Same filter path.
  void onAltitude(TimeMs t, float altitude, BaroOrigin origin);
  void onImu(const ImuSample& s);
  void onGnss(const GnssFix& f);
  // Temperature and humidity from the case sensor (BME280), ~1 Hz.
  void onAir(TimeMs t, float caseTempC, float rhPct);
  // Handles commands that are pure logic (MC, volume, mute, status). Returns
  // false for commands the firmware must act on (FANET sends, marks).
  bool onCommand(Command c, TimeMs t);
  void notify(Alert a, TimeMs t);
  void setVolume(int v) { st_.volume = v < 0 ? 0 : (v > 3 ? 3 : v); }
  // Changing QNH shifts every altitude; restart the filter so the step doesn't
  // read as a vario spike (and a false STAY/GLIDE).
  void setQnh(float qnhPa);
  // Optional data: terrain grid (AGL, arrival heights) and a hotspot pack
  // (thermal chances). Both must outlive the FlightComputer.
  void setTerrain(const Terrain* t) { terrain_ = t; }
  void setHotspots(const HotspotMap* h) { hotspots_ = h; }
  // UTC date and time (from GPS while it's trusted, or the RTC).
  void setClock(int year, int month, int day, int utcMin);
  Atmosphere& atmosphere() { return atmo_; }

  Outputs tick(TimeMs t);
  const Status& status() const { return st_; }
  Advisor& advisor() { return advisor_; }
  AudioEngine& audio() { return audio_; }
  FlightComputerConfig& config() { return cfg_; }

 private:
  void runAdvisor(TimeMs t);
  FlightComputerConfig cfg_;
  KalmanVario kf_;
  MahonyAhrs ahrs_;
  CirclingDetector circ_;
  WindEstimator wind_;
  Atmosphere atmo_;
  HeadingEstimator heading_;
  int clockBaseMin_ = 0;
  TimeMs clockAt_ = 0;
  bool clockFresh_ = false;
  float relHdg_ = 0;  // gyro-integrated, snapped to heading_ when trusted and not circling
  GnssGuard guard_;
  ThermalAssist assist_;
  const Terrain* terrain_ = nullptr;
  const HotspotMap* hotspots_ = nullptr;
  float gyroSinceFix_ = 0;
  float mslOffset_ = 0;
  bool haveMslOffset_ = false;
  GpsState prevGps_ = GpsState::NoData;
  TimeMs lastNav_ = 0;
  void updateNav(TimeMs t);
  Advisor advisor_;
  AudioEngine audio_;
  LedEngine led_;
  WindowAverage<128> avg20_{20000};
  WindowAverage<128> audioAvg_{1000};
  Status st_;
  TimeMs lastPredict_ = 0;
  TimeMs filterStart_ = 0;
  TimeMs lastImu_ = 0;
  TimeMs lastGnss_ = 0;
  TimeMs lastAdvisor_ = 0;
  TimeMs lastGyroFeed_ = 0;
  float accelUp_ = 0;
  float gyroTurnSum_ = 0;
  int gyroTurnN_ = 0;
  bool haveImu_ = false;
  BaroOrigin origin_ = BaroOrigin::None;
  TimeMs lastOnboardBaro_ = 0;
  Alert pending_ = Alert::None;
};

}  // namespace pg
