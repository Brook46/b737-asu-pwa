// C API for the browser simulator (compiled to WebAssembly by build.sh) and
// for the native harness (sim_native.cpp). Everything here is glue: the
// instrument behaviour is the real lib/core code.
#include <cstdint>
#include <cstring>

#include "display/gfx.h"
#include "display/screens.h"
#include "flight_computer.h"
#include "world.h"

#ifdef __wasm__
#define EXPORT(name) extern "C" __attribute__((export_name(#name), used))
#else
#define EXPORT(name) extern "C"
#endif

namespace {

pg::FlightComputer* gFc = nullptr;
world::World gWorld;
pg::gfx::Canvas gCanvas;
pg::display::Model gModel;
pg::display::Page gPage = pg::display::Page::Thermal;
uint16_t gTone = 0;
bool gLed = false;
uint32_t gNextTick = 0;
int gLastAlert = 0;
uint32_t gLastAlertT = 0;
float gState[48];
float gThermals[world::World::kThermals * 4];
constexpr int kTrack = 900;
float gTrack[kTrack * 2];
int gTrackHead = 0, gTrackN = 0;
uint32_t gLastTrack = 0;

pg::FlightComputer& fc() {
  static pg::FlightComputer f;
  if (!gFc) gFc = &f;
  return *gFc;
}

}  // namespace

EXPORT(sim_reset) void sim_reset(uint32_t seed) {
  fc().reset();
  pg::AdvisorConfig a = fc().advisor().config();
  a.autoMc = true;
  a.mc = 1.0f;
  fc().advisor().configure(a);
  pg::AtmosphereConfig ac = fc().atmosphere().config();
  ac.tempOffset = 0;
  fc().atmosphere().configure(ac);
  fc().setQnh(101325.0f);
  gWorld.reset(seed);
  gModel = pg::display::Model();
  gNextTick = 0;
  gLastAlert = 0;
  gTrackHead = gTrackN = 0;
  gLastTrack = 0;
}

// Parameters: 0 wind from (deg), 1 wind speed (km/h), 2 surface temp, 3 surface
// dew point, 4 env lapse (°C/km), 5 case offset, 6 thermal strength (m/s),
// 7 IMU on, 8 autopilot on, 9 manual turn (deg/s, + right), 10 speed bar 0..1,
// 11 inversion altitude (m, 0 = none).
EXPORT(sim_set) void sim_set(int key, float v) {
  world::Params& p = gWorld.p;
  switch (key) {
    case 0: p.windFromDeg = v; break;
    case 1: p.windSpeed = v / 3.6f; break;
    case 2: p.surfaceT = v; break;
    case 3: p.surfaceTd = v; break;
    case 4: p.envLapse = v; break;
    case 5: p.caseOffset = v; break;
    case 6: p.strength = v; break;
    case 7: p.imu = v != 0; break;
    case 8: p.autopilot = v != 0; break;
    case 9: gWorld.turnCmd = v; break;
    case 10: gWorld.speedBar = v; break;
    case 11: p.inversionAlt = v; break;
    default: break;
  }
}

// Remote / button commands: the pg::Command bytes, plus 0x20 = next page.
EXPORT(sim_command) void sim_command(int code) {
  if (code == 0x20) {
    gPage = static_cast<pg::display::Page>((static_cast<int>(gPage) + 1) % static_cast<int>(pg::display::Page::Count));
    return;
  }
  fc().onCommand(static_cast<pg::Command>(code), gWorld.t);
}

EXPORT(sim_page) void sim_page(int p) {
  if (p >= 0 && p < static_cast<int>(pg::display::Page::Count)) gPage = static_cast<pg::display::Page>(p);
}

EXPORT(sim_step) void sim_step(int ms) {
  for (int i = 0; i < ms / 10; ++i) {
    gWorld.step(fc());
    if (gWorld.t >= gNextTick) {
      gNextTick = gWorld.t + 20;
      const pg::Outputs o = fc().tick(gWorld.t);
      gTone = o.toneHz;
      gLed = o.led;
      if (o.alertStarted != pg::Alert::None) {
        gModel.noteAlert(o.alertStarted, gWorld.t);
        gLastAlert = static_cast<int>(o.alertStarted);
        gLastAlertT = gWorld.t;
      }
      gModel.update(gWorld.t, fc().status());
    }
    if (gWorld.t - gLastTrack >= 1000 || !gLastTrack) {
      gLastTrack = gWorld.t;
      const int idx = (gTrackHead + gTrackN) % kTrack;
      gTrack[idx * 2] = static_cast<float>(gWorld.x);
      gTrack[idx * 2 + 1] = static_cast<float>(gWorld.y);
      if (gTrackN < kTrack) ++gTrackN;
      else gTrackHead = (gTrackHead + 1) % kTrack;
    }
  }
}

