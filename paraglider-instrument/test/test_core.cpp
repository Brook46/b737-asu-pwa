// Desktop tests for lib/core. Build and run: `make test` in paraglider-instrument/.
#include <cstring>
#include <string>
#include <vector>

#include "advisor.h"
#include "ahrs.h"
#include "atmosphere.h"
#include "audio.h"
#include "bme280_comp.h"
#include "averager.h"
#include "check.h"
#include "circling.h"
#include "dps310_comp.h"
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

TEST("nmea: L76K setup commands match Meshtastic's known-good strings") {
  char b[96];
  nmeaBuild("PCAS04,7", b, sizeof b);
  EXPECT(std::strcmp(b, "$PCAS04,7*1E") == 0);
  nmeaBuild("PCAS03,1,0,0,0,1,0,0,0,0,0,,,0,0", b, sizeof b);
  EXPECT(std::strcmp(b, "$PCAS03,1,0,0,0,1,0,0,0,0,0,,,0,0*02") == 0);
  nmeaBuild("PCAS11,3", b, sizeof b);
  EXPECT(std::strcmp(b, "$PCAS11,3*1E") == 0);
  nmeaBuild("PCAS06,0", b, sizeof b);
  EXPECT(std::strcmp(b, "$PCAS06,0*1B") == 0);
}

TEST("nmea: GGA + RMC from a GNSS receiver make one fix") {
  NmeaGnssParser p;
  char gga[128], rmc[128];
  nmeaBuild("GNGGA,101530.00,3233.0000,N,03521.0000,E,1,09,0.9,512.3,M,18.0,M,,", gga, sizeof gga);
  nmeaBuild("GNRMC,101530.00,A,3233.0000,N,03521.0000,E,19.44,90.0,011126,,,A", rmc, sizeof rmc);
  GnssFix f;
  EXPECT(!p.feed(gga, 1000, f));
  EXPECT(p.feed(rmc, 1000, f));
  EXPECT(f.valid());
  EXPECT_NEAR(f.lat, 32.55, 1e-6);
  EXPECT_NEAR(f.lon, 35.35, 1e-6);
  EXPECT_NEAR(f.altMsl, 512.3, 1e-3);
  EXPECT(f.sats == 9);
  EXPECT_NEAR(f.groundSpeed, 10.0, 0.01);  // 19.44 kn
  EXPECT_NEAR(f.velE, 10.0, 0.01);
  EXPECT_NEAR(f.velN, 0.0, 0.01);
  int y, mo, d, h, mi, sec;
  EXPECT(p.utc(y, mo, d, h, mi, sec) && y == 2026 && mo == 11 && d == 1 && h == 10 && mi == 15);
  nmeaBuild("GPRMC,101531.00,V,,,,,,,011126,,,N", rmc, sizeof rmc);
  EXPECT(p.feed(rmc, 1200, f));
  EXPECT(!f.valid());  // receiver says no fix
}

TEST("dps310: coefficient unpacking and sign extension") {
  // c0=-100 (12b) c1=-300 (12b) c00=81000 (20b) c10=-50000 (20b) c01..c30 16-bit.
  const int32_t c0 = -100 & 0xFFF, c1 = -300 & 0xFFF, c00 = 81000, c10 = -50000 & 0xFFFFF;
  uint8_t b[18];
  b[0] = c0 >> 4;
  b[1] = ((c0 & 0xF) << 4) | (c1 >> 8);
  b[2] = c1 & 0xFF;
  b[3] = c00 >> 12;
  b[4] = (c00 >> 4) & 0xFF;
  b[5] = ((c00 & 0xF) << 4) | (c10 >> 16);
  b[6] = (c10 >> 8) & 0xFF;
  b[7] = c10 & 0xFF;
  const int16_t rest[5] = {-1234, 567, -8000, 42, -3};
  for (int i = 0; i < 5; ++i) {
    b[8 + 2 * i] = static_cast<uint8_t>(static_cast<uint16_t>(rest[i]) >> 8);
    b[9 + 2 * i] = static_cast<uint8_t>(rest[i] & 0xFF);
  }
  const Dps310Calib c = dps310ParseCalib(b);
  EXPECT(c.c0 == -100 && c.c1 == -300 && c.c00 == 81000 && c.c10 == -50000);
  EXPECT(c.c01 == -1234 && c.c11 == 567 && c.c20 == -8000 && c.c21 == 42 && c.c30 == -3);
  const uint8_t neg[3] = {0xFF, 0xFF, 0xFE};
  EXPECT(dps310Raw24(neg) == -2);
  EXPECT(dps310ScaleFactor(3) == 7864320);
  EXPECT_NEAR(dps310Temperature(c, 0.0), -50.0, 1e-9);  // c0 / 2
}

