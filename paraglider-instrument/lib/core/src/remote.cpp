#include "remote.h"

namespace pg {

const char* const kCannedMessages[4] = {"OK", "Thermal here", "Landing", "NEED HELP"};

Command parseCommand(const uint8_t* data, size_t len) {
  if (!data || len == 0) return Command::None;
  const uint8_t b = data[0];
  if (b >= 0x01 && b <= 0x0D) return static_cast<Command>(b);
  switch (b) {
    case '+': return Command::McUp;
    case '-': return Command::McDown;
    case 'u': return Command::VolumeUp;
    case 'd': return Command::VolumeDown;
    case 'm': return Command::MuteToggle;
    case 'o': return Command::SendOk;
    case 't': return Command::SendThermal;
    case 'l': return Command::SendLanding;
    case 'h': return Command::SendHelp;
    case 's': return Command::Status;
    case 'k': return Command::MarkThermal;
    case 'b': return Command::AtCloudBase;
    case 'p': return Command::NextPage;
    default: return Command::None;
  }
}

const char* commandName(Command c) {
  switch (c) {
    case Command::None: return "none";
    case Command::McUp: return "mc+";
    case Command::McDown: return "mc-";
    case Command::VolumeUp: return "vol+";
    case Command::VolumeDown: return "vol-";
    case Command::MuteToggle: return "mute";
    case Command::SendOk: return "send-ok";
    case Command::SendThermal: return "send-thermal";
    case Command::SendLanding: return "send-landing";
    case Command::SendHelp: return "send-help";
    case Command::Status: return "status";
    case Command::MarkThermal: return "mark";
    case Command::AtCloudBase: return "at-cloud-base";
    case Command::NextPage: return "next-page";
  }
  return "?";
}

}  // namespace pg

namespace pg {

bool parseAirFrame(const uint8_t* d, size_t n, float& tempC, float& rhPct) {
  if (!d || n != 5 || d[0] != kAirFrame) return false;
  const int16_t t = static_cast<int16_t>(d[1] | (d[2] << 8));
  const uint16_t h = static_cast<uint16_t>(d[3] | (d[4] << 8));
  tempC = t / 100.0f;
  rhPct = h / 100.0f;
  return tempC > -60 && tempC < 70 && rhPct >= 0 && rhPct <= 100;
}

size_t encodeAirFrame(float tempC, float rhPct, uint8_t* out) {
  const int16_t t = static_cast<int16_t>(tempC * 100.0f + (tempC >= 0 ? 0.5f : -0.5f));
  const uint16_t h = static_cast<uint16_t>(rhPct * 100.0f + 0.5f);
  out[0] = kAirFrame;
  out[1] = static_cast<uint8_t>(t & 0xFF);
  out[2] = static_cast<uint8_t>((t >> 8) & 0xFF);
  out[3] = static_cast<uint8_t>(h & 0xFF);
  out[4] = static_cast<uint8_t>(h >> 8);
  return 5;
}

}  // namespace pg
