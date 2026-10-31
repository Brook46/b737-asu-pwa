#include "audio.h"

#include <cstddef>

namespace pg {

namespace {
const Note kStay[] = {{880, 90}, {0, 40}, {1320, 160}};
const Note kGlide[] = {{1320, 110}, {0, 40}, {990, 110}, {0, 40}, {660, 220}};
const Note kMessage[] = {{2000, 50}, {0, 50}, {2000, 50}, {0, 50}, {2000, 50}};
const Note kAck[] = {{1600, 40}};
const Note kMcUp[] = {{1000, 50}, {1400, 50}};
const Note kMcDown[] = {{1400, 50}, {1000, 50}};
const Note kBoot[] = {{660, 80}, {880, 80}, {1100, 80}, {1320, 120}};
const Note kError[] = {{300, 200}, {0, 100}, {300, 200}};
template <std::size_t N>
const Note* ret(const Note (&a)[N], int& c) {
  c = static_cast<int>(N);
  return a;
}
float clamp01(float x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }
}  // namespace

const Note* alertNotes(Alert a, int& count) {
  switch (a) {
    case Alert::Stay: return ret(kStay, count);
    case Alert::Glide: return ret(kGlide, count);
    case Alert::Message: return ret(kMessage, count);
    case Alert::RemoteAck: return ret(kAck, count);
    case Alert::McUp: return ret(kMcUp, count);
    case Alert::McDown: return ret(kMcDown, count);
    case Alert::Boot: return ret(kBoot, count);
    case Alert::Error: return ret(kError, count);
    case Alert::None: break;
  }
  count = 0;
  return nullptr;
}

uint16_t AudioEngine::climbFreq(float v) const {
  float f = cfg_.baseFreq + cfg_.freqPerMs * (v - cfg_.liftThreshold);
  if (f < cfg_.baseFreq) f = cfg_.baseFreq;
  if (f > cfg_.maxFreq) f = cfg_.maxFreq;
  return static_cast<uint16_t>(f);
}

TimeMs AudioEngine::climbPeriod(float v) const {
  const float span = cfg_.fastAt - cfg_.liftThreshold;
  const float k = span > 0 ? clamp01((v - cfg_.liftThreshold) / span) : 1.0f;
  return static_cast<TimeMs>(cfg_.periodSlow + (static_cast<float>(cfg_.periodFast) -
                                                static_cast<float>(cfg_.periodSlow)) * k);
}

void AudioEngine::play(Alert a, TimeMs now) {
  alert_ = a;
  alertStart_ = now;
}

ToneOut AudioEngine::tick(TimeMs now) {
  ToneOut out;
  if (alert_ != Alert::None) {
    int n = 0;
    const Note* notes = alertNotes(alert_, n);
    TimeMs t = now - alertStart_;
    for (int i = 0; i < n; ++i) {
      if (t < notes[i].ms) {
        out.freq = notes[i].freq;
        return out;
      }
      t -= notes[i].ms;
    }
    alert_ = Alert::None;
    cycleStart_ = now;  // restart the vario rhythm cleanly after the jingle
  }
  if (muted_) return out;

  const float v = vario_;
  beeping_ = beeping_ ? v > cfg_.liftOffThreshold : v >= cfg_.liftThreshold;

  if (beeping_) {
    // Frequency follows the vario continuously; the period is latched per
    // cycle so a changing climb doesn't chop a beep in half.
    if (cyclePeriod_ == 0 || now - cycleStart_ >= cyclePeriod_) {
      cycleStart_ = now;
      cyclePeriod_ = climbPeriod(v);
    }
    cycleFreq_ = climbFreq(v);
    const TimeMs on = static_cast<TimeMs>(cyclePeriod_ * cfg_.duty);
    if (now - cycleStart_ < on) out.freq = cycleFreq_;
    return out;
  }
  cyclePeriod_ = 0;

  if (cfg_.sinkTone && v <= cfg_.sinkThreshold) {
    // Linear from sinkFreqHigh at the threshold to sinkFreqLow at -6 m/s.
    const float range = cfg_.sinkThreshold + 6.0f;
    const float k = range > 0 ? clamp01((cfg_.sinkThreshold - v) / range) : 1.0f;
    out.freq = static_cast<uint16_t>(cfg_.sinkFreqHigh + (cfg_.sinkFreqLow - cfg_.sinkFreqHigh) * k);
    return out;
  }

  if (cfg_.nearThermal && v >= cfg_.nearThermalFrom) {
    // 25 ms ticks every 250 ms at a low pitch.
    if ((now % 250) < 25) out.freq = 300;
  }
  return out;
}

bool LedEngine::tick(TimeMs now) {
  if (flashes_ > 0) {
    const TimeMs t = now - flashStart_;
    const int idx = static_cast<int>(t / 120);
    if (idx < flashes_ * 2) return (idx % 2) == 0;
    flashes_ = 0;
  }
  switch (mode_) {
    case LedMode::Off: return false;
    case LedMode::Searching: return (now % 1000) < 100;   // slow blip: waiting for a fix
    case LedMode::Ready: return (now % 3000) < 60;        // heartbeat
    case LedMode::Climbing: return (now % 400) < 200;
    case LedMode::Alert: return (now % 200) < 100;
  }
  return false;
}

}  // namespace pg
