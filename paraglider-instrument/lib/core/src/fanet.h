// FANET packet codec (no radio code — see src/io/lora_fanet.* for that).
//
// Layout (FANET protocol spec, github.com/3s1d/fanet-stm32 "Fanet.md"):
//   byte 0      header: bit7 extended header, bit6 forward, bits5..0 type
//   byte 1..3   source address: manufacturer, unique id (16-bit little endian)
//   [ext hdr]   bit7..6 ACK (0 none, 1 requested, 2 requested+forwarded),
//               bit5 unicast (a 3-byte destination follows), bit4 signature
//               (4 bytes follow), lower bits reserved
//   [dest 3]    [signature 4]
//   payload
//
// Radio: LoRa SF7, CR 4/5 (the reference switches TX to 4/8 in busy airspace;
// receivers read CR from the explicit header), sync word 0xF1, CRC on,
// preamble left at the default 8 symbols. Frequency, bandwidth and power are
// per region, chosen from the GPS position — see regionFor(). Values are from
// the FANET reference stack (github.com/3s1d/fanet-stm32, radio/fmac.h).
//
// ⚠ Israel is its own zone there: IL918 = 918.5 MHz / BW 125 kHz / 15 dBm,
//   not the EU 868.2 MHz. Pilots over the Valley are on 918.5.
#pragma once
#include <cstddef>
#include <cstdint>

namespace pg::fanet {

enum Type : uint8_t {
  kAck = 0,
  kTracking = 1,
  kName = 2,
  kMessage = 3,
  kService = 4,
  kLandmarks = 5,
  kRemoteConfig = 6,
  kGroundTracking = 7,
  kHwInfo = 8,
};

enum class AircraftType : uint8_t {
  Other = 0, Paraglider = 1, Hangglider = 2, Balloon = 3, Glider = 4, Powered = 5, Helicopter = 6, Uav = 7,
};

struct Address {
  uint8_t manufacturer = 0;
  uint16_t id = 0;
  bool operator==(const Address& o) const { return manufacturer == o.manufacturer && id == o.id; }
  bool isBroadcast() const { return manufacturer == 0 && id == 0; }
};

constexpr size_t kMaxPayload = 200;
constexpr size_t kMaxFrame = 1 + 3 + 1 + 3 + 4 + kMaxPayload;

struct Frame {
  uint8_t type = 0;
  bool forward = false;
  Address src;
  uint8_t ack = 0;      // 0 none, 1 requested, 2 requested via forward
  bool unicast = false;
  Address dest;
  bool signature = false;
  uint32_t sig = 0;
  uint8_t payload[kMaxPayload] = {};
  size_t payloadLen = 0;
};

struct Region {
  const char* name;
  float freqMHz;
  float bwKHz;
  int8_t dBm;
  // Bounding box in degrees: lat in [south, north], lon in [west, east].
  float north, south, east, west;
};

// FANET zone for a position: first matching box in the reference order,
// EU868 when nothing matches (also the choice before the first GPS fix).
const Region& regionFor(double lat, double lon);
const Region& defaultRegion();
const Region* regionByName(const char* name);

// Returns the encoded length, or 0 if `cap` is too small.
size_t encode(const Frame& f, uint8_t* out, size_t cap);
bool decode(const uint8_t* in, size_t len, Frame& out);

struct Tracking {
  double lat = 0, lon = 0;   // degrees
  int altitude = 0;          // m
  AircraftType aircraft = AircraftType::Paraglider;
  bool onlineTracking = true;
  float speedKmh = 0;
  float climb = 0;           // m/s
  float headingDeg = 0;
  bool hasTurnRate = false;
  float turnRateDeg = 0;     // deg/s
};

size_t encodeTracking(const Tracking& t, uint8_t* out, size_t cap);
bool decodeTracking(const uint8_t* p, size_t len, Tracking& out);

// Type 3 message: subheader byte (0 = normal) + UTF-8 text (not NUL-terminated
// on air). decode writes a NUL-terminated string into `text`.
size_t encodeMessage(const char* text, uint8_t* out, size_t cap);
bool decodeMessage(const uint8_t* p, size_t len, char* text, size_t cap);

// Type 2 name: UTF-8 text, no subheader.
size_t encodeName(const char* name, uint8_t* out, size_t cap);

}  // namespace pg::fanet
