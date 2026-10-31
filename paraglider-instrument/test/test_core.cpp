// Desktop tests for lib/core. Build and run: `make test` in paraglider-instrument/.
#include <cstring>
#include <string>
#include <vector>

#include "advisor.h"
#include "ahrs.h"
#include "audio.h"
#include "averager.h"
#include "check.h"
#include "circling.h"
#include "fanet.h"
#include "flight_computer.h"
#include "kalman_vario.h"
#include "nmea.h"
#include "polar.h"
#include "remote.h"
#include "sensors.h"
#include "synth_flight.h"
#include "wind.h"

using namespace pg;

// ---------------------------------------------------------------- atmosphere

TEST("pressure ↔ altitude round trip, ISA anchor points") {
  EXPECT_NEAR(pressureToAltitude(101325), 0, 0.01);
  EXPECT_NEAR(pressureToAltitude(89874.6f), 1000, 1.0);  // ISA table
  EXPECT_NEAR(pressureToAltitude(altitudeToPressure(2345)), 2345, 0.1);
  EXPECT_NEAR(pressureToAltitude(101325, 102325), 83.4, 1.0);  // QNH +10 hPa ≈ +83 m
}

// ---------------------------------------------------------------- kalman

TEST("kalman: tracks a steady 2 m/s climb through baro noise") {
  KalmanVario kf;
  uint32_t r = 1;
  float alt = 1000;
  for (int i = 0; i < 25 * 30; ++i) {  // 30 s at 25 Hz
    alt += 2.0f * 0.04f;
    r = r * 1103515245u + 12345u;
    const float n = ((r >> 16) % 1000) / 1000.0f - 0.5f;  // ±0.5 m uniform
    kf.predict(0.04f);
    kf.updateAltitude(alt + n);
  }
  EXPECT_NEAR(kf.vario(), 2.0, 0.25);
  EXPECT_NEAR(kf.altitude(), alt, 0.5);
}

TEST("kalman: still air reads zero, not drift") {
  KalmanVario kf;
  for (int i = 0; i < 500; ++i) {
    kf.predict(0.04f);
    kf.updateAltitude(500.0f + ((i % 7) - 3) * 0.1f);
  }
  EXPECT_NEAR(kf.vario(), 0, 0.15);
}

TEST("kalman: responds to a step into lift within ~1.5 s") {
  KalmanVario kf;
  float alt = 1000;
  for (int i = 0; i < 250; ++i) {
    kf.predict(0.04f);
    kf.updateAltitude(alt);
  }
  int steps = 0;
  while (kf.vario() < 2.0f && steps < 500) {  // 3 m/s step
    alt += 3.0f * 0.04f;
    kf.predict(0.04f);
    kf.updateAltitude(alt);
    ++steps;
  }
  EXPECT(steps * 0.04f < 1.5f);
}

TEST("kalman: IMU assist estimates a constant accel bias") {
  KalmanVarioConfig c;
  c.accelAssist = true;
  c.accelNoise = 0.2f;
  KalmanVario kf(c);
  kf.reset(1000);
  for (int i = 0; i < 100 * 120; ++i) {  // 120 s, accel at 100 Hz, baro at 25 Hz
    kf.predict(0.01f, 0.3f);              // still air, accelerometer reads +0.3 bias
    if (i % 4 == 0) kf.updateAltitude(1000);
  }
  EXPECT_NEAR(kf.accelBias(), 0.3, 0.05);
  EXPECT_NEAR(kf.vario(), 0, 0.05);
}

// ---------------------------------------------------------------- ahrs

TEST("ahrs: level and still → zero vertical accel") {
  MahonyAhrs a;
  for (int i = 0; i < 200; ++i) a.update(0, 0, kGravity, 0, 0, 0, 0.01f);
  EXPECT_NEAR(a.verticalAccel(0, 0, kGravity), 0, 0.01);
  EXPECT_NEAR(a.rollDeg(), 0, 0.5);
}

