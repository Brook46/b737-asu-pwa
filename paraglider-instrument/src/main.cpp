// Headless paragliding instrument — XIAO ESP32-S3 firmware entry point.
//
// loop() runs flat out (~1 kHz): poll every sensor, feed the FlightComputer,
// and at 50 Hz apply its tone/LED. Each subsystem is optional: a missing
// sensor is reported at boot and skipped, so the board can be brought up one
// breakout at a time (docs/bringup.md). Serial console: type `help`.
#include <Arduino.h>
#include <LittleFS.h>
#include <Preferences.h>
#include <SPI.h>
#include <Wire.h>

#include <cmath>

#include "build_config.h"
#include "drivers/bme280.h"
#include "drivers/dps310.h"
#include "drivers/gnss_l76k.h"
#include "drivers/lsm6ds3.h"
#include "flight_computer.h"
#include "hotspots.h"
#include "io/ble_link.h"
#include "io/buzzer.h"
#include "io/lora_fanet.h"
#include "io/xctracer_source.h"
#include "pins.h"
#include "remote.h"
#include "terrain.h"

namespace {

Bme280 bme;           // Grove BME280 (or a BMP280)
Dps310 dps;           // fallback if one is fitted instead
pg::BaroSource* baro = nullptr;  // whichever answered at boot
GnssL76k gnss;
Lsm6ds3 imu;
BleLink ble;
XcTracerSource xct(ble);
LoraFanet lora;
Buzzer buzzer;
StatusLed led;
Preferences prefs;
pg::FlightComputer fc;
// Area data from the file system (data/ → `pio run -t uploadfs`): a terrain
// grid (*.ter, tools/terrain/build_terrain.py) and a thermal pack
// (hotspots.pghs, sim/pack.html). Both optional.
pg::Terrain terrain;
pg::HotspotMap hotspots;
pg::Task task;  // optional: an XCTrack task file (*.xctsk) in data/
char terrainName[32] = "none", packName[32] = "none", taskName[32] = "none";

// Bring-up print toggles (console: `show baro|gnss|nmea|imu|xct|fc|off`).
bool showBaro = false, showGnss = false, showImu = false, showFc = true;
uint32_t lastTick = 0, lastPrint = 0, lastStatusText = 0, lastTrack = 0;
pg::BaroSample lastBaro;
pg::GnssFix lastFix;
pg::ImuSample lastImu;
uint32_t baroCount = 0, gnssCount = 0, imuCount = 0;

void loadSettings() {
  prefs.begin("pg", true);
  fc.setQnh(prefs.getFloat("qnh", 101325.0f));
  pg::AdvisorConfig a = fc.advisor().config();
  a.mc = prefs.getFloat("mc", 1.0f);
  a.autoMc = prefs.getBool("automc", true);
  fc.advisor().configure(a);
  fc.setVolume(prefs.getInt("vol", 2));
  {
    pg::AtmosphereConfig ac = fc.atmosphere().config();
    ac.tempOffset = prefs.getFloat("toff", 0.0f);
    fc.atmosphere().configure(ac);
  }
  prefs.end();
}

void saveSettings() {
  prefs.begin("pg", false);
  prefs.putFloat("qnh", fc.config().qnhPa);
  prefs.putFloat("mc", fc.advisor().config().mc);
  prefs.putBool("automc", fc.advisor().config().autoMc);
  prefs.putInt("vol", fc.status().volume);
  prefs.putFloat("toff", fc.atmosphere().config().tempOffset);
  prefs.end();
}

void i2cScan() {
  Serial.println("I2C scan:");
  for (uint8_t a = 1; a < 127; ++a) {
    Wire.beginTransmission(a);
    if (Wire.endTransmission() == 0) {
      const char* what = (a == 0x76 || a == 0x77) ? " (BME280?)" : (a == 0x6A || a == 0x6B) ? " (LSM6DS3?)" : "";
      Serial.printf("  0x%02X%s\n", a, what);
    }
  }
}

void printStatus() {
  const pg::Status& s = fc.status();
  Serial.printf("alt %7.1f m  vario %+5.2f  avg %+5.2f  netto %+5.2f  %s  mc %.2f%s  advice %s\n",
                s.altitude, s.vario, s.avg, s.netto, s.circling ? "CIRC" : "    ", s.advisor.mc,
                fc.advisor().config().autoMc ? "(auto)" : "",
                s.advisor.advice == pg::Advice::Stay ? "STAY" : s.advisor.advice == pg::Advice::Glide ? "GLIDE" : "-");
  if (s.wind.valid)
    Serial.printf("   wind %.0f km/h from %03.0f  airspeed %.0f km/h  stf %.0f km/h\n", s.wind.speed * 3.6f,
                  s.wind.fromDeg, s.airspeed * 3.6f, s.stf);
}

const char* stabilityName(pg::Stability s) {
  switch (s) {
    case pg::Stability::Inversion: return "inversion";
    case pg::Stability::Stable: return "stable";
    case pg::Stability::Moderate: return "moderate";
    case pg::Stability::Unstable: return "unstable";
    default: return "unknown";
  }
}

void printAir() {
  const pg::AtmosphereState& a = fc.status().air;
  if (!a.haveAir) {
    Serial.println("air: no humidity sensor data yet");
    return;
  }
  if (a.ventilated)
    Serial.printf("air: %.1f C from the remote (outside, no offset)  RH %.0f%%  dew point %.1f C\n", a.tempC, a.rh,
                  a.dewPointC);
  else
    Serial.printf("air: %.1f C (case %.1f, offset %.1f)  RH %.0f%%  dew point %.1f C\n", a.tempC,
                  a.tempC + fc.atmosphere().config().tempOffset, fc.atmosphere().config().tempOffset, a.rh,
                  a.dewPointC);
  if (a.baseValid)
    Serial.printf("   cloud base ~%.0f m (%s)  %.0f m above you\n", a.cloudBase,
                  a.baseFromThermal ? "from thermal air" : "rough, not yet from a thermal",
                  a.cloudBase - fc.status().altitude);
  if (a.lapseValid)
    Serial.printf("   lapse rate %.1f C/km (%s)%s\n", a.lapseRate, stabilityName(a.stability),
                  a.inversion ? "  INVERSION in this climb" : "");
}

void printHealth() {
  Serial.printf("baro: %s (%lu samples)  gnss: %s (%lu)  imu: %s (%lu)\n",
                baro ? baro->name() : "absent", static_cast<unsigned long>(baroCount),
                gnss.present() ? "L76K" : "silent", static_cast<unsigned long>(gnssCount),
                imu.present() ? "LSM6DS3" : "absent", static_cast<unsigned long>(imuCount));
  Serial.printf("xctracer: %s %s (%lu bytes, %lu ok / %lu bad sentences, batt %d%%)\n",
                ble.xctConnected() ? "connected" : "searching", ble.xctAddress(),
                static_cast<unsigned long>(ble.xctBytes()), static_cast<unsigned long>(xct.sentences()),
                static_cast<unsigned long>(xct.rejected()), xct.batteryPct());
  Serial.printf("remote: %s   lora: %s %s rx %lu tx %lu, TX %s%s   vario source: %s\n",
                ble.remoteConnected() ? "connected" : "-", lora.present() ? "ok" : "absent", lora.region().name,
                static_cast<unsigned long>(lora.rxCount()), static_cast<unsigned long>(lora.txCount()),
                LoraFanet::txCompiledIn() ? "compiled in" : "compiled OUT",
                lora.txArmed() ? ", ARMED" : "",
                fc.status().baro == pg::BaroOrigin::Onboard   ? "onboard"
                : fc.status().baro == pg::BaroOrigin::XcTracer ? "XCTracer"
                                                               : "none");
}

void sendCanned(int idx) {
  const char* text = pg::kCannedMessages[idx];
  char buf[64];
  const pg::Status& s = fc.status();
  if (idx == 1 && s.pos.valid) {
    // "Thermal here" carries the spot: other pilots' FANET devices show text only.
    // Guarded position: never a spoofed one; "~" while dead reckoning.
    snprintf(buf, sizeof buf, "%s %s%.5f,%.5f %+.1f", text, s.pos.deadReckoned ? "~" : "", s.pos.lat, s.pos.lon,
             s.advisor.thermalAvg);
    text = buf;
  }
  const bool sent = lora.sendMessage(text);
  fc.notify(sent ? pg::Alert::RemoteAck : pg::Alert::Error, millis());
  Serial.printf("[fanet] \"%s\" %s\n", text, sent ? "sent" : "NOT sent");
}

void handleCommand(pg::Command c) {
  const uint32_t now = millis();
  Serial.printf("[remote] %s\n", pg::commandName(c));
  if (fc.onCommand(c, now)) {
    if (c == pg::Command::McUp || c == pg::Command::McDown || c == pg::Command::VolumeUp ||
        c == pg::Command::VolumeDown)
      saveSettings();
    if (c == pg::Command::Status) {
      printStatus();
      printAir();
    }
    if (c == pg::Command::AtCloudBase) {
      saveSettings();
      Serial.printf("[air] calibrated at base: temperature offset %.1f C\n", fc.atmosphere().config().tempOffset);
    }
    return;
  }
  switch (c) {
    case pg::Command::SendOk: sendCanned(0); break;
    case pg::Command::SendThermal: sendCanned(1); break;
    case pg::Command::SendLanding: sendCanned(2); break;
    case pg::Command::SendHelp: sendCanned(3); break;
    case pg::Command::MarkThermal:
      Serial.printf("[mark] %.6f,%.6f%s alt %.0f\n", fc.status().pos.lat, fc.status().pos.lon,
                    fc.status().pos.deadReckoned ? " (dead reckoned)" : "", fc.status().altitude);
      fc.notify(pg::Alert::RemoteAck, now);
      break;
    default: break;
  }
}

// Reads a whole file into PSRAM (or heap); the Terrain/HotspotMap keep pointing at it.
uint8_t* readFile(File& f, size_t& len) {
  len = f.size();
  uint8_t* buf = static_cast<uint8_t*>(ps_malloc(len));
  if (!buf) buf = static_cast<uint8_t*>(malloc(len));
  if (!buf) return nullptr;
  if (f.read(buf, len) != len) {
    free(buf);
    return nullptr;
  }
  return buf;
}

void loadAreaData() {
  if (!LittleFS.begin(false)) {
    Serial.println("area data no file system (pio run -t uploadfs to add terrain / thermal pack)");
    return;
  }
  auto endsWith = [](const char* s, const char* suf) {
    const size_t a = strlen(s), b = strlen(suf);
    return a >= b && !strcasecmp(s + a - b, suf);
  };
  File root = LittleFS.open("/");
  for (File f = root.openNextFile(); f; f = root.openNextFile()) {
    const char* name = f.name();
    size_t len = 0;
    if (endsWith(name, ".ter") && !terrain.valid()) {
      uint8_t* buf = readFile(f, len);
      if (buf && terrain.load(buf, len)) {
        snprintf(terrainName, sizeof terrainName, "%s", name);
        fc.setTerrain(&terrain);
      } else if (buf) {
        free(buf);
      }
    } else if (endsWith(name, ".xctsk") && task.count() == 0) {
      uint8_t* buf = readFile(f, len);
      if (buf && task.parseXctsk(reinterpret_cast<const char*>(buf), len)) {
        snprintf(taskName, sizeof taskName, "%s", name);
        fc.setTask(&task);
      }
      free(buf);  // Task copies the turnpoints
    } else if (endsWith(name, ".pghs") && !hotspots.count()) {
      uint8_t* buf = readFile(f, len);
      if (buf && hotspots.load(buf, len) && hotspots.count()) {
        snprintf(packName, sizeof packName, "%s", name);
        fc.setHotspots(&hotspots);
      }
      free(buf);  // HotspotMap copies the records
    }
  }
  Serial.printf("terrain    %s%s\n", terrainName,
                terrain.valid() ? "" : " (no AGL; arrival heights above sea level)");
  Serial.printf("thermals   %s (%d sources)\n", packName, hotspots.count());
  Serial.printf("task       %s (%d turnpoints)\n", taskName, task.count());
}

void printGps() {
  const pg::Status& s = fc.status();
  Serial.printf("gps: %s (%s)  receiver: fix %d, %u sats, hAcc %.0f m\n", pg::gpsStateName(s.gps), pg::gpsReasonName(s.gpsReason),
                static_cast<int>(lastFix.fix), lastFix.sats, lastFix.hAcc);
  if (s.pos.valid && s.pos.deadReckoned)
    Serial.printf("   position %.5f,%.5f DEAD RECKONED, +/-%.0f m\n", s.pos.lat, s.pos.lon, s.pos.errorM);
  else if (s.pos.valid)
    Serial.printf("   position %.5f,%.5f trusted\n", s.pos.lat, s.pos.lon);
  else
    Serial.println("   position unknown");
  if (s.headingValid) Serial.printf("   heading %03.0f (%s)", s.heading, s.imu ? "gyro" : "GPS track");
  else Serial.printf("   heading unknown%s", s.assistHeadingValid ? " (gyro-relative only: assistant works)" : "");
  if (s.aglValid) Serial.printf("  AGL %.0f m", s.agl);
  Serial.printf("  clock %s\n", s.clockValid ? "set" : "unset");
  if (s.best.valid)
    Serial.printf("   best thermal %.0f%% at %.1f km, bearing %03.0f, arrive %+.0f m AGL\n", s.best.chance * 100,
                  s.best.distM / 1000, s.best.bearingDeg, s.best.arrivalAgl);
  if (s.home.valid)
    Serial.printf("   home %.1f km, bearing %03.0f, arrive %+.0f m\n", s.home.distM / 1000, s.home.bearingDeg,
                  s.home.arrivalAgl);
}

void printXc() {
  const pg::Status& s = fc.status();
  Serial.printf("xc: MC flown %.1f (base %.1f%s)%s  band %d%%\n", s.xc.mc, s.advisor.mcBase,
                fc.advisor().config().autoMc ? ", auto" : "", s.task.active && s.task.started ? " RACE" : " XC",
                s.xc.bandValid ? static_cast<int>(s.xc.band * 100) : -1);
  Serial.printf("   speed to fly %.0f km/h, bar %.2f%s%s, turbulence %.1f m/s2\n", s.xc.stf * 3.6f, s.xc.bar,
                s.xc.barLimit != pg::BarLimit::None ? " limited: " : "", pg::barLimitName(s.xc.barLimit), s.turbulence);
  const pg::TurnView& tv = s.turn;
  if (tv.fit.valid)
    Serial.printf("   thermal: core %.0f m off your circle, R %.0f m, %.1f m/s, %s%s  (circle %.0f m, bank %.0f->%.0f)\n",
                  tv.coreDist, tv.fit.radius, tv.fit.strength, pg::turnAdviceName(tv.advice),
                  tv.settled ? "" : " (settling)", tv.myRadius, tv.bankNow, tv.bankBest);
  Serial.printf("   traffic: %d pilots, %d live thermals; ceiling %.0f m%s\n", fc.traffic().pilots(),
                fc.traffic().thermals(), s.ceilingMsl, s.ceilingIsBase ? " (cloud base)" : " (best top)");
}

void printTask() {
  if (task.count() < 2) {
    Serial.println("task: none (put an XCTrack .xctsk in data/ and uploadfs)");
    return;
  }
  const pg::TaskView& v = fc.status().task;
  for (int i = 0; i < task.count(); ++i)
    Serial.printf("  %c %d %-15s %.5f,%.5f r %.0f\n", i == task.next() ? '>' : ' ', i + 1, task.at(i).name,
                  task.at(i).lat, task.at(i).lon, task.at(i).radius);
  if (v.finished) Serial.println("   GOAL");
  else
    Serial.printf("   next %s %.1f km (brg %03.0f), %.1f km to goal, final glide %+.0f m (MC %.1f affordable)\n",
                  v.nextName, v.nextDist / 1000, v.nextBearing, v.toGoal / 1000, v.finalSurplus, v.finalMc);
}

void consoleHelp() {
  Serial.println(
      "commands:\n"
      "  status | health | air | gps | xc | task | pack | i2c | help\n"
      "  base                             I'm at cloud base now (learns the case temperature offset)\n"
      "  toff <C>                         set the case temperature offset by hand\n"
      "  show baro|gnss|nmea|imu|fc|xct|off   periodic prints / raw streams for bring-up\n"
      "  mc <m/s> | automc on|off | vol <0-3> | mute | qnh <hPa>\n"
      "  beep stay|glide|msg|boot|err    play an alert\n"
      "  tone <Hz> | vario <m/s>          drive the piezo directly (bench)\n"
      "  cmd <char>                       inject a remote command (+ - u d m o t l h s k b)\n"
      "  send <text>                      FANET message (needs TX compiled in + armed)\n"
      "  tx arm|disarm                    runtime TX gate (not saved)\n"
      "  rescan                           drop the XCTracer link and scan again");
}

float benchVario = NAN;
uint16_t benchTone = 0;

void console() {
  static char line[96];
  static size_t n = 0;
  while (Serial.available()) {
    const char ch = static_cast<char>(Serial.read());
    if (ch != '\n' && ch != '\r') {
      if (n < sizeof line - 1) line[n++] = ch;
      continue;
    }
    if (!n) continue;
    line[n] = 0;
    n = 0;
    char* arg = strchr(line, ' ');
    if (arg) *arg++ = 0;
    const uint32_t now = millis();
    if (!strcmp(line, "help")) consoleHelp();
    else if (!strcmp(line, "status")) printStatus();
    else if (!strcmp(line, "air")) printAir();
    else if (!strcmp(line, "gps")) printGps();
    else if (!strcmp(line, "xc")) printXc();
    else if (!strcmp(line, "task")) printTask();
    else if (!strcmp(line, "pack")) {
      Serial.printf("terrain %s, thermal pack %s (%d sources)\n", terrainName, packName, hotspots.count());
    }
    else if (!strcmp(line, "base")) handleCommand(pg::Command::AtCloudBase);
    else if (!strcmp(line, "toff") && arg) {
      pg::AtmosphereConfig ac = fc.atmosphere().config();
      ac.tempOffset = atof(arg);
      fc.atmosphere().configure(ac);
      saveSettings();
    }
    else if (!strcmp(line, "health")) printHealth();
    else if (!strcmp(line, "i2c")) i2cScan();
    else if (!strcmp(line, "rescan")) ble.rescan();
    else if (!strcmp(line, "show") && arg) {
      const bool off = !strcmp(arg, "off");
      showBaro = !off && !strcmp(arg, "baro") ? !showBaro : (off ? false : showBaro);
      showGnss = !off && !strcmp(arg, "gnss") ? !showGnss : (off ? false : showGnss);
      showImu = !off && !strcmp(arg, "imu") ? !showImu : (off ? false : showImu);
      showFc = !off && !strcmp(arg, "fc") ? !showFc : (off ? false : showFc);
      xct.echo = !off && !strcmp(arg, "xct") ? !xct.echo : (off ? false : xct.echo);
      gnss.echo = !off && !strcmp(arg, "nmea") ? !gnss.echo : (off ? false : gnss.echo);
    } else if (!strcmp(line, "mc") && arg) {
      auto a = fc.advisor().config();
      a.autoMc = false;
      a.mc = atof(arg);
      fc.advisor().configure(a);
      saveSettings();
    } else if (!strcmp(line, "automc") && arg) {
      auto a = fc.advisor().config();
      a.autoMc = !strcmp(arg, "on");
      fc.advisor().configure(a);
      saveSettings();
    } else if (!strcmp(line, "vol") && arg) {
      fc.setVolume(atoi(arg));
      fc.notify(pg::Alert::RemoteAck, now);
      saveSettings();
    } else if (!strcmp(line, "mute")) {
      fc.onCommand(pg::Command::MuteToggle, now);
    } else if (!strcmp(line, "qnh") && arg) {
      fc.setQnh(atof(arg) * 100.0f);
      Serial.printf("QNH %.1f hPa\n", fc.config().qnhPa / 100.0f);
      saveSettings();
    } else if (!strcmp(line, "beep") && arg) {
      pg::Alert a = pg::Alert::RemoteAck;
      if (!strcmp(arg, "stay")) a = pg::Alert::Stay;
      else if (!strcmp(arg, "glide")) a = pg::Alert::Glide;
      else if (!strcmp(arg, "msg")) a = pg::Alert::Message;
      else if (!strcmp(arg, "boot")) a = pg::Alert::Boot;
      else if (!strcmp(arg, "err")) a = pg::Alert::Error;
      fc.notify(a, now);
    } else if (!strcmp(line, "tone")) {
      benchTone = arg ? static_cast<uint16_t>(atoi(arg)) : 0;
    } else if (!strcmp(line, "vario")) {
      benchVario = arg ? atof(arg) : NAN;
    } else if (!strcmp(line, "cmd") && arg) {
      const uint8_t b = static_cast<uint8_t>(arg[0]);
      handleCommand(pg::parseCommand(&b, 1));
    } else if (!strcmp(line, "send") && arg) {
      Serial.printf("[fanet] %s\n", lora.sendMessage(arg) ? "sent" : "not sent");
    } else if (!strcmp(line, "tx") && arg) {
      const bool on = lora.armTx(!strcmp(arg, "arm"));
      Serial.printf("[fanet] TX %s%s\n", on ? "ARMED" : "disarmed",
                    !LoraFanet::txCompiledIn() ? " (compiled out: PG_LORA_TX_ENABLED=0)" : "");
    } else {
      Serial.printf("? %s  (try help)\n", line);
    }
  }
}

void onFanet(const FanetRx& rx) {
  const auto& f = rx.frame;
  Serial.printf("[fanet] rx type %u from %02X:%04X rssi %.0f snr %.1f\n", f.type, f.src.manufacturer, f.src.id,
                rx.rssi, rx.snr);
  if (f.type == pg::fanet::kMessage) {
    // Only messages addressed to us (or broadcast) chirp.
    if (f.unicast && !(f.dest == lora.address())) return;
    char text[pg::fanet::kMaxPayload + 1];
    if (pg::fanet::decodeMessage(f.payload, f.payloadLen, text, sizeof text)) {
      Serial.printf("[fanet] message: %s\n", text);
      fc.notify(pg::Alert::Message, millis());
    }
  } else if (f.type == pg::fanet::kTracking) {
    pg::fanet::Tracking t;
    if (pg::fanet::decodeTracking(f.payload, f.payloadLen, t)) {
      Serial.printf("[fanet]   %.5f,%.5f %d m %+.1f m/s %.0f km/h\n", t.lat, t.lon, t.altitude, t.climb, t.speedKmh);
      // Other pilots: live thermals and lift samples for the thermal model.
      fc.onTraffic(millis(), (static_cast<uint32_t>(f.src.manufacturer) << 16) | f.src.id, t);
    }
  }
}

// Follow the FANET zone with the GPS position (checked every 30 s).
void updateRegion(uint32_t now) {
  static uint32_t last = 0;
  if (now - last < 30000) return;
  last = now;
  // Only from the guarded position (not the raw fix, which can already be a
  // spoofed one while the guard is still counting to three): a spoofer must
  // not move us onto another country's frequency.
  const pg::Status& s = fc.status();
  if (s.gps != pg::GpsState::Ok || !s.pos.valid || s.pos.deadReckoned) return;
  const pg::fanet::Region& r = pg::fanet::regionFor(s.pos.lat, s.pos.lon);
  if (&r == &lora.region()) return;
  Serial.printf("[fanet] region %s → %s (%.1f MHz)\n", lora.region().name, r.name, r.freqMHz);
  lora.setRegion(r);
  prefs.begin("pg", false);
  prefs.putString("region", r.name);
  prefs.end();
}

void maybeSendTracking(uint32_t now) {
  if (!PG_FANET_TRACK_PERIOD_S || !lora.txArmed()) return;
  if (now - lastTrack < PG_FANET_TRACK_PERIOD_S * 1000UL) return;
  const pg::Status& s = fc.status();
  // Never broadcast a position the guard doesn't trust (jammed or spoofed).
  // The last fix the guard accepted, never the raw one.
  const pg::GnssFix& g = s.trustedFix;
  if (s.gps != pg::GpsState::Ok || !g.valid() || now - g.t > 3000) return;
  lastTrack = now;
  pg::fanet::Tracking t;
  t.lat = g.lat;
  t.lon = g.lon;
  t.altitude = static_cast<int>(g.altMsl);
  t.speedKmh = g.groundSpeed * 3.6f;
  t.climb = s.vario;
  t.headingDeg = g.trackDeg;
  t.hasTurnRate = true;
  t.turnRateDeg = s.turnRate;
  lora.sendTracking(t);
}

}  // namespace

