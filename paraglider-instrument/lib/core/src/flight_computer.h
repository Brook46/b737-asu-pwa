// FlightComputer wires the logic layer together. Firmware and desktop tools
// both drive it the same way: push samples in as they arrive, call tick() at
// ~50 Hz, apply the returned tone/LED. Nothing in here touches hardware.
#pragma once
#include "advisor.h"
#include "ahrs.h"
#include "audio.h"
#include "averager.h"
#include "circling.h"
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
  int volume = 2;
  bool muted = false;
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
  // Handles commands that are pure logic (MC, volume, mute, status). Returns
  // false for commands the firmware must act on (FANET sends, marks).
  bool onCommand(Command c, TimeMs t);
  void notify(Alert a, TimeMs t);
  void setVolume(int v) { st_.volume = v < 0 ? 0 : (v > 3 ? 3 : v); }
  // Changing QNH shifts every altitude; restart the filter so the step doesn't
  // read as a vario spike (and a false STAY/GLIDE).
  void setQnh(float qnhPa);

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