TEST("bme280: Bosch datasheet worked example (BMP280 §3.12)") {
  Bme280Calib c{};
  c.t1 = 27504; c.t2 = 26435; c.t3 = -1000;
  c.p1 = 36477; c.p2 = -10685; c.p3 = 3024; c.p4 = 2855; c.p5 = 140; c.p6 = -7;
  c.p7 = 15500; c.p8 = -14600; c.p9 = 6000;
  const Bme280Reading r = bme280Compensate(c, 519888, 415148, 0);
  EXPECT_NEAR(r.tempC, 25.08, 0.01);
  EXPECT_NEAR(r.pressurePa, 100653.27, 0.05);
}

TEST("bme280: humidity calibration nibble packing (H4/H5 share 0xE5)") {
  uint8_t tp[26] = {};
  tp[25] = 75;                                            // H1
  const uint8_t hum[7] = {0x6A, 0x01, 0x00, 0x13, 0x25, 0x03, 0x1E};
  const Bme280Calib c = bme280ParseCalib(tp, hum);
  EXPECT(c.hasHumidity && c.h1 == 75 && c.h2 == 362 && c.h3 == 0);
  EXPECT(c.h4 == (0x13 * 16 | 0x5));                      // 309
  EXPECT(c.h5 == (0x03 * 16 | 0x2));                      // 50
  EXPECT(c.h6 == 30);
  const uint8_t neg[7] = {0, 0, 0, 0xFF, 0x0F, 0xFF, 0x80};
  const Bme280Calib n = bme280ParseCalib(tp, neg);
  EXPECT(n.h4 == -1 && n.h5 == -16 && n.h6 == -128);
}

// ---------------------------------------------------------------- atmosphere

TEST("atmosphere: dew point and RH are inverses; known value") {
  EXPECT_NEAR(dewPointC(20, 50), 9.3, 0.15);
  EXPECT_NEAR(relativeHumidity(25, dewPointC(25, 63)), 63, 0.1);
  EXPECT_NEAR(condensationHeight(28, 14), 1750, 1);
  EXPECT_NEAR(condensationHeight(10, 12), 0, 1e-6);
}

TEST("atmosphere: dew point is the same inside a warm case") {
  // Outside 20 °C / 50 %. The case is 3 °C warmer: lower RH, same moisture.
  const float td = dewPointC(20, 50);
  const float caseRh = relativeHumidity(23, td);
  EXPECT(caseRh < 50);
  EXPECT_NEAR(dewPointC(23, caseRh), td, 0.01);
}

// Feeds one minute of thermal air (parcel from a 28/14 °C surface) at alt.
static AtmosphereEvent feedThermal(Atmosphere& a, uint32_t& t, float alt, float rate, float offset, int secs) {
  AtmosphereEvent last = AtmosphereEvent::None;
  for (int i = 0; i < secs; ++i, t += 1000, alt += rate) {
    const float temp = 28 - 9.8f * alt / 1000, td = 14 - 1.8f * alt / 1000;
    const AtmosphereEvent e = a.update(t, alt, temp + offset, relativeHumidity(temp + offset, td), true, rate);
    if (e != AtmosphereEvent::None) last = e;
  }
  return last;
}

