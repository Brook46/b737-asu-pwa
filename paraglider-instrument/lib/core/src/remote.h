// Command protocol for the XIAO ESP32-C6 brake-handle remote.
//
// The instrument exposes a GATT service with one writable characteristic
// (UUIDs in src/io/remote_ble.h). The remote writes one byte per button
// action. Printable ASCII aliases are accepted too, so you can drive it by hand
// from nRF Connect while the remote firmware doesn't exist yet.
#pragma once
#include <cstddef>
#include <cstdint>

namespace pg {

enum class Command : uint8_t {
  None = 0x00,
  McUp = 0x01,          // '+'
  McDown = 0x02,        // '-'
  VolumeUp = 0x03,      // 'u'
  VolumeDown = 0x04,    // 'd'
  MuteToggle = 0x05,    // 'm'
  SendOk = 0x06,        // 'o'  canned FANET message 0
  SendThermal = 0x07,   // 't'  canned FANET message 1 ("thermal here" + position)
  SendLanding = 0x08,   // 'l'  canned FANET message 2
  SendHelp = 0x09,      // 'h'  canned FANET message 3 — needs a double press on the remote
  Status = 0x0A,        // 's'  beep out MC and wind
  MarkThermal = 0x0B,   // 'k'
};

Command parseCommand(const uint8_t* data, size_t len);
const char* commandName(Command c);

// Canned messages, index matches SendOk..SendHelp. Short on purpose: FANET
// airtime is shared, and every byte costs everyone in the valley.
extern const char* const kCannedMessages[4];

}  // namespace pg