TEST("ahrs: tilted 30° still → vertical accel ~0, roll ~30°") {
  MahonyAhrs a;
  const float r = 30 * kDegToRad;
  const float ay = kGravity * std::sin(r), az = kGravity * std::cos(r);
  for (int i = 0; i < 500; ++i) a.update(0, ay, az, 0, 0, 0, 0.01f);
  EXPECT_NEAR(a.rollDeg(), 30, 1.0);
  EXPECT_NEAR(a.verticalAccel(0, ay, az), 0, 0.05);
  // 1 m/s² upward push along true vertical shows up as +1.
  EXPECT_NEAR(a.verticalAccel(0, ay * 1.102f, az * 1.102f), 1.0, 0.05);
}

// ---------------------------------------------------------------- averager

TEST("window average: time-based window drops old samples") {
  WindowAverage<64> w(1000);
  for (uint32_t t = 0; t <= 2000; t += 100) w.add(t, t < 1000 ? 0.0f : 2.0f);
  EXPECT_NEAR(w.mean(), 2.0, 1e-6);
  EXPECT(w.full());
}

TEST("window average: capacity too small for the window is reported, not hidden") {
  WindowAverage<16> w(20000);
  for (uint32_t t = 0; t <= 20000; t += 40) w.add(t, 1.0f);
  EXPECT(!w.full());
}

TEST("gain average: honest climb rate since start") {
  GainAverage g;
  g.start(10000, 1200);
  EXPECT_NEAR(g.rate(70000, 1290), 1.5, 1e-6);
  EXPECT_NEAR(g.gain(1290), 90, 1e-6);
}

// ---------------------------------------------------------------- circling

TEST("circling: steady turn enters after enterMs, straight exits after exitMs") {
  CirclingDetector c;
  uint32_t t = 0;
  for (; t < 30000; t += 200) c.update(t, 0);
  EXPECT(!c.circling());
  uint32_t enteredAt = 0;
  for (; t < 60000; t += 200)
    if (c.update(t, 15) && c.circling()) enteredAt = t;
  EXPECT(c.circling());
  EXPECT(enteredAt >= 42000 && enteredAt <= 44000);
  EXPECT(c.direction() == 1);
  for (; t < 70000; t += 200) c.update(t, 0);
  EXPECT(c.circling());  // still within exit hysteresis
  for (; t < 80000; t += 200) c.update(t, 0);
  EXPECT(!c.circling());
}

TEST("circling: S-turns don't count") {
  CirclingDetector c;
  for (uint32_t t = 0; t < 60000; t += 200) c.update(t, ((t / 5000) % 2) ? 15.0f : -15.0f);
  EXPECT(!c.circling());
}

TEST("circling: track wrap-around 359→1 is a small right turn") {
  EXPECT_NEAR(angleDiffDeg(359, 1), 2, 1e-4);
  EXPECT_NEAR(angleDiffDeg(1, 359), -2, 1e-4);
  EXPECT_NEAR(angleDiffDeg(10, 190), 180, 1e-4);
}

// ---------------------------------------------------------------- wind

TEST("wind: circle fit recovers centre and radius exactly") {
  float n[36], e[36];
  for (int i = 0; i < 36; ++i) {
    const float a = i * 10 * kDegToRad;
    n[i] = 3 + 10 * std::cos(a);
    e[i] = -2 + 10 * std::sin(a);
  }
  const CircleFit f = fitCircle(n, e, 36);
  EXPECT(f.ok);
  EXPECT_NEAR(f.cN, 3, 1e-3);
  EXPECT_NEAR(f.cE, -2, 1e-3);
  EXPECT_NEAR(f.radius, 10, 1e-3);
}

TEST("wind: estimator after one noisy circle — 15 km/h from the west") {
  WindEstimator w;
  const float wN = 0, wE = 15 / 3.6f;  // air moving east = wind FROM 270
  uint32_t t = 0;
  bool got = false;
  uint32_t r = 7;
  for (float hdg = 0; hdg < 400; hdg += 3) {
    r = r * 1103515245u + 12345u;
    const float jit = (((r >> 16) % 100) / 100.0f - 0.5f) * 0.6f;
    const float h = hdg * kDegToRad;
    const float vn = 9.5f * std::cos(h) + wN + jit, ve = 9.5f * std::sin(h) + wE - jit;
    const float trk = std::fmod(std::atan2(ve, vn) * kRadToDeg + 360, 360);
    got |= w.addSample(t, vn, ve, trk);
    t += 500;
  }
  EXPECT(got);
  EXPECT_NEAR(w.estimate().speed * 3.6f, 15, 1.0);
  EXPECT_NEAR(w.estimate().fromDeg, 270, 4);
  EXPECT_NEAR(w.estimate().airspeed, 9.5, 0.4);
}

