#include "screens.h"

#include <cmath>
#include <cstdio>

namespace pg::display {

using gfx::Align;
using gfx::Canvas;
using gfx::kFontHuge;
using gfx::kFontLarge;
using gfx::kFontMedium;
using gfx::kFontSmall;
using gfx::kFontTiny;

const char* pageName(Page p) {
  switch (p) {
    case Page::Flight: return "FLIGHT";
    case Page::Info: return "INFO";
    case Page::Profile: return "PROFILE";
    default: return "";
  }
}

// ---------------------------------------------------------------- model

void Model::update(TimeMs t, const Status& s) {
  if (lastSample_ && t - lastSample_ < 1000) return;
  lastSample_ = t;
  ++n_;
  const int gi = (gHead_ + gN_) % kGlideN;
  gAlt_[gi] = s.altitude;
  gLat_[gi] = s.pos.lat;
  gLon_[gi] = s.pos.lon;
  gBad_[gi] = s.circling || !s.pos.valid || s.pos.deadReckoned;
  if (gN_ < kGlideN) ++gN_;
  else gHead_ = (gHead_ + 1) % kGlideN;
}

void Model::noteAlert(Alert a, TimeMs t) {
  switch (a) {
    case Alert::NearBase: case Alert::Inversion: case Alert::Message: case Alert::GpsLost:
    case Alert::GpsBack: case Alert::Stay: case Alert::Glide: case Alert::FinalGlide: case Alert::Turnpoint:
      banner_ = a;
      bannerT_ = t;
      break;
    default: break;
  }
}

Alert Model::banner(TimeMs t) const {
  const TimeMs hold =
      banner_ == Alert::Stay || banner_ == Alert::Glide || banner_ == Alert::FinalGlide ? 15000 : 10000;
  return banner_ != Alert::None && t - bannerT_ < hold ? banner_ : Alert::None;
}

bool Model::glideRatio(float& ld) const {
  if (gN_ < kGlideN) return false;
  for (int i = 0; i < gN_; ++i)
    if (gBad_[(gHead_ + i) % kGlideN]) return false;
  const int a = gHead_, b = (gHead_ + gN_ - 1) % kGlideN;
  const double dN = (gLat_[b] - gLat_[a]) * 111195.0;
  const double dE = (gLon_[b] - gLon_[a]) * 111195.0 * std::cos(gLat_[a] * 0.0174533);
  const float loss = gAlt_[a] - gAlt_[b];
  if (loss < 3.0f) {
    ld = 99.0f;  // climbing or level
    return true;
  }
  ld = static_cast<float>(std::sqrt(dN * dN + dE * dE) / loss);
  return true;
}

// ---------------------------------------------------------------- helpers

namespace {

constexpr float kD2R = 0.0174533f;

void fmtSigned(char* b, size_t n, float v) {
  if (std::fabs(v) < 0.05f) v = 0.0f;
  std::snprintf(b, n, "%+.1f", static_cast<double>(v));
}
void fmtKm(char* b, size_t n, float m) {
  if (m < 1000) std::snprintf(b, n, "%.0f m", static_cast<double>(m));
  else std::snprintf(b, n, "%.1f km", static_cast<double>(m / 1000));
}

// Screen point at `angle` (deg, 0 = up, clockwise) and radius r from (cx, cy).
void polar(int cx, int cy, float angle, float r, int& x, int& y) {
  x = cx + static_cast<int>(std::lround(r * std::sin(angle * kD2R)));
  y = cy - static_cast<int>(std::lround(r * std::cos(angle * kD2R)));
}

void arrow(Canvas& c, int cx, int cy, float angle, float r0, float r1, int thick, int head) {
  int x0, y0, x1, y1, xb, yb;
  polar(cx, cy, angle, r0, x0, y0);
  polar(cx, cy, angle, r1, x1, y1);
  polar(cx, cy, angle, r1 - head * 1.6f, xb, yb);
  c.line(x0, y0, xb, yb, true, thick);
  int xl, yl, xr, yr;
  polar(xb, yb, angle - 90, static_cast<float>(head), xl, yl);
  polar(xb, yb, angle + 90, static_cast<float>(head), xr, yr);
  c.fillTriangle(x1, y1, xl, yl, xr, yr);
}

void glider(Canvas& c, int x, int y, float angle, int s) {
  int x0, y0, x1, y1, x2, y2;
  polar(x, y, angle, static_cast<float>(s), x0, y0);
  polar(x, y, angle + 140, static_cast<float>(s), x1, y1);
  polar(x, y, angle - 140, static_cast<float>(s), x2, y2);
  c.fillTriangle(x0, y0, x1, y1, x2, y2);
}

void dottedCircle(Canvas& c, int cx, int cy, int r, int stepDeg) {
  for (int a = 0; a < 360; a += stepDeg) {
    int x, y;
    polar(cx, cy, static_cast<float>(a), static_cast<float>(r), x, y);
    c.pixel(x, y);
    c.pixel(x + 1, y);
  }
}

void label(Canvas& c, int x, int y, const char* s, Align a = Align::Left) { c.text(x, y, s, kFontTiny, a); }

// Label over a value, right-aligned value.
void row(Canvas& c, int x0, int x1, int y, const char* name, const char* val) {
  label(c, x0, y, name);
  c.text(x1, y + 8, val, kFontMedium, Align::Right);
}

void statusBar(Canvas& c, const Status& s, const DeviceInfo& d, TimeMs t) {
  c.fillRect(0, 0, gfx::kWidth, 16);
  char b[64];
  int x = 4;
  if (d.clockMin >= 0) {
    std::snprintf(b, sizeof b, "%02d:%02d", d.clockMin / 60 % 24, d.clockMin % 60);
    x += c.text(x, 2, b, kFontTiny, Align::Left, false) + 10;
  }
  if (d.flightMin >= 0) {
    std::snprintf(b, sizeof b, "%d:%02d", d.flightMin / 60, d.flightMin % 60);
    c.text(x, 2, b, kFontTiny, Align::Left, false);
  }
  // GPS: quiet when fine, loud (inverted, centred) when not.
  if (s.gps == GpsState::Lost || s.gps == GpsState::Spoofed) {
    const int mins = static_cast<int>((t - s.gpsSince) / 60000);
    if (s.pos.valid) {
      char e[16];
      fmtKm(e, sizeof e, s.pos.errorM);
      std::snprintf(b, sizeof b, "GPS %s %d' - est. ~%s", s.gps == GpsState::Spoofed ? "SPOOFED" : "LOST", mins, e);
    } else {
      std::snprintf(b, sizeof b, "GPS %s %d'", s.gps == GpsState::Spoofed ? "SPOOFED" : "LOST", mins);
    }
    const int w = Canvas::textWidth(b, kFontTiny) + 12;
    c.fillRect(200 - w / 2, 1, w, 14, false);
    c.text(200, 2, b, kFontTiny, Align::Center, true);
  } else if (s.gps == GpsState::NoData) {
    // In the air with nothing yet is jamming, not a cold start.
    c.text(200, 2, d.flightMin >= 1 ? "NO GPS - gyro + baro" : "GPS searching", kFontTiny, Align::Center, false);
  } else {
    std::snprintf(b, sizeof b, "GPS %u", s.gnss.sats);
    c.text(200, 2, b, kFontTiny, Align::Center, false);
  }
  int r = 396;
  if (d.batteryPct >= 0) {
    c.rect(r - 20, 4, 18, 9, false);
    c.fillRect(r - 2, 6, 2, 5, false);
    c.fillRect(r - 18, 6, (14 * (d.batteryPct > 100 ? 100 : d.batteryPct)) / 100, 5, false);
    std::snprintf(b, sizeof b, "%d%%", d.batteryPct);
    r -= 24;
    r -= c.text(r, 2, b, kFontTiny, Align::Right, false) + 8;
  }
  if (s.muted) r -= c.text(r, 2, "MUTE", kFontTiny, Align::Right, false) + 8;
  if (d.simulated) c.text(r, 2, "SIM", kFontTiny, Align::Right, false);
}

// Bottom banner: cue events, then GPS trouble.
bool bannerArea(Canvas& c, const Status& s, const Model& m, TimeMs t) {
  char b[64], b2[32];
  const char* big = nullptr;
  const char* small = b;
  b[0] = 0;
  switch (m.banner(t)) {
    case Alert::Stay:
      if (s.advisor.advice != Advice::Stay) break;
      big = "STAY";
      fmtSigned(b2, sizeof b2, s.circling ? s.advisor.circleClimb : s.advisor.expectedClimb);
      std::snprintf(b, sizeof b, "%s %s", s.circling ? "circle" : "expect", b2);
      break;
    case Alert::Glide:
      if (s.advisor.advice != Advice::Glide) break;
      big = "GLIDE";
      fmtSigned(b2, sizeof b2, s.advisor.circleClimb);
      // Why: the climb fell below MC, or something better than climbing on.
      if (s.leave == LeaveReason::Base) std::snprintf(b, sizeof b, "at cloud base");
      else if (s.leave == LeaveReason::Better && s.best.live)
        std::snprintf(b, sizeof b, "pilot %+.1f, %.1f km", static_cast<double>(s.best.liveClimb),
                      static_cast<double>(s.best.distM / 1000));
      else std::snprintf(b, sizeof b, "circle %s < MC %.1f", b2, static_cast<double>(s.advisor.mc));
      break;
    case Alert::FinalGlide:
      big = "FINAL GLIDE";
      std::snprintf(b, sizeof b, "%+.0f m", static_cast<double>(s.task.finalSurplus));
      break;
    case Alert::Turnpoint:
      big = "TURNPOINT";
      std::snprintf(b, sizeof b, "next %s", s.task.nextName);
      break;
    case Alert::NearBase:
      big = "CLOUD BASE";
      std::snprintf(b, sizeof b, "%+.0f m", static_cast<double>(s.air.cloudBase - s.altitude));
      break;
    case Alert::Inversion: big = "INVERSION"; small = "top of lift"; break;
    case Alert::Message: big = "MESSAGE"; small = "FANET"; break;
    case Alert::GpsLost: big = "GPS LOST"; small = "vario + assist fine"; break;
    case Alert::GpsBack: big = "GPS OK"; small = "position trusted again"; break;
    default: break;
  }
  if (!big) return false;
  c.fillRect(0, 206, 400, 34);
  c.text(10, 206, big, kFontLarge, Align::Left, false);
  c.text(392, 214, small, kFontSmall, Align::Right, false);
  return true;
}

// Wind arrow relative to your heading: shows which way the air carries you.
void windSmall(Canvas& c, int cx, int cy, const Status& s) {
  if (!s.headingValid) return;  // can't point a wind arrow without north
  if (!s.wind.valid) {
    label(c, cx - 4, cy - 6, "--");
    return;
  }
  const float to = s.wind.fromDeg + 180.0f - (s.headingValid ? s.heading : 0.0f);
  c.circle(cx, cy, 12);
  arrow(c, cx, cy, to, -9, 11, 2, 4);
  char b[16];
  std::snprintf(b, sizeof b, "%.0f", static_cast<double>(s.wind.speed * 3.6f));
  label(c, cx + 16, cy - 6, b);
}

// ---------------------------------------------------------------- pages

void pageThermal(Canvas& c, const Status& s, const Model& m, TimeMs t) {
  char b[64], b2[32];
  const AssistView& a = s.assist;
  const int cx = 116, cy = 122, R = 84;
  // Heading-up in the assistant's gyro frame; north only when it's known.
  const float hdg = s.assistHeading;

  dottedCircle(c, cx, cy, R, 6);
  // North tick, so a heading-up view still has a reference.
  int nx, ny;
  // (skipped where the glider marker sits, at 90° to the side of the turn)
  if (s.headingValid && (!a.active || std::fabs(angleDiffDeg(-90.0f * a.dir, -hdg)) > 25.0f)) {
    polar(cx, cy, -hdg, R + 9, nx, ny);
    c.text(nx, ny - 6, "N", kFontTiny, Align::Center);
  }

  if (a.active) {
    for (int i = 0; i < 36; ++i) {
      if (!a.have[i]) continue;
      const float onCircle = i * 10.0f + 5.0f - 90.0f * a.dir - hdg;
      int x, y;
      polar(cx, cy, onCircle, static_cast<float>(R), x, y);
      const float l = a.lift[i];
      if (l > 0.1f) {
        int r = static_cast<int>(2 + l * 2.6f);
        if (r > 11) r = 11;
        c.fillCircle(x, y, r);
      } else {
        c.circle(x, y, 3);
      }
    }
    // You, heading up, on your side of the circle.
    int gx, gy;
    polar(cx, cy, -90.0f * a.dir, static_cast<float>(R), gx, gy);
    c.fillCircle(gx, gy, 9, false);
    glider(c, gx, gy, 0, 8);
    const TurnView& tv = s.turn;
    const float pxPerM = tv.myRadius > 5 ? R / tv.myRadius : 0;
    if (tv.fit.valid && pxPerM > 0) {
      // The thermal as fitted: its core (+) and its 1/e size, to the scale of
      // your circle. You see whether you're on it and how big it is.
      int kx, ky;
      polar(cx, cy, tv.coreBearing - hdg, tv.coreDist * pxPerM, kx, ky);
      const int kr = static_cast<int>(tv.fit.radius * pxPerM);
      if (kr < 160) dottedCircle(c, kx, ky, kr, kr > 60 ? 4 : 8);
      c.line(kx - 6, ky, kx + 6, ky, true, 2);
      c.line(kx, ky - 6, kx, ky + 6, true, 2);
      if (tv.advice == TurnAdvice::Move) arrow(c, cx, cy, tv.coreBearing - hdg, 30, R - 14.0f, 4, 8);
    } else if (a.strength > 0.15f) {
      arrow(c, cx, cy, a.coreDeg - hdg, 30, 36 + a.strength * (R - 48), 4, 8);  // starts clear of the number
    }
    // Other pilots in the thermal (their climb in tenths), when we know north.
    if (s.headingValid && pxPerM > 0) {
      for (int i = 0; i < s.nearCount; ++i) {
        const NearPilot& np = s.near[i];
        const float d = std::sqrt(np.north * np.north + np.east * np.east) * pxPerM;
        if (d > R + 20) continue;
        int px, py;
        polar(cx, cy, std::atan2(np.east, np.north) / kD2R - s.heading, d, px, py);
        c.circle(px, py, 4);
        std::snprintf(b, sizeof b, "%+.1f", static_cast<double>(np.climb));
        label(c, px + 6, py - 6, b);
      }
    }
    fmtSigned(b, sizeof b, s.advisor.thermalAvg);
    c.text(cx, cy + 10, b, kFontMedium, Align::Center);
    // What to do: one word, plus the number that goes with it.
    const char* word = nullptr;
    b2[0] = 0;
    switch (tv.advice) {
      case TurnAdvice::Move:
        word = tv.moveNow ? "STRAIGHTEN" : "MOVE";
        std::snprintf(b2, sizeof b2, tv.moveNow ? "%.0f s" : "%.0f m", tv.moveNow ? static_cast<double>(tv.moveSeconds)
                                                                                  : static_cast<double>(tv.coreDist));
        break;
      case TurnAdvice::Tighten:
      case TurnAdvice::Widen:
        word = tv.advice == TurnAdvice::Tighten ? "TIGHTEN" : "WIDEN";
        std::snprintf(b2, sizeof b2, "bank %.0f\x7f > %.0f\x7f  %+.1f", static_cast<double>(tv.bankNow),
                      static_cast<double>(tv.bankBest), static_cast<double>(tv.gain));
        break;
      case TurnAdvice::Good: word = "CENTRED"; break;
      default: break;
    }
    if (word) {
      const bool loud = tv.advice != TurnAdvice::Good;
      const int w = Canvas::textWidth(word, kFontSmall) + 14;
      if (loud) c.fillRect(cx - w / 2, cy + 34, w, 18);
      c.text(cx, cy + 35, word, kFontSmall, Align::Center, !loud);
      if (b2[0]) c.text(cx, cy + 54, b2, kFontTiny, Align::Center);
    }
  } else {
    c.text(cx, cy - 8, s.assistHeadingValid ? "assistant" : "no heading", kFontSmall, Align::Center);
    c.text(cx, cy + 8, s.assistHeadingValid ? "maps the lift" : "(needs IMU or GPS)", kFontTiny, Align::Center);
  }
  windSmall(c, 18, 34, s);

  // Right column: vario, average, then the heights that matter in a climb.
  fmtSigned(b, sizeof b, s.vario);
  c.text(398, 14, b, kFontHuge, Align::Right);
  fmtSigned(b2, sizeof b2, s.avg);
  std::snprintf(b, sizeof b, "avg %s", b2);
  c.text(398, 82, b, kFontMedium, Align::Right);
  if (s.circling && std::fabs(s.advisor.thermalGain) >= 0.5f) {
    std::snprintf(b, sizeof b, "gain %+.0f", static_cast<double>(s.advisor.thermalGain));
    label(c, 232, 88, b);
  }
  c.hline(228, 110, 172);
  std::snprintf(b, sizeof b, "%.0f", static_cast<double>(s.altMsl));
  row(c, 232, 398, 114, "ALT m", b);
  if (s.aglValid) std::snprintf(b, sizeof b, "%.0f", static_cast<double>(s.agl));
  else std::snprintf(b, sizeof b, "--");
  row(c, 232, 398, 144, "AGL m", b);
  // "~" until a thermal top has confirmed the estimate.
  if (s.air.baseValid)
    std::snprintf(b, sizeof b, "%s%+.0f", s.air.baseFromThermal ? "" : "~", static_cast<double>(s.air.cloudBase - s.altitude));
  else std::snprintf(b, sizeof b, "--");
  row(c, 232, 398, 174, "TO BASE m", b);
  bannerArea(c, s, m, t);
}

void pageGlide(Canvas& c, const Status& s, const Model& m, TimeMs t) {
  char b[64], b2[32];
  const float hdg = s.headingValid ? s.heading : 0.0f;
  const int cx = 112, cy = 132, R = 62;
  const bool onTask = s.task.active && !s.task.finished;
  // Where to go: the next turnpoint on a task; else a live thermal (another
  // pilot climbing), a likely thermal (history × today), or home.
  const Target& tg = s.best.valid ? s.best : s.home;
  if (onTask) {
    std::snprintf(b, sizeof b, "TP %d %s", s.task.next + 1, s.task.nextName);
    label(c, 8, 20, b);
    fmtKm(b2, sizeof b2, s.task.nextDist);
    // Goal height only once it's near: far out, it's just a big negative number.
    if (s.task.finalValid && s.task.finalSurplus > -500)
      std::snprintf(b, sizeof b, "%s  goal %+.0f", b2, static_cast<double>(s.task.finalSurplus));
    else
      std::snprintf(b, sizeof b, "%s", b2);
    c.text(8, 30, b, kFontMedium);
  } else {
    // What it is (another pilot, history, today's sun on the terrain), and
    // how far downwind of its trigger the climb is at the height you'll arrive.
    if (s.best.valid && s.best.live)
      std::snprintf(b2, sizeof b2, "PILOT %+.1f  %d'", static_cast<double>(s.best.liveClimb), s.best.ageMin);
    else if (s.best.valid)
      std::snprintf(b2, sizeof b2, "%s %.0f%%", s.best.kind == TargetKind::Sun ? "SUN" : "THERMAL",
                    static_cast<double>(s.best.chance * 100));
    else std::snprintf(b2, sizeof b2, s.home.valid ? "HOME" : "NO TARGET");
    if (s.best.valid && s.best.driftM >= 300)
      std::snprintf(b, sizeof b, "%s - %.1f km downwind", b2, static_cast<double>(s.best.driftM / 1000));
    else std::snprintf(b, sizeof b, "%s", b2);
    label(c, 8, 20, b);
    if (tg.valid && s.pos.valid) {
      fmtKm(b2, sizeof b2, tg.distM);
      if (tg.arrivalAgl > -9000) std::snprintf(b, sizeof b, "%s  %+.0f m", b2, static_cast<double>(tg.arrivalAgl));
      else std::snprintf(b, sizeof b, "%s  out of reach", b2);
      c.text(8, 30, b, kFontMedium);
    }
  }
  dottedCircle(c, cx, cy, R, 8);
  c.fillTriangle(cx, cy - R - 6, cx - 6, cy - R + 4, cx + 6, cy - R + 4);  // your heading
  int nx, ny;
  polar(cx, cy, -hdg, R + 10, nx, ny);
  c.text(nx, ny - 6, "N", kFontTiny, Align::Center);
  if (onTask && s.pos.valid && s.headingValid) {
    arrow(c, cx, cy, s.task.nextBearing - hdg, -R * 0.55f, R - 8.0f, 5, 10);
    if (s.best.valid) arrow(c, cx, cy, s.best.bearingDeg - hdg, 0, R - 16.0f, 1, 6);  // thermal on the way
    if (s.task.finalValid && s.task.finalSurplus >= 0) {
      std::snprintf(b, sizeof b, "FINAL GLIDE  MC %.1f", static_cast<double>(s.task.finalMc));
      c.text(cx, cy + R + 8, b, kFontSmall, Align::Center);
    }
  } else if (tg.valid && s.pos.valid) {
    arrow(c, cx, cy, tg.bearingDeg - hdg, -R * 0.55f, R - 8.0f, 5, 10);
    // Short of it at best glide in this wind: how much height you still need.
    if (tg.arrivalAgl < 0 && tg.arrivalAgl > -9000) {
      std::snprintf(b, sizeof b, "NEED +%.0f m", static_cast<double>(-tg.arrivalAgl));
      c.text(cx, cy + R + 8, b, kFontSmall, Align::Center);
    }
  } else {
    c.text(cx, cy - 8, s.pos.valid ? "no target" : "no position", kFontSmall, Align::Center);
  }
  if (s.pos.deadReckoned && s.pos.valid) {
    fmtKm(b2, sizeof b2, s.pos.errorM);
    std::snprintf(b, sizeof b, "estimated ~%s", b2);
    c.text(cx, cy + R + 24, b, kFontTiny, Align::Center);
  }

  // Right column.
  fmtSigned(b, sizeof b, s.vario);
  c.text(398, 16, b, kFontLarge, Align::Right);
  fmtSigned(b2, sizeof b2, s.avg);
  std::snprintf(b, sizeof b, "avg %s", b2);
  c.text(398, 52, b, kFontSmall, Align::Right);
  c.hline(232, 74, 168);
  if (s.aglValid) std::snprintf(b, sizeof b, "%.0f", static_cast<double>(s.agl));
  else std::snprintf(b, sizeof b, "%.0f", static_cast<double>(s.altMsl));
  row(c, 236, 398, 78, s.aglValid ? "AGL m" : "ALT m", b);
  float ld;
  if (m.glideRatio(ld)) std::snprintf(b, sizeof b, ld >= 99 ? "--" : "%.1f", static_cast<double>(ld));
  else std::snprintf(b, sizeof b, "...");
  row(c, 236, 398, 108, "L/D", b);
  // Speed bar: the MacCready speed for this air and headwind, in quarters,
  // capped near the ground and in turbulence.
  const float bar = s.xc.bar;
  const char* bv = bar <= 0 ? (s.xc.slow ? "SLOW" : "OFF") : bar < 0.3f ? "1/4" : bar < 0.6f ? "1/2" : bar < 0.9f ? "3/4" : "FULL";
  if (s.xc.barLimit == BarLimit::Low || s.xc.barLimit == BarLimit::Turbulence)
    std::snprintf(b2, sizeof b2, "BAR  %s", barLimitName(s.xc.barLimit));
  else
    std::snprintf(b2, sizeof b2, "BAR  MC %.1f", static_cast<double>(s.xc.mc));
  row(c, 236, 398, 138, b2, bv);
  label(c, 236, 170, "WIND");
  windSmall(c, 286, 186, s);
  bannerArea(c, s, m, t);
}

// The day by altitude: climb found (bars), wind (arrows, north up), and air
// temperature / dew point, for each height band flown through.
void pageProfile(Canvas& c, const Status& s) {
  char b[32];
  const Profile* pr = s.profile;
  if (!pr || pr->highest() < 0) {
    c.text(200, 100, "PROFILE", kFontMedium, Align::Center);
    c.text(200, 130, "builds as you climb and glide", kFontSmall, Align::Center);
    return;
  }
  int lo = pr->lowest(), hi = pr->highest();
  const int ceilBand = s.ceilingValid ? static_cast<int>(s.ceilingMsl / Profile::kBandM) : -1;
  if (ceilBand > hi && ceilBand < Profile::kBands) hi = ceilBand;
  const int group = (hi - lo + 1) > 22 ? 2 : 1;  // rows of 100 or 200 m
  const int rows = (hi - lo) / group + 1;
  const int top = 22, bottom = 200;
  const int rh = (bottom - top) / (rows > 0 ? rows : 1) > 16 ? 16 : (bottom - top) / (rows > 0 ? rows : 1);
  label(c, 4, top - 2, "m");
  label(c, 96, top - 2, "climb");
  label(c, 236, top - 2, "wind");
  label(c, 316, top - 2, "air/dew");
  int lastText = -100;  // keep text rows at least 11 px apart
  for (int r = 0; r < rows; ++r) {
    const int b0 = hi - r * group;
    const int y = top + 10 + r * rh;
    float climb = 0, wn = 0, we = 0, temp = 0, dew = 0;
    int nc = 0, nw = 0, na = 0;
    for (int g = 0; g < group && b0 - g >= 0; ++g) {
      const ProfileBand& pb = pr->band(b0 - g);
      if (pb.nClimb) climb += pb.climb, ++nc;
      if (pb.nWind) wn += pb.windN, we += pb.windE, ++nw;
      if (pb.nAir) temp += pb.temp, dew += pb.dew, ++na;
    }
    const bool text = y - lastText >= 11;
    if (text && (r % 2 == 0 || rh >= 12)) {
      std::snprintf(b, sizeof b, "%d", b0 * 100);
      label(c, 4, y, b);
    }
    bool wrote = false;
    if (nc) {
      climb /= nc;
      int w = static_cast<int>(climb * 30);
      if (w > 120) w = 120;
      if (w > 0) c.fillRect(96, y + 2, w, rh > 4 ? rh - 3 : 2);
      else c.hline(96, y + rh / 2, 3);
      std::snprintf(b, sizeof b, "%.1f", static_cast<double>(climb));
      if (rh >= 10) label(c, 100 + (w > 0 ? w : 0) + 2, y, b);
    }
    if (nw) {
      wn /= nw;
      we /= nw;
      const float spd = std::sqrt(wn * wn + we * we);
      // Arrow shows where the air goes (north up).
      if (text) {
        if (spd > 0.5f) arrow(c, 248, y + 5, std::atan2(we, wn) / kD2R, -6, 6, 1, 3);
        std::snprintf(b, sizeof b, "%.0f", static_cast<double>(spd * 3.6f));
        label(c, 260, y, b);
        wrote = true;
      }
    }
    if (na && text) {
      std::snprintf(b, sizeof b, "%.0f/%.0f", static_cast<double>(temp / na), static_cast<double>(dew / na));
      label(c, 316, y, b);
      wrote = true;
    }
    if (wrote) {
      lastText = y;
      if (!(text && (r % 2 == 0 || rh >= 12))) {  // data rows always get their height
        std::snprintf(b, sizeof b, "%d", b0 * 100);
        label(c, 4, y, b);
      }
    }
    if (b0 == ceilBand) c.text(392, y, "BASE", kFontTiny, Align::Right);
  }
  // You are here.
  const int me = static_cast<int>(s.altMsl / Profile::kBandM);
  if (me >= lo && me <= hi) {
    const int y = top + 10 + ((hi - me) / group) * rh + rh / 2;
    c.fillTriangle(82, y, 90, y - 5, 90, y + 5);
  }
  c.hline(0, 204, 400);
  c.text(200, 214, "PROFILE  -  Page returns to flight", kFontSmall, Align::Center);
}

void pageInfo(Canvas& c, const Status& s, const DeviceInfo& d) {
  char b[64], b2[32];
  const int L0 = 8, L1 = 194, R0 = 208, R1 = 394;
  const AtmosphereState& a = s.air;
  if (a.baseValid)
    std::snprintf(b, sizeof b, "%.0f%s", static_cast<double>(a.cloudBase + (s.altMsl - s.altitude)),
                  a.baseFromThermal ? "" : "?");
  else std::snprintf(b, sizeof b, "--");
  row(c, L0, L1, 22, "CLOUD BASE m", b);
  if (a.lapseValid) {
    const char* st = a.stability == Stability::Unstable ? "unstable"
                     : a.stability == Stability::Moderate ? "moderate"
                     : a.stability == Stability::Stable ? "stable" : "inversion";
    std::snprintf(b, sizeof b, "%.1f %s", static_cast<double>(a.lapseRate), st);
  } else {
    std::snprintf(b, sizeof b, "--");
  }
  row(c, L0, L1, 58, "LAPSE \x7f" "C/km", b);
  if (a.haveAir) std::snprintf(b, sizeof b, "%.0f / %.0f", static_cast<double>(a.tempC), static_cast<double>(a.dewPointC));
  else std::snprintf(b, sizeof b, "--");
  row(c, L0, L1, 94, "AIR / DEW \x7f" "C", b);
  if (s.wind.valid)
    std::snprintf(b, sizeof b, "%.0f from %03.0f", static_cast<double>(s.wind.speed * 3.6f), static_cast<double>(s.wind.fromDeg));
  else std::snprintf(b, sizeof b, "--");
  row(c, L0, L1, 130, "WIND km/h", b);
  // Effective MC (band, XC/race, time of day) and what it's built from.
  std::snprintf(b, sizeof b, "%.1f (%.1f)", static_cast<double>(s.xc.mc), static_cast<double>(s.advisor.mcBase));
  row(c, L0, L1, 166, s.task.active && s.task.started ? "MC  race (base)" : "MC  XC (base)", b);

  if (s.home.valid && s.pos.valid) {
    fmtKm(b2, sizeof b2, s.home.distM);
    std::snprintf(b, sizeof b, "%s %+.0f", b2, static_cast<double>(s.home.arrivalAgl));
  } else {
    std::snprintf(b, sizeof b, "--");
  }
  row(c, R0, R1, 22, "HOME  dist / arrive", b);
  if (s.gps == GpsState::Ok) std::snprintf(b, sizeof b, "ok, %u sats", s.gnss.sats);
  else if (s.gps == GpsState::NoData) std::snprintf(b, sizeof b, "searching");
  else std::snprintf(b, sizeof b, "%s", gpsStateName(s.gps));
  row(c, R0, R1, 58, s.gps == GpsState::Lost || s.gps == GpsState::Spoofed ? gpsReasonName(s.gpsReason) : "GPS", b);
  std::snprintf(b, sizeof b, "%s", s.imu ? "gyro" : (s.headingValid ? "GPS track" : "--"));
  row(c, R0, R1, 94, "HEADING", b);
  if (d.flightMin >= 0) std::snprintf(b, sizeof b, "%d:%02d", d.flightMin / 60, d.flightMin % 60);
  else std::snprintf(b, sizeof b, "--");
  row(c, R0, R1, 130, "FLIGHT TIME", b);
  if (d.batteryPct >= 0) std::snprintf(b, sizeof b, "%d%%", d.batteryPct);
  else std::snprintf(b, sizeof b, "--");
  row(c, R0, R1, 166, "BATTERY", b);
  c.vline(200, 22, 176);
  c.hline(0, 204, 400);
  c.text(200, 214, "INFO  -  Page: profile", kFontSmall, Align::Center);
}

}  // namespace

void render(Canvas& c, Page p, const Status& s, const Model& m, const DeviceInfo& d, TimeMs t) {
  c.clear();
  statusBar(c, s, d, t);
  if (p == Page::Info) pageInfo(c, s, d);
  else if (p == Page::Profile) pageProfile(c, s);
  else if (s.circling) pageThermal(c, s, m, t);
  else pageGlide(c, s, m, t);
}

}  // namespace pg::display