void setup() {
  Serial.begin(115200);
  const uint32_t t0 = millis();
  while (!Serial && millis() - t0 < 1500) delay(10);  // USB CDC: give the host a moment, don't block forever
  Serial.println("\n== paragliding instrument ==");

  // Both SPI chip-selects high before anything talks on the shared bus.
  pinMode(PIN_LORA_NSS, OUTPUT);
  digitalWrite(PIN_LORA_NSS, HIGH);

  buzzer.begin(PIN_PIEZO);
  led.begin(PIN_LED, LED_ACTIVE_LOW);
  loadSettings();

  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL, I2C_FREQ_HZ);
  SPI.begin(PIN_SPI_SCK, PIN_SPI_MISO, PIN_SPI_MOSI);

  if (bme.begin(Wire)) {
    baro = &bme;
    Serial.printf("%s     ok at 0x%02X%s\n", bme.name(), bme.address(),
                  bme.hasHumidity() ? " (pressure, temperature, humidity)" : " (no humidity)");
  } else if (dps.begin(Wire)) {
    baro = &dps;
    Serial.printf("DPS310     ok at 0x%02X (no humidity)\n", dps.address());
  } else {
    Serial.println("barometer  not found");
  }
  Serial.printf("LSM6DS3    %s (WHO_AM_I 0x%02X)\n", imu.begin(Wire) ? "ok" : "not found", imu.whoAmI());
  gnss.begin(Serial1, PIN_GNSS_RX, PIN_GNSS_TX, 5);
  Serial.println("L76K       configured on Serial1 (D7 RX / D6 TX); `health` shows if it talks");
  // FANET zone: last one used (saved), corrected from GPS once there's a fix.
  prefs.begin("pg", true);
  const String savedRegion = prefs.getString("region", "IL918");
  prefs.end();
  const pg::fanet::Region* reg = pg::fanet::regionByName(savedRegion.c_str());
  if (!reg) reg = &pg::fanet::defaultRegion();
  Serial.printf("SX1262     %s, %s %.1f MHz BW %.0f\n", lora.begin(SPI, *reg) ? "ok (receive)" : "not found",
                reg->name, reg->freqMHz, reg->bwKHz);
  if (!lora.present()) Serial.printf("           RadioLib error %d\n", lora.lastError());
  Serial.printf("LoRa TX    %s\n", LoraFanet::txCompiledIn() ? "compiled in, disarmed" : "compiled out (legal check pending)");

  // FANET address: unregistered-device manufacturer 0xFC + low 16 bits of the MAC.
  const uint64_t mac = ESP.getEfuseMac();
  lora.setAddress({0xFC, static_cast<uint16_t>(mac & 0xFFFF)});

  ble.begin(PG_BLE_NAME, PG_REMOTE_ALLOWED_ADDR);
  Serial.println("BLE        advertising for remote, scanning for XCTracer");

  loadAreaData();

  if (!baro) Serial.println("note: no onboard baro — vario comes from the XCTracer once connected");
  fc.notify(pg::Alert::Boot, millis());
  consoleHelp();
}

