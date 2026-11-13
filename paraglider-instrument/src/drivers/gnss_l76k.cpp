#include "gnss_l76k.h"

#include <Arduino.h>

void GnssL76k::send(const char* body) {
  char buf[96];
  if (!pg::nmeaBuild(body, buf, sizeof buf)) return;
  serial_->print(buf);
  serial_->print("\r\n");
  delay(250);  // the module needs a moment between commands (Meshtastic waits 250 ms)
}

void GnssL76k::begin(HardwareSerial& serial, int rxPin, int txPin, uint8_t rateHz) {
  serial_ = &serial;
  serial_->begin(9600, SERIAL_8N1, rxPin, txPin);
  send("PCAS04,7");                              // GPS + BeiDou + GLONASS
  send("PCAS03,1,0,0,0,1,0,0,0,0,0,,,0,0");      // only GGA and RMC
  // Dynamic model 3 = vehicle, as Meshtastic sets it (and SoftRF uses an
  // aviation mode). Vehicle tracks a paraglider fine; an airborne code exists
  // in the CASIC protocol but isn't verified on this module, so not used here.
  send("PCAS11,3");
  // Fix interval in ms. 5 Hz of GGA + RMC is ~75 % of 9600 baud, which fits.
  char body[24];
  snprintf(body, sizeof body, "PCAS02,%u", rateHz ? 1000u / rateHz : 1000u);
  send(body);
}

bool GnssL76k::poll(pg::GnssFix& out) {
  if (!serial_) return false;
  uint8_t buf[64];
  int n;
  while ((n = serial_->available()) > 0) {
    if (n > static_cast<int>(sizeof buf)) n = sizeof buf;
    const size_t got = serial_->readBytes(buf, n);
    la_.feed(buf, got, [this](const char* line, size_t) {
      if (echo) Serial.printf("[gnss] %s\n", line);
      pg::GnssFix f;
      if (parser_.feed(line, millis(), f)) {
        pending_ = f;
        havePending_ = true;
      }
    });
  }
  if (!havePending_) return false;
  havePending_ = false;
  out = pending_;
  return true;
}