// ---------------------------------------------------------------- polar

TEST("polar: passes through its points; STF grows with MC and headwind") {
  const Polar p = defaultParagliderPolar();
  EXPECT_NEAR(p.sink(38 / 3.6f), 1.15, 1e-3);
  EXPECT_NEAR(p.sink(52 / 3.6f), 2.0, 1e-3);
  const float v0 = p.speedToFly(0, 0, 0), v2 = p.speedToFly(2, 0, 0);
  EXPECT(v2 > v0);
  EXPECT(p.speedToFly(0, 0, 5) > v0);
  EXPECT(p.speedToFly(0, -2, 0) > v0);  // fly faster through sink
  EXPECT(p.speedToFly(5, -3, 8) <= p.vMax() + 1e-4);
  // Best glide still-air L/D for a typical B wing lands around 8.5–10.
  const float ld = p.groundGlideRatio(v0, 0, 0);
  EXPECT(ld > 8.0f && ld < 10.5f);
}

TEST("polar: arrival height drops with headwind") {
  const Polar p = defaultParagliderPolar();
  const float still = arrivalHeight(p, 1500, 300, 8000, 0, 0, 100);
  const float head = arrivalHeight(p, 1500, 300, 8000, 0, 4, 100);
  EXPECT(still > 0);
  EXPECT(head < still);
}

// ---------------------------------------------------------------- advisor

TEST("advisor: weak climb after warmup → GLIDE, cued once then re-cued") {
  AdvisorConfig c;
  c.autoMc = false;
  c.mc = 1.5f;
  Advisor a(c);
  int glideCues = 0;
  uint32_t firstCue = 0;
  for (uint32_t t = 0; t < 200000; t += 200) {
    AdvisorInput in{t, true, 1000.0f + t / 1000.0f * 0.6f, 0.6f, 0};
    const auto out = a.update(in);
    if (out.changed && out.advice == Advice::Glide) {
      if (!glideCues) firstCue = t;
      ++glideCues;
    }
  }
  EXPECT(firstCue >= 55000 && firstCue <= 70000);  // warmup 40 s + hold 15 s
  EXPECT(glideCues >= 2);                          // re-cued every 60 s
}

TEST("advisor: strong climb never says GLIDE") {
  AdvisorConfig c;
  c.autoMc = false;
  c.mc = 1.0f;
  Advisor a(c);
  bool glide = false;
  for (uint32_t t = 0; t < 300000; t += 200) {
    const auto out = a.update({t, true, 1000.0f + t / 1000.0f * 2.0f, 2.0f, 0});
    glide |= out.advice == Advice::Glide;
  }
  EXPECT(!glide);
}

TEST("advisor: gliding into strong netto lift → STAY") {
  AdvisorConfig c;
  c.autoMc = false;
  c.mc = 1.0f;
  Advisor a(c);
  Advice seen = Advice::None;
  uint32_t at = 0;
  for (uint32_t t = 0; t < 20000; t += 200) {
    const float netto = t < 10000 ? -0.5f : 3.0f;
    const auto out = a.update({t, false, 1000, netto - 1.15f, netto});
    if (out.changed) {
      seen = out.advice;
      at = t;
    }
  }
  EXPECT(seen == Advice::Stay);
  EXPECT(at >= 11000 && at <= 13500);
}

TEST("advisor: auto-MC learns from completed thermals") {
  AdvisorConfig c;
  c.autoMc = true;
  c.autoMcFactor = 1.0f;
  Advisor a(c);
  uint32_t t = 0;
  float alt = 1000;
  for (int th = 0; th < 3; ++th) {
    for (uint32_t k = 0; k < 120000; k += 200, t += 200) {
      alt += 2.0f * 0.2f;
      a.update({t, true, alt, 2.0f, 0});
    }
    for (uint32_t k = 0; k < 60000; k += 200, t += 200) {
      alt -= 1.2f * 0.2f;
      a.update({t, false, alt, -1.2f, 0});
    }
  }
  EXPECT(a.thermalCount() == 3);
  EXPECT_NEAR(a.mc(), 2.0, 0.05);
}

