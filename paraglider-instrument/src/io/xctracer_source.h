// SensorSource adapter for the XCTracer Maxx II BLE stream.
// Turns LK8EX1 / XCTRC sentences into BaroSample and GnssFix, so the rest of
// the firmware treats the XCTracer like any other sensor.
#pragma once
#include "ble_link.h"
#include "nmea.h"
#include "sensors.h"

class XcTracerSource : public pg::BaroSource, public pg::GnssSource {
 public:
  explicit XcTracerSource(BleLink& ble) : ble_(ble) {}
  const char* name() const override { return "XCTracer"; }
  // Drain BLE bytes and parse. Call every loop().
  void service();
  bool poll(pg::BaroSample& out) override;
  bool poll(pg::GnssFix& out) override;
  // XCTracer's LK8EX1 without pressure: altitude only.
  bool pollAltitude(uint32_t& t, float& alt);

  uint32_t sentences() const { return good_; }
  uint32_t rejected() const { return bad_; }
  int batteryPct() const { return battery_; }
  float varioReported() const { return vario_; }  // what the XCTracer itself says, for comparison
  bool echo = false;  // print every sentence to Serial (bring-up)

 private:
  void onLine(const char* line);
  BleLink& ble_;
  pg::LineAssembler la_;
  pg::BaroSample baro_;
  bool baroNew_ = false;
  pg::GnssFix gnss_;
  bool gnssNew_ = false;
  uint32_t altT_ = 0;
  float alt_ = 0;
  bool altNew_ = false;
  float vario_ = 0;
  int battery_ = -1;
  uint32_t good_ = 0, bad_ = 0;
};
