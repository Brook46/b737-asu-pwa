#include "traffic.h"

#include <cmath>

#include "circling.h"

namespace pg {

void offsetMeters(double lat0, double lon0, double lat, double lon, float& north, float& east) {
  constexpr double kM = 111195.0;
  north = static_cast<float>((lat - lat0) * kM);
  east = static_cast<float>((lon - lon0) * kM * std::cos(lat0 * 3.14159265358979 / 180.0));
}

void Traffic::onTracking(TimeMs t, uint32_t id, const fanet::Tracking& tr) {
  int i = 0;
  while (i < nP_ && p_[i].id != id) ++i;
  if (i == nP_) {
    if (nP_ == kPilots) {  // full: replace the stalest
      i = 0;
      for (int k = 1; k < nP_; ++k)
        if (p_[k].t < p_[i].t) i = k;
    } else {
      ++nP_;
    }
    p_[i] = OtherPilot{};
    p_[i].id = id;
  }
  OtherPilot& p = p_[i];
  const bool first = p.t == 0;
  p.prevT = p.t;
  p.prevHeading = p.headingDeg;
  p.t = t;
  p.lat = tr.lat;
  p.lon = tr.lon;
  p.alt = static_cast<float>(tr.altitude);
  p.climb = tr.climb;
  p.climbAvg = first ? tr.climb : p.climbAvg + 0.35f * (tr.climb - p.climbAvg);
  p.headingDeg = tr.headingDeg;
  if (tr.hasTurnRate) {
    p.turnRateDeg = tr.turnRateDeg;
  } else if (!first && t > p.prevT) {
    // Heading change between reports; FANET reports are seconds apart, so a
    // full circle can alias: also accept a sustained climb with any change.
    p.turnRateDeg = angleDiffDeg(p.prevHeading, p.headingDeg) / ((t - p.prevT) / 1000.0f);
  }
  p.turning = std::fabs(p.turnRateDeg) > 6.0f;
  if (p.turning && p.climbAvg > 0.4f) mark(t, p);
}

void Traffic::mark(TimeMs t, const OtherPilot& p) {
  for (int i = 0; i < nT_; ++i) {
    float n, e;
    offsetMeters(th_[i].lat, th_[i].lon, p.lat, p.lon, n, e);
    if (n * n + e * e < 300.0f * 300.0f) {  // same thermal: follow it as it drifts
      LiveThermal& h = th_[i];
      h.lat += 0.3 * (p.lat - h.lat);
      h.lon += 0.3 * (p.lon - h.lon);
      h.climb += 0.3f * (p.climbAvg - h.climb);
      if (p.alt > h.alt) h.alt = p.alt;
      h.t = t;
      h.by = p.id;
      return;
    }
  }
  int i = nT_;
  if (nT_ == kThermals) {
    i = 0;
    for (int k = 1; k < nT_; ++k)
      if (th_[k].t < th_[i].t) i = k;
  } else {
    ++nT_;
  }
  th_[i] = {p.lat, p.lon, p.alt, p.climbAvg, t, p.id};
}

void Traffic::expire(TimeMs t) {
  for (int i = 0; i < nP_;) {
    if (t - p_[i].t > kPilotTimeoutMs) p_[i] = p_[--nP_];
    else ++i;
  }
  for (int i = 0; i < nT_;) {
    if (t - th_[i].t > kThermalTimeoutMs) th_[i] = th_[--nT_];
    else ++i;
  }
}

}  // namespace pg