EXPORT(sim_render) const uint8_t* sim_render() {
  pg::display::DeviceInfo d;
  d.batteryPct = 100 - static_cast<int>(gWorld.t / 1000 / 300);  // ~1 %/5 min, cosmetic
  if (d.batteryPct < 5) d.batteryPct = 5;
  d.clockMin = 12 * 60 + static_cast<int>(gWorld.t / 60000);
  d.simulated = true;
  d.baroName = "BME280";
  render(gCanvas, gPage, fc().status(), gModel, d, gWorld.t);
  return gCanvas.buffer();
}

EXPORT(sim_tone) int sim_tone() { return gTone; }
EXPORT(sim_led) int sim_led() { return gLed ? 1 : 0; }

EXPORT(sim_state) const float* sim_state() {
  const pg::Status& s = fc().status();
  float* o = gState;
  std::memset(gState, 0, sizeof gState);
  o[0] = gWorld.t / 1000.0f;
  o[1] = s.altitude;
  o[2] = s.vario;
  o[3] = s.avg;
  o[4] = gWorld.alt;
  o[5] = gWorld.climb;
  o[6] = gWorld.lift;
  o[7] = static_cast<float>(gWorld.x);
  o[8] = static_cast<float>(gWorld.y);
  o[9] = gWorld.hdg;
  o[10] = s.circling ? 1 : 0;
  o[11] = static_cast<float>(s.advisor.advice);
  o[12] = s.advisor.mc;
  o[13] = s.wind.speed * 3.6f;
  o[14] = s.wind.fromDeg;
  o[15] = s.wind.valid ? 1 : 0;
  o[16] = s.air.cloudBase;
  o[17] = s.air.baseValid ? 1 : 0;
  o[18] = gWorld.cloudBase();
  o[19] = s.air.lapseRate;
  o[20] = s.air.lapseValid ? 1 : 0;
  o[21] = fc().atmosphere().config().tempOffset;
  o[22] = s.stf;
  o[23] = s.gnss.groundSpeed * 3.6f;
  o[24] = static_cast<float>(world::World::kThermals);
  o[25] = static_cast<float>(gPage);
  o[26] = static_cast<float>(s.volume);
  o[27] = s.muted ? 1 : 0;
  o[28] = gWorld.p.autopilot ? 1 : 0;
  o[29] = static_cast<float>(gLastAlert);
  o[30] = gLastAlertT / 1000.0f;
  o[31] = gWorld.p.windSpeed * 3.6f;
  o[32] = gWorld.p.windFromDeg;
  o[33] = static_cast<float>(gWorld.landings);
  o[34] = gWorld.turnCmd;
  o[35] = s.advisor.thermalAvg;
  o[36] = s.advisor.circleClimb;
  o[37] = s.air.baseFromThermal ? 1 : 0;
  o[38] = static_cast<float>(fc().advisor().thermalCount());
  o[39] = gWorld.p.envLapse;
  return gState;
}

EXPORT(sim_thermals) const float* sim_thermals() {
  for (int i = 0; i < world::World::kThermals; ++i) {
    const world::Thermal& h = gWorld.th[i];
    gThermals[i * 4] = static_cast<float>(h.x);
    gThermals[i * 4 + 1] = static_cast<float>(h.y);
    gThermals[i * 4 + 2] = h.radius;
    gThermals[i * 4 + 3] = h.now();
  }
  return gThermals;
}

EXPORT(sim_track) const float* sim_track() {
  static float lin[kTrack * 2];
  for (int i = 0; i < gTrackN; ++i) {
    const int idx = (gTrackHead + i) % kTrack;
    lin[i * 2] = gTrack[idx * 2];
    lin[i * 2 + 1] = gTrack[idx * 2 + 1];
  }
  return lin;
}
EXPORT(sim_track_len) int sim_track_len() { return gTrackN; }
