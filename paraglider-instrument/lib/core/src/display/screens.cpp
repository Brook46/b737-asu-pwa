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
    case Alert::GpsBack: case Alert::Stay: case Alert::Glide:
      banner_ = a;
      bannerT_ = t;
      break;
    default: break;
  }
}

Alert Model::banner(TimeMs t) const {
  const TimeMs hold = banner_ == Alert::Stay || banner_ == Alert::Glide ? 15000 : 10000;
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
      std::snprintf(b, sizeof b, "circle %s < MC %.1f", b2, static_cast<double>(s.advisor.mc));
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
    // Starts clear of the number in the middle.
    if (a.strength > 0.15f) arrow(c, cx, cy, a.coreDeg - hdg, 30, 36 + a.strength * (R - 48), 4, 8);
    fmtSigned(b, sizeof b, s.advisor.thermalAvg);
    c.text(cx, cy + 10, b, kFontMedium, Align::Center);
    if (a.straightenNow) {
      const int w = Canvas::textWidth("STRAIGHTEN", kFontSmall) + 14;
      c.fillRect(cx - w / 2, cy + 36, w, 18);
      c.text(cx, cy + 37, "STRAIGHTEN", kFontSmall, Align::Center, false);
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
  // Where to go: the best thermal by history and today's chances, else home.
  const Target& tg = s.best.valid ? s.best : s.home;
  const int cx = 112, cy = 132, R = 62;
  if (s.best.valid) std::snprintf(b, sizeof b, "THERMAL %.0f%%", static_cast<double>(s.best.chance * 100));
  else std::snprintf(b, sizeof b, s.home.valid ? "HOME" : "NO TARGET");
  label(c, 8, 20, b);
  if (tg.valid && s.pos.valid) {
    fmtKm(b2, sizeof b2, tg.distM);
    if (tg.arrivalAgl > -9000) std::snprintf(b, sizeof b, "%s  %+.0f m", b2, static_cast<double>(tg.arrivalAgl));
    else std::snprintf(b, sizeof b, "%s  out of reach", b2);
    c.text(8, 30, b, kFontMedium);
  }
  dottedCircle(c, cx, cy, R, 8);
  c.fillTriangle(cx, cy - R - 6, cx - 6, cy - R + 4, cx + 6, cy - R + 4);  // your heading
  int nx, ny;
  polar(cx, cy, -hdg, R + 10, nx, ny);
  c.text(nx, ny - 6, "N", kFontTiny, Align::Center);
  if (tg.valid && s.pos.valid) {
    arrow(c, cx, cy, tg.bearingDeg - hdg, -R * 0.55f, R - 8.0f, 5, 10);
    if (tg.arrivalAgl < 0) c.text(cx, cy + R + 10, "CAN'T REACH", kFontSmall, Align::Center);
  } else {
    c.text(cx, cy - 8, s.pos.valid ? "no target" : "no position", kFontSmall, Align::Center);
  }
  if (s.pos.deadReckoned && s.pos.valid) {
    fmtKm(b2, sizeof b2, s.pos.errorM);
    std::snprintf(b, sizeof b, "estimated ~%s", b2);
    c.text(cx, cy + R + 10, b, kFontTiny, Align::Center);
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
  // Speed to fly, with which way to go from where you are.
  std::snprintf(b, sizeof b, "%.0f", static_cast<double>(s.stf));
  row(c, 236, 398, 138, "STF km/h", b);
  const float diff = s.stf - s.airspeed * 3.6f;
  if (std::fabs(diff) > 3) {
    const int ax = 300, ay = 158;
    if (diff > 0) c.fillTriangle(ax, ay - 7, ax - 6, ay + 3, ax + 6, ay + 3);
    else c.fillTriangle(ax, ay + 7, ax - 6, ay - 3, ax + 6, ay - 3);
    label(c, ax + 9, ay - 6, diff > 0 ? "bar" : "slow");
  }
  label(c, 236, 170, "WIND");
  windSmall(c, 286, 186, s);
  bannerArea(c, s, m, t);
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
  std::snprintf(b, sizeof b, "%.1f%s", static_cast<double>(s.advisor.mc), "");
  row(c, L0, L1, 166, "MACCREADY", b);

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
  c.text(200, 214, "INFO  -  Page returns to flight", kFontSmall, Align::Center);
}

}  // namespace

void render(Canvas& c, Page p, const Status& s, const Model& m, const DeviceInfo& d, TimeMs t) {
  c.clear();
  statusBar(c, s, d, t);
  if (p == Page::Info) pageInfo(c, s, d);
  else if (s.circling) pageThermal(c, s, m, t);
  else pageGlide(c, s, m, t);
}

}  // namespace pg::display
