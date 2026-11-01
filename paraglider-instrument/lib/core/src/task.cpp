#include "task.h"

#include <cmath>
#include <cstdlib>
#include <cstring>

#include "terrain.h"
#include "traffic.h"

namespace pg {

namespace {

// --- a very small, tolerant JSON scanner for .xctsk ---------------------------
// Finds "key" at the current object level between [p, end) and returns a
// pointer just after its ':' (or nullptr). Nested objects/arrays are skipped.
const char* findKey(const char* p, const char* end, const char* key) {
  const size_t kl = std::strlen(key);
  int depth = 0;
  bool str = false;
  for (const char* q = p; q < end; ++q) {
    const char c = *q;
    if (str) {
      if (c == '\\') ++q;
      else if (c == '"') str = false;
      continue;
    }
    if (c == '"') {
      if (depth == 0 && q + kl + 1 < end && !std::strncmp(q + 1, key, kl) && q[kl + 1] == '"') {
        const char* r = q + kl + 2;
        while (r < end && (*r == ' ' || *r == '\t' || *r == '\n' || *r == '\r')) ++r;
        if (r < end && *r == ':') return r + 1;
      }
      str = true;
    } else if (c == '{' || c == '[') {
      ++depth;
    } else if (c == '}' || c == ']') {
      if (--depth < 0) return nullptr;
    }
  }
  return nullptr;
}

const char* skipWs(const char* p, const char* end) {
  while (p < end && (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r')) ++p;
  return p;
}

// End of the value (object/array/string/number) starting at p.
const char* valueEnd(const char* p, const char* end) {
  p = skipWs(p, end);
  if (p >= end) return end;
  if (*p == '{' || *p == '[') {
    int depth = 0;
    bool str = false;
    for (const char* q = p; q < end; ++q) {
      if (str) {
        if (*q == '\\') ++q;
        else if (*q == '"') str = false;
        continue;
      }
      if (*q == '"') str = true;
      else if (*q == '{' || *q == '[') ++depth;
      else if ((*q == '}' || *q == ']') && --depth == 0) return q + 1;
    }
    return end;
  }
  if (*p == '"') {
    for (const char* q = p + 1; q < end; ++q) {
      if (*q == '\\') ++q;
      else if (*q == '"') return q + 1;
    }
    return end;
  }
  while (p < end && *p != ',' && *p != '}' && *p != ']') ++p;
  return p;
}

bool numberAt(const char* p, const char* end, double& out) {
  if (!p) return false;
  p = skipWs(p, end);
  char buf[32];
  size_t n = 0;
  while (p < end && n < sizeof buf - 1 && (std::strchr("+-.eE", *p) || (*p >= '0' && *p <= '9'))) buf[n++] = *p++;
  buf[n] = 0;
  if (!n) return false;
  out = std::strtod(buf, nullptr);
  return true;
}

void stringAt(const char* p, const char* end, char* out, size_t cap) {
  out[0] = 0;
  if (!p) return;
  p = skipWs(p, end);
  if (p >= end || *p != '"') return;
  size_t n = 0;
  for (++p; p < end && *p != '"' && n < cap - 1; ++p) out[n++] = *p;
  out[n] = 0;
}

float legHeight(const Polar& p, float dist, float bearingDeg, float mc, float wN, float wE) {
  const float ux = std::sin(bearingDeg * kDegToRad), uy = std::cos(bearingDeg * kDegToRad);
  const float along = wE * ux + wN * uy, cross = -wE * uy + wN * ux;
  const float v = p.speedToFly(mc, 0, -along);
  const float gsq = v * v - cross * cross;
  if (gsq <= 0) return 1e6f;
  const float gs = std::sqrt(gsq) + along;
  if (gs <= 0.5f) return 1e6f;
  return p.sink(v) * dist / gs;
}

void legTo(double lat0, double lon0, double lat1, double lon1, float& dist, float& brg) {
  float n, e;
  offsetMeters(lat0, lon0, lat1, lon1, n, e);
  dist = std::sqrt(n * n + e * e);
  brg = std::fmod(std::atan2(e, n) * kRadToDeg + 360.0f, 360.0f);
}

}  // namespace

bool Task::parseXctsk(const char* json, size_t len) {
  clear();
  const char* end = json + len;
  const char* p = skipWs(json, end);
  if (p >= end || *p != '{') return false;
  ++p;
  const char* tps = findKey(p, end, "turnpoints");
  if (!tps) return false;
  tps = skipWs(tps, end);
  if (tps >= end || *tps != '[') return false;
  const char* arrEnd = valueEnd(tps, end);
  const char* q = tps + 1;
  while (q < arrEnd && n_ < kMax) {
    q = skipWs(q, arrEnd);
    if (q >= arrEnd || *q != '{') break;
    const char* oEnd = valueEnd(q, arrEnd);
    Turnpoint tp;
    double v;
    if (numberAt(findKey(q + 1, oEnd, "radius"), oEnd, v)) tp.radius = static_cast<float>(v);
    char type[12];
    stringAt(findKey(q + 1, oEnd, "type"), oEnd, type, sizeof type);
    if (!std::strcmp(type, "SSS")) tp.type = TpType::Start;
    else if (!std::strcmp(type, "ESS")) tp.type = TpType::EndOfSpeed;
    else if (!std::strcmp(type, "TAKEOFF")) tp.type = TpType::Takeoff;
    const char* wp = findKey(q + 1, oEnd, "waypoint");
    const char* wpStart = wp ? skipWs(wp, oEnd) : nullptr;
    if (wpStart && *wpStart == '{') {
      const char* wEnd = valueEnd(wpStart, oEnd);
      bool ok = numberAt(findKey(wpStart + 1, wEnd, "lat"), wEnd, v);
      tp.lat = v;
      ok = ok && numberAt(findKey(wpStart + 1, wEnd, "lon"), wEnd, v);
      tp.lon = v;
      if (numberAt(findKey(wpStart + 1, wEnd, "altSmoothed"), wEnd, v)) tp.alt = static_cast<float>(v);
      stringAt(findKey(wpStart + 1, wEnd, "name"), wEnd, tp.name, sizeof tp.name);
      if (ok) add(tp);
    }
    q = skipWs(oEnd, arrEnd);
    if (q < arrEnd && *q == ',') ++q;
  }
  const char* sss = findKey(p, end, "sss");
  if (sss) {
    const char* s0 = skipWs(sss, end);
    if (s0 < end && *s0 == '{') {
      const char* sEnd = valueEnd(s0, end);
      char dir[8];
      stringAt(findKey(s0 + 1, sEnd, "direction"), sEnd, dir, sizeof dir);
      startExit_ = std::strcmp(dir, "ENTER") != 0;
    }
  }
  // Skip a leading takeoff: it isn't a cylinder to fly to.
  while (next_ < n_ && tp_[next_].type == TpType::Takeoff) ++next_;
  return n_ >= 2;
}

bool Task::update(double lat, double lon) {
  if (next_ >= n_) return false;
  const Turnpoint& tp = tp_[next_];
  float d, b;
  legTo(lat, lon, tp.lat, tp.lon, d, b);
  const bool in = d <= tp.radius;
  bool reached = false;
  if (tp.type == TpType::Start && startExit_) {
    reached = inside_ && !in;  // exit start: crossing out of the cylinder
  } else {
    reached = in;
  }
  inside_ = in;
  if (reached) {
    ++next_;
    inside_ = false;
  }
  return reached;
}

float Task::remaining(double lat, double lon) const {
  if (next_ >= n_) return 0;
  float d, b, total;
  legTo(lat, lon, tp_[next_].lat, tp_[next_].lon, d, b);
  total = d > tp_[next_].radius ? d - tp_[next_].radius : 0;
  for (int i = next_ + 1; i < n_; ++i) {
    legTo(tp_[i - 1].lat, tp_[i - 1].lon, tp_[i].lat, tp_[i].lon, d, b);
    total += d - tp_[i].radius > 0 ? d - tp_[i].radius : 0;
  }
  return total;
}

float Task::requiredAltitude(const Polar& p, double lat, double lon, float mc, float wN, float wE,
                             const Terrain* terrain, float safety) const {
  if (next_ >= n_) return -1e6f;
  float need = 0;
  double fromLat = lat, fromLon = lon;
  for (int i = next_; i < n_; ++i) {
    float d, b;
    legTo(fromLat, fromLon, tp_[i].lat, tp_[i].lon, d, b);
    const float leg = d - tp_[i].radius > 0 ? d - tp_[i].radius : 0;
    need += legHeight(p, leg, b, mc, wN, wE);
    fromLat = tp_[i].lat;
    fromLon = tp_[i].lon;
  }
  float goalGround = tp_[n_ - 1].alt;
  float g;
  if (terrain && terrain->elevation(tp_[n_ - 1].lat, tp_[n_ - 1].lon, g)) goalGround = g;
  return goalGround + safety + need;
}

TaskView Task::view(double lat, double lon) const {
  TaskView v;
  v.active = n_ >= 2;
  if (!v.active) return v;
  v.next = next_;
  v.finished = next_ >= n_;
  v.started = false;
  for (int i = 0; i < next_ && i < n_; ++i)
    if (tp_[i].type == TpType::Start) v.started = true;
  bool hasStart = false;
  for (int i = 0; i < n_; ++i)
    if (tp_[i].type == TpType::Start) hasStart = true;
  if (!hasStart) v.started = true;  // no start: racing from launch
  if (v.finished) return v;
  v.nextName = tp_[next_].name;
  float d, b;
  legTo(lat, lon, tp_[next_].lat, tp_[next_].lon, d, b);
  v.nextDist = d > tp_[next_].radius ? d - tp_[next_].radius : 0;
  v.nextBearing = b;
  v.toGoal = remaining(lat, lon);
  return v;
}

}  // namespace pg
