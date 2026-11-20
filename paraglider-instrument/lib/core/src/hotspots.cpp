#include "hotspots.h"

#include <cmath>
#include <cstring>

namespace pg {

namespace {
constexpr double kPiD = 3.14159265358979;
constexpr double kMPerDeg = 111195.0;
int32_t rd32(const uint8_t* p) {
  return static_cast<int32_t>(p[0] | (p[1] << 8) | (p[2] << 16) | (static_cast<uint32_t>(p[3]) << 24));
}
int dayOfYear(int y, int m, int d) {
  static const int cum[] = {0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334};
  const bool leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
  return cum[(m - 1) % 12] + d + (leap && m > 2 ? 1 : 0);
}
}  // namespace

namespace {
// Solar noon and the half-day hour angle (minutes, degrees).
void solarDay(int year, int month, int day, double lat, double lon, double& noonMin, double& ha);
}  // namespace

int sunriseUtcMin(int year, int month, int day, double lat, double lon) {
  double noon, ha;
  solarDay(year, month, day, lat, lon, noon, ha);
  return static_cast<int>(std::lround(noon - 4.0 * ha));
}

int sunsetUtcMin(int year, int month, int day, double lat, double lon) {
  double noon, ha;
  solarDay(year, month, day, lat, lon, noon, ha);
  return static_cast<int>(std::lround(noon + 4.0 * ha));
}

namespace {
void solarDay(int year, int month, int day, double lat, double lon, double& noonMin, double& haOut) {
  const double g = 2 * kPiD / 365.0 * (dayOfYear(year, month, day) - 1);
  const double eqt = 229.18 * (0.000075 + 0.001868 * std::cos(g) - 0.032077 * std::sin(g) -
                               0.014615 * std::cos(2 * g) - 0.040849 * std::sin(2 * g));
  const double decl = 0.006918 - 0.399912 * std::cos(g) + 0.070257 * std::sin(g) - 0.006758 * std::cos(2 * g) +
                      0.000907 * std::sin(2 * g) - 0.002697 * std::cos(3 * g) + 0.00148 * std::sin(3 * g);
  const double la = lat * kPiD / 180.0;
  double c = std::cos(90.833 * kPiD / 180.0) / (std::cos(la) * std::cos(decl)) - std::tan(la) * std::tan(decl);
  if (c > 1) c = 1;
  if (c < -1) c = -1;
  haOut = std::acos(c) * 180.0 / kPiD;
  noonMin = 720.0 - 4.0 * lon - eqt;
}
}  // namespace

int seasonOf(int month) {
  if (month == 12 || month <= 2) return 0;
  if (month <= 5) return 1;
  if (month <= 8) return 2;
  return 3;
}

int slotOf(float h) { return h < 5.5f ? 0 : (h < 8.5f ? 1 : 2); }

bool HotspotMap::load(const uint8_t* d, size_t len) {
  n_ = 0;
  if (!d || len < 36 || std::memcmp(d, "PGHS", 4) != 0 || (d[4] | (d[5] << 8)) != 1) return false;
  const int count = d[6] | (d[7] << 8);
  if (len < 36 + static_cast<size_t>(count) * 20) return false;
  for (int h = 0; h < 24; ++h) setDayFactor(h, d[8 + h] == 255 ? -1.0f : d[8 + h] / 100.0f);
  utcOffsetMin_ = static_cast<int16_t>(d[32] | (d[33] << 8));
  const uint8_t* p = d + 36;
  for (int i = 0; i < count && n_ < kMax; ++i, p += 20) {
    Hotspot h;
    h.lat = rd32(p) / 1e6;
    h.lon = rd32(p + 4) / 1e6;
    std::memcpy(h.prob, p + 8, 12);
    add(h);
  }
  return true;
}

void HotspotMap::add(const Hotspot& h) {
  if (!dayInit_) {
    for (auto& f : dayFactor_) f = -1;
    dayInit_ = true;
  }
  if (n_ < kMax) h_[n_++] = h;
}

void HotspotMap::setDayFactor(int hour, float f) {
  if (!dayInit_) {
    for (auto& x : dayFactor_) x = -1;
    dayInit_ = true;
  }
  if (hour >= 0 && hour < 24) dayFactor_[hour] = f < 0 ? -1 : static_cast<int16_t>(f * 100);
}

float HotspotMap::chance(int i, int year, int month, int day, int utcMin) const {
  const Hotspot& h = h_[i];
  const int sr = sunriseUtcMin(year, month, day, h.lat, h.lon);
  const float hrs = (utcMin - sr) / 60.0f;
  if (hrs < 1.5f) return 0;  // too early for thermals
  float c = h.prob[seasonOf(month)][slotOf(hrs)] / 100.0f;
  const int localHour = (((utcMin + utcOffsetMin_) / 60) % 24 + 24) % 24;
  if (dayInit_ && dayFactor_[localHour] >= 0) c *= dayFactor_[localHour] / 100.0f;
  return c > 1 ? 1 : c;
}

float arrivalAgl(const Polar& p, const Terrain* terr, double lat, double lon, float alt, double tLat, double tLon,
                 float wN, float wE, float& bearing, float& dist) {
  const double dN = (tLat - lat) * kMPerDeg;
  const double dE = (tLon - lon) * kMPerDeg * std::cos(lat * kPiD / 180.0);
  dist = static_cast<float>(std::sqrt(dN * dN + dE * dE));
  bearing = static_cast<float>(std::fmod(std::atan2(dE, dN) * 180.0 / kPiD + 360.0, 360.0));
  float ground = 0;
  if (terr) terr->elevation(tLat, tLon, ground);
  if (dist < 1) return alt - ground;
  const float ux = static_cast<float>(dE / dist), uy = static_cast<float>(dN / dist);
  const float along = wE * ux + wN * uy, cross = -wE * uy + wN * ux;
  const float v = p.speedToFly(0, 0, -along);  // fastest-range speed in this headwind
  const float gsq = v * v - cross * cross;
  if (gsq <= 0) return -1e6f;
  const float gs = std::sqrt(gsq) + along;
  if (gs <= 0.5f) return -1e6f;
  return alt - p.sink(v) * dist / gs - ground;
}

float targetScore(float chance, float arr, float dist, float minArrival) {
  float reach = (arr - minArrival) / 300.0f + 0.5f;
  if (reach > 1) reach = 1;
  return chance * reach / (1.0f + dist / 6000.0f);
}

Target bestHotspot(const HotspotMap& m, const Polar& p, const Terrain* terr, double lat, double lon, float alt,
                   float wN, float wE, int year, int month, int day, int utcMin, float minArrival) {
  Target best;
  float bestScore = 0;
  for (int i = 0; i < m.count(); ++i) {
    const float ch = m.chance(i, year, month, day, utcMin);
    if (ch < 0.15f) continue;
    float brg, dist;
    const float arr = arrivalAgl(p, terr, lat, lon, alt, m.at(i).lat, m.at(i).lon, wN, wE, brg, dist);
    if (dist < 400 || arr < minArrival) continue;
    const float score = targetScore(ch, arr, dist, minArrival);
    if (score > bestScore) {
      bestScore = score;
      best = {true, false, i, m.at(i).lat, m.at(i).lon, brg, dist, arr, ch};
    }
  }
  return best;
}

}  // namespace pg