// ---------------------------------------------------------------- audio

TEST("audio: deadband silent, lift beeps, pitch rises with climb, sink tone") {
  AudioEngine e;
  e.setVario(0.0f);
  bool any = false;
  for (uint32_t t = 0; t < 2000; t += 10) any |= e.tick(t).freq != 0;
  EXPECT(!any);

  e.setVario(1.0f);
  int on = 0, off = 0;
  for (uint32_t t = 2000; t < 6000; t += 10) (e.tick(t).freq ? on : off)++;
  EXPECT(on > 0 && off > 0);
  EXPECT(e.climbFreq(3.0f) > e.climbFreq(1.0f));
  EXPECT(e.climbPeriod(4.0f) < e.climbPeriod(0.5f));

  e.setVario(-3.5f);
  const auto f = e.tick(7000).freq;
  EXPECT(f >= 220 && f <= 420);
}

TEST("audio: alerts preempt the vario, play even when muted, then end") {
  AudioEngine e;
  e.setMuted(true);
  e.setVario(2.0f);
  e.play(Alert::Glide, 1000);
  EXPECT(e.tick(1000).freq == 1320);
  EXPECT(e.alertActive());
  e.tick(2000);
  EXPECT(!e.alertActive());
  EXPECT(e.tick(2010).freq == 0);  // muted vario stays silent
}

// ---------------------------------------------------------------- nmea

TEST("nmea: checksum and LK8EX1 parse") {
  const char* body = "LK8EX1,98765,99999,-123,22,1085,";
  char line[80];
  std::snprintf(line, sizeof line, "$%s*%02X", body, nmeaChecksum(body, std::strlen(body)));
  EXPECT(nmeaChecksumOk(line));
  Lk8ex1 m;
  EXPECT(parseLk8ex1(line, m));
  EXPECT(m.hasPressure);
  EXPECT_NEAR(m.pressurePa, 98765, 0.5);
  EXPECT(!m.hasAltitude);
  EXPECT_NEAR(m.vario, -1.23, 1e-4);
  EXPECT(m.batteryPct == 85);
  line[5] = 'Y';  // corrupt
  EXPECT(!parseLk8ex1(line, m));
}

TEST("nmea: XCTRC parse (example from the XCTracer docs)") {
  const char* body = "XCTRC,2015,1,5,16,34,33,36,46.947508,7.453117,540.32,12.35,270.4,2.78,,,,964.93,98";
  char line[160];
  std::snprintf(line, sizeof line, "$%s*%02X", body, nmeaChecksum(body, std::strlen(body)));
  Xctrc x;
  EXPECT(parseXctrc(line, x));
  EXPECT(x.hasFix);
  EXPECT_NEAR(x.lat, 46.947508, 1e-6);
  EXPECT_NEAR(x.speedKmh, 12.35, 1e-3);
  EXPECT_NEAR(x.climb, 2.78, 1e-3);
  EXPECT_NEAR(x.rawPressure, 96493, 1);
  EXPECT(x.batteryPct == 98);
}

TEST("nmea: line assembler rebuilds sentences split across BLE packets") {
  LineAssembler la;
  std::vector<std::string> got;
  const char* chunks[] = {"garbage$LK8E", "X1,1,2,3,4,5*00\r", "\n$XC", "TRC,a*11\r\n$torn"};
  for (const char* c : chunks)
    la.feed(reinterpret_cast<const uint8_t*>(c), std::strlen(c),
            [&](const char* l, size_t) { got.emplace_back(l); });
  EXPECT(got.size() == 2);
  if (got.size() == 2) {
    EXPECT(got[0] == "$LK8EX1,1,2,3,4,5*00");
    EXPECT(got[1] == "$XCTRC,a*11");
  }
}

// ---------------------------------------------------------------- fanet

