#include "screens.h"

#include <cmath>
#include <cstdio>

#include "../sun.h"
#include "../terrain.h"

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
    case Page::Side: return "SIDE";
    case Page::Info: return "INFO";
    case Page::Profile: return "PROFILE";
    default: return "";
  }
}

// ---------------------------------------------------------------- model

namespace {
constexpr TimeMs kPageReturnMs = 20000;   // a manual page goes back to FLIGHT
constexpr TimeMs kThermalHoldMs = 10000;  // thermal page stays after rolling out
}  // namespace

void Model::update(TimeMs t, const Status& s) {
  // Which flight page: thermal while circling, through a MOVE straightening,
  // and for a while after rolling out unless the advice is to leave.
  if (s.circling) lastCircling_ = t;
  if (s.turn.advice == TurnAdvice::Move && s.turn.moveNow)
    moveUntil_ = t + static_cast<TimeMs>((s.turn.moveSeconds < 2 ? 2 : s.turn.moveSeconds) * 1000) + 3000;
  thermalView_ = s.circling || t < moveUntil_ ||
                 (lastCircling_ && t - lastCircling_ < kThermalHoldMs && s.advisor.advice != Advice::Glide);

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
  // Cues that need the flight page bring it back.
  switch (a) {
    case Alert::Stay: case Alert::Glide: case Alert::FinalGlide: case Alert::GpsLost: case Alert::Move:
    case Alert::Tighten: case Alert::Widen: case Alert::Turnpoint:
      page_ = Page::Flight;
      break;
    default: break;
  }
}

Alert Model::banner(TimeMs t) const {
  const TimeMs hold =
      banner_ == Alert::Stay || banner_ == Alert::Glide || banner_ == Alert::FinalGlide ? 15000 : 10000;
  return banner_ != Alert::None && t - bannerT_ < hold ? banner_ : Alert::None;
}

Page Model::page(TimeMs t) const {
  if (page_ != Page::Flight && t - pageT_ > kPageReturnMs) return Page::Flight;
  return page_;
}

void Model::nextPage(TimeMs t) {
  const Page cur = page(t);
  page_ = static_cast<Page>((static_cast<int>(cur) + 1) % static_cast<int>(Page::Count));
  pageT_ = t;
}

