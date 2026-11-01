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
    case Page::Thermal: return "THERMAL";
    case Page::Glide: return "GLIDE";
    case Page::Air: return "AIR";
    case Page::System: return "SYSTEM";
    default: return "";
  }
}

// ---------------------------------------------------------------- model

void Model::update(TimeMs t, const Status& s) {
  if (lastSample_ && t - lastSample_ < 1000) return;
  lastSample_ = t;
  tr_[(head_ + n_) % kTrace] = s.vario;
  if (n_ < kTrace) ++n_;
  else head_ = (head_ + 1) % kTrace;

  const int gi = (gHead_ + gN_) % kGlideN;
  gAlt_[gi] = s.altitude;
  gLat_[gi] = s.gnss.lat;
  gLon_[gi] = s.gnss.lon;
  gCircling_[gi] = s.circling || !s.gnss.valid();
  if (gN_ < kGlideN) ++gN_;
  else gHead_ = (gHead_ + 1) % kGlideN;
}

void Model::noteAlert(Alert a, TimeMs t) {
  if (a == Alert::NearBase || a == Alert::Inversion || a == Alert::Message) {
    banner_ = a;
    bannerT_ = t;
  }
}

Alert Model::banner(TimeMs t) const {
  return banner_ != Alert::None && t - bannerT_ < 10000 ? banner_ : Alert::None;
}

float Model::trace(int i) const { return tr_[(head_ + i) % kTrace]; }

bool Model::glideRatio(float& ld) const {
  if (gN_ < kGlideN) return false;
  for (int i = 0; i < gN_; ++i)
    if (gCircling_[(gHead_ + i) % kGlideN]) return false;
  const int a = gHead_, b = (gHead_ + gN_ - 1) % kGlideN;
  const double dN = (gLat_[b] - gLat_[a]) * 111195.0;
  const double dE = (gLon_[b] - gLon_[a]) * 111195.0 * std::cos(gLat_[a] * 0.0174533);
  const double dist = std::sqrt(dN * dN + dE * dE);
  const float loss = gAlt_[a] - gAlt_[b];
  if (loss < 3.0f) {
    ld = 99.0f;  // climbing or level: show as "--"
    return true;
  }
  ld = static_cast<float>(dist / loss);
  return true;
}

// ---------------------------------------------------------------- helpers

