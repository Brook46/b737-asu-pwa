#include "sun.h"

#include <cmath>

#include "profile.h"
#include "terrain.h"

namespace pg {

namespace {
constexpr double kPiD = 3.14159265358979;
constexpr double kMPerDeg = 111195.0;
int dayOfYear(int y, int m, int d) {
  static const int cum[] = {0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334};
  const bool leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
  return cum[(m - 1 + 12) % 12] + d + (leap && m > 2 ? 1 : 0);
}
}  // namespace

SunPos sunPosition(int year, int month, int day, int utcMin, double lat, double lon) {
  const double g = 2 * kPiD / 365.0 * (dayOfYear(year, month, day) - 1 + (utcMin / 60.0 - 12) / 24.0);
  const double eqt = 229.18 * (0.000075 + 0.001868 * std::cos(g) - 0.032077 * std::sin(g) -
                               0.014615 * std::cos(2 * g) - 0.040849 * std::sin(2 * g));
  const double decl = 0.006918 - 0.399912 * std::cos(g) + 0.070257 * std::sin(g) - 0.006758 * std::cos(2 * g) +
                      0.000907 * std::sin(2 * g) - 0.002697 * std::cos(3 * g) + 0.00148 * std::sin(3 * g);
  const double tst = utcMin + eqt + 4.0 * lon;  // true solar time, minutes
  const double ha = (tst / 4.0 - 180.0) * kPiD / 180.0;
  const double la = lat * kPiD / 180.0;
  double cz = std::sin(la) * std::sin(decl) + std::cos(la) * std::cos(decl) * std::cos(ha);
  if (cz > 1) cz = 1;
  if (cz < -1) cz = -1;
  SunPos p;
  p.elevDeg = static_cast<float>(90.0 - std::acos(cz) * 180.0 / kPiD);
  // Azimuth from south (+ west), then from north.
  const double azS = std::atan2(std::sin(ha), std::cos(ha) * std::sin(la) - std::tan(decl) * std::cos(la));
  p.azDeg = static_cast<float>(std::fmod(azS * 180.0 / kPiD + 180.0 + 360.0, 360.0));
  return p;
}

void ThermalSources::reset() {
  n_ = 0;
  valid_ = false;
  lastUtc_ = lastDay_ = -1;
  for (auto& r : heat_)
    for (auto& h : r) h = 0;
}

void ThermalSources::cellLatLon(int i, int j, double& lat, double& lon) const {
  const double half = (kN - 1) / 2.0;
  lat = lat0_ + (j - half) * kCellM / kMPerDeg;
  lon = lon0_ + (i - half) * kCellM / (kMPerDeg * std::cos(lat0_ * kPiD / 180.0));
}

float ThermalSources::heatingAt(double lat, double lon) const {
  if (!valid_) return 0;
  const double half = (kN - 1) / 2.0;
  const int j = static_cast<int>(std::lround((lat - lat0_) * kMPerDeg / kCellM + half));
  const int i = static_cast<int>(std::lround((lon - lon0_) * kMPerDeg * std::cos(lat0_ * kPiD / 180.0) / kCellM + half));
  if (i < 0 || j < 0 || i >= kN || j >= kN) return 0;
  return heat_[j][i];
}

void ThermalSources::update(const Terrain& terr, double lat, double lon, int year, int month, int day, int utcMin,
                            float windN, float windE) {
  // Re-centre (and restart heating) when you've flown far from the grid's middle.
  float dn = static_cast<float>((lat - lat0_) * kMPerDeg);
  float de = static_cast<float>((lon - lon0_) * kMPerDeg * std::cos(lat0_ * kPiD / 180.0));
  const int dayKey = year * 400 + month * 32 + day;
  const bool recentre = !valid_ || dn * dn + de * de > 6000.0f * 6000.0f || dayKey != lastDay_;
  float keep = 0;  // weight of the previous heating
  if (recentre) {
    lat0_ = lat;
    lon0_ = lon;
    for (int j = 0; j < kN; ++j)
      for (int i = 0; i < kN; ++i) {
        double la, lo;
        cellLatLon(i, j, la, lo);
        float e = 0;
        if (!terr.elevation(la, lo, e)) e = -9999;
        elev_[j][i] = e;
      }
  } else if (lastUtc_ >= 0 && utcMin > lastUtc_) {
    keep = std::exp(-(utcMin - lastUtc_) / 45.0f);  // ~45 min response
  }
  lastUtc_ = utcMin;
  lastDay_ = dayKey;

  sun_ = sunPosition(year, month, day, utcMin, lat0_, lon0_);
  const float el = sun_.elevDeg * kDegToRad, az = sun_.azDeg * kDegToRad;
  const float sx = std::sin(az) * std::cos(el), sy = std::cos(az) * std::cos(el), sz = std::sin(el);
  const float tanEl = std::tan(el > 0.01f ? el : 0.01f);

  // 1. Sun on each cell, with shade and water.
  for (int j = 0; j < kN; ++j)
    for (int i = 0; i < kN; ++i) {
      const float h = elev_[j][i];
      float insol = 0;
      if (h > -9000 && sun_.elevDeg > 2) {
        auto e = [&](int a, int b) {
          a = a < 0 ? 0 : (a >= kN ? kN - 1 : a);
          b = b < 0 ? 0 : (b >= kN ? kN - 1 : b);
          return elev_[b][a] < -9000 ? h : elev_[b][a];
        };
        const float dzdx = (e(i + 1, j) - e(i - 1, j)) / (2 * kCellM);
        const float dzdy = (e(i, j + 1) - e(i, j - 1)) / (2 * kCellM);
        const float nl = std::sqrt(dzdx * dzdx + dzdy * dzdy + 1);
        insol = (-dzdx * sx - dzdy * sy + sz) / nl;
        if (insol < 0) insol = 0;
        // Shade: does terrain toward the sun rise above the sun's line?
        double la, lo;
        cellLatLon(i, j, la, lo);
        for (float d = 300; d <= 6000 && insol > 0; d += 300) {
          float th;
          const double pla = la + std::cos(az) * d / kMPerDeg;
          const double plo = lo + std::sin(az) * d / (kMPerDeg * std::cos(la * kPiD / 180.0));
          if (terr.elevation(pla, plo, th) && th > h + d * tanEl) insol = 0.1f * sz;  // diffuse light only
        }
        // Water (the Kinneret, sea): flat and low barely heats the air.
        if (h < -150 && nl < 1.0005f) insol *= 0.1f;
      }
      heat_[j][i] = keep * heat_[j][i] + (1 - keep) * insol;
    }

  // 2. Trigger score: heating, contrast with the surroundings, prominence.
  static float score[kN][kN];
  float best = 0;
  for (int j = 0; j < kN; ++j)
    for (int i = 0; i < kN; ++i) {
      if (elev_[j][i] < -9000) {
        score[j][i] = 0;
        continue;
      }
      float hs = 0, es = 0;
      int n = 0;
      bool edge = false;  // next to the map's edge: no fair comparison, not a source
      for (int b = j - 3; b <= j + 3; ++b)
        for (int a = i - 3; a <= i + 3; ++a) {
          if (a < 0 || b < 0 || a >= kN || b >= kN || elev_[b][a] < -9000) {
            edge = true;
            continue;
          }
          hs += heat_[b][a];
          es += elev_[b][a];
          ++n;
        }
      const float contrast = heat_[j][i] - hs / n;
      const float prom = elev_[j][i] - es / n;
      // Prominence and contrast only help release air that is being heated:
      // a shaded spur triggers nothing.
      float sc = heat_[j][i] * (1.0f + 1.5f * (contrast > 0 ? contrast : 0) + (prom > 0 ? prom / 400.0f : 0));
      if (edge) sc = 0;
      score[j][i] = sc;
      if (sc > best) best = sc;
    }

  // 3. Release points: local maxima; in wind, moved to the crest downwind.
  const float wspd = std::sqrt(windN * windN + windE * windE);
  float windFactor = 1;
  if (wspd > 6) windFactor = wspd > 12 ? 0.4f : 1 - 0.6f * (wspd - 6) / 6;
  const float sunFactor = sun_.elevDeg < 10 ? 0 : (sun_.elevDeg > 45 ? 1.0f : (sun_.elevDeg - 10) / 35);
  n_ = 0;
  for (int j = 1; j < kN - 1 && best > 0; ++j)
    for (int i = 1; i < kN - 1; ++i) {
      const float sc = score[j][i];
      bool peak = sc > 0.25f * best;
      for (int b = -1; b <= 1 && peak; ++b)
        for (int a = -1; a <= 1; ++a)
          if ((a || b) && score[j + b][i + a] > sc) peak = false;
      if (!peak) continue;
      int ri = i, rj = j;
      if (wspd > 3) {  // warm air is pushed up to the crest downwind (up to 1 km)
        const float ux = windE / wspd, uy = windN / wspd;
        for (int k = 1; k <= 2; ++k) {
          const int a = i + static_cast<int>(std::lround(ux * k)), b = j + static_cast<int>(std::lround(uy * k));
          if (a < 0 || b < 0 || a >= kN || b >= kN) break;
          if (elev_[b][a] > elev_[rj][ri]) {
            ri = a;
            rj = b;
          }
        }
      }
      ThermalSource src;
      cellLatLon(ri, rj, src.lat, src.lon);
      src.ground = elev_[rj][ri];
      src.strength = sc / best * windFactor * sunFactor;
      // keep the strongest kMax, merging release points that coincide
      bool merged = false;
      for (int k = 0; k < n_; ++k)
        if (s_[k].lat == src.lat && s_[k].lon == src.lon) {
          if (src.strength > s_[k].strength) s_[k].strength = src.strength;
          merged = true;
        }
      if (merged) continue;
      if (n_ < kMax) {
        s_[n_++] = src;
      } else {
        int w = 0;
        for (int k = 1; k < n_; ++k)
          if (s_[k].strength < s_[w].strength) w = k;
        if (src.strength > s_[w].strength) s_[w] = src;
      }
    }
  valid_ = true;
}

void thermalColumnAt(double srcLat, double srcLon, float ground, float alt, float rise, const Profile* prof, float wN,
                     float wE, double& lat, double& lon, float halfDepth) {
  if (rise < 1.0f) rise = 1.0f;
  float dn = 0, de = 0;
  const float top = alt + halfDepth;
  for (float z = ground; z < top; z += 100) {
    const float dz = top - z < 100 ? top - z : 100;
    float n = wN, e = wE;
    if (prof) prof->windBetween(z, z + dz, n, e);  // the layer's wind if we've measured it
    dn += n * dz / rise;
    de += e * dz / rise;
  }
  lat = srcLat + dn / kMPerDeg;
  lon = srcLon + de / (kMPerDeg * std::cos(srcLat * kPiD / 180.0));
}

}  // namespace pg
