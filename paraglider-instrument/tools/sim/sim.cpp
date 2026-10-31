// Desktop flight replay: runs the exact firmware logic layer (lib/core) over a
// recorded or synthetic flight and prints a CSV timeline plus every cue.
//
//   build/sim --synthetic                 scripted thermal (same as the tests)
//   build/sim flight.igc                  replay an IGC track (1 Hz typical)
//   build/sim --xct capture.txt           replay a BLE capture: "<ms> <sentence>" per line
//   options: --mc 1.5   --auto-mc   --csv   (CSV every second to stdout)
//
// IGC caveat: 1 Hz positions and integer-metre altitude make the vario coarse;
// the advisor and wind logic are what's worth evaluating on IGC data.
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>

#include "flight_computer.h"
#include "nmea.h"
#include "sensors.h"
#include "synth_flight.h"

using namespace pg;

namespace {

bool gCsv = false;

const char* adviceName(Advice a) {
  return a == Advice::Stay ? "STAY" : a == Advice::Glide ? "GLIDE" : "-";
}

void header() {
  if (gCsv)
    std::printf("t_s,alt_m,vario,avg20,netto,circling,turn_dps,wind_kmh,wind_from,mc,advice,"
                "circle_climb,thermal_avg,stf_kmh\n");
}

void report(FlightComputer& fc, TimeMs t, const Outputs& o, TimeMs& lastRow) {
  const Status& s = fc.status();
  if (o.alertStarted == Alert::Stay || o.alertStarted == Alert::Glide) {
    std::fprintf(gCsv ? stderr : stdout,
                 "%7.1f s  %-5s  alt %6.0f  vario %+5.1f  circle %+4.1f  thermal %+4.1f  mc %.1f\n",
                 t / 1000.0, o.alertStarted == Alert::Stay ? "STAY" : "GLIDE", s.altitude, s.vario,
                 s.advisor.circleClimb, s.advisor.thermalAvg, s.advisor.mc);
  }
  if (gCsv && t - lastRow >= 1000) {
    lastRow = t;
    std::printf("%.1f,%.1f,%.2f,%.2f,%.2f,%d,%.1f,%.1f,%.0f,%.2f,%s,%.2f,%.2f,%.0f\n", t / 1000.0,
                s.altitude, s.vario, s.avg, s.netto, s.circling ? 1 : 0, s.turnRate,
                s.wind.valid ? s.wind.speed * 3.6 : 0.0, s.wind.fromDeg, s.advisor.mc,
                adviceName(s.advisor.advice), s.advisor.circleClimb, s.advisor.thermalAvg, s.stf);
  }
}

void summary(FlightComputer& fc) {
  const Status& s = fc.status();
  std::fprintf(stderr, "\nend: alt %.0f m, thermals counted %d, MC %.2f", s.altitude,
               fc.advisor().thermalCount(), fc.advisor().mc());
  if (s.wind.valid)
    std::fprintf(stderr, ", wind %.1f km/h from %.0f° (q %.2f)", s.wind.speed * 3.6, s.wind.fromDeg,
                 s.wind.quality);
  std::fprintf(stderr, "\n");
}

int runSynthetic(FlightComputer& fc) {
  synth::Flight fl(synth::defaultScript());
  TimeMs lastRow = 0;
  header();
  while (!fl.done()) {
    fl.step(fc);
    report(fc, fl.now(), fc.tick(fl.now()), lastRow);
  }
  summary(fc);
  return 0;
}

// --- IGC -----------------------------------------------------------------

bool parseB(const char* l, int& sec, double& lat, double& lon, int& palt, int& galt) {
  // B HHMMSS DDMMmmmN DDDMMmmmE V PPPPP GGGGG
  if (l[0] != 'B' || std::strlen(l) < 35) return false;
  auto n = [&](int off, int len) {
    int v = 0;
    for (int i = 0; i < len; ++i) {
      const char c = l[off + i];
      if (c < '0' || c > '9') return -1;
      v = v * 10 + (c - '0');
    }
    return v;
  };
  const int hh = n(1, 2), mm = n(3, 2), ss = n(5, 2);
  const int latD = n(7, 2), latM = n(9, 5), lonD = n(15, 3), lonM = n(18, 5);
  if (hh < 0 || latD < 0 || lonD < 0) return false;
  sec = hh * 3600 + mm * 60 + ss;
  lat = latD + latM / 60000.0;
  if (l[14] == 'S') lat = -lat;
  lon = lonD + lonM / 60000.0;
  if (l[23] == 'W') lon = -lon;
  const bool neg = l[25] == '-';
  palt = n(neg ? 26 : 25, neg ? 4 : 5);
  if (neg) palt = -palt;
  galt = n(30, 5);
  return l[24] == 'A';
}

int runIgc(FlightComputer& fc, const char* path) {
  FILE* f = std::fopen(path, "r");
  if (!f) {
    std::perror(path);
    return 1;
  }
  char line[256];
  int t0 = -1, lastSec = -1;
  double lastLat = 0, lastLon = 0;
  bool usePressure = true;
  TimeMs lastRow = 0, now = 0;
  header();
  while (std::fgets(line, sizeof line, f)) {
    int sec, palt, galt;
    double lat, lon;
    if (!parseB(line, sec, lat, lon, palt, galt)) continue;
    if (t0 < 0) {
      t0 = sec;
      usePressure = palt != 0;
    }
    if (sec < lastSec) sec += 86400;  // UTC midnight rollover
    const TimeMs t = static_cast<TimeMs>(sec - t0) * 1000;

    BaroSample b;
    b.t = t;
    b.pressurePa = altitudeToPressure(static_cast<float>(usePressure ? palt : galt));
    b.valid = true;
    // Step the clock through the second at 50 Hz so tick() timing is realistic.
    while (now + 20 < t) {
      now += 20;
      report(fc, now, fc.tick(now), lastRow);
    }
    fc.onBaro(b);

    if (lastSec >= 0 && sec > lastSec) {
      const double dt = sec - lastSec;
      const double dN = (lat - lastLat) * 111194.9;
      const double dE = (lon - lastLon) * 111194.9 * std::cos(lat * kDegToRad);
      GnssFix g;
      g.t = t;
      g.lat = lat;
      g.lon = lon;
      g.altMsl = static_cast<float>(galt);
      g.velN = static_cast<float>(dN / dt);
      g.velE = static_cast<float>(dE / dt);
      g.groundSpeed = std::hypot(g.velN, g.velE);
      g.trackDeg = std::fmod(std::atan2(g.velE, g.velN) * kRadToDeg + 360.0f, 360.0f);
      g.fix = FixType::Fix3D;
      fc.onGnss(g);
    }
    lastSec = sec;
    lastLat = lat;
    lastLon = lon;
    now = t;
    report(fc, now, fc.tick(now), lastRow);
  }
  std::fclose(f);
  summary(fc);
  return 0;
}

// --- XCTracer BLE capture --------------------------------------------------

int runXct(FlightComputer& fc, const char* path) {
  FILE* f = std::fopen(path, "r");
  if (!f) {
    std::perror(path);
    return 1;
  }
  char line[256];
  TimeMs lastRow = 0, now = 0;
  int bad = 0, good = 0;
  header();
  while (std::fgets(line, sizeof line, f)) {
    char* sp = std::strchr(line, ' ');
    if (!sp) continue;
    const TimeMs t = static_cast<TimeMs>(std::strtoul(line, nullptr, 10));
    char* sent = sp + 1;
    sent[std::strcspn(sent, "\r\n")] = 0;
    while (now + 20 < t) {
      now += 20;
      report(fc, now, fc.tick(now), lastRow);
    }
    Lk8ex1 lk;
    Xctrc xc;
    if (parseLk8ex1(sent, lk)) {
      ++good;
      if (lk.hasPressure) {
        BaroSample b;
        b.t = t;
        b.pressurePa = lk.pressurePa;
        b.valid = true;
        fc.onBaro(b, BaroOrigin::XcTracer);
      } else if (lk.hasAltitude) {
        fc.onAltitude(t, lk.altitude, BaroOrigin::XcTracer);
      }
    } else if (parseXctrc(sent, xc)) {
      ++good;
      if (xc.rawPressure > 0) {
        BaroSample b;
        b.t = t;
        b.pressurePa = xc.rawPressure;
        b.valid = true;
        fc.onBaro(b, BaroOrigin::XcTracer);
      }
      if (xc.hasFix) {
        GnssFix g;
        g.t = t;
        g.lat = xc.lat;
        g.lon = xc.lon;
        g.altMsl = xc.altitude;
        g.groundSpeed = xc.speedKmh / 3.6f;
        g.trackDeg = xc.course;
        g.fix = FixType::Fix3D;
        fc.onGnss(g);
      }
    } else {
      ++bad;
    }
    now = t;
    report(fc, now, fc.tick(now), lastRow);
  }
  std::fclose(f);
  std::fprintf(stderr, "sentences: %d parsed, %d rejected\n", good, bad);
  summary(fc);
  return 0;
}

}  // namespace