void Model::setPage(Page p, TimeMs t) {
  page_ = p;
  pageT_ = t;
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
constexpr double kMPerDeg = 111195.0;

void fmtSigned(char* b, size_t n, float v) {
  if (std::fabs(v) < 0.05f) v = 0.0f;
  std::snprintf(b, n, "%+.1f", static_cast<double>(v));
}
void fmtKm(char* b, size_t n, float m) {
  if (m < 1000) std::snprintf(b, n, "%.0f m", static_cast<double>(m));
  else std::snprintf(b, n, "%.1f km", static_cast<double>(m / 1000));
}
const char* barText(const Status& s) {
  const float bar = s.xc.bar;
  return bar <= 0 ? (s.xc.slow ? "SLOW" : "OFF") : bar < 0.3f ? "1/4" : bar < 0.6f ? "1/2" : bar < 0.9f ? "3/4" : "FULL";
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
  // Values that would run into the label shrink rather than overlap.
  const bool fits = Canvas::textWidth(val, kFontMedium) + Canvas::textWidth(name, kFontTiny) < x1 - x0 - 6;
  c.text(x1, fits ? y + 8 : y + 13, val, fits ? kFontMedium : kFontSmall, Align::Right);
}

// Label over a value, both centred in a column.
void cell(Canvas& c, int cx, int y, const char* name, const char* val, int width = 76) {
  label(c, cx, y, name, Align::Center);
  const bool fits = Canvas::textWidth(val, kFontMedium) <= width;
  c.text(cx, fits ? y + 12 : y + 16, val, fits ? kFontMedium : kFontSmall, Align::Center);
}

void statusBar(Canvas& c, const Status& s, const DeviceInfo& d, TimeMs t) {
  const int W = c.width();
  const bool narrow = c.portrait();
  c.fillRect(0, 0, W, 16);
  char b[64];
  int x = 4;
  const bool loud = s.gps == GpsState::Lost || s.gps == GpsState::Spoofed;
  if (d.clockMin >= 0) {
    std::snprintf(b, sizeof b, "%02d:%02d", d.clockMin / 60 % 24, d.clockMin % 60);
    x += c.text(x, 2, b, kFontTiny, Align::Left, false) + 10;
  }
  if (d.flightMin >= 0 && !(narrow && loud)) {
    std::snprintf(b, sizeof b, "%d:%02d", d.flightMin / 60, d.flightMin % 60);
    if (!narrow) c.text(x, 2, b, kFontTiny, Align::Left, false);
  }
  // GPS: quiet when fine, loud (inverted, centred) when not.
  if (loud) {
    const int mins = static_cast<int>((t - s.gpsSince) / 60000);
    const char* what = s.gps == GpsState::Spoofed ? "SPOOFED" : "LOST";
    if (s.pos.valid) {
      char e[16];
      fmtKm(e, sizeof e, s.pos.errorM);
      if (narrow) std::snprintf(b, sizeof b, "GPS %s ~%s", what, e);
      else std::snprintf(b, sizeof b, "GPS %s %d' - est. ~%s", what, mins, e);
    } else {
      std::snprintf(b, sizeof b, "GPS %s %d'", what, mins);
    }
    const int w = Canvas::textWidth(b, kFontTiny) + 12;
    c.fillRect(W / 2 - w / 2, 1, w, 14, false);
    c.text(W / 2, 2, b, kFontTiny, Align::Center, true);
  } else if (s.gps == GpsState::NoData) {
    // In the air with nothing yet is jamming, not a cold start.
    c.text(W / 2, 2, d.flightMin >= 1 ? (narrow ? "NO GPS" : "NO GPS - gyro + baro") : (narrow ? "GPS ..." : "GPS searching"),
           kFontTiny, Align::Center, false);
  } else {
    std::snprintf(b, sizeof b, "GPS %u", s.gnss.sats);
    c.text(W / 2, 2, b, kFontTiny, Align::Center, false);
  }
  int r = W - 4;
  if (d.batteryPct >= 0) {
    c.rect(r - 20, 4, 18, 9, false);
    c.fillRect(r - 2, 6, 2, 5, false);
    c.fillRect(r - 18, 6, (14 * (d.batteryPct > 100 ? 100 : d.batteryPct)) / 100, 5, false);
    r -= 24;
    if (!narrow) {
      std::snprintf(b, sizeof b, "%d%%", d.batteryPct);
      r -= c.text(r, 2, b, kFontTiny, Align::Right, false) + 8;
    }
  }
  if (s.muted && !(narrow && loud)) r -= c.text(r, 2, "MUTE", kFontTiny, Align::Right, false) + 8;
  if (d.simulated && !narrow) c.text(r, 2, "SIM", kFontTiny, Align::Right, false);
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
      else std::snprintf(b, sizeof b, "%s < MC %.1f", b2, static_cast<double>(s.advisor.mc));
      break;
    case Alert::FinalGlide:
      big = c.portrait() ? "FINAL" : "FINAL GLIDE";
      std::snprintf(b, sizeof b, "%+.0f m", static_cast<double>(s.task.finalSurplus));
      break;
    case Alert::Turnpoint:
      big = c.portrait() ? "TP" : "TURNPOINT";
      std::snprintf(b, sizeof b, "next %s", s.task.nextName);
      break;
    case Alert::NearBase:
      big = c.portrait() ? "BASE" : "CLOUD BASE";
      std::snprintf(b, sizeof b, "%+.0f m", static_cast<double>(s.air.cloudBase - s.altitude));
      break;
    case Alert::Inversion: big = c.portrait() ? "INVERS." : "INVERSION"; small = "top of lift"; break;
    case Alert::Message: big = c.portrait() ? "MSG" : "MESSAGE"; small = "FANET"; break;
    case Alert::GpsLost: big = "GPS LOST"; small = c.portrait() ? "vario ok" : "vario + assist fine"; break;
    case Alert::GpsBack: big = "GPS OK"; small = c.portrait() ? "trusted" : "position trusted again"; break;
    default: break;
  }
  if (!big) return false;
  const int W = c.width(), H = c.height();
  c.fillRect(0, H - 34, W, 34);
  c.text(8, H - 34, big, kFontLarge, Align::Left, false);
  if (!c.portrait() || Canvas::textWidth(big, kFontLarge) + Canvas::textWidth(small, kFontSmall) < W - 24)
    c.text(W - 8, H - 26, small, kFontSmall, Align::Right, false);
  return true;
}

// Wind arrow relative to your heading: shows which way the air carries you.
void windSmall(Canvas& c, int cx, int cy, const Status& s) {
  if (!s.headingValid) return;  // can't point a wind arrow without north
  if (!s.wind.valid) {
    label(c, cx - 4, cy - 6, "--");
    return;
  }
  const float to = s.wind.fromDeg + 180.0f - s.heading;
  c.circle(cx, cy, 12);
  arrow(c, cx, cy, to, -9, 11, 2, 4);
  char b[16];
  std::snprintf(b, sizeof b, "%.0f", static_cast<double>(s.wind.speed * 3.6f));
  label(c, cx + 16, cy - 6, b);
}

// ---------------------------------------------------------------- thermal assistant

