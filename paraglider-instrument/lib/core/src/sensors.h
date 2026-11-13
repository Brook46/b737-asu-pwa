// Sensor interfaces. Every concrete source — the BMP390, the MAX-M10S, the
// ICM-42688-P, and the XCTracer BLE stream — sits behind one of these, so the
// logic layer never knows which hardware produced a sample.
#pragma once
#include "types.h"

namespace pg {

class BaroSource {
 public:
  virtual ~BaroSource() = default;
  virtual const char* name() const = 0;
  // Fills `out` and returns true when a new sample is available since the last call.
  virtual bool poll(BaroSample& out) = 0;
};

class GnssSource {
 public:
  virtual ~GnssSource() = default;
  virtual const char* name() const = 0;
  virtual bool poll(GnssFix& out) = 0;
};

class ImuSource {
 public:
  virtual ~ImuSource() = default;
  virtual const char* name() const = 0;
  virtual bool poll(ImuSample& out) = 0;
};

// ISA pressure altitude. qnhPa defaults to standard atmosphere.
float pressureToAltitude(float pressurePa, float qnhPa = 101325.0f);
float altitudeToPressure(float altitudeM, float qnhPa = 101325.0f);

}  // namespace pg