namespace {

void fmtSigned(char* b, size_t n, float v) {
  if (std::fabs(v) < 0.05f) v = 0.0f;
  std::snprintf(b, n, "%+.1f", static_cast<double>(v));
}

// Wind: arrow pointing where the air goes, inside a ring.
void windArrow(Canvas& c, int cx, int cy, int r, const WindEstimate& w) {
  c.circle(cx, cy, r);
  c.pixel(cx, cy - r - 2);  // north tick
  c.vline(cx, cy - r - 4, 3);
  if (!w.valid) {
    c.text(cx, cy - kFontSmall.lineHeight / 2, "?", kFontSmall, Align::Center);
    return;
  }
  const float to = (w.fromDeg + 180.0f) * 0.0174533f;
  const float sx = std::sin(to), sy = -std::cos(to);
  const int tipX = cx + static_cast<int>(sx * (r - 3)), tipY = cy + static_cast<int>(sy * (r - 3));
  const int tailX = cx - static_cast<int>(sx * (r - 5)), tailY = cy - static_cast<int>(sy * (r - 5));
  c.line(tailX, tailY, tipX, tipY, true, 3);
  const float px = -sy, py = sx;  // perpendicular
  const int bx = cx + static_cast<int>(sx * (r - 13)), by = cy + static_cast<int>(sy * (r - 13));
  c.fillTriangle(tipX, tipY, bx + static_cast<int>(px * 7), by + static_cast<int>(py * 7),
                 bx - static_cast<int>(px * 7), by - static_cast<int>(py * 7));
}

void statusBar(Canvas& c, Page p, const Status& s, const DeviceInfo& d) {
  c.fillRect(0, 0, gfx::kWidth, 17);
  c.text(4, 2, pageName(p), kFontTiny, Align::Left, false);
  // page dots
  for (int i = 0; i < static_cast<int>(Page::Count); ++i) {
    const int x = 74 + i * 9;
    if (i == static_cast<int>(p)) c.fillRect(x, 6, 6, 6, false);
    else c.rect(x, 6, 6, 6, false);
  }
  char b[48];
  if (d.clockMin >= 0) {
    std::snprintf(b, sizeof b, "%02d:%02d", d.clockMin / 60 % 24, d.clockMin % 60);
    c.text(200, 2, b, kFontTiny, Align::Center, false);
  }
  int x = 396;
  if (d.batteryPct >= 0) {
    // battery icon
    c.rect(x - 22, 4, 20, 9, false);
    c.fillRect(x - 2, 6, 2, 5, false);
    c.fillRect(x - 20, 6, (16 * (d.batteryPct > 100 ? 100 : d.batteryPct)) / 100, 5, false);
    std::snprintf(b, sizeof b, "%d%%", d.batteryPct);
    x -= 26;
    x -= c.text(x, 2, b, kFontTiny, Align::Right, false) + 8;
  }
  if (s.gnss.valid()) std::snprintf(b, sizeof b, "GPS %u", s.gnss.sats);
  else std::snprintf(b, sizeof b, "GPS --");
  x -= c.text(x, 2, b, kFontTiny, Align::Right, false) + 8;
  if (d.xctLinked) x -= c.text(x, 2, "XCT", kFontTiny, Align::Right, false) + 8;
  if (s.muted) x -= c.text(x, 2, "MUTE", kFontTiny, Align::Right, false) + 8;
  if (d.simulated) c.text(x, 2, "SIM", kFontTiny, Align::Right, false);
}

// Vertical vario bar on the left: ±5 m/s, filled from zero.
void varioBar(Canvas& c, float v, float avg) {
  const int x = 2, w = 20, top = 22, bot = 236, mid = (top + bot) / 2;
  const float pxPer = (mid - top) / 5.0f;
  c.rect(x, top, w, bot - top);
  for (int i = -5; i <= 5; ++i) {
    const int y = mid - static_cast<int>(i * pxPer);
    c.hline(x, y, i == 0 ? w : 5);
  }
  float vc = v > 5 ? 5 : (v < -5 ? -5 : v);
  const int vy = mid - static_cast<int>(vc * pxPer);
  if (vy < mid) c.fillRect(x + 6, vy, w - 9, mid - vy);
  else c.fillRect(x + 6, mid, w - 9, vy - mid + 1);
  float ac = avg > 5 ? 5 : (avg < -5 ? -5 : avg);
  const int ay = mid - static_cast<int>(ac * pxPer);
  c.fillTriangle(x + w + 1, ay, x + w + 7, ay - 5, x + w + 7, ay + 5);
}

void trace(Canvas& c, const Model& m, int x, int y, int w, int h) {
  const int mid = y + h / 2;
  const float pxPer = (h / 2) / 4.0f;  // ±4 m/s
  c.dotted(x, mid, w, 2);
  c.dotted(x, mid - static_cast<int>(2 * pxPer), w, 6);
  c.dotted(x, mid + static_cast<int>(2 * pxPer), w, 6);
  const int n = m.traceCount();
  for (int i = 0; i < n && i < w; ++i) {
    float v = m.trace(n - 1 - i);
    v = v > 4 ? 4 : (v < -4 ? -4 : v);
    const int px = x + w - 1 - i;
    const int vy = mid - static_cast<int>(v * pxPer);
    if (v > 0) c.vline(px, vy, mid - vy);
    else c.pixel(px, vy);  // sink: just the outline, so climbs stand out
  }
  c.text(x, y, "+4", kFontTiny);
  c.text(x, y + h - kFontTiny.lineHeight, "-4", kFontTiny);
}

void banner(Canvas& c, int x, int y, int w, int h, const char* big, const char* small) {
  c.fillRect(x, y, w, h);
  c.text(x + 10, y + (h - kFontLarge.lineHeight) / 2 + 1, big, kFontLarge, Align::Left, false);
  if (small) c.text(x + w - 8, y + (h - kFontSmall.lineHeight) / 2, small, kFontSmall, Align::Right, false);
}

void label(Canvas& c, int x, int y, const char* s, Align a = Align::Left) { c.text(x, y, s, kFontTiny, a); }

// ---------------------------------------------------------------- pages

void pageThermal(Canvas& c, const Status& s, const Model& m, TimeMs t) {
  char b[96], b2[32];
  varioBar(c, s.vario, s.avg);

  // Big vario number.
  fmtSigned(b, sizeof b, s.vario);
  c.text(246, 16, b, kFontHuge, Align::Right);
  label(c, 250, 70, "m/s");
  fmtSigned(b2, sizeof b2, s.avg);
  std::snprintf(b, sizeof b, "avg %s", b2);
  c.text(36, 88, b, kFontMedium);
  if (s.circling && s.advisor.thermalGain != 0.0f) {
    fmtSigned(b2, sizeof b2, s.advisor.thermalAvg);
    std::snprintf(b, sizeof b, "thermal %s m/s  gain %+.0f m", b2, static_cast<double>(s.advisor.thermalGain));
    c.text(36, 110, b, kFontSmall);
  }

  // Right column.
  c.vline(268, 20, 182);
  label(c, 276, 20, "ALT m");
  std::snprintf(b, sizeof b, "%.0f", static_cast<double>(s.altitude));
  c.text(396, 28, b, kFontLarge, Align::Right);
  c.hline(272, 68, 128);
  label(c, 276, 72, s.advisor.mc > 0 ? "MC" : "MC");
  std::snprintf(b, sizeof b, "%.1f", static_cast<double>(s.advisor.mc));
  c.text(352, 76, b, kFontMedium, Align::Right);
  label(c, 358, 82, "auto");
  c.hline(272, 102, 128);
  windArrow(c, 296, 132, 20, s.wind);
  if (s.wind.valid) {
    std::snprintf(b, sizeof b, "%.0f", static_cast<double>(s.wind.speed * 3.6f));
    c.text(394, 114, b, kFontMedium, Align::Right);
    label(c, 394, 138, "km/h", Align::Right);
  } else {
    label(c, 394, 124, "wind ...", Align::Right);
  }
  c.hline(272, 160, 128);
  label(c, 276, 164, "BASE m");
  if (s.air.baseValid) {
    std::snprintf(b, sizeof b, "%.0f", static_cast<double>(s.air.cloudBase));
    c.text(396, 172, b, kFontMedium, Align::Right);
    std::snprintf(b, sizeof b, "%+.0f", static_cast<double>(s.air.cloudBase - s.altitude));
    label(c, 276, 184, b);
    if (!s.air.baseFromThermal) label(c, 330, 164, "rough");
  } else {
    label(c, 396, 178, "--", Align::Right);
  }

  // Vario trace.
  trace(c, m, 36, 128, 226, 74);

  // Bottom: advice / event banner / info line.
  const Alert ev = m.banner(t);
  if (ev == Alert::NearBase) {
    std::snprintf(b, sizeof b, "%+.0f m", static_cast<double>(s.air.cloudBase - s.altitude));
    banner(c, 30, 206, 368, 32, "CLOUD BASE", b);
  } else if (ev == Alert::Inversion) {
    banner(c, 30, 206, 368, 32, "INVERSION", "top of lift near");
  } else if (ev == Alert::Message) {
    banner(c, 30, 206, 368, 32, "MESSAGE", "FANET");
  } else if (s.advisor.advice == Advice::Stay) {
    if (s.circling) {
      fmtSigned(b2, sizeof b2, s.advisor.circleClimb);
      std::snprintf(b, sizeof b, "circle %s", b2);
    } else {
      fmtSigned(b2, sizeof b2, s.advisor.expectedClimb);
      std::snprintf(b, sizeof b, "expect %s", b2);
    }
    banner(c, 30, 206, 368, 32, "STAY", b);
  } else if (s.advisor.advice == Advice::Glide) {
    fmtSigned(b2, sizeof b2, s.advisor.circleClimb);
    std::snprintf(b, sizeof b, "circle %s < MC %.1f", b2, static_cast<double>(s.advisor.mc));
    banner(c, 30, 206, 368, 32, "GLIDE", b);
  } else {
    c.hline(30, 206, 368);
    std::snprintf(b, sizeof b, "STF %.0f km/h", static_cast<double>(s.stf));
    c.text(36, 214, b, kFontMedium);
    fmtSigned(b2, sizeof b2, s.netto);
    std::snprintf(b, sizeof b, "netto %s", b2);
    c.text(396, 216, b, kFontSmall, Align::Right);
  }
}

void pageGlide(Canvas& c, const Status& s, const Model& m) {
  char b[96], b2[32];
  label(c, 8, 22, "SPEED TO FLY km/h");
  std::snprintf(b, sizeof b, "%.0f", static_cast<double>(s.stf));
  c.text(8, 32, b, kFontHuge);
  std::snprintf(b, sizeof b, "MC %.1f", static_cast<double>(s.advisor.mc));
  c.text(8, 102, b, kFontMedium);

  // Right: values
  struct Row { const char* name; char val[16]; };
  Row rows[4];
  rows[0].name = "GROUND km/h";
  std::snprintf(rows[0].val, sizeof rows[0].val, "%.0f", static_cast<double>(s.gnss.groundSpeed * 3.6f));
  rows[1].name = "AIR km/h (est)";
  std::snprintf(rows[1].val, sizeof rows[1].val, "%.0f", static_cast<double>(s.airspeed * 3.6f));
  rows[2].name = "NETTO m/s";
  fmtSigned(rows[2].val, sizeof rows[2].val, s.netto);
  rows[3].name = "GLIDE L/D 30 s";
  float ld;
  if (m.glideRatio(ld)) {
    if (ld >= 99.0f) std::snprintf(rows[3].val, sizeof rows[3].val, "--");
    else std::snprintf(rows[3].val, sizeof rows[3].val, "%.1f", static_cast<double>(ld));
  } else {
    std::snprintf(rows[3].val, sizeof rows[3].val, s.circling ? "circ" : "...");
  }
  c.vline(214, 20, 120);
  for (int i = 0; i < 4; ++i) {
    const int y = 22 + i * 30;
    label(c, 222, y, rows[i].name);
    c.text(396, y + 6, rows[i].val, kFontMedium, Align::Right);
    if (i < 3) c.dotted(222, y + 28, 176, 3);
  }

  // Bottom: wind and vario.
  c.hline(0, 146, 400);
  windArrow(c, 52, 192, 36, s.wind);
  label(c, 100, 152, "WIND");
  if (s.wind.valid) {
    std::snprintf(b, sizeof b, "%.0f km/h", static_cast<double>(s.wind.speed * 3.6f));
    c.text(100, 166, b, kFontMedium);
    std::snprintf(b, sizeof b, "from %03.0f\x7f", static_cast<double>(s.wind.fromDeg));
    c.text(100, 190, b, kFontSmall);
  } else {
    c.text(100, 170, "circle once", kFontSmall);
  }
  label(c, 396, 152, "VARIO m/s", Align::Right);
  fmtSigned(b, sizeof b, s.vario);
  c.text(396, 164, b, kFontLarge, Align::Right);
  fmtSigned(b2, sizeof b2, s.avg);
  std::snprintf(b, sizeof b, "avg %s", b2);
  c.text(396, 206, b, kFontSmall, Align::Right);
}

void pageAir(Canvas& c, const Status& s, const FlightComputerConfig* /*unused*/) {
  char b[96];
  const AtmosphereState& a = s.air;
  label(c, 8, 22, "CLOUD BASE m");
  if (a.baseValid) {
    std::snprintf(b, sizeof b, "%.0f", static_cast<double>(a.cloudBase));
    c.text(8, 30, b, kFontHuge);
    std::snprintf(b, sizeof b, "%+.0f m from you", static_cast<double>(a.cloudBase - s.altitude));
    c.text(8, 98, b, kFontMedium);
    c.text(8, 122, a.baseFromThermal ? "from thermal air" : "rough: not from a thermal yet", kFontSmall);
  } else {
    c.text(8, 40, "--", kFontHuge);
    c.text(8, 122, a.haveAir ? "waiting for altitude" : "no humidity sensor", kFontSmall);
  }

  c.vline(240, 20, 124);
  struct Row { const char* name; char val[16]; };
  Row rows[3];
  rows[0].name = "AIR \x7f" "C";
  rows[1].name = "DEW POINT \x7f" "C";
  rows[2].name = "HUMIDITY %";
  if (a.haveAir) {
    std::snprintf(rows[0].val, 16, "%.1f", static_cast<double>(a.tempC));
    std::snprintf(rows[1].val, 16, "%.1f", static_cast<double>(a.dewPointC));
    std::snprintf(rows[2].val, 16, "%.0f", static_cast<double>(a.rh));
  } else {
    for (auto& r : rows) std::snprintf(r.val, 16, "--");
  }
  for (int i = 0; i < 3; ++i) {
    const int y = 22 + i * 40;
    label(c, 248, y, rows[i].name);
    c.text(396, y + 10, rows[i].val, kFontMedium, Align::Right);
  }

  // Lapse-rate gauge 0..12 °C/km with the stable / unstable marks.
  c.hline(0, 148, 400);
  label(c, 8, 154, "LAPSE RATE \x7f" "C/km");
  const int gx = 8, gy = 196, gw = 384, gh = 14;
  c.rect(gx, gy, gw, gh);
  auto px = [&](float v) { return gx + static_cast<int>(v / 12.0f * gw); };
  c.vline(px(6.5f), gy - 4, gh + 8);
  c.vline(px(8.5f), gy - 4, gh + 8);
  c.vline(px(9.8f), gy - 2, gh + 4);
  label(c, px(6.5f) - 40, gy + gh + 4, "stable");
  label(c, px(8.5f) + 4, gy + gh + 4, "unstable");
  label(c, px(9.8f) - 6, gy - 16, "dry");
  if (a.lapseValid) {
    float v = a.lapseRate < 0 ? 0 : (a.lapseRate > 12 ? 12 : a.lapseRate);
    c.fillRect(gx + 2, gy + 2, px(v) - gx - 2, gh - 4);
    const char* st = a.stability == Stability::Unstable ? "unstable"
                     : a.stability == Stability::Moderate ? "moderate"
                     : a.stability == Stability::Stable ? "stable" : "inversion";
    std::snprintf(b, sizeof b, "%.1f  %s", static_cast<double>(a.lapseRate), st);
    c.text(396, 160, b, kFontMedium, Align::Right);
  } else {
    c.text(396, 164, "glide 250 m+ to measure", kFontSmall, Align::Right);
  }
  if (a.inversion) {
    c.fillRect(0, 226, 400, 14);
    c.text(200, 226, "INVERSION IN THIS CLIMB", kFontTiny, Align::Center, false);
  }
}

void pageSystem(Canvas& c, const Status& s, const DeviceInfo& d) {
  char b[64];
  struct Row { const char* name; char val[40]; };
  Row r[8];
  r[0].name = "GPS";
  if (s.gnss.valid())
    std::snprintf(r[0].val, 40, "%s  %u sats  ±%.0f m", s.gnss.fix == FixType::Fix3D ? "3D" : "2D", s.gnss.sats,
                  static_cast<double>(s.gnss.hAcc));
  else std::snprintf(r[0].val, 40, "searching");
  r[1].name = "BARO";
  std::snprintf(r[1].val, 40, "%s  %s", s.baro == BaroOrigin::Onboard ? d.baroName
                                       : s.baro == BaroOrigin::XcTracer ? "XCTracer" : "none",
                s.air.haveAir ? "+ humidity" : "");
  r[2].name = "IMU";
  std::snprintf(r[2].val, 40, "%s", s.imu ? "LSM6DS3 on" : "off");
  r[3].name = "XCTRACER";
  std::snprintf(r[3].val, 40, "%s", d.xctLinked ? "linked" : "not linked");
  r[4].name = "FANET";
  std::snprintf(r[4].val, 40, "%s  rx %lu  tx %s", d.fanetRegion, static_cast<unsigned long>(d.fanetRx),
                d.txEnabled ? "ON" : "off");
  r[5].name = "AUDIO";
  std::snprintf(r[5].val, 40, "volume %d%s", s.volume, s.muted ? "  muted" : "");
  r[6].name = "WIND FIT";
  if (s.wind.valid) std::snprintf(r[6].val, 40, "quality %.2f", static_cast<double>(s.wind.quality));
  else std::snprintf(r[6].val, 40, "--");
  r[7].name = "THERMALS";
  std::snprintf(r[7].val, 40, "MC %.1f", static_cast<double>(s.advisor.mc));
  for (int i = 0; i < 8; ++i) {
    const int y = 24 + i * 26;
    c.text(8, y, r[i].name, kFontSmall);
    c.text(396, y, r[i].val, kFontSmall, Align::Right);
    c.dotted(8, y + 21, 384, 3);
  }
  (void)b;
}

}  // namespace

void render(Canvas& c, Page p, const Status& s, const Model& m, const DeviceInfo& d, TimeMs t) {
  c.clear();
  statusBar(c, p, s, d);
  switch (p) {
    case Page::Thermal: pageThermal(c, s, m, t); break;
    case Page::Glide: pageGlide(c, s, m); break;
    case Page::Air: pageAir(c, s, nullptr); break;
    case Page::System: pageSystem(c, s, d); break;
    default: break;
  }
}

}  // namespace pg::display