int main(int argc, char** argv) {
  FlightComputerConfig cfg;
  cfg.advisor.autoMc = false;
  const char* igc = nullptr;
  const char* xct = nullptr;
  bool synthetic = false;
  for (int i = 1; i < argc; ++i) {
    if (!std::strcmp(argv[i], "--synthetic")) synthetic = true;
    else if (!std::strcmp(argv[i], "--csv")) gCsv = true;
    else if (!std::strcmp(argv[i], "--auto-mc")) cfg.advisor.autoMc = true;
    else if (!std::strcmp(argv[i], "--mc") && i + 1 < argc) cfg.advisor.mc = std::strtof(argv[++i], nullptr);
    else if (!std::strcmp(argv[i], "--xct") && i + 1 < argc) xct = argv[++i];
    else if (argv[i][0] != '-') igc = argv[i];
    else {
      std::fprintf(stderr, "unknown option %s\n", argv[i]);
      return 2;
    }
  }
  FlightComputer fc(cfg);
  if (synthetic) return runSynthetic(fc);
  if (xct) return runXct(fc, xct);
  if (igc) return runIgc(fc, igc);
  std::fprintf(stderr, "usage: sim --synthetic | sim [--mc X] [--auto-mc] [--csv] flight.igc | sim --xct capture.txt\n");
  return 2;
}