TEST("fanet: tracking round trip within quantisation") {
  fanet::Tracking t;
  t.lat = 32.712345;
  t.lon = 35.087654;
  t.altitude = 1234;
  t.speedKmh = 37.5f;
  t.climb = 2.3f;
  t.headingDeg = 271;
  t.hasTurnRate = true;
  t.turnRateDeg = -14.5f;
  uint8_t buf[16];
  const size_t n = fanet::encodeTracking(t, buf, sizeof buf);
  EXPECT(n == 12);
  fanet::Tracking d;
  EXPECT(fanet::decodeTracking(buf, n, d));
  EXPECT_NEAR(d.lat, t.lat, 2e-5);
  EXPECT_NEAR(d.lon, t.lon, 3e-5);
  EXPECT(d.altitude == 1234);
  EXPECT(d.aircraft == fanet::AircraftType::Paraglider);
  EXPECT_NEAR(d.speedKmh, 37.5, 0.5);
  EXPECT_NEAR(d.climb, 2.3, 0.1);
  EXPECT_NEAR(d.headingDeg, 271, 1.5);
  EXPECT_NEAR(d.turnRateDeg, -14.5, 0.25);
}

TEST("fanet: scaled ranges (high altitude, fast, strong sink)") {
  fanet::Tracking t;
  t.lat = -33.9;
  t.lon = 151.2;
  t.altitude = 4321;
  t.speedKmh = 90;
  t.climb = -9.0f;
  uint8_t buf[16];
  const size_t n = fanet::encodeTracking(t, buf, sizeof buf);
  fanet::Tracking d;
  EXPECT(fanet::decodeTracking(buf, n, d));
  EXPECT(std::abs(d.altitude - 4321) <= 4);
  EXPECT_NEAR(d.speedKmh, 90, 2.5);
  EXPECT_NEAR(d.climb, -9.0, 0.5);
  EXPECT_NEAR(d.lat, -33.9, 2e-5);
}

TEST("fanet: unicast message frame round trip") {
  fanet::Frame f;
  f.type = fanet::kMessage;
  f.src = {0xFC, 0x1234};
  f.unicast = true;
  f.ack = 1;
  f.dest = {0x11, 0xBEEF};
  f.payloadLen = fanet::encodeMessage("Thermal here", f.payload, sizeof f.payload);
  uint8_t air[fanet::kMaxFrame];
  const size_t n = fanet::encode(f, air, sizeof air);
  EXPECT(n == 1 + 3 + 1 + 3 + 13);
  EXPECT(air[0] == (0x80 | fanet::kMessage));
  EXPECT(air[1] == 0xFC && air[2] == 0x34 && air[3] == 0x12);
  fanet::Frame d;
  EXPECT(fanet::decode(air, n, d));
  EXPECT(d.unicast && d.ack == 1 && d.dest == f.dest && d.src == f.src);
  char text[64];
  EXPECT(fanet::decodeMessage(d.payload, d.payloadLen, text, sizeof text));
  EXPECT(std::strcmp(text, "Thermal here") == 0);
}

TEST("fanet: truncated frames are rejected") {
  const uint8_t bad[] = {0x83, 0x01, 0x02};
  fanet::Frame d;
  EXPECT(!fanet::decode(bad, sizeof bad, d));
  const uint8_t bad2[] = {0x83, 0x01, 0x02, 0x03, 0x20, 0x01};  // unicast, dest cut short
  EXPECT(!fanet::decode(bad2, sizeof bad2, d));
}

TEST("fanet: region from position — Israel is IL918, Alps EU868") {
  EXPECT(std::strcmp(fanet::regionFor(32.55, 35.35).name, "IL918") == 0);  // Gilboa / the Valley
  EXPECT_NEAR(fanet::regionFor(33.0, 35.6).freqMHz, 918.5, 1e-3);            // Hula
  EXPECT(std::strcmp(fanet::regionFor(46.6, 8.0).name, "EU868") == 0);
  EXPECT(std::strcmp(fanet::regionFor(38.0, -110.0).name, "US920") == 0);
  EXPECT(std::strcmp(fanet::defaultRegion().name, "EU868") == 0);
  EXPECT(fanet::regionByName("IL918") != nullptr && fanet::regionByName("XX") == nullptr);
}

// ---------------------------------------------------------------- remote