// The circle: lift around it, you, the fitted thermal (core + size), pilots,
// the thermal average in the middle and the one-word advice under it.
void assistant(Canvas& c, const Status& s, int cx, int cy, int R) {
  char b[64], b2[32];
  const AssistView& a = s.assist;
  const float hdg = s.assistHeading;  // heading-up in the gyro frame; north only when known
  dottedCircle(c, cx, cy, R, 6);
  if (s.headingValid && (!a.active || std::fabs(angleDiffDeg(-90.0f * a.dir, -hdg)) > 25.0f)) {
    int nx, ny;
    polar(cx, cy, -hdg, R + 9, nx, ny);
    c.text(nx, ny - 6, "N", kFontTiny, Align::Center);
  }
  if (!a.active) {
    c.text(cx, cy - 8, s.assistHeadingValid ? "assistant" : "no heading", kFontSmall, Align::Center);
    c.text(cx, cy + 8, s.assistHeadingValid ? "maps the lift" : "(needs IMU or GPS)", kFontTiny, Align::Center);
    return;
  }
  for (int i = 0; i < 36; ++i) {
    if (!a.have[i]) continue;
    const float onCircle = i * 10.0f + 5.0f - 90.0f * a.dir - hdg;
    int x, y;
    polar(cx, cy, onCircle, static_cast<float>(R), x, y);
    const float l = a.lift[i];
    if (l > 0.1f) {
      int r = static_cast<int>(2 + l * R / 32.0f);
      if (r > R / 8) r = R / 8;
      c.fillCircle(x, y, r);
    } else {
      c.circle(x, y, 3);
    }
  }
  int gx, gy;
  polar(cx, cy, -90.0f * a.dir, static_cast<float>(R), gx, gy);
  c.fillCircle(gx, gy, 9, false);
  glider(c, gx, gy, 0, 8);
  const TurnView& tv = s.turn;
  const float pxPerM = tv.myRadius > 5 ? R / tv.myRadius : 0;
  if (tv.fit.valid && pxPerM > 0) {
    int kx, ky;
    polar(cx, cy, tv.coreBearing - hdg, tv.coreDist * pxPerM, kx, ky);
    const int kr = static_cast<int>(tv.fit.radius * pxPerM);
    // Its size, when it fits around the circle (a big outline would cover the numbers).
    if (kr <= R + 12 && std::abs(kx - cx) + kr <= R + 16 && std::abs(ky - cy) + kr <= R + 16)
      dottedCircle(c, kx, ky, kr, kr > 60 ? 4 : 8);
    c.line(kx - 6, ky, kx + 6, ky, true, 2);
    c.line(kx, ky - 6, kx, ky + 6, true, 2);
    if (tv.advice == TurnAdvice::Move) arrow(c, cx, cy, tv.coreBearing - hdg, R * 0.5f, R - 12.0f, 4, 8);
  } else if (a.strength > 0.15f) {
    arrow(c, cx, cy, a.coreDeg - hdg, R * 0.5f, R * 0.5f + 6 + a.strength * (R * 0.5f - 18), 4, 8);
  }
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
  const char* word = nullptr;
  b2[0] = 0;
  switch (tv.advice) {
    case TurnAdvice::Move:
      word = tv.moveNow ? "STRAIGHTEN" : "MOVE";
      if (tv.moveNow) std::snprintf(b2, sizeof b2, "%.0f s", static_cast<double>(tv.moveSeconds));
      else std::snprintf(b2, sizeof b2, "%.0f m", static_cast<double>(tv.coreDist));
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
}

// ---------------------------------------------------------------- side view

// Along your course (the next turnpoint, else the glide target, else your
// heading): terrain, your best-glide line in this wind (and where it meets
// the ground), cloud base, the target's thermal column leaning with the wind
// (and today's other triggers near the line when `detail`), other pilots.
struct SideResult {
  bool ok = false;
  float arrival = 0;       // glide line minus ground at the end
  float clearance = 1e9f;  // smallest glide-line height over the ground on the way
  float clearAt = 0;
  float hitAt = -1;        // where the glide line meets the ground (m), -1 = clear
  float range = 0;
  const char* what = "";
};

SideResult sideView(Canvas& c, const Status& s, int x0, int y0, int w, int h, bool detail) {
  SideResult r;
  c.rect(x0, y0, w, h);
  if (!s.pos.valid || !s.terrain || !s.polar) {
    c.text(x0 + w / 2, y0 + h / 2 - 8, s.pos.valid ? "no terrain" : "no position", kFontSmall, Align::Center);
    return r;
  }
  // Direction and range.
  float brg = 0, range = 8000;
  const bool onTask = s.task.active && !s.task.finished && s.gps == GpsState::Ok;
  if (onTask) {
    brg = s.task.nextBearing;
    range = s.task.nextDist * 1.15f + 1000;
    r.what = s.task.nextName;
  } else if (s.best.valid) {
    brg = s.best.bearingDeg;
    range = s.best.distM * 1.3f;
    r.what = s.best.kind == TargetKind::Live ? "pilot" : (s.best.kind == TargetKind::Sun ? "sun" : "thermal");
  } else if (s.home.valid && s.home.distM > 500) {
    brg = s.home.bearingDeg;
    range = s.home.distM * 1.15f;
    r.what = "home";
  } else if (s.headingValid) {
    brg = s.heading;
    r.what = "ahead";
  } else {
    c.text(x0 + w / 2, y0 + h / 2 - 8, "no direction", kFontSmall, Align::Center);
    return r;
  }
  range = range < 3000 ? 3000 : (range > 25000 ? 25000 : range);
  r.range = range;
  const float ub = std::sin(brg * kD2R), vb = std::cos(brg * kD2R);  // east, north of the course
  const double lat0 = s.pos.lat, lon0 = s.pos.lon;
  const double mLon = kMPerDeg * std::cos(lat0 * kD2R);
  auto at = [&](float d, double& la, double& lo) {
    la = lat0 + vb * d / kMPerDeg;
    lo = lon0 + ub * d / mLon;
  };
  // Ground along the line.
  int n = w - 2;
  if (n > 398) n = 398;
  static float g[398];
  float gmin = 1e9f, gmax = -1e9f;
  for (int i = 0; i < n; ++i) {
    double la, lo;
    at(range * i / (n - 1), la, lo);
    float e;
    g[i] = s.terrain->elevation(la, lo, e) ? e : NAN;
    if (!std::isnan(g[i])) {
      if (g[i] < gmin) gmin = g[i];
      if (g[i] > gmax) gmax = g[i];
    }
  }
  if (gmin > gmax) {
    c.text(x0 + w / 2, y0 + h / 2 - 8, "off the map", kFontSmall, Align::Center);
    return r;
  }
  // Glide line: best glide (MC 0) through this wind along the course.
  const float wN = s.wind.valid ? s.wind.toN : 0, wE = s.wind.valid ? s.wind.toE : 0;
  const float along = wE * ub + wN * vb, cross = -wE * vb + wN * ub;
  const float v = s.polar->speedToFly(0, 0, -along);
  const float gsq = v * v - cross * cross;
  const float gs = gsq > 0 ? std::sqrt(gsq) + along : 0.1f;
  const float slope = gs > 0.5f ? s.polar->sink(v) / gs : 1.0f;  // m lost per m
  // Vertical scale.
  float zlo = gmin - 50, zhi = s.altMsl + 150;
  if (gmax + 100 > zhi) zhi = gmax + 100;
  const bool showBase = s.ceilingValid && s.ceilingMsl < zhi + 800;
  if (showBase && s.ceilingMsl + 60 > zhi) zhi = s.ceilingMsl + 60;
  const int top = y0 + 2, bot = y0 + h - 12, left = x0 + 1;
  auto X = [&](float d) { return left + static_cast<int>(d / range * (n - 1)); };
  auto Y = [&](float z) { return bot - static_cast<int>((z - zlo) / (zhi - zlo) * (bot - top)); };
  // Terrain: outline and a light fill.
  for (int i = 0; i < n; ++i) {
    if (std::isnan(g[i])) continue;
    const int x = left + i, yg = Y(g[i]);
    for (int y = yg; y <= bot; ++y)
      if (((x + y) & 3) == 0) c.pixel(x, y);
    c.pixel(x, yg);
    c.pixel(x, yg + 1);
  }
  // Cloud base.
  if (showBase) {
    const int yb = Y(s.ceilingMsl);
    for (int x = left; x < left + n; x += 6) c.hline(x, yb, 3);
    label(c, left + n - 2, yb - 12, s.ceilingIsBase ? "base" : "top", Align::Right);
  }
  // Thermal columns: the target's (bold), today's triggers near the line.
  auto column = [&](double tLat, double tLon, float fromAlt, bool live, int thick) {
    const float zTop = showBase ? s.ceilingMsl : s.altMsl + 600;
    int px = -1, py = -1;
    for (float z = fromAlt; z <= zTop; z += 100) {
      double la, lo;
      if (live) {
        la = tLat + wN * (z - fromAlt) / s.thermalRise / kMPerDeg;
        lo = tLon + wE * (z - fromAlt) / s.thermalRise / mLon;
      } else {
        thermalColumnAt(tLat, tLon, fromAlt, z, s.thermalRise, s.profile, wN, wE, la, lo);
      }
      const float dn = static_cast<float>((la - lat0) * kMPerDeg), de = static_cast<float>((lo - lon0) * mLon);
      const float d = de * ub + dn * vb, lat = -de * vb + dn * ub;
      if (d < 0 || d > range || std::fabs(lat) > 1500) {
        px = -1;
        continue;
      }
      const int x = X(d), y = Y(z);
      if (px >= 0) {
        if (thick > 1) c.line(px, py, x, y, true, thick);
        else if (((x + y) & 1) == 0) c.line(px, py, x, y, true, 1);
      }
      // where it is at your height: a ring
      if (thick > 1 && std::fabs(z - s.altMsl) < 50) c.circle(x, y, 5);
      px = x;
      py = y;
    }
  };
  if (detail && s.sun) {
    for (int i = 0; i < s.sun->count(); ++i) {
      const ThermalSource& src = s.sun->at(i);
      if (src.strength >= 0.3f) column(src.lat, src.lon, src.ground, false, 1);
    }
  }
  if (s.best.valid && s.best.kind != TargetKind::Home)
    column(s.best.trigLat, s.best.trigLon, s.best.trigAlt, s.best.kind == TargetKind::Live, 3);
  // Other pilots within 1 km of the line.
  for (int i = 0; i < s.nearCount; ++i) {
    const NearPilot& np = s.near[i];
    const float d = np.east * ub + np.north * vb, lat = -np.east * vb + np.north * ub;
    if (d < 0 || d > range || std::fabs(lat) > 1000) continue;
    const int x = X(d), y = Y(s.altMsl + np.dAlt);
    c.fillTriangle(x, y - 4, x - 4, y + 3, x + 4, y + 3);
  }
  // Glide line, and where it meets the ground.
  int lx = X(0), ly = Y(s.altMsl);
  for (int i = 1; i < n; ++i) {
    const float d = range * i / (n - 1);
    const float z = s.altMsl - slope * d;
    if (!std::isnan(g[i])) {
      const float over = z - g[i];
      if (over < r.clearance) {
        r.clearance = over;
        r.clearAt = d;
      }
      if (over < 0 && r.hitAt < 0) r.hitAt = d;
    }
    const int x = X(d), y = Y(z);
    if (r.hitAt < 0 && (i / 3) % 2 == 0) c.line(lx, ly, x, y, true, 2);
    lx = x;
    ly = y;
  }
  if (r.hitAt >= 0) {
    const int x = X(r.hitAt), y = Y(s.altMsl - slope * r.hitAt);
    c.line(x - 5, y - 5, x + 5, y + 5, true, 2);
    c.line(x - 5, y + 5, x + 5, y - 5, true, 2);
  }
  const float gEnd = std::isnan(g[n - 1]) ? 0 : g[n - 1];
  r.arrival = s.altMsl - slope * range - gEnd;
  // You.
  glider(c, left + 6, Y(s.altMsl), 90, 7);
  // Distance ticks.
  const float step = range > 15000 ? 5000 : (range > 6000 ? 2000 : 1000);
  for (float d = step; d < range; d += step) c.vline(X(d), bot, 4);
  char b[24];
  std::snprintf(b, sizeof b, "%.0f km", static_cast<double>(range / 1000));
  label(c, left + n - 2, bot, b, Align::Right);
  r.ok = true;
  return r;
}

// ---------------------------------------------------------------- pages

void pageThermal(Canvas& c, const Status& s, const Model& m, TimeMs t) {
  char b[64], b2[32];
  if (!c.portrait()) {
    assistant(c, s, 116, 122, 84);
    windSmall(c, 18, 34, s);
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
    if (s.air.baseValid)
      std::snprintf(b, sizeof b, "%s%+.0f", s.air.baseFromThermal ? "" : "~",
                    static_cast<double>(s.air.cloudBase - s.altitude));
    else std::snprintf(b, sizeof b, "--");
    row(c, 232, 398, 174, "TO BASE m", b);
  } else {
    // Portrait: the vario across the top, the circle big, heights underneath.
    fmtSigned(b, sizeof b, s.vario);
    c.text(236, 16, b, kFontHuge, Align::Right);
    label(c, 4, 22, "avg");
    fmtSigned(b, sizeof b, s.avg);
    c.text(4, 34, b, kFontMedium);
    if (s.circling && std::fabs(s.advisor.thermalGain) >= 0.5f) {
      std::snprintf(b, sizeof b, "gain %+.0f", static_cast<double>(s.advisor.thermalGain));
      label(c, 4, 62, b);
    }
    assistant(c, s, 120, 196, 88);
    windSmall(c, 18, 104, s);
    c.hline(0, 300, 240);
    std::snprintf(b, sizeof b, "%.0f", static_cast<double>(s.altMsl));
    cell(c, 40, 304, "ALT", b);
    if (s.aglValid) std::snprintf(b, sizeof b, "%.0f", static_cast<double>(s.agl));
    else std::snprintf(b, sizeof b, "--");
    cell(c, 120, 304, "AGL", b);
    if (s.air.baseValid)
      std::snprintf(b, sizeof b, "%s%+.0f", s.air.baseFromThermal ? "" : "~",
                    static_cast<double>(s.air.cloudBase - s.altitude));
    else std::snprintf(b, sizeof b, "--");
    cell(c, 200, 304, "TO BASE", b);
    c.vline(80, 302, 36);
    c.vline(160, 302, 36);
  }
  bannerArea(c, s, m, t);
}

// Target line: what, how far, arrival (or the task's next turnpoint).
void targetText(const Status& s, char* lab, size_t nl, char* val, size_t nv) {
  char b2[32];
  const bool onTask = s.task.active && !s.task.finished;
  const Target& tg = s.best.valid ? s.best : s.home;
  if (onTask) {
    std::snprintf(lab, nl, "TP %d %s", s.task.next + 1, s.task.nextName);
    fmtKm(b2, sizeof b2, s.task.nextDist);
    if (s.task.insideStart) {
      std::snprintf(lab, nl, "START %s - exit", s.task.nextName);
      std::snprintf(val, nv, "edge %s", b2);
      return;
    }
    if (s.task.finalValid && s.task.finalSurplus > -500)
      std::snprintf(val, nv, "%s  goal %+.0f", b2, static_cast<double>(s.task.finalSurplus));
    else std::snprintf(val, nv, "%s", b2);
    return;
  }
  char k[40];
  if (s.best.valid && s.best.live)
    std::snprintf(k, sizeof k, "PILOT %+.1f %d'", static_cast<double>(s.best.liveClimb), s.best.ageMin);
  else if (s.best.valid)
    std::snprintf(k, sizeof k, "%s %.0f%%", s.best.kind == TargetKind::Sun ? "SUN" : "THERMAL",
                  static_cast<double>(s.best.chance * 100));
  else std::snprintf(k, sizeof k, s.home.valid ? "HOME" : "NO TARGET");
  if (s.best.valid && s.best.driftM >= 300)
    std::snprintf(lab, nl, "%s - %.1f km downwind", k, static_cast<double>(s.best.driftM / 1000));
  else std::snprintf(lab, nl, "%s", k);
  val[0] = 0;
  if (tg.valid && s.pos.valid) {
    fmtKm(b2, sizeof b2, tg.distM);
    if (tg.arrivalAgl > -9000) std::snprintf(val, nv, "%s  %+.0f m", b2, static_cast<double>(tg.arrivalAgl));
    else std::snprintf(val, nv, "%s  out of reach", b2);
  }
}

// Compass with the course arrow (and the thermal on the way when on task).
void courseCompass(Canvas& c, const Status& s, int cx, int cy, int R) {
  const float hdg = s.headingValid ? s.heading : 0.0f;
  dottedCircle(c, cx, cy, R, 10);
  c.fillTriangle(cx, cy - R - 6, cx - 5, cy - R + 3, cx + 5, cy - R + 3);  // your heading
  int nx, ny;
  polar(cx, cy, -hdg, R + 9, nx, ny);
  c.text(nx, ny - 6, "N", kFontTiny, Align::Center);
  const bool onTask = s.task.active && !s.task.finished && s.headingValid;
  const Target& tg = s.best.valid ? s.best : s.home;
  if (onTask && s.pos.valid) {
    arrow(c, cx, cy, s.task.nextBearing - hdg, -R * 0.55f, R - 6.0f, 4, 8);
    if (s.best.valid) arrow(c, cx, cy, s.best.bearingDeg - hdg, 0, R - 12.0f, 1, 5);
  } else if (tg.valid && s.pos.valid) {
    arrow(c, cx, cy, tg.bearingDeg - hdg, -R * 0.55f, R - 6.0f, 4, 8);
  } else {
    c.text(cx, cy - 6, s.pos.valid ? "-" : "no pos", kFontTiny, Align::Center);
  }
}

// What the arrow can't say: height still needed, or final glide.
void needText(const Status& s, char* b, size_t n) {
  b[0] = 0;
  const Target& tg = s.best.valid ? s.best : s.home;
  if (s.task.active && !s.task.finished && s.task.finalValid && s.task.finalSurplus >= 0)
    std::snprintf(b, n, "FINAL  MC %.1f", static_cast<double>(s.task.finalMc));
  else if (tg.valid && tg.arrivalAgl < 0 && tg.arrivalAgl > -9000)
    std::snprintf(b, n, "NEED +%.0f m", static_cast<double>(-tg.arrivalAgl));
  else if (s.pos.deadReckoned && s.pos.valid)
    std::snprintf(b, n, "pos. ~%.0f m", static_cast<double>(s.pos.errorM));
}

void pageGlide(Canvas& c, const Status& s, const Model& m, TimeMs t) {
  char b[64], lab[80], val[64];
  targetText(s, lab, sizeof lab, val, sizeof val);
  float ld = 0;
  const bool haveLd = m.glideRatio(ld);
  if (!c.portrait()) {
    label(c, 6, 19, lab);
    c.text(6, 31, val, kFontMedium);
    courseCompass(c, s, 58, 106, 34);
    // Bar: the MacCready speed for this air and headwind, in quarters.
    if (s.xc.barLimit == BarLimit::Low || s.xc.barLimit == BarLimit::Turbulence)
      std::snprintf(b, sizeof b, "BAR  %s", barLimitName(s.xc.barLimit));
    else std::snprintf(b, sizeof b, "BAR  MC %.1f", static_cast<double>(s.xc.mc));
    label(c, 108, 62, b);
    c.text(108, 72, barText(s), kFontLarge);
    if (haveLd) std::snprintf(b, sizeof b, ld >= 99 ? "L/D --" : "L/D %.1f", static_cast<double>(ld));
    else std::snprintf(b, sizeof b, "L/D ...");
    c.text(108, 114, b, kFontSmall);
    needText(s, b, sizeof b);
    if (b[0]) c.text(108, 134, b, kFontSmall);
    // Right column.
    fmtSigned(b, sizeof b, s.vario);
    c.text(398, 16, b, kFontLarge, Align::Right);
    char a[16];
    fmtSigned(a, sizeof a, s.avg);
    std::snprintf(b, sizeof b, "avg %s", a);
    c.text(398, 52, b, kFontSmall, Align::Right);
    c.hline(236, 72, 164);
    if (s.aglValid) std::snprintf(b, sizeof b, "%.0f", static_cast<double>(s.agl));
    else std::snprintf(b, sizeof b, "%.0f", static_cast<double>(s.altMsl));
    row(c, 240, 398, 76, s.aglValid ? "AGL m" : "ALT m", b);
    label(c, 240, 112, "WIND");
    windSmall(c, 300, 130, s);
    sideView(c, s, 0, 154, 400, 86, false);
  } else {
    // Portrait: numbers on top, then the target and compass, then the side view.
    if (s.aglValid) std::snprintf(b, sizeof b, "%.0f", static_cast<double>(s.agl));
    else std::snprintf(b, sizeof b, "%.0f", static_cast<double>(s.altMsl));
    label(c, 4, 20, s.aglValid ? "AGL m" : "ALT m");
    c.text(4, 32, b, kFontMedium);
    fmtSigned(b, sizeof b, s.vario);
    c.text(236, 16, b, kFontLarge, Align::Right);
    char a[16];
    fmtSigned(a, sizeof a, s.avg);
    std::snprintf(b, sizeof b, "avg %s", a);
    c.text(236, 52, b, kFontSmall, Align::Right);
    c.hline(0, 72, 240);
    label(c, 4, 76, lab);
    c.text(4, 88, val, kFontMedium);
    courseCompass(c, s, 58, 166, 40);
    if (s.xc.barLimit == BarLimit::Low || s.xc.barLimit == BarLimit::Turbulence)
      std::snprintf(b, sizeof b, "BAR %s", barLimitName(s.xc.barLimit));
    else std::snprintf(b, sizeof b, "BAR  MC %.1f", static_cast<double>(s.xc.mc));
    label(c, 112, 120, b);
    c.text(112, 130, barText(s), kFontLarge);
    if (haveLd) std::snprintf(b, sizeof b, ld >= 99 ? "L/D --" : "L/D %.1f", static_cast<double>(ld));
    else std::snprintf(b, sizeof b, "L/D ...");
    c.text(112, 172, b, kFontSmall);
    windSmall(c, 196, 180, s);
    needText(s, b, sizeof b);
    if (b[0]) c.text(112, 194, b, kFontSmall);
    sideView(c, s, 0, 214, 240, 150, false);
  }
  bannerArea(c, s, m, t);
}

void pageSide(Canvas& c, const Status& s, const Model& m, TimeMs t) {
  char b[64], b2[24];
  const int W = c.width(), H = c.height();
  const int h = c.portrait() ? H - 18 - 74 : H - 18 - 40;
  const SideResult r = sideView(c, s, 0, 18, W, h, true);
  const int y = 18 + h + 4;
  if (r.ok) {
    fmtKm(b2, sizeof b2, r.range);
    std::snprintf(b, sizeof b, "to %s", r.what);
    label(c, 4, y, b);
    if (r.hitAt >= 0) {
      fmtKm(b2, sizeof b2, r.hitAt);
      std::snprintf(b, sizeof b, "GROUND at %s", b2);
    } else {
      std::snprintf(b, sizeof b, "clear by %.0f m", static_cast<double>(r.clearance));
    }
    c.text(c.portrait() ? 4 : W / 2 - 40, c.portrait() ? y + 14 : y - 2, b, kFontSmall);
    std::snprintf(b, sizeof b, "best glide in this wind");
    label(c, W - 4, c.portrait() ? y + 36 : y + 18, b, Align::Right);
  }
  if (!c.portrait()) label(c, 4, y + 18, "SIDE - Page: info");
  else label(c, 4, y + 52, "SIDE - Page: info");
  bannerArea(c, s, m, t);
}

void pageInfo(Canvas& c, const Status& s, const DeviceInfo& d) {
  char b[64], b2[32];
  struct Item {
    const char* name;
    char val[64];
  } it[10];
  const AtmosphereState& a = s.air;
  int n = 0;
  auto add = [&](const char* name, const char* v) {
    it[n].name = name;
    std::snprintf(it[n].val, sizeof it[n].val, "%s", v);
    ++n;
  };
  if (a.baseValid)
    std::snprintf(b, sizeof b, "%.0f%s", static_cast<double>(a.cloudBase + (s.altMsl - s.altitude)),
                  a.baseFromThermal ? "" : "?");
  else std::snprintf(b, sizeof b, "--");
  add("CLOUD BASE m", b);
  if (a.lapseValid) {
    const char* st = a.stability == Stability::Unstable ? "unstable"
                     : a.stability == Stability::Moderate ? "moderate"
                     : a.stability == Stability::Stable ? "stable" : "inversion";
    std::snprintf(b, sizeof b, "%.1f %s", static_cast<double>(a.lapseRate), st);
  } else {
    std::snprintf(b, sizeof b, "--");
  }
  add("LAPSE \x7f" "C/km", b);
  if (a.haveAir)
    std::snprintf(b, sizeof b, "%.0f / %.0f%s", static_cast<double>(a.tempC), static_cast<double>(a.dewPointC),
                  a.ventilated ? " out" : "");
  else std::snprintf(b, sizeof b, "--");
  add("AIR / DEW \x7f" "C", b);
  if (s.wind.valid)
    std::snprintf(b, sizeof b, "%.0f from %03.0f", static_cast<double>(s.wind.speed * 3.6f),
                  static_cast<double>(s.wind.fromDeg));
  else std::snprintf(b, sizeof b, "--");
  add("WIND km/h", b);
  std::snprintf(b, sizeof b, "%.1f (%.1f)", static_cast<double>(s.xc.mc), static_cast<double>(s.advisor.mcBase));
  add(s.task.active && s.task.started ? "MC  race (base)" : "MC  XC (base)", b);
  if (s.home.valid && s.pos.valid) {
    fmtKm(b2, sizeof b2, s.home.distM);
    std::snprintf(b, sizeof b, "%s %+.0f", b2, static_cast<double>(s.home.arrivalAgl));
  } else {
    std::snprintf(b, sizeof b, "--");
  }
  add("HOME  dist / arrive", b);
  if (s.gps == GpsState::Ok) std::snprintf(b, sizeof b, "ok, %u sats", s.gnss.sats);
  else if (s.gps == GpsState::NoData) std::snprintf(b, sizeof b, "searching");
  else std::snprintf(b, sizeof b, "%s", gpsStateName(s.gps));
  add(s.gps == GpsState::Lost || s.gps == GpsState::Spoofed ? gpsReasonName(s.gpsReason) : "GPS", b);
  std::snprintf(b, sizeof b, "%s", s.imu ? "gyro" : (s.headingValid ? "GPS track" : "--"));
  add("HEADING", b);
  if (d.flightMin >= 0) std::snprintf(b, sizeof b, "%d:%02d", d.flightMin / 60, d.flightMin % 60);
  else std::snprintf(b, sizeof b, "--");
  add("FLIGHT TIME", b);
  if (d.batteryPct >= 0) std::snprintf(b, sizeof b, "%d%%", d.batteryPct);
  else std::snprintf(b, sizeof b, "--");
  add("BATTERY", b);

  if (!c.portrait()) {
    for (int i = 0; i < 5; ++i) row(c, 8, 194, 22 + i * 36, it[i].name, it[i].val);
    for (int i = 5; i < 10; ++i) row(c, 208, 394, 22 + (i - 5) * 36, it[i].name, it[i].val);
    c.vline(200, 22, 176);
    c.hline(0, 204, 400);
    c.text(200, 214, "INFO  -  Page: profile", kFontSmall, Align::Center);
  } else {
    for (int i = 0; i < 10; ++i) {
      row(c, 6, 234, 20 + i * 35, it[i].name, it[i].val);
      if (i) c.dotted(6, 18 + i * 35, 228, 3);
    }
    c.hline(0, 372, 240);
    c.text(120, 378, "INFO - Page: profile", kFontSmall, Align::Center);
  }
}

// The day by altitude: climb found (bars), wind (arrows, north up), and air
// temperature / dew point, for each height band flown through.
void pageProfile(Canvas& c, const Status& s) {
  char b[32];
  const int W = c.width(), H = c.height();
  const bool P = c.portrait();
  const Profile* pr = s.profile;
  if (!pr || pr->highest() < 0) {
    c.text(W / 2, H / 2 - 30, "PROFILE", kFontMedium, Align::Center);
    c.text(W / 2, H / 2, P ? "builds as you fly" : "builds as you climb and glide", kFontSmall, Align::Center);
    return;
  }
  // Column positions scale with the width.
  const int xClimb = P ? 44 : 96, climbMax = P ? 70 : 120, xWind = P ? 136 : 236, xAir = P ? 182 : 316;
  int lo = pr->lowest(), hi = pr->highest();
  const int ceilBand = s.ceilingValid ? static_cast<int>(s.ceilingMsl / Profile::kBandM) : -1;
  if (ceilBand > hi && ceilBand < Profile::kBands) hi = ceilBand;
  const int top = 22, bottom = H - (P ? 36 : 40);
  const int group = (hi - lo + 1) > (bottom - top) / 9 ? 2 : 1;  // rows of 100 or 200 m
  const int rows = (hi - lo) / group + 1;
  const int rh = (bottom - top) / (rows > 0 ? rows : 1) > 16 ? 16 : (bottom - top) / (rows > 0 ? rows : 1);
  label(c, 4, top - 2, "m");
  label(c, xClimb, top - 2, "climb");
  label(c, xWind, top - 2, "wind");
  label(c, xAir, top - 2, P ? "T/Td" : "air/dew");
  int lastText = -100;
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
    bool wrote = false;
    if (nc) {
      climb /= nc;
      int w = static_cast<int>(climb * climbMax / 4);
      if (w > climbMax) w = climbMax;
      if (w > 0) c.fillRect(xClimb, y + 2, w, rh > 4 ? rh - 3 : 2);
      else c.hline(xClimb, y + rh / 2, 3);
      if (rh >= 10 && text) {
        std::snprintf(b, sizeof b, "%.1f", static_cast<double>(climb));
        label(c, xClimb + (w > 0 ? w : 0) + 3, y, b);
      }
    }
    if (nw && text) {
      wn /= nw;
      we /= nw;
      const float spd = std::sqrt(wn * wn + we * we);
      if (spd > 0.5f) arrow(c, xWind + 8, y + 5, std::atan2(we, wn) / kD2R, -6, 6, 1, 3);
      std::snprintf(b, sizeof b, "%.0f", static_cast<double>(spd * 3.6f));
      label(c, xWind + 20, y, b);
      wrote = true;
    }
    if (na && text) {
      std::snprintf(b, sizeof b, "%.0f/%.0f", static_cast<double>(temp / na), static_cast<double>(dew / na));
      label(c, xAir, y, b);
      wrote = true;
    }
    if (text && (wrote || r % 2 == 0 || rh >= 12)) {
      std::snprintf(b, sizeof b, "%d", b0 * 100);
      label(c, 4, y, b);
    }
    if (wrote) lastText = y;
    if (b0 == ceilBand) c.text(W - 4, y, "BASE", kFontTiny, Align::Right);
  }
  const int me = static_cast<int>(s.altMsl / Profile::kBandM);
  if (me >= lo && me <= hi) {
    const int y = top + 10 + ((hi - me) / group) * rh + rh / 2;
    c.fillTriangle(xClimb - 14, y, xClimb - 6, y - 5, xClimb - 6, y + 5);
  }
  c.hline(0, H - 26, W);
  c.text(W / 2, H - 20, P ? "PROFILE - Page: flight" : "PROFILE  -  Page returns to flight", kFontSmall,
         Align::Center);
}

}  // namespace

void render(Canvas& c, Page p, const Status& s, const Model& m, const DeviceInfo& d, TimeMs t) {
  c.setPortrait(d.portrait);
  c.clear();
  statusBar(c, s, d, t);
  if (p == Page::Info) pageInfo(c, s, d);
  else if (p == Page::Profile) pageProfile(c, s);
  else if (p == Page::Side) pageSide(c, s, m, t);
  else if (m.thermalView()) pageThermal(c, s, m, t);
  else pageGlide(c, s, m, t);
}

}  // namespace pg::display
