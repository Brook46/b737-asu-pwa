// Audio and LED behaviour as pure state machines.
// `tick(t)` returns what the piezo / LED should be doing at time t; the firmware
// only applies it. That keeps every sound testable on the desktop.
#pragma once
#include "types.h"

namespace pg {

struct VarioToneConfig {
  float liftThreshold = 0.15f;    // m/s, start beeping
  float liftOffThreshold = 0.05f; // m/s, stop beeping (hysteresis)
  float sinkThreshold = -2.5f;    // m/s, continuous sink tone below this
  float baseFreq = 700;           // Hz at the lift threshold
  float freqPerMs = 110;          // Hz per m/s of climb
  float maxFreq = 1800;
  TimeMs periodSlow = 600;        // beep period at threshold, ms
  TimeMs periodFast = 160;        // beep period at `fastAt`
  float fastAt = 5.0f;
  float duty = 0.5f;
  float sinkFreqHigh = 420, sinkFreqLow = 220;  // at sinkThreshold → at -6 m/s
  bool sinkTone = true;
  // Pre-thermal "buzz": a quiet, low, rapid tick in weak lift that doesn't yet
  // reach liftThreshold. Off by default.
  bool nearThermal = false;
  float nearThermalFrom = -0.4f;
};

// One note of an alert jingle. freq 0 = rest.
struct Note {
  uint16_t freq;
  uint16_t ms;
};

enum class Alert : uint8_t {
  None,
  Stay,        // rising pair: "turn here / keep turning"
  Glide,       // falling triple: "leave"
  Message,     // three quick chirps: FANET message received
  RemoteAck,   // one short blip: remote command accepted
  McUp,        // short rising blip
  McDown,      // short falling blip
  Boot,
  Error,       // low double buzz: a sensor dropped out
};

struct ToneOut {
  uint16_t freq = 0;  // 0 = silent
};

class AudioEngine {
 public:
  explicit AudioEngine(const VarioToneConfig& cfg = {}) : cfg_(cfg) {}
  void configure(const VarioToneConfig& cfg) { cfg_ = cfg; }
  const VarioToneConfig& config() const { return cfg_; }
  void setVario(float v) { vario_ = v; }
  void setMuted(bool m) { muted_ = m; }
  bool muted() const { return muted_; }
  // Alerts play even when the vario is muted (they're rare and matter).
  void play(Alert a, TimeMs now);
  ToneOut tick(TimeMs now);
  bool alertActive() const { return alert_ != Alert::None; }

  // Exposed for tests: the continuous mapping vario → (freq, period).
  uint16_t climbFreq(float v) const;
  TimeMs climbPeriod(float v) const;

 private:
  VarioToneConfig cfg_;
  float vario_ = 0;
  bool muted_ = false;
  bool beeping_ = false;      // lift hysteresis state
  TimeMs cycleStart_ = 0;
  TimeMs cyclePeriod_ = 0;
  uint16_t cycleFreq_ = 0;
  Alert alert_ = Alert::None;
  TimeMs alertStart_ = 0;
};

// Notes of an alert, for the engine and for tests.
const Note* alertNotes(Alert a, int& count);

enum class LedMode : uint8_t { Off, Searching, Ready, Climbing, Alert };

class LedEngine {
 public:
  void setMode(LedMode m) { mode_ = m; }
  void flash(TimeMs now, int count) { flashStart_ = now; flashes_ = count; }
  bool tick(TimeMs now);

 private:
  LedMode mode_ = LedMode::Off;
  TimeMs flashStart_ = 0;
  int flashes_ = 0;
};

}  // namespace pg
