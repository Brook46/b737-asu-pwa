#include "sensors.h"

#include <cmath>

namespace pg {

// ISA troposphere: h = 44330.77 * (1 - (p/p0)^0.190263)
float pressureToAltitude(float pressurePa, float qnhPa) {
  if (pressurePa <= 0 || qnhPa <= 0) return 0;
  return 44330.77f * (1.0f - std::pow(pressurePa / qnhPa, 0.190263f));
}

float altitudeToPressure(float altitudeM, float qnhPa) {
  return qnhPa * std::pow(1.0f - altitudeM / 44330.77f, 1.0f / 0.190263f);
}

}  // namespace pg
