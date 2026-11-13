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
constexpr TimeMs kSettleMs = 10000;
constexpr float kMaxJumpM = 100.0f;  // filter start-up transients must not cue STAY/GLIDE
}  // namespace

FlightComputer::FlightComputer(const FlightComputerConfig& cfg)
    : cfg_(cfg),
      kf_(cfg.vario),
      circ_(cfg.circling),
      atmo_(cfg.air),
      model_(cfg.polar),
      xc_(cfg.xc),
      advisor_(cfg.advisor),
      audio_(cfg.tone) {
  if (cfg_.audioAvgMs) audioAvg_.setWindow(cfg_.audioAvgMs);
}

void FlightComputer::reset() {
  kf_ = KalmanVario(cfg_.vario);
  heading_.reset();
  relHdg_ = 0;
  guard_.reset();
  assist_.reset();
  model_.reset();
  xc_.reset();
  traffic_.reset();
  profile_.reset();
  sun_.reset();
  airX_ = airY_ = 0;
  lastAirStep_ = lastCirclingT_ = circStart_ = 0;
  nettoAvg_ = accMean_ = accVar_ = 0;
  thermalTop_ = curTop_ = 0;
  betterNearby_ = finalCued_ = false;
  lastWindFed_ = 0;
  remoteAirT_ = 0;
  candAdv_ = cuedAdv_ = TurnAdvice::None;
  candSince_ = lastTurnCue_ = lastMoveCue_ = moveEnd_ = 0;
  cuedBar_ = candBar_ = 0;
  barSince_ = lastBarCue_ = leftThermal_ = 0;
  gyroSinceFix_ = 0;
  haveMslOffset_ = false;
  prevGps_ = GpsState::NoData;
  lastNav_ = 0;
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

void FlightComputer::setClock(int year, int month, int day, int utcMin) {
  st_.clockValid = year > 2000 && month >= 1 && month <= 12;
  st_.year = year;
  st_.month = month;
  st_.day = day;
  st_.utcMin = utcMin;
  clockBaseMin_ = utcMin;
  clockFresh_ = true;  // anchored to the tick clock on the next updateNav
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
  // A different sensor (different offset), or a reading far from where the
  // filter expects to be (sensor glitch, bad I2C read): restart cleanly rather
  // than turn the jump into a huge vario and a false cue. 100 m is far beyond
  // anything a paraglider climbs or sinks between two samples.
  const bool jump = kf_.initialized() && origin == origin_ && std::fabs(alt - kf_.altitude()) > kMaxJumpM;
  if (origin != origin_ || jump) {
    origin_ = origin;
    kf_.reset(alt);
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
  // Shocks (a knock on the harness, touchdown, a collapse) can read 5–10 g for
  // one sample; flying never sustains more than ~2 g. Unclamped, one such
  // sample rings the vario for seconds.
  constexpr float kMaxAcc = 2.0f * kGravity;
  if (accelUp_ > kMaxAcc) accelUp_ = kMaxAcc;
  if (accelUp_ < -kMaxAcc) accelUp_ = -kMaxAcc;
  // Turbulence: RMS of vertical acceleration about its ~2 s mean.
  accMean_ += 0.005f * (accelUp_ - accMean_);
  accVar_ += 0.01f * ((accelUp_ - accMean_) * (accelUp_ - accMean_) - accVar_);
  st_.turbulence = std::sqrt(accVar_);
  if (kf_.initialized() && lastPredict_ && s.t > lastPredict_) {
    kf_.predict((s.t - lastPredict_) / 1000.0f, accelUp_);
    lastPredict_ = s.t;
  }
  // Earth-frame yaw rate: gyro projected on "up". Right-hand rule about up is
  // counter-clockwise from above, so negate for "+ = right turn".
  float ux, uy, uz;
  ahrs_.upVector(ux, uy, uz);
  const float yaw = -(s.gx * ux + s.gy * uy + s.gz * uz) * kRadToDeg;
  gyroTurnSum_ += yaw;
  ++gyroTurnN_;
  heading_.onYawRate(dt, yaw);
  relHdg_ = std::fmod(relHdg_ + heading_.rate() * dt + 360.0f, 360.0f);
  gyroSinceFix_ += heading_.rate() * dt;
  st_.imu = true;
}

void FlightComputer::onGnss(const GnssFix& f) {
  st_.gnss = f;
  GnssFix g = f;
  if (g.velN == 0 && g.velE == 0 && g.groundSpeed > 0) {
    g.velN = g.groundSpeed * std::cos(g.trackDeg * kDegToRad);
    g.velE = g.groundSpeed * std::sin(g.trackDeg * kDegToRad);
  }
  // The guard decides whether this fix is believable (jamming, spoofing).
  const float baroAlt = kf_.initialized() ? st_.altitude : NAN;
  const float gyro = haveImu_ ? gyroSinceFix_ : NAN;
  gyroSinceFix_ = 0;
  if (!guard_.check(g, baroAlt, gyro)) return;
  lastGnss_ = f.t;
  st_.trustedFix = g;

  // GPS is trusted: align the vario altitude to it, and correct the heading.
  if (kf_.initialized()) {
    const float off = g.altMsl - st_.altitude;
    mslOffset_ = haveMslOffset_ ? mslOffset_ + 0.01f * (off - mslOffset_) : off;
    haveMslOffset_ = true;
  }
  if (g.groundSpeed > 3.0f) {
    float ref = g.trackDeg, weight = 0.3f;  // track ≈ heading only roughly, without wind
    if (st_.wind.valid) {
      ref = std::fmod(std::atan2(g.velE - st_.wind.toE, g.velN - st_.wind.toN) * kRadToDeg + 360.0f, 360.0f);
      weight = 1.0f;
    }
    if (haveImu_) heading_.correct(ref, weight);
    else heading_.setDirect(ref);
  }
  if (!st_.home.valid) {
    st_.home.valid = true;
    st_.home.isHome = true;
    st_.home.lat = g.lat;
    st_.home.lon = g.lon;
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

void FlightComputer::onTraffic(TimeMs t, uint32_t id, const fanet::Tracking& tr) {
  // Someone else's GPS can be spoofed too: ignore reports far from us.
  if (st_.pos.valid && !st_.pos.deadReckoned) {
    float n, e;
    offsetMeters(st_.pos.lat, st_.pos.lon, tr.lat, tr.lon, n, e);
    if (n * n + e * e > 60000.0f * 60000.0f) return;
  }
  traffic_.onTracking(t, id, tr);
  // A pilot in our thermal: their climb is a sample of the lift where they
  // are. Needs our trusted position and north to place them in our air frame.
  if (st_.circling && st_.gps == GpsState::Ok && st_.headingValid && st_.pos.valid) {
    float n, e;
    offsetMeters(st_.pos.lat, st_.pos.lon, tr.lat, tr.lon, n, e);
    if (n * n + e * e < 400.0f * 400.0f && std::fabs(tr.altitude - st_.altMsl) < 300) {
      const float d = (st_.assistHeading - st_.heading) * kDegToRad;  // true → assist frame
      const float x = airX_ + e * std::cos(d) + n * std::sin(d);
      const float y = airY_ - e * std::sin(d) + n * std::cos(d);
      model_.addOther(t, x, y, tr.climb);
    }
  }
}

void FlightComputer::onRemoteAir(TimeMs t, float tempC, float rhPct) {
  if (!kf_.initialized()) return;
  remoteAirT_ = t;
  const AtmosphereEvent ev = atmo_.update(t, st_.altitude, tempC, rhPct, circ_.circling(), st_.vario, true);
  st_.air = atmo_.state();
  if (t - filterStart_ < kSettleMs) return;
  if (ev == AtmosphereEvent::NearBase) notify(Alert::NearBase, t);
  else if (ev == AtmosphereEvent::Inversion) notify(Alert::Inversion, t);
}

void FlightComputer::onAir(TimeMs t, float caseTempC, float rhPct) {
  if (!kf_.initialized()) return;  // cloud base is relative to the vario altitude
  if (remoteAirFresh(t)) return;   // the remote's outside air is better
  const AtmosphereEvent ev =
      atmo_.update(t, st_.altitude, caseTempC, rhPct, circ_.circling(), st_.vario);
  st_.air = atmo_.state();
  if (t - filterStart_ < kSettleMs) return;
  if (ev == AtmosphereEvent::NearBase) notify(Alert::NearBase, t);
  else if (ev == AtmosphereEvent::Inversion) notify(Alert::Inversion, t);
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
    case Command::AtCloudBase:
      if (!st_.air.haveAir) {
        notify(Alert::Error, t);
        return true;
      }
      if (remoteAirFresh(t)) {  // outside sensor: nothing to calibrate
        notify(Alert::RemoteAck, t);
        return true;
      }
      atmo_.calibrateAtBase();
      st_.air = atmo_.state();
      notify(Alert::RemoteAck, t);
      return true;
    default:
      return false;
  }
}

void FlightComputer::runAdvisor(TimeMs t) {
  // Netto = what the air is doing = our climb + our own sink at this airspeed.
  // No GPS yet (or jammed from the start): airspeed unknown → assume trim, not 0.
  if (st_.airspeed <= 0) st_.airspeed = cfg_.polar.bestGlideSpeed();
  st_.netto = st_.vario + cfg_.polar.sink(st_.airspeed);
  const bool circling = circ_.circling();
  if (!circling) nettoAvg_ += 0.067f * (st_.netto - nettoAvg_);  // ~3 s: don't chase gusts

  // Course: the next turnpoint when racing a task, else where you're heading.
  float headwind = 0;
  const bool onTask = st_.task.active && !st_.task.finished && st_.gps == GpsState::Ok;
  if (st_.wind.valid && (st_.headingValid || onTask)) {
    const float tr = (onTask ? st_.task.nextBearing : st_.heading) * kDegToRad;
    headwind = -(st_.wind.toN * std::cos(tr) + st_.wind.toE * std::sin(tr));
  }
  XcInput xi;
  xi.t = t;
  xi.circling = circling;
  xi.altMsl = st_.altMsl;
  xi.agl = st_.agl;
  xi.aglValid = st_.aglValid;
  xi.ceilingMsl = st_.ceilingMsl;
  xi.ceilingValid = st_.ceilingValid;
  xi.ceilingIsBase = st_.ceilingIsBase;
  xi.mcBase = advisor_.mc();
  xi.netto = nettoAvg_;
  xi.headwind = headwind;
  if (st_.clockValid && st_.pos.valid) {
    const int sr = sunriseUtcMin(st_.year, st_.month, st_.day, st_.pos.lat, st_.pos.lon);
    const int ss = sunsetUtcMin(st_.year, st_.month, st_.day, st_.pos.lat, st_.pos.lon);
    (void)sr;
    xi.hoursToSunset = (ss - st_.utcMin) / 60.0f;
  }
  bool hasStart = false;
  if (task_)
    for (int i = 0; i < task_->count(); ++i)
      if (task_->at(i).type == TpType::Start) hasStart = true;
  xi.race = onTask && st_.task.started && hasStart;
  xi.finalGlide = onTask && st_.task.finalValid && st_.task.finalSurplus >= 0;
  xi.circleClimb = st_.advisor.circleClimb;
  xi.thermalWarm = circling && circStart_ && t - circStart_ >= 40000;
  xi.betterNearby = betterNearby_;
  xi.turbulence = st_.turbulence;
  st_.xc = xc_.update(xi, cfg_.polar);

  AdvisorInput in;
  in.t = t;
  in.circling = circling;
  in.leaving = circ_.mode() == FlightMode::MaybeCruise;
  in.altitude = st_.altitude;
  in.vario = st_.vario;
  in.netto = st_.netto;
  in.mcEffective = st_.xc.mc;
  in.leaveNow = st_.xc.leave != LeaveReason::None;
  st_.advisor = advisor_.update(in);
  if (st_.advisor.changed) {
    if (st_.advisor.advice == Advice::Glide) {
      st_.leave = st_.xc.leave != LeaveReason::None ? st_.xc.leave : LeaveReason::Weak;
      notify(st_.leave == LeaveReason::FinalGlide ? Alert::FinalGlide : Alert::Glide, t);
    } else {
      notify(Alert::Stay, t);
    }
  }
  st_.stf = st_.xc.stf * 3.6f;
}

// Thermal-model and speed-bar sounds, rate-limited so they guide rather than nag.
void FlightComputer::runCues(TimeMs t) {
  const bool busy = audio_.alertActive();
  const TurnView& tv = st_.turn;
  if (cfg_.turnCues && st_.circling) {
    if (moveEnd_ && t >= moveEnd_) {
      if (!busy) notify(Alert::TurnAgain, t);
      moveEnd_ = 0;
    }
    // One move, then a full new circle (the model waits for it) and 25 s.
    if (tv.advice == TurnAdvice::Move && tv.moveNow && !moveEnd_ && t - lastMoveCue_ >= 25000 && !busy) {
      notify(Alert::Move, t);
      lastMoveCue_ = t;
      float secs = tv.moveSeconds < 2 ? 2 : (tv.moveSeconds > 8 ? 8 : tv.moveSeconds);
      moveEnd_ = t + static_cast<TimeMs>(secs * 1000);
    }
    if (tv.advice != candAdv_) {
      candAdv_ = tv.advice;
      candSince_ = t;
    }
    const bool radius = candAdv_ == TurnAdvice::Tighten || candAdv_ == TurnAdvice::Widen;
    if (radius && t - candSince_ >= 4000 && tv.gain >= 0.2f && !busy &&
        (t - lastTurnCue_ >= 20000 || (candAdv_ != cuedAdv_ && t - lastTurnCue_ >= 8000))) {
      notify(candAdv_ == TurnAdvice::Tighten ? Alert::Tighten : Alert::Widen, t);
      cuedAdv_ = candAdv_;
      lastTurnCue_ = t;
    }
  } else {
    moveEnd_ = 0;
    candAdv_ = cuedAdv_ = TurnAdvice::None;
  }

  // Bar: released in the thermal; on glide, cue changes of a quarter or more
  // once they've held for 6 s, at most every 30 s (not in the first 8 s
  // after leaving a thermal). The screen shows the exact step meanwhile.
  if (st_.circling) {
    cuedBar_ = candBar_ = 0;
    leftThermal_ = t;
    return;
  }
  if (!cfg_.barCues) return;
  const float b = st_.xc.bar;
  if (b != candBar_) {
    candBar_ = b;
    barSince_ = t;
  }
  if (candBar_ != cuedBar_ && t - barSince_ >= 6000 && t - lastBarCue_ >= 30000 && t - leftThermal_ >= 8000 &&
      !busy) {
    notify(candBar_ > cuedBar_ ? Alert::BarMore : Alert::BarLess, t);
    cuedBar_ = candBar_;
    lastBarCue_ = t;
  }
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
  updateNav(t);

  if (kf_.initialized() && t - filterStart_ >= kSettleMs && t - lastAdvisor_ >= kAdvisorPeriodMs) {
    lastAdvisor_ = t;
    // 5 Hz into a 128-slot buffer covers the full 20 s (25 Hz would not).
    avg20_.add(t, st_.vario);
    st_.avg = avg20_.mean();
    // Air-mass-frame position: gyro heading × airspeed. The thermal drifts
    // with the air, so in this frame it stands still. While circling with
    // the wind unknown (or GPS out), assume a typical circling airspeed.
    const float dt = lastAirStep_ ? (t - lastAirStep_) / 1000.0f : 0.0f;
    lastAirStep_ = t;
    const bool airKnown = st_.wind.valid && st_.gps == GpsState::Ok;
    const float as = st_.circling && !airKnown ? cfg_.polar.minSinkSpeed() * 1.05f
                                                : (st_.airspeed > 0 ? st_.airspeed : cfg_.polar.bestGlideSpeed());
    if (st_.assistHeadingValid && dt > 0 && dt < 1) {
      airX_ += as * std::sin(st_.assistHeading * kDegToRad) * dt;
      airY_ += as * std::cos(st_.assistHeading * kDegToRad) * dt;
    }
    if (st_.circling) {
      if (!circStart_) circStart_ = t;
      lastCirclingT_ = t;
      if (st_.altMsl > curTop_) curTop_ = st_.altMsl;
      profile_.addClimb(t, st_.altMsl, st_.vario);
    } else {
      circStart_ = 0;
      if (curTop_ > thermalTop_) thermalTop_ = curTop_;  // best top of finished thermals
      curTop_ = 0;
    }
    // Straightening for a few seconds to move the circle mustn't erase the map.
    const bool inThermal = st_.circling || (lastCirclingT_ && t - lastCirclingT_ < 15000);
    if (st_.circling && st_.assistHeadingValid)
      model_.add(t, airX_, airY_, st_.assistHeading, as, st_.turnRate, st_.vario);
    model_.update(t, inThermal);
    st_.turn = model_.view();
    runAdvisor(t);
    if (st_.assistHeadingValid) assist_.update(t, st_.circling, st_.assistHeading, circ_.direction(), st_.vario);
    st_.assist = assist_.view();
    runCues(t);
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

void FlightComputer::updateNav(TimeMs t) {
  // The clock runs on between setClock calls (e.g. while GPS is jammed).
  if (clockFresh_) {
    clockAt_ = t;
    clockFresh_ = false;
  }
  if (st_.clockValid) st_.utcMin = (clockBaseMin_ + static_cast<int>((t - clockAt_) / 60000)) % 1440;
  st_.headingValid = heading_.valid() && (haveImu_ || guard_.trusted());
  st_.heading = heading_.heading();
  if (haveImu_) {
    if (st_.headingValid && !st_.circling) relHdg_ = st_.heading;
    st_.assistHeading = relHdg_;
    st_.assistHeadingValid = true;
  } else {
    st_.assistHeading = st_.heading;
    st_.assistHeadingValid = st_.headingValid;
  }
  const float wN = st_.wind.valid ? st_.wind.toN : 0, wE = st_.wind.valid ? st_.wind.toE : 0;
  const float as = st_.airspeed > 0 ? st_.airspeed : cfg_.polar.bestGlideSpeed();
  guard_.propagate(t, st_.headingValid && haveImu_ ? st_.heading : NAN, as, wN, wE);
  st_.gps = guard_.state();
  st_.gpsReason = guard_.reason();
  st_.gpsSince = guard_.since();
  st_.pos = guard_.position();
  if (prevGps_ == GpsState::Ok && (st_.gps == GpsState::Lost || st_.gps == GpsState::Spoofed))
    notify(Alert::GpsLost, t);
  else if ((prevGps_ == GpsState::Lost || prevGps_ == GpsState::Spoofed) && st_.gps == GpsState::Ok)
    notify(Alert::GpsBack, t);
  prevGps_ = st_.gps;
  st_.altMsl = st_.altitude + (haveMslOffset_ ? mslOffset_ : 0);

  if (t - lastNav_ < 1000) return;  // terrain and targets at 1 Hz
  lastNav_ = t;
  st_.profile = &profile_;
  traffic_.expire(t);
  // Ceiling: cloud base if the air sensor has one, else the best top today.
  st_.ceilingIsBase = st_.air.baseValid && st_.air.baseFromThermal;
  if (st_.air.baseValid) {
    st_.ceilingMsl = st_.air.cloudBase + (st_.altMsl - st_.altitude);
    st_.ceilingValid = true;
  } else if (thermalTop_ > 0) {
    st_.ceilingMsl = thermalTop_;
    st_.ceilingValid = true;
  }
  if (st_.wind.valid && st_.wind.t != lastWindFed_) {
    lastWindFed_ = st_.wind.t;
    profile_.addWind(t, st_.altMsl, st_.wind.toN, st_.wind.toE);
  }
  if (st_.air.haveAir) profile_.addAir(t, st_.altMsl, st_.air.tempC, st_.air.dewPointC);
  st_.aglValid = false;
  float ground;
  if (terrain_ && st_.pos.valid && terrain_->elevation(st_.pos.lat, st_.pos.lon, ground)) {
    st_.agl = st_.altMsl - ground;
    st_.aglValid = true;
  }
  // Glides descend through the layers below: use their winds when known.
  float gN = wN, gE = wE;
  const float floorAlt = st_.aglValid ? st_.altMsl - st_.agl : st_.altMsl - 500;
  profile_.windBetween(st_.altMsl, floorAlt, gN, gE);
  if (st_.home.valid && st_.pos.valid) {
    st_.home.arrivalAgl = arrivalAgl(cfg_.polar, terrain_, st_.pos.lat, st_.pos.lon, st_.altMsl, st_.home.lat,
                                     st_.home.lon, gN, gE, st_.home.bearingDeg, st_.home.distM);
  }
  // Where to glide next. Every candidate is a ground trigger (KK7 history,
  // today's sun on the terrain) or a pilot climbing at some height; the climb
  // is where the thermal's column will be at the height you'd arrive.
  st_.best = Target{};
  st_.best.kind = TargetKind::None;
  float bestScore = 0;
  // Latched for the rest of the thermal: recomputing it every second made
  // GLIDE and STAY alternate when the other pilot's climb hovered at the edge.
  if (!st_.circling) betterNearby_ = false;
  st_.nearCount = 0;
  if (terrain_ && st_.clockValid && st_.pos.valid &&
      (!sun_.valid() || st_.utcMin - sun_.lastUtcMin() >= 10 || st_.utcMin < sun_.lastUtcMin())) {
    sun_.update(*terrain_, st_.pos.lat, st_.pos.lon, st_.year, st_.month, st_.day, st_.utcMin, wN, wE);
  }
  // A thermal's core updraft ≈ the climb you've been getting + your sink and
  // the sink around it (~1.7 m/s); the bubble itself rises at about 0.6 × that.
  float rise = 0.6f * (advisor_.mc() / 0.8f + 1.7f);
  rise = rise < 1.5f ? 1.5f : (rise > 5 ? 5 : rise);
  st_.thermalRise = rise;
  st_.terrain = terrain_;
  st_.polar = &cfg_.polar;
  st_.sun = sun_.valid() ? &sun_ : nullptr;
  auto consider = [&](double tLat, double tLon, float fromAlt, float chance, TargetKind kind, float liveClimb,
                      int ageMin) {
    // Two passes: the arrival height decides where the column is, and that
    // decides the arrival height.
    double cLat = tLat, cLon = tLon;
    float brg = 0, dist = 0, arr = 0, z = st_.altMsl;
    for (int pass = 0; pass < 2; ++pass) {
      if (kind == TargetKind::Live) {
        // Their climb was at their height: shift it by the drift between there and here.
        float dn = 0, de = 0;
        const float dz = z - fromAlt;
        dn = gN * dz / rise;
        de = gE * dz / rise;
        cLat = tLat + dn / 111195.0;
        cLon = tLon + de / (111195.0 * std::cos(tLat * kDegToRad));
      } else {
        thermalColumnAt(tLat, tLon, fromAlt, z, rise, &profile_, wN, wE, cLat, cLon);
      }
      arr = arrivalAgl(cfg_.polar, terrain_, st_.pos.lat, st_.pos.lon, st_.altMsl, cLat, cLon, gN, gE, brg, dist);
      float g = 0;
      if (!terrain_ || !terrain_->elevation(cLat, cLon, g)) g = st_.altMsl - (st_.aglValid ? st_.agl : 0);
      z = g + arr;
    }
    if (dist < 400 || arr < 250) return;
    if (chance > 0.95f) chance = 0.95f;
    const float sc = targetScore(chance, arr, dist, 250.0f);
    if (sc <= bestScore) return;
    bestScore = sc;
    float dn, de;
    offsetMeters(tLat, tLon, cLat, cLon, dn, de);
    Target tg;
    tg.valid = true;
    tg.lat = cLat;
    tg.lon = cLon;
    tg.bearingDeg = brg;
    tg.distM = dist;
    tg.arrivalAgl = arr;
    tg.chance = chance;
    tg.kind = kind;
    tg.live = kind == TargetKind::Live;
    tg.liveClimb = liveClimb;
    tg.ageMin = ageMin;
    tg.driftM = std::sqrt(dn * dn + de * de);
    tg.trigLat = tLat;
    tg.trigLon = tLon;
    tg.trigAlt = fromAlt;
    st_.best = tg;
  };
  if (st_.pos.valid) {
    // History (KK7 pack), weighted by today's sun on that spot.
    if (hotspots_ && st_.clockValid) {
      for (int i = 0; i < hotspots_->count(); ++i) {
        float ch = hotspots_->chance(i, st_.year, st_.month, st_.day, st_.utcMin);
        if (ch < 0.15f) continue;
        const Hotspot& h = hotspots_->at(i);
        float g = 0;
        if (terrain_) terrain_->elevation(h.lat, h.lon, g);
        if (sun_.valid()) ch *= 0.6f + 0.8f * sun_.heatingAt(h.lat, h.lon);
        consider(h.lat, h.lon, g, ch, TargetKind::History, 0, 0);
      }
    }
    // Today's sun on the terrain: less certain than history, so scaled down.
    if (sun_.valid()) {
      for (int i = 0; i < sun_.count(); ++i) {
        const ThermalSource& src = sun_.at(i);
        if (src.strength < 0.2f) continue;
        consider(src.lat, src.lon, src.ground, 0.6f * src.strength, TargetKind::Sun, 0, 0);
      }
    }
  }
  // Live thermals (other pilots climbing) beat history and prediction. They
  // drift with the wind as they age, and with height between theirs and yours.
  if (st_.gps == GpsState::Ok && st_.pos.valid) {
    for (int i = 0; i < traffic_.thermals(); ++i) {
      const LiveThermal& h = traffic_.thermal(i);
      const float age = (t - h.t) / 1000.0f;
      const double lat = h.lat + wN * age / 111195.0;
      const double lon = h.lon + wE * age / (111195.0 * std::cos(h.lat * kDegToRad));
      float ch = (0.5f + 0.15f * h.climb) * std::exp(-age / 900.0f);
      consider(lat, lon, h.alt, ch, TargetKind::Live, h.climb, static_cast<int>(age / 60));
      // Leave a weak thermal for a clearly better one you can reach high.
      if (st_.circling && age < 300 && st_.best.kind == TargetKind::Live && st_.best.arrivalAgl > 300 &&
          h.climb > st_.advisor.circleClimb + cfg_.xc.betterBy)
        betterNearby_ = true;
    }
    for (int i = 0; i < traffic_.pilots() && st_.nearCount < 8; ++i) {
      const OtherPilot& p = traffic_.pilot(i);
      NearPilot& np = st_.near[st_.nearCount];
      offsetMeters(st_.pos.lat, st_.pos.lon, p.lat, p.lon, np.north, np.east);
      if (np.north * np.north + np.east * np.east > 5000.0f * 5000.0f) continue;
      np.dAlt = p.alt - st_.altMsl;
      np.climb = p.climbAvg;
      np.turning = p.turning;
      ++st_.nearCount;
    }
  }

  // Climb plan: from here, how high before leaving for the next target.
  st_.plan = ClimbPlan{};
  if (st_.pos.valid) {
    double tLat = 0, tLon = 0;
    float margin = 0;
    const char* what = nullptr;
    if (task_ && st_.task.active && !st_.task.finished && task_->next() < task_->count()) {
      tLat = task_->at(task_->next()).lat;
      tLon = task_->at(task_->next()).lon;
      margin = 150;
      what = task_->at(task_->next()).name;
    } else if (st_.best.valid) {
      tLat = st_.best.lat;
      tLon = st_.best.lon;
      margin = 250;  // arrive high enough to work a thermal
      what = st_.best.kind == TargetKind::Live ? "pilot" : (st_.best.kind == TargetKind::Sun ? "sun" : "thermal");
    } else if (st_.home.valid) {
      tLat = st_.home.lat;
      tLon = st_.home.lon;
      margin = 150;
      what = "home";
    }
    if (what) {
      ClimbPlan& p = st_.plan;
      p.arriveNow = arrivalAgl(cfg_.polar, terrain_, st_.pos.lat, st_.pos.lon, st_.altMsl, tLat, tLon, gN, gE,
                               p.bearingDeg, p.distM);
      if (p.arriveNow > -9000) {
        p.valid = true;
        p.what = what;
        p.margin = margin;
        p.need = margin - p.arriveNow;  // glide loss doesn't change with start height
        p.leaveAt = st_.altMsl + p.need;
        float g = 0;
        if (terrain_) terrain_->elevation(tLat, tLon, g);
        p.targetGround = g;
        const float climb = st_.advisor.thermalAvg > 0.2f ? st_.advisor.thermalAvg : 0.2f;
        p.minutes = p.need > 0 ? p.need / climb / 60.0f : 0;
        p.aboveCeiling = st_.ceilingValid && p.leaveAt > st_.ceilingMsl;
      }
    }
  }

  // Task: advance turnpoints (trusted GPS only), final glide.
  if (task_ && task_->count() >= 2) {
    if (st_.gps == GpsState::Ok && st_.pos.valid && task_->update(st_.pos.lat, st_.pos.lon)) notify(Alert::Turnpoint, t);
    if (st_.pos.valid) {
      st_.task = task_->view(st_.pos.lat, st_.pos.lon);
      if (!st_.task.finished) {
        const float mc = st_.xc.mc;
        const float need = task_->requiredAltitude(cfg_.polar, st_.pos.lat, st_.pos.lon, mc, gN, gE, terrain_, 150);
        st_.task.finalValid = need < 1e5f;
        st_.task.finalSurplus = st_.altMsl - need;
        // MC that exactly uses the height: the speed you can afford to goal.
        st_.task.finalMc = 0;
        if (st_.task.finalValid &&
            st_.altMsl >= task_->requiredAltitude(cfg_.polar, st_.pos.lat, st_.pos.lon, 0, gN, gE, terrain_, 150)) {
          float lo = 0, hi = 5;
          for (int k = 0; k < 14; ++k) {
            const float m = (lo + hi) / 2;
            if (task_->requiredAltitude(cfg_.polar, st_.pos.lat, st_.pos.lon, m, gN, gE, terrain_, 150) <= st_.altMsl)
              lo = m;
            else
              hi = m;
          }
          st_.task.finalMc = lo;
        }
        if (st_.task.finalValid && st_.task.finalSurplus >= 0 && !finalCued_ && !st_.circling) {
          notify(Alert::FinalGlide, t);
          finalCued_ = true;
        }
        if (st_.task.finalSurplus < -100) finalCued_ = false;
      }
    }
  } else {
    st_.task = TaskView{};
  }
}

}  // namespace pg