TEST("remote: byte codes and ASCII aliases") {
  const uint8_t b = 0x01, a = '-', z = 'Z';
  EXPECT(parseCommand(&b, 1) == Command::McUp);
  EXPECT(parseCommand(&a, 1) == Command::McDown);
  EXPECT(parseCommand(&z, 1) == Command::None);
  EXPECT(parseCommand(nullptr, 0) == Command::None);
}

// ---------------------------------------------------------------- end to end

TEST("flight computer: synthetic flight — STAY on entry, wind, GLIDE as it dies") {
  FlightComputerConfig cfg;
  cfg.advisor.autoMc = false;
  cfg.advisor.mc = 1.0f;
  FlightComputer fc(cfg);
  auto script = synth::defaultScript();
  synth::Flight fl(script);
  uint32_t stayAt = 0, glideAt = 0;
  int lateGlides = 0;  // GLIDE after the pilot already rolled out = nagging
  float maxErr = 0;
  while (!fl.done()) {
    fl.step(fc);
    const Outputs o = fc.tick(fl.now());
    if (o.alertStarted == Alert::Stay && !stayAt) stayAt = fl.now();
    if (o.alertStarted == Alert::Glide && !glideAt) glideAt = fl.now();
    if (o.alertStarted == Alert::Glide && fl.now() > 420000) ++lateGlides;
    if (fl.now() > 20000) {
      const float err = std::fabs(fc.status().vario - fl.trueClimb());
      bool nearEdge = false;  // the filter is allowed a few seconds to follow a step
      for (uint32_t edge : {60000u, 75000u, 300000u, 420000u})
        nearEdge |= fl.now() >= edge && fl.now() < edge + 4000;
      if (fl.now() % 1000 == 0 && !nearEdge && err > maxErr) maxErr = err;
    }
  }
  const Status& s = fc.status();
  std::printf("        STAY at %.1f s, GLIDE at %.1f s, wind %.1f km/h from %.0f°, max vario err %.2f\n",
              stayAt / 1000.0, glideAt / 1000.0, s.wind.speed * 3.6, s.wind.fromDeg, maxErr);
  EXPECT(stayAt >= 60000 && stayAt <= 66000);
  EXPECT(glideAt >= 300000 && glideAt <= 420000);
  EXPECT(s.wind.valid);
  EXPECT_NEAR(s.wind.speed * 3.6f, 14.4, 1.5);
  EXPECT_NEAR(s.wind.fromDeg, 270, 6);
  EXPECT_NEAR(s.altitude, fl.trueAltitude(), 1.0);
  EXPECT(maxErr < 0.35f);
  EXPECT(lateGlides == 0);
  // Gliding at the end for 80 s in -0.3 m/s air: the 20 s average must equal
  // the steady climb (catches a buffer too small for its window).
  EXPECT_NEAR(s.avg, fl.trueClimb(), 0.1);
}

TEST("flight computer: same flight with IMU — gyro drives circling, same answers") {
  FlightComputerConfig cfg;
  cfg.advisor.autoMc = false;
  cfg.advisor.mc = 1.0f;
  FlightComputer fc(cfg);
  auto script = synth::defaultScript();
  script.imu = true;
  synth::Flight fl(script);
  uint32_t stayAt = 0, glideAt = 0;
  bool sawRight = false;
  while (!fl.done()) {
    fl.step(fc);
    const Outputs o = fc.tick(fl.now());
    if (o.alertStarted == Alert::Stay && !stayAt) stayAt = fl.now();
    if (o.alertStarted == Alert::Glide && !glideAt) glideAt = fl.now();
    if (fl.now() == 200000) sawRight = fc.status().circling && fc.status().turnRate > 10;
  }
  const Status& s = fc.status();
  std::printf("        STAY at %.1f s, GLIDE at %.1f s, wind %.1f km/h from %.0f°\n", stayAt / 1000.0,
              glideAt / 1000.0, s.wind.speed * 3.6, s.wind.fromDeg);
  EXPECT(s.imu);
  EXPECT(sawRight);
  EXPECT(stayAt >= 60000 && stayAt <= 66000);
  EXPECT(glideAt >= 300000 && glideAt <= 420000);
  EXPECT_NEAR(s.wind.speed * 3.6f, 14.4, 1.5);
  EXPECT_NEAR(s.altitude, fl.trueAltitude(), 1.0);
}

int main() { return check::runAll(); }
