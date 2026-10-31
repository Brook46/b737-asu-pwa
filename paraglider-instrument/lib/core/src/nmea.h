// Parsers for the sentences the XCTracer Maxx II can send over BLE.
//
// BLE delivers the stream in notification-sized chunks (20–244 bytes) that
// split sentences anywhere, so LineAssembler rebuilds whole lines first.
//
// The protocol is chosen in the XCTracer's own config file (XCTracerConfig.txt
// on its USB drive), not by us. Supported here:
//   $LK8EX1,pressure,altitude,vario,temperature,battery,*cs
//       pressure Pa (999999 = n/a), altitude m (99999 = n/a, used only if no
//       pressure), vario cm/s (9999 = n/a), temp °C (99 = n/a),
//       battery: voltage, or percent + 1000 (999 = n/a)
//   $XCTRC,year,month,day,hour,min,sec,centisec,lat,lon,alt,speed,course,climb,
//          res,res,res,rawpressure,battery*cs
//       lat/lon decimal degrees, alt m (GPS), speed km/h, course deg,
//       climb m/s, raw pressure (unit auto-detected: Pa or hPa), battery %
// Field layouts are from the published LK8000 and XCTracer docs. Check them
// against a real capture before trusting them (tools/sim can replay a
// captured BLE log).
#pragma once
#include <cstddef>
#include <cstdint>

namespace pg {

class LineAssembler {
 public:
  static constexpr size_t kMax = 160;
  // Feed bytes; `onLine` is called for each complete line (without CR/LF).
  template <typename F>
  void feed(const uint8_t* data, size_t len, F&& onLine) {
    for (size_t i = 0; i < len; ++i) {
      const char c = static_cast<char>(data[i]);
      if (c == '\r' || c == '\n') {
        if (n_ > 0) {
          buf_[n_] = 0;
          onLine(buf_, n_);
        }
        n_ = 0;
      } else if (c == '$') {
        n_ = 0;  // a new sentence always restarts, dropping any torn fragment
        buf_[n_++] = c;
      } else if (n_ > 0 && n_ < kMax) {
        buf_[n_++] = c;
      } else if (n_ >= kMax) {
        n_ = 0;  // runaway line: discard
      }
    }
  }

 private:
  char buf_[kMax + 1] = {};
  size_t n_ = 0;
};

// True if the sentence carries a valid "*hh" XOR checksum over the bytes
// between '$' and '*'. Sentences without a checksum return false.
bool nmeaChecksumOk(const char* line);
uint8_t nmeaChecksum(const char* body, size_t len);

struct Lk8ex1 {
  float pressurePa = 0;
  bool hasPressure = false;
  float altitude = 0;
  bool hasAltitude = false;
  float vario = 0;  // m/s
  bool hasVario = false;
  float tempC = 0;
  bool hasTemp = false;
  float batteryV = 0;     // if reported as a voltage
  int batteryPct = -1;    // if reported as a percentage
};

bool parseLk8ex1(const char* line, Lk8ex1& out);

struct Xctrc {
  int year = 0, month = 0, day = 0, hour = 0, minute = 0, second = 0, centi = 0;
  double lat = 0, lon = 0;
  float altitude = 0;
  float speedKmh = 0;
  float course = 0;
  float climb = 0;
  float rawPressure = 0;
  int batteryPct = -1;
  bool hasFix = false;
};

bool parseXctrc(const char* line, Xctrc& out);

}  // namespace pg
