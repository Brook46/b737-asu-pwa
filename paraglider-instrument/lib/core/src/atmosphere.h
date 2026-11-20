// What temperature and humidity can say in flight: dew point, cloud base,
// the temperature lapse rate (how unstable the air is) and inversions.
//
// The sensor sits inside the case, which matters:
//  * The dew point is trustworthy. A vented box holds the same moisture as
//    the air outside; only its temperature (and so its RH) differs, and the
//    dew point computed from the two is unchanged.
//  * The temperature reads warm (electronics, sun on the case). Cloud base
//    comes from the temperature–dew point spread, so every 1 °C of warm bias
//    puts the estimate ~125 m too high. `tempOffset` removes that bias; it is
//    learned with calibrateAtBase() when you are actually at cloud base.
//  * The case slows the temperature response (tens of seconds). The lapse rate
//    uses a regression over long glides, where a constant lag barely changes
//    the slope. Inversion cues need 0.5 °C of smoothed warming over 100 m
//    of climb, so they arrive late (~150 m) but don't fire on core/edge swings.
#pragma once
#include "types.h"

namespace pg {

// Magnus formula (Sonntag 1990 constants), −40…+60 °C.
float dewPointC(float tempC, float rhPct);
float relativeHumidity(float tempC, float dewPointC);

// Height (m) a rising, unsaturated parcel climbs before condensing: Espy's
// ~125 m per °C of spread (dry adiabat 9.8 °C/km vs dew point 1.8 °C/km).
float condensationHeight(float tempC, float dewPointC);

struct AtmosphereConfig {
  float tempOffset = 0.0f;       // °C subtracted from the case reading
  TimeMs baseTauMs = 60000;      // smoothing of the cloud-base estimate
  TimeMs thermalWarmupMs = 30000;// sample cloud base only well inside a thermal
  float nearBaseM = 300.0f;      // cue when this close below the estimated base
  TimeMs lapseWindowMs = 20u * 60u * 1000u;
  float lapseMinSpanM = 250.0f;  // altitude range needed for a lapse rate
};

enum class Stability : uint8_t { Unknown, Inversion, Stable, Moderate, Unstable };

struct AtmosphereState {
  float tempC = 0;        // corrected air temperature
  float rh = 0;           // %RH as measured in the case
  bool ventilated = false; // from the remote's outside sensor (no case offset)
  float dewPointC = 0;
  bool haveAir = false;
  float cloudBase = 0;    // m, same altitude reference as the vario
  bool baseValid = false;
  bool baseFromThermal = false;  // estimate came from thermal air (better)
  float lapseRate = 0;    // °C per km, positive = cooling with height
  bool lapseValid = false;
  Stability stability = Stability::Unknown;
  bool inversion = false; // warming with height in the current climb
};

enum class AtmosphereEvent : uint8_t { None, NearBase, Inversion };

class Atmosphere {
 public:
  explicit Atmosphere(const AtmosphereConfig& cfg = {}) : cfg_(cfg) {}
  void configure(const AtmosphereConfig& cfg) { cfg_ = cfg; }
  const AtmosphereConfig& config() const { return cfg_; }
  // One sensor sample (~1 Hz is plenty), with the flight state at that time.
  // `ventilated`: the reading is outside air (the remote's sensor), not the
  // warm case: no offset applied, and it doesn't disturb the case calibration.
  AtmosphereEvent update(TimeMs t, float altitude, float caseTempC, float rhPct, bool circling,
                         float vario, bool ventilated = false);
  // "I'm at cloud base now": sets tempOffset so the spread is zero here.
  // Returns the new offset.
  float calibrateAtBase();
  const AtmosphereState& state() const { return st_; }

 private:
  void addLapseSample(TimeMs t, float alt, float temp);
  void fitLapse(TimeMs t);
  AtmosphereConfig cfg_;
  AtmosphereState st_;
  TimeMs lastT_ = 0;
  bool wasCircling_ = false;
  TimeMs circlingSince_ = 0;
  float caseT_ = 0, dew_ = 0;  // latest raw values
  // lapse rate: glide samples (environment air), one per 5 s
  static constexpr int kLapseN = 256;
  TimeMs lt_[kLapseN] = {};
  float la_[kLapseN] = {}, lT_[kLapseN] = {};
  int lHead_ = 0, lCount_ = 0;
  TimeMs lastLapseSample_ = 0;
  // inversion: temperature vs altitude inside the current climb
  float smoothT_ = 0, minT_ = 0, minTAlt_ = 0;
  bool smoothInit_ = false, climbTracking_ = false;
  bool nearBaseCued_ = false, inversionCued_ = false;
};

}  // namespace pg
