#include "flight_computer.h"

#include <cmath>

#include "sensors.h"

namespace pg {

namespace {
constexpr TimeMs kAdvisorPeriodMs = 200;
constexpr TimeMs kImuStaleMs = 1000;
constexpr TimeMs kGnssStaleMs = 3000;
constexpr TimeMs kOnboardPreferMs = 2000;
constexpr float kMcStep = 0.25f;
constexpr TimeMs kSettleMs = 10000;  // filter start-up transients must not cue STAY/GLIDE
}  // namespace

FlightComputer::FlightComputer(const FlightComputerConfig& cfg)
    : cfg_(cfg), kf_(cfg.vario), circ_(cfg.circling), advisor_(cfg.advisor), audio_(cfg.tone) {
  if (cfg_.audioAvgMs) audioAvg_.setWindow(cfg_.audioAvgMs);
}

void FlightComputer::reset() {
  kf_ = KalmanVario(cfg_.vario);
  ahrs_.reset();
  circ_.reset();
  wind_.reset();
  advisor_.reset();
  avg20_.clear();
  audioAvg_.clear();
  st_ = Status{};
  haveImu_ = false;
  origin_ = BaroOrigin::None;
}

void FlightComputer::setQnh(float qnhPa) {
  if (qnhPa < 85000 || qnhPa > 110000) return;
  cfg_.qnhPa = qnhPa;
  origin_ = BaroOrigin::None;  // next sample re-initialises the filter
}

void FlightComputer::onAltitude(TimeMs t, float alt, BaroOrigin origin) {
  if (origin == BaroOrigin::Onboard) lastOnboardBaro_ = t;
  // The onboard BMP390 wins while it's alive; the XCTracer stream is the backup.
  if (origin == BaroOrigin::XcTracer && lastOnboardBaro_ && t - lastOnboardBaro_ < kOnboardPreferMs)
    return;
  if (origin != origin_) {
    origin_ = origin;
    kf_.reset(alt);  // different sensor, different offset: restart cleanly
    lastPredict_ = t;
    filterStart_ = t;
    return;
  }
  if (kf_.initialized()) {
    // With the IMU running, prediction already happened at IMU rate.
    if (lastPredict_ && t > lastPredict_) kf_.predict((t - lastPredict_) / 1000.0f, accelUp_);
    lastPredict_ = t;
  }
  kf_.updateAltitude(alt);
  if (!lastPredict_) lastPredict_ = t;

  st_.t = t;
  st_.altitude = kf_.altitude();
  st_.vario = kf_.vario();
  st_.baro = origin_;
  audioAvg_.add(t, st_.vario);
}

void FlightComputer::onBaro(const BaroSample& s, BaroOrigin origin) {
  if (!s.valid) return;
  onAltitude(s.t, pressureToAltitude(s.pressurePa, cfg_.qnhPa), origin);
}

void FlightComputer::onImu(const ImuSample& s) {
  if (!s.valid || !cfg_.useImu) return;
  const float dt = lastImu_ && s.t > lastImu_ ? (s.t - lastImu_) / 1000.0f : 0.0f;
  lastImu_ = s.t;
  ahrs_.update(s.ax, s.ay, s.az, s.gx, s.gy, s.gz, dt);
  if (!ahrs_.initialized()) return;
  if (!haveImu_) {
    haveImu_ = true;
    kf_.configure(cfg_.varioWithImu);
  }
  accelUp_ = ahrs_.verticalAccel(s.ax, s.ay, s.az);
  if (kf_.initialized() && lastPredict_ && s.t > lastPredict_) {
    kf_.predict((s.t - lastPredict_) / 1000.0f, accelUp_);
    lastPredict_ = s.t;
  }
  // Earth-frame yaw rate: gyro projected on "up". Right-hand rule about up is
  // counter-clockwise from above, so negate for "+ = right turn".
  float ux, uy, uz;
  ahrs_.upVector(ux, uy, uz);
  gyroTurnSum_ += -(s.gx * ux + s.gy * uy + s.gz * uz) * kRadToDeg;
  ++gyroTurnN_;
  st_.imu = true;
}

void FlightComputer::onGnss(const GnssFix& f) {
  st_.gnss = f;
  if (!f.valid()) return;
  lastGnss_ = f.t;
  GnssFix g = f;
  if (g.velN == 0 && g.velE == 0 && g.groundSpeed > 0) {
    g.velN = g.groundSpeed * std::cos(g.trackDeg * kDegToRad);
    g.velE = g.groundSpeed * std::sin(g.trackDeg * kDegToRad);
  }
  // Below walking pace the track is noise.
  if (g.groundSpeed > 2.0f && !(haveImu_ && cfg_.useImu)) {
    if (circ_.updateTrack(g.t, g.trackDeg) && !circ_.circling()) wind_.endCircling();
  }
  if (circ_.circling() && g.groundSpeed > 1.0f) wind_.addSample(g.t, g.velN, g.velE, g.trackDeg);
  st_.wind = wind_.estimate();

  // Airspeed ≈ |ground velocity − wind|, clamped to the wing's speed range.
  float as = cfg_.polar.bestGlideSpeed();
  if (st_.wind.valid) {
    as = std::hypot(g.velN - st_.wind.toN, g.velE - st_.wind.toE);
    if (as < cfg_.polar.vMin()) as = cfg_.polar.vMin();
    if (as > cfg_.polar.vMax()) as = cfg_.polar.vMax();
  }
  st_.airspeed = as;
}

void FlightComputer::notify(Alert a, TimeMs t) {
  audio_.play(a, t);
  pending_ = a;
  led_.flash(t, a == Alert::Message ? 3 : 1);
}

bool FlightComputer::onCommand(Command c, TimeMs t) {
  switch (c) {
    case Command::McUp: {
      // Touching MC takes it off auto, starting from whatever auto had chosen.
      const float cur = advisor_.mc();
      auto a = advisor_.config();
      a.autoMc = false;
      advisor_.configure(a);
      advisor_.setMc(cur + kMcStep);
      notify(Alert::McUp, t);
      return true;
    }
    case Command::McDown: {
      // Touching MC takes it off auto, starting from whatever auto had chosen.
      const float cur = advisor_.mc();
      auto a = advisor_.config();
      a.autoMc = false;
      advisor_.configure(a);
      advisor_.setMc(cur - kMcStep);
      notify(Alert::McDown, t);
      return true;
    }
    case Command::VolumeUp:
      if (st_.volume < 3) ++st_.volume;
      notify(Alert::RemoteAck, t);
      return true;
    case Command::VolumeDown:
      if (st_.volume > 0) --st_.volume;
      notify(Alert::RemoteAck, t);
      return true;
    case Command::MuteToggle:
      audio_.setMuted(!audio_.muted());
      st_.muted = audio_.muted();
      notify(Alert::RemoteAck, t);
      return true;
    case Command::Status:
      notify(Alert::RemoteAck, t);
      return true;
    default:
      return false;
  }
}

void FlightComputer::runAdvisor(TimeMs t) {
  // Netto = what the air is doing = our climb + our own sink at this airspeed.
  st_.netto = st_.vario + cfg_.polar.sink(st_.airspeed);
  AdvisorInput in;
  in.t = t;
  in.circling = circ_.circling();
  in.leaving = circ_.mode() == FlightMode::MaybeCruise;
  in.altitude = st_.altitude;
  in.vario = st_.vario;
  in.netto = st_.netto;
  st_.advisor = advisor_.update(in);
  if (st_.advisor.changed) {
    notify(st_.advisor.advice == Advice::Stay ? Alert::Stay : Alert::Glide, t);
  }

  float headwind = 0;
  if (st_.wind.valid && st_.gnss.valid() && st_.gnss.groundSpeed > 2.0f) {
    const float tr = st_.gnss.trackDeg * kDegToRad;
    headwind = -(st_.wind.toN * std::cos(tr) + st_.wind.toE * std::sin(tr));
  }
  st_.stf = cfg_.polar.speedToFly(st_.advisor.mc, 0, headwind) * 3.6f;
}

Outputs FlightComputer::tick(TimeMs t) {
  Outputs out;
  if (haveImu_ && t - lastImu_ > kImuStaleMs) {
    haveImu_ = false;
    st_.imu = false;
    accelUp_ = 0;
    kf_.configure(cfg_.vario);
  }
  const bool gnssOk = lastGnss_ && t - lastGnss_ < kGnssStaleMs;
  // Gyro turn rate drives circling detection when the IMU is alive (it's
  // smoother and has no GPS lag); averaged down to the advisor rate.
  if (haveImu_ && t - lastGyroFeed_ >= kAdvisorPeriodMs && gyroTurnN_ > 0) {
    const bool flipped = circ_.update(t, gyroTurnSum_ / gyroTurnN_);
    if (flipped && !circ_.circling()) wind_.endCircling();
    gyroTurnSum_ = 0;
    gyroTurnN_ = 0;
    lastGyroFeed_ = t;
  }
  st_.circling = circ_.circling();
  st_.mode = circ_.mode();
  st_.turnRate = circ_.turnRate();

  if (kf_.initialized() && t - filterStart_ >= kSettleMs && t - lastAdvisor_ >= kAdvisorPeriodMs) {
    lastAdvisor_ = t;
    // 5 Hz into a 128-slot buffer covers the full 20 s (25 Hz would not).
    avg20_.add(t, st_.vario);
    st_.avg = avg20_.mean();
    runAdvisor(t);
  }

  audio_.setVario(cfg_.audioAvgMs ? audioAvg_.mean() : st_.vario);
  out.toneHz = audio_.tick(t).freq;

  if (audio_.alertActive()) led_.setMode(LedMode::Alert);
  else if (!kf_.initialized() || !gnssOk) led_.setMode(LedMode::Searching);
  else if (st_.vario > cfg_.tone.liftThreshold) led_.setMode(LedMode::Climbing);
  else led_.setMode(LedMode::Ready);
  out.led = led_.tick(t);
  out.alertStarted = pending_;
  pending_ = Alert::None;
  return out;
}

}  // namespace pg
