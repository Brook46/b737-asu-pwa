#include "nmea.h"

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

}  // namespace pg
