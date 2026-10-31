#include "remote.h"

namespace pg {

const char* const kCannedMessages[4] = {"OK", "Thermal here", "Landing", "NEED HELP"};

Command parseCommand(const uint8_t* data, size_t len) {
  if (!data || len == 0) return Command::None;
  const uint8_t b = data[0];
  if (b >= 0x01 && b <= 0x0B) return static_cast<Command>(b);
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
  }
  return "?";
}

}  // namespace pg
