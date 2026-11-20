#include "fanet.h"

#include <cmath>
#include <cstring>

namespace pg::fanet {

namespace {
void putAddr(uint8_t* p, const Address& a) {
  p[0] = a.manufacturer;
  p[1] = static_cast<uint8_t>(a.id & 0xFF);
  p[2] = static_cast<uint8_t>(a.id >> 8);
}
Address getAddr(const uint8_t* p) {
  Address a;
  a.manufacturer = p[0];
  a.id = static_cast<uint16_t>(p[1] | (p[2] << 8));
  return a;
}
void put24(uint8_t* p, int32_t v) {
  p[0] = static_cast<uint8_t>(v & 0xFF);
  p[1] = static_cast<uint8_t>((v >> 8) & 0xFF);
  p[2] = static_cast<uint8_t>((v >> 16) & 0xFF);
}
int32_t get24(const uint8_t* p) {
  int32_t v = p[0] | (p[1] << 8) | (p[2] << 16);
  if (v & 0x800000) v |= ~0xFFFFFF;  // sign-extend
  return v;
}
int clampi(int v, int lo, int hi) { return v < lo ? lo : (v > hi ? hi : v); }
}  // namespace

namespace {
// Same order and boxes as fmac.h in the reference stack.
const Region kRegions[] = {
    {"US920", 920.8f, 500, 15, 90, -90, -30, -169},
    {"AU920", 920.8f, 500, 15, -10, -48, 179, 110},
    {"IN866", 866.2f, 250, 14, 40, 5, 89, 69},
    {"KR923", 923.2f, 125, 15, 39, 34, 130, 124},
    {"AS920", 923.2f, 125, 15, 47, 21, 146, 89},
    {"IL918", 918.5f, 125, 15, 34, 29, 36, 34},
    {"EU868", 868.2f, 250, 14, 90, -90, 180, -180},
};
constexpr int kNumRegions = sizeof(kRegions) / sizeof(kRegions[0]);
}  // namespace

const Region& defaultRegion() { return kRegions[kNumRegions - 1]; }

const Region& regionFor(double lat, double lon) {
  for (const Region& r : kRegions)
    if (lat <= r.north && lat >= r.south && lon <= r.east && lon >= r.west) return r;
  return defaultRegion();
}

const Region* regionByName(const char* name) {
  for (const Region& r : kRegions)
    if (std::strcmp(r.name, name) == 0) return &r;
  return nullptr;
}

size_t encode(const Frame& f, uint8_t* out, size_t cap) {
  const bool ext = f.ack || f.unicast || f.signature;
  const size_t need = 4 + (ext ? 1 : 0) + (f.unicast ? 3 : 0) + (f.signature ? 4 : 0) + f.payloadLen;
  if (need > cap || f.payloadLen > kMaxPayload) return 0;
  size_t i = 0;
  out[i++] = static_cast<uint8_t>((ext ? 0x80 : 0) | (f.forward ? 0x40 : 0) | (f.type & 0x3F));
  putAddr(out + i, f.src);
  i += 3;
  if (ext) {
    out[i++] = static_cast<uint8_t>(((f.ack & 0x3) << 6) | (f.unicast ? 0x20 : 0) | (f.signature ? 0x10 : 0));
    if (f.unicast) {
      putAddr(out + i, f.dest);
      i += 3;
    }
    if (f.signature) {
      for (int k = 0; k < 4; ++k) out[i++] = static_cast<uint8_t>(f.sig >> (8 * k));
    }
  }
  std::memcpy(out + i, f.payload, f.payloadLen);
  return i + f.payloadLen;
}

bool decode(const uint8_t* in, size_t len, Frame& out) {
  if (len < 4) return false;
  out = Frame{};
  size_t i = 0;
  const uint8_t h = in[i++];
  const bool ext = h & 0x80;
  out.forward = h & 0x40;
  out.type = h & 0x3F;
  out.src = getAddr(in + i);
  i += 3;
  if (ext) {
    if (i >= len) return false;
    const uint8_t e = in[i++];
    out.ack = (e >> 6) & 0x3;
    out.unicast = e & 0x20;
    out.signature = e & 0x10;
    if (out.unicast) {
      if (i + 3 > len) return false;
      out.dest = getAddr(in + i);
      i += 3;
    }
    if (out.signature) {
      if (i + 4 > len) return false;
      out.sig = in[i] | (in[i + 1] << 8) | (in[i + 2] << 16) | (static_cast<uint32_t>(in[i + 3]) << 24);
      i += 4;
    }
  }
  out.payloadLen = len - i;
  if (out.payloadLen > kMaxPayload) return false;
  std::memcpy(out.payload, in + i, out.payloadLen);
  return true;
}

size_t encodeTracking(const Tracking& t, uint8_t* out, size_t cap) {
  const size_t need = t.hasTurnRate ? 12 : 11;
  if (cap < need) return 0;
  put24(out, static_cast<int32_t>(std::lround(t.lat * 93206.0)));
  put24(out + 3, static_cast<int32_t>(std::lround(t.lon * 46603.0)));

  int alt = t.altitude < 0 ? 0 : t.altitude;
  uint16_t ta = 0;
  if (alt > 2047) {
    ta = static_cast<uint16_t>(clampi((alt + 2) / 4, 0, 2047)) | 0x0800;
  } else {
    ta = static_cast<uint16_t>(alt);
  }
  ta |= static_cast<uint16_t>((static_cast<uint8_t>(t.aircraft) & 0x7) << 12);
  if (t.onlineTracking) ta |= 0x8000;
  out[6] = static_cast<uint8_t>(ta & 0xFF);
  out[7] = static_cast<uint8_t>(ta >> 8);

  int spd = static_cast<int>(std::lround(t.speedKmh * 2.0f));  // 0.5 km/h units
  if (spd > 127) out[8] = static_cast<uint8_t>(0x80 | clampi((spd + 2) / 5, 0, 127));
  else out[8] = static_cast<uint8_t>(clampi(spd, 0, 127));

  int climb = static_cast<int>(std::lround(t.climb * 10.0f));  // 0.1 m/s units
  if (climb > 63 || climb < -64)
    out[9] = static_cast<uint8_t>(0x80 | (clampi(static_cast<int>(std::lround(climb / 5.0)), -64, 63) & 0x7F));
  else
    out[9] = static_cast<uint8_t>(climb & 0x7F);

  float hd = std::fmod(t.headingDeg, 360.0f);
  if (hd < 0) hd += 360.0f;
  out[10] = static_cast<uint8_t>(static_cast<int>(std::lround(hd * 256.0f / 360.0f)) & 0xFF);

  if (t.hasTurnRate) {
    int tr = static_cast<int>(std::lround(t.turnRateDeg * 4.0f));  // 0.25 deg/s units
    if (tr > 63 || tr < -64)
      out[11] = static_cast<uint8_t>(0x80 | (clampi(static_cast<int>(std::lround(tr / 4.0)), -64, 63) & 0x7F));
    else
      out[11] = static_cast<uint8_t>(tr & 0x7F);
  }
  return need;
}

namespace {
int signed7(uint8_t b) {
  int v = b & 0x7F;
  return (v & 0x40) ? v - 128 : v;
}
}  // namespace

bool decodeTracking(const uint8_t* p, size_t len, Tracking& t) {
  if (len < 11) return false;
  t = Tracking{};
  t.lat = get24(p) / 93206.0;
  t.lon = get24(p + 3) / 46603.0;
  const uint16_t ta = static_cast<uint16_t>(p[6] | (p[7] << 8));
  t.onlineTracking = ta & 0x8000;
  t.aircraft = static_cast<AircraftType>((ta >> 12) & 0x7);
  t.altitude = (ta & 0x07FF) * ((ta & 0x0800) ? 4 : 1);
  t.speedKmh = (p[8] & 0x7F) * 0.5f * ((p[8] & 0x80) ? 5 : 1);
  t.climb = signed7(p[9]) * 0.1f * ((p[9] & 0x80) ? 5 : 1);
  t.headingDeg = p[10] * 360.0f / 256.0f;
  if (len >= 12) {
    t.hasTurnRate = true;
    t.turnRateDeg = signed7(p[11]) * 0.25f * ((p[11] & 0x80) ? 4 : 1);
  }
  return true;
}

size_t encodeMessage(const char* text, uint8_t* out, size_t cap) {
  const size_t n = std::strlen(text);
  if (cap < n + 1 || n + 1 > kMaxPayload) return 0;
  out[0] = 0;  // normal message
  std::memcpy(out + 1, text, n);
  return n + 1;
}

bool decodeMessage(const uint8_t* p, size_t len, char* text, size_t cap) {
  if (len < 1 || cap == 0) return false;
  size_t n = len - 1;
  if (n >= cap) n = cap - 1;
  std::memcpy(text, p + 1, n);
  text[n] = 0;
  return true;
}

size_t encodeName(const char* name, uint8_t* out, size_t cap) {
  const size_t n = std::strlen(name);
  if (cap < n || n > kMaxPayload) return 0;
  std::memcpy(out, name, n);
  return n;
}

}  // namespace pg::fanet