TEST("atmosphere: cloud base from thermal air; warm case biases it; calibration fixes it") {
  Atmosphere a;
  uint32_t t = 1000;
  feedThermal(a, t, 900, 1.0f, 2.0f, 120);
  EXPECT(a.state().baseValid && a.state().baseFromThermal);
  EXPECT_NEAR(a.state().cloudBase, 1750 + 125 * 2.0, 40);  // 2 °C warm → 250 m high
  // Climb to the real base and tell it so.
  feedThermal(a, t, 1745, 0.5f, 2.0f, 5);
  EXPECT_NEAR(a.calibrateAtBase(), 2.0, 0.1);
  feedThermal(a, t, 1000, 1.0f, 2.0f, 240);
  EXPECT_NEAR(a.state().cloudBase, 1750, 40);
}

TEST("atmosphere: near-base cue once per approach") {
  Atmosphere a;
  uint32_t t = 1000;
  int cues = 0;
  float alt = 1000;
  for (int i = 0; i < 800; ++i, t += 1000, alt += 1.0f) {
    const float temp = 28 - 9.8f * alt / 1000, td = 14 - 1.8f * alt / 1000;
    if (alt > 1760) alt = 1700;  // pilot stays just under base
    if (a.update(t, alt, temp, relativeHumidity(temp, td), true, 1.0f) == AtmosphereEvent::NearBase) ++cues;
  }
  EXPECT(cues == 1);
}

TEST("atmosphere: lapse rate from glides — unstable vs stable days") {
  for (float lapse : {9.0f, 5.0f}) {
    Atmosphere a;
    uint32_t t = 1000;
    float alt = 2200;
    for (int i = 0; i < 900; ++i, t += 1000, alt -= 1.0f) {  // 15 min glide, 900 m
      const float temp = 28 - lapse * alt / 1000 + 2.0f + ((i % 7) - 3) * 0.05f;
      a.update(t, alt, temp, 40, false, -1.0f);
    }
    EXPECT(a.state().lapseValid);
    EXPECT_NEAR(a.state().lapseRate, lapse, 0.2);
    EXPECT(a.state().stability == (lapse > 8.5f ? Stability::Unstable : Stability::Stable));
  }
}

TEST("atmosphere: inversion cue when the climb starts warming with height") {
  Atmosphere a;
  uint32_t t = 1000;
  float alt = 1000;
  AtmosphereEvent seen = AtmosphereEvent::None;
  for (int i = 0; i < 400; ++i, t += 1000, alt += 1.0f) {
    // Normal thermal cooling up to 1200 m, then +3 °C/km above it.
    const float temp = alt < 1200 ? 20 - 9.8f * (alt - 1000) / 1000 : 18.04f + 3.0f * (alt - 1200) / 1000;
    const AtmosphereEvent e = a.update(t, alt, temp, 30, true, 1.0f);
    if (e == AtmosphereEvent::Inversion && seen == AtmosphereEvent::None) {
      seen = e;
      EXPECT(alt > 1200 && alt < 1450);
    }
  }
  EXPECT(seen == AtmosphereEvent::Inversion);
}

TEST("flight computer: synthetic flight with air — base estimate and near-base cue") {
  FlightComputerConfig cfg;
  cfg.advisor.autoMc = false;
  FlightComputer fc(cfg);
  auto script = synth::defaultScript();
  script.air = true;
  synth::Flight fl(script);
  uint32_t nearBaseAt = 0;
  while (!fl.done()) {
    fl.step(fc);
    const Outputs o = fc.tick(fl.now());
    if (o.alertStarted == Alert::NearBase && !nearBaseAt) nearBaseAt = fl.now();
  }
  const auto& air = fc.status().air;
  std::printf("        base %.0f m (true 1750, case +2 °C → expect ~2000), near-base cue at %.0f s, %.0f m\n",
              air.cloudBase, nearBaseAt / 1000.0, fc.status().altitude);
  EXPECT(air.baseValid && air.baseFromThermal);
  EXPECT_NEAR(air.cloudBase, 2000, 60);
  EXPECT(nearBaseAt > 0);
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
