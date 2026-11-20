#include "nmea.h"

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>

namespace pg {

namespace {

int hexVal(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  return -1;
}

// Splits the body of a sentence (after "$TAG,") into fields in place. Empty
// fields are kept as empty strings so positions stay meaningful.
constexpr int kMaxFields = 24;
struct Fields {
  char buf[LineAssembler::kMax + 1];
  const char* f[kMaxFields];
  int n = 0;
};

bool split(const char* line, const char* tag, Fields& out) {
  const size_t tagLen = std::strlen(tag);
  if (line[0] != '$' || std::strncmp(line + 1, tag, tagLen) != 0 || line[1 + tagLen] != ',')
    return false;
  if (!nmeaChecksumOk(line)) return false;
  const char* body = line + 2 + tagLen;
  size_t len = 0;
  while (body[len] && body[len] != '*' && len < LineAssembler::kMax) ++len;
  std::memcpy(out.buf, body, len);
  out.buf[len] = 0;
  out.n = 0;
  char* p = out.buf;
  out.f[out.n++] = p;
  for (; *p; ++p) {
    if (*p == ',') {
      *p = 0;
      if (out.n < kMaxFields) out.f[out.n++] = p + 1;
    }
  }
  return true;
}

bool num(const char* s, double& v) {
  if (!s || !*s) return false;
  char* end = nullptr;
  v = std::strtod(s, &end);
  return end != s;
}

// Like split(), but for any two-letter talker: tag "RMC" matches "$GNRMC,".
bool splitAnyTalker(const char* line, const char* tag, Fields& out) {
  if (line[0] != '$' || !line[1] || !line[2]) return false;
  char fullTag[8];
  std::snprintf(fullTag, sizeof fullTag, "%c%c%s", line[1], line[2], tag);
  return split(line, fullTag, out);
}

// "ddmm.mmmm" / "dddmm.mmmm" + hemisphere → signed degrees.
bool latLon(const char* v, const char* hemi, int degDigits, double& out) {
  if (!v || !*v || !hemi || !*hemi) return false;
  char deg[4] = {};
  for (int i = 0; i < degDigits; ++i) {
    if (!v[i]) return false;
    deg[i] = v[i];
  }
  const double d = std::atof(deg);
  const double m = std::atof(v + degDigits);
  out = d + m / 60.0;
  if (*hemi == 'S' || *hemi == 'W') out = -out;
  return true;
}

}  // namespace

uint8_t nmeaChecksum(const char* body, size_t len) {
  uint8_t cs = 0;
  for (size_t i = 0; i < len; ++i) cs ^= static_cast<uint8_t>(body[i]);
  return cs;
}

bool nmeaChecksumOk(const char* line) {
  if (!line || line[0] != '$') return false;
  const char* star = std::strchr(line, '*');
  if (!star || !star[1] || !star[2]) return false;
  const int hi = hexVal(star[1]), lo = hexVal(star[2]);
  if (hi < 0 || lo < 0) return false;
  return nmeaChecksum(line + 1, static_cast<size_t>(star - line - 1)) == ((hi << 4) | lo);
}

bool parseLk8ex1(const char* line, Lk8ex1& out) {
  Fields fs;
  if (!split(line, "LK8EX1", fs) || fs.n < 5) return false;
  out = Lk8ex1{};
  double v;
  if (num(fs.f[0], v) && v != 999999) {
    out.pressurePa = static_cast<float>(v);
    out.hasPressure = v > 1000;  // reject obvious garbage
  }
  if (num(fs.f[1], v) && v != 99999) {
    out.altitude = static_cast<float>(v);
    out.hasAltitude = true;
  }
  if (num(fs.f[2], v) && v != 9999) {
    out.vario = static_cast<float>(v / 100.0);
    out.hasVario = true;
  }
  if (num(fs.f[3], v) && v != 99) {
    out.tempC = static_cast<float>(v);
    out.hasTemp = true;
  }
  if (num(fs.f[4], v) && v != 999) {
    if (v > 1000)
      out.batteryPct = static_cast<int>(v - 1000);
    else
      out.batteryV = static_cast<float>(v);
  }
  return out.hasPressure || out.hasAltitude || out.hasVario;
}

bool parseXctrc(const char* line, Xctrc& out) {
  Fields fs;
  if (!split(line, "XCTRC", fs) || fs.n < 17) return false;
  out = Xctrc{};
  double v;
  int* ints[] = {&out.year, &out.month, &out.day, &out.hour, &out.minute, &out.second, &out.centi};
  for (int i = 0; i < 7; ++i)
    if (num(fs.f[i], v)) *ints[i] = static_cast<int>(v);
  double lat = 0, lon = 0;
  const bool hasLat = num(fs.f[7], lat), hasLon = num(fs.f[8], lon);
  out.lat = lat;
  out.lon = lon;
  out.hasFix = hasLat && hasLon && !(lat == 0 && lon == 0);
  if (num(fs.f[9], v)) out.altitude = static_cast<float>(v);
  if (num(fs.f[10], v)) out.speedKmh = static_cast<float>(v);
  if (num(fs.f[11], v)) out.course = static_cast<float>(v);
  if (num(fs.f[12], v)) out.climb = static_cast<float>(v);
  if (num(fs.f[16], v)) {
    // Pa vs hPa: anything plausible as hPa (< 2000) is scaled up.
    out.rawPressure = static_cast<float>(v < 2000 ? v * 100.0 : v);
  }
  if (fs.n > 17 && num(fs.f[17], v)) out.batteryPct = static_cast<int>(v);
  return true;
}

size_t nmeaBuild(const char* body, char* out, size_t cap) {
  const size_t n = std::strlen(body);
  if (n + 5 > cap) return 0;
  const int w = std::snprintf(out, cap, "$%s*%02X", body, nmeaChecksum(body, n));
  return w > 0 ? static_cast<size_t>(w) : 0;
}

bool NmeaGnssParser::utc(int& y, int& mo, int& d, int& h, int& mi, int& s) const {
  if (!haveTime_) return false;
  y = y_;
  mo = mo_;
  d = d_;
  h = h_;
  mi = mi_;
  s = s_;
  return true;
}

bool NmeaGnssParser::feed(const char* line, TimeMs now, GnssFix& out) {
  Fields fs;
  double v;
  if (splitAnyTalker(line, "GGA", fs)) {
    // time,lat,N,lon,E,quality,sats,hdop,alt,M,geoid,M,age,station
    if (fs.n < 10) {
      ++bad_;
      return false;
    }
    ++good_;
    quality_ = num(fs.f[5], v) ? static_cast<int>(v) : 0;
    sats_ = num(fs.f[6], v) ? static_cast<uint8_t>(v) : 0;
    hdop_ = num(fs.f[7], v) ? static_cast<float>(v) : 99.0f;
    if (num(fs.f[8], v)) alt_ = static_cast<float>(v);
    haveGga_ = true;
    return false;
  }
  if (splitAnyTalker(line, "RMC", fs)) {
    // time,status,lat,N,lon,E,speed(kn),course,date,magvar,E,mode
    if (fs.n < 9) {
      ++bad_;
      return false;
    }
    ++good_;
    const char* t = fs.f[0];
    const char* date = fs.f[8];
    if (std::strlen(t) >= 6 && std::strlen(date) >= 6) {
      auto two = [](const char* p) { return (p[0] - '0') * 10 + (p[1] - '0'); };
      h_ = two(t);
      mi_ = two(t + 2);
      s_ = two(t + 4);
      d_ = two(date);
      mo_ = two(date + 2);
      y_ = 2000 + two(date + 4);
      haveTime_ = true;
    }
    out = GnssFix{};
    out.t = now;
    const bool active = fs.f[1][0] == 'A';
    double lat = 0, lon = 0;
    const bool pos = latLon(fs.f[2], fs.f[3], 2, lat) && latLon(fs.f[4], fs.f[5], 3, lon);
    if (active && pos) {
      out.lat = lat;
      out.lon = lon;
      out.fix = (haveGga_ && quality_ == 0) ? FixType::None : FixType::Fix3D;
      out.altMsl = alt_;
      out.sats = sats_;
      // u-blox-style accuracy isn't in NMEA; HDOP × ~2.5 m is a usable stand-in.
      out.hAcc = hdop_ * 2.5f;
      if (num(fs.f[6], v)) out.groundSpeed = static_cast<float>(v * 0.514444);
      if (num(fs.f[7], v)) out.trackDeg = static_cast<float>(v);
      const float tr = out.trackDeg * 0.0174532925f;
      out.velN = out.groundSpeed * std::cos(tr);
      out.velE = out.groundSpeed * std::sin(tr);
    }
    return true;
  }
  if (line[0] == '$') ++bad_;
  return false;
}

}  // namespace pg
