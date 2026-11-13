// Quectel L76K GNSS ("L76K GNSS Module for Seeed Studio XIAO") over UART.
// It speaks NMEA at 9600 baud and is configured with CASIC "$PCAS" commands:
// GPS + BeiDou + GLONASS, only GGA and RMC, 5 Hz, vehicle dynamics. The
// command sequence follows Meshtastic's L76K setup (src/gps/GPS.cpp).
#pragma once
#include <HardwareSerial.h>

#include "nmea.h"
#include "sensors.h"

class GnssL76k : public pg::GnssSource {
 public:
  // rxPin = XIAO pin wired to the module's TX, txPin = to the module's RX.
  void begin(HardwareSerial& serial, int rxPin, int txPin, uint8_t rateHz = 5);
  const char* name() const override { return "L76K"; }
  bool poll(pg::GnssFix& out) override;
  // True once valid NMEA has arrived (the module answers within ~1 s of power).
  bool present() const { return parser_.sentences() > 0; }
  bool utc(int& y, int& mo, int& d, int& h, int& mi, int& s) const { return parser_.utc(y, mo, d, h, mi, s); }
  uint32_t sentences() const { return parser_.sentences(); }
  bool echo = false;  // print raw sentences (bring-up)

 private:
  void send(const char* body);
  HardwareSerial* serial_ = nullptr;
  pg::LineAssembler la_;
  pg::NmeaGnssParser parser_;
  pg::GnssFix pending_;
  bool havePending_ = false;
};