void loop() {
  const uint32_t now = millis();

  pg::BaroSample b;
  if (baro && baro->poll(b)) {
    fc.onBaro(b, pg::BaroOrigin::Onboard);
    lastBaro = b;
    ++baroCount;
  }
  static uint32_t lastAir = 0;
  if (baro == &bme && bme.hasHumidity() && now - lastAir >= 1000 && lastBaro.valid) {
    lastAir = now;
    fc.onAir(now, bme.tempC(), bme.humidity());
  }
  pg::ImuSample m;
  if (imu.poll(m)) {
    fc.onImu(m);
    lastImu = m;
    ++imuCount;
  }
  // One GNSS source at a time into the guard. While the onboard receiver has
  // no fix (jammed) but the XCTracer still does, the onboard "no fix" epochs
  // are held back: mixed in, each one would reset the guard's run of good
  // fixes and the XCTracer's position would never be trusted.
  static uint32_t lastXctFix = 0;
  const bool xctCovering = lastXctFix && now - lastXctFix < 3000;
  pg::GnssFix g;
  if (gnss.poll(g)) {
    if (g.valid() || !xctCovering) fc.onGnss(g);
    lastFix = g;
    ++gnssCount;
  }

  xct.service();
  if (xct.poll(b)) fc.onBaro(b, pg::BaroOrigin::XcTracer);
  uint32_t at;
  float alt;
  if (xct.pollAltitude(at, alt)) fc.onAltitude(at, alt, pg::BaroOrigin::XcTracer);
  // XCTracer position only when the onboard GNSS has nothing.
  if (xct.poll(g) && (!gnss.present() || !lastFix.valid() || now - lastFix.t > 3000)) {
    if (g.valid()) lastXctFix = now;
    fc.onGnss(g);
  }

  pg::Command c;
  while (ble.popCommand(c)) handleCommand(c);
  float remoteT, remoteRh;
  while (ble.popAir(remoteT, remoteRh)) fc.onRemoteAir(now, remoteT, remoteRh);  // the remote's outside sensor

  FanetRx rx;
  if (lora.service(rx)) onFanet(rx);
  updateRegion(now);
  maybeSendTracking(now);
  // Date and time for the thermal chances: from RMC, only while GPS is trusted
  // (a spoofer can fake the time too). Kept running by the FC between fixes.
  static uint32_t lastClock = 0;
  int yy, mo, dd, hh, mi, ss;
  if (now - lastClock >= 60000 && fc.status().gps == pg::GpsState::Ok && gnss.utc(yy, mo, dd, hh, mi, ss)) {
    lastClock = now;
    fc.setClock(yy, mo, dd, hh * 60 + mi);
  }

  console();

  if (now - lastTick >= 20) {  // 50 Hz output
    lastTick = now;
    const pg::Outputs o = fc.tick(now);
    uint16_t hz = o.toneHz;
    if (benchTone) hz = benchTone;
    if (!std::isnan(benchVario)) {
      fc.audio().setVario(benchVario);
      hz = fc.audio().tick(now).freq;
    }
    buzzer.set(hz, fc.status().volume);
    led.set(o.led);
    if (o.alertStarted == pg::Alert::Stay || o.alertStarted == pg::Alert::Glide) {
      Serial.printf("[advice] %s\n", o.alertStarted == pg::Alert::Stay ? "STAY" : "GLIDE");
    }
  }

  if (now - lastStatusText >= 2000) {
    lastStatusText = now;
    char txt[96];
    const pg::Status& s = fc.status();
    int n = snprintf(txt, sizeof txt, "%+.1f %.0fm mc%.1f %s", s.vario, s.altitude, s.advisor.mc,
                     s.advisor.advice == pg::Advice::Stay ? "STAY" : s.advisor.advice == pg::Advice::Glide ? "GLIDE" : "");
    if (s.air.baseValid && n > 0 && n < static_cast<int>(sizeof txt))
      n += snprintf(txt + n, sizeof txt - n, " base%.0f", s.air.cloudBase);
    if (s.air.lapseValid && n > 0 && n < static_cast<int>(sizeof txt))
      snprintf(txt + n, sizeof txt - n, " lapse%.1f", s.air.lapseRate);
    ble.setStatusText(txt);
  }

  if (now - lastPrint >= 1000) {
    lastPrint = now;
    if (showBaro && lastBaro.valid)
      Serial.printf("[baro] %.1f Pa  %.2f C  alt %.1f m\n", lastBaro.pressurePa, lastBaro.tempC,
                    pg::pressureToAltitude(lastBaro.pressurePa, fc.config().qnhPa));
    if (showGnss)
      Serial.printf("[gnss] fix %d sats %u  %.6f,%.6f  %.1f m  %.1f km/h  trk %.0f  hAcc %.1f m\n",
                    static_cast<int>(lastFix.fix), lastFix.sats, lastFix.lat, lastFix.lon, lastFix.altMsl,
                    lastFix.groundSpeed * 3.6f, lastFix.trackDeg, lastFix.hAcc);
    if (showImu && lastImu.valid)
      Serial.printf("[imu] a %+6.2f %+6.2f %+6.2f m/s2  g %+6.1f %+6.1f %+6.1f dps  %.1f C\n", lastImu.ax,
                    lastImu.ay, lastImu.az, lastImu.gx * pg::kRadToDeg, lastImu.gy * pg::kRadToDeg,
                    lastImu.gz * pg::kRadToDeg, lastImu.tempC);
    if (showFc) printStatus();
  }
}
