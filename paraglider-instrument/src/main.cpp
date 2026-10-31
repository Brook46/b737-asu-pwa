// Headless paragliding instrument — XIAO ESP32-S3 firmware entry point.
//
// loop() runs flat out (~1 kHz): poll every sensor, feed the FlightComputer,
// and at 50 Hz apply its tone/LED. Each subsystem is optional: a missing
// sensor is reported at boot and skipped, so the board can be brought up one
// breakout at a time (docs/bringup.md). Serial console: type `help`.
#include <Arduino.h>
#include <Preferences.h>
#include <SPI.h>
#include <Wire.h>

#include <cmath>

#include "build_config.h"
#include "drivers/bmp390.h"
#include "drivers/gnss_m10.h"
#include "drivers/icm42688.h"
#include "flight_computer.h"
#include "io/ble_link.h"
#include "io/buzzer.h"
#include "io/lora_fanet.h"
#include "io/xctracer_source.h"
#include "pins.h"
#include "remote.h"

namespace {

Bmp390 baro;
GnssM10 gnss;
Icm42688 imu;
BleLink ble;
XcTracerSource xct(ble);
LoraFanet lora;
Buzzer buzzer;
StatusLed led;
Preferences prefs;
pg::FlightComputer fc;

// Bring-up print toggles (console: `show baro|gnss|imu|xct|fc|off`).
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
  prefs.end();
}

void saveSettings() {
  prefs.begin("pg", false);
  prefs.putFloat("qnh", fc.config().qnhPa);
  prefs.putFloat("mc", fc.advisor().config().mc);
  prefs.putBool("automc", fc.advisor().config().autoMc);
  prefs.putInt("vol", fc.status().volume);
  prefs.end();
}

void i2cScan() {
  Serial.println("I2C scan:");
  for (uint8_t a = 1; a < 127; ++a) {
    Wire.beginTransmission(a);
    if (Wire.endTransmission() == 0) {
      const char* what = a == 0x42 ? " (u-blox GNSS)" : (a == 0x76 || a == 0x77) ? " (BMP390?)" : "";
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

void printHealth() {
  Serial.printf("baro: %s (%lu samples)  gnss: %s (%lu)  imu: %s (%lu)\n",
                baro.present() ? "BMP390" : "absent", static_cast<unsigned long>(baroCount),
                gnss.present() ? "M10" : "absent", static_cast<unsigned long>(gnssCount),
                imu.present() ? "ICM42688" : "absent", static_cast<unsigned long>(imuCount));
  Serial.printf("xctracer: %s %s (%lu bytes, %lu ok / %lu bad sentences, batt %d%%)\n",
                ble.xctConnected() ? "connected" : "searching", ble.xctAddress(),
                static_cast<unsigned long>(ble.xctBytes()), static_cast<unsigned long>(xct.sentences()),
                static_cast<unsigned long>(xct.rejected()), xct.batteryPct());
  Serial.printf("remote: %s   lora: %s %s rx %lu tx %lu, TX %s%s   vario source: %s\n",
                ble.remoteConnected() ? "connected" : "-", lora.present() ? "ok" : "absent", lora.region().name,
                static_cast<unsigned long>(lora.rxCount()), static_cast<unsigned long>(lora.txCount()),
                LoraFanet::txCompiledIn() ? "compiled in" : "compiled OUT",
                lora.txArmed() ? ", ARMED" : "",
                fc.status().baro == pg::BaroOrigin::Onboard   ? "BMP390"
                : fc.status().baro == pg::BaroOrigin::XcTracer ? "XCTracer"
                                                               : "none");
}

void sendCanned(int idx) {
  const char* text = pg::kCannedMessages[idx];
  char buf[64];
  const pg::Status& s = fc.status();
  if (idx == 1 && s.gnss.valid()) {
    // "Thermal here" carries the spot: other pilots' FANET devices show text only.
    snprintf(buf, sizeof buf, "%s %.5f,%.5f %+.1f", text, s.gnss.lat, s.gnss.lon, s.advisor.thermalAvg);
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
    if (c == pg::Command::Status) printStatus();
    return;
  }
  switch (c) {
    case pg::Command::SendOk: sendCanned(0); break;
    case pg::Command::SendThermal: sendCanned(1); break;
    case pg::Command::SendLanding: sendCanned(2); break;
    case pg::Command::SendHelp: sendCanned(3); break;
    case pg::Command::MarkThermal:
      Serial.printf("[mark] %.6f,%.6f alt %.0f\n", fc.status().gnss.lat, fc.status().gnss.lon, fc.status().altitude);
      fc.notify(pg::Alert::RemoteAck, now);
      break;
    default: break;
  }
}

void consoleHelp() {
  Serial.println(
      "commands:\n"
      "  status | health | i2c | help\n"
      "  show baro|gnss|imu|fc|xct|off   periodic prints for bring-up\n"
      "  mc <m/s> | automc on|off | vol <0-3> | mute | qnh <hPa>\n"
      "  beep stay|glide|msg|boot|err    play an alert\n"
      "  tone <Hz> | vario <m/s>          drive the piezo directly (bench)\n"
      "  cmd <char>                       inject a remote command (+ - u d m o t l h s k)\n"
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
    if (pg::fanet::decodeTracking(f.payload, f.payloadLen, t))
      Serial.printf("[fanet]   %.5f,%.5f %d m %+.1f m/s %.0f km/h\n", t.lat, t.lon, t.altitude, t.climb, t.speedKmh);
  }
}

// Follow the FANET zone with the GPS position (checked every 30 s).
void updateRegion(uint32_t now) {
  static uint32_t last = 0;
  if (now - last < 30000) return;
  last = now;
  const pg::GnssFix& g = fc.status().gnss;
  if (!g.valid()) return;
  const pg::fanet::Region& r = pg::fanet::regionFor(g.lat, g.lon);
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
  if (!s.gnss.valid()) return;
  lastTrack = now;
  pg::fanet::Tracking t;
  t.lat = s.gnss.lat;
  t.lon = s.gnss.lon;
  t.altitude = static_cast<int>(s.gnss.altMsl);
  t.speedKmh = s.gnss.groundSpeed * 3.6f;
  t.climb = s.vario;
  t.headingDeg = s.gnss.trackDeg;
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
  pinMode(PIN_IMU_CS, OUTPUT);
  digitalWrite(PIN_IMU_CS, HIGH);
  pinMode(PIN_LORA_NSS, OUTPUT);
  digitalWrite(PIN_LORA_NSS, HIGH);

  buzzer.begin(PIN_PIEZO);
  led.begin(PIN_LED, LED_ACTIVE_LOW);
  loadSettings();

  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL, I2C_FREQ_HZ);
  SPI.begin(PIN_SPI_SCK, PIN_SPI_MISO, PIN_SPI_MOSI);

  Serial.printf("BMP390     %s\n", baro.begin(Wire) ? "ok" : "not found");
  if (baro.present()) Serial.printf("           at 0x%02X\n", baro.address());
  Serial.printf("MAX-M10S   %s\n", gnss.begin(Wire, 5) ? "ok" : "not found");
  Serial.printf("ICM-42688  %s (WHO_AM_I 0x%02X)\n", imu.begin(SPI, PIN_IMU_CS) ? "ok" : "not found", imu.whoAmI());
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

  if (!baro.present()) Serial.println("note: no onboard baro — vario comes from the XCTracer once connected");
  fc.notify(pg::Alert::Boot, millis());
  consoleHelp();
}

void loop() {
  const uint32_t now = millis();

  pg::BaroSample b;
  if (baro.poll(b)) {
    fc.onBaro(b, pg::BaroOrigin::Onboard);
    lastBaro = b;
    ++baroCount;
  }
  pg::ImuSample m;
  if (imu.poll(m)) {
    fc.onImu(m);
    lastImu = m;
    ++imuCount;
  }
  pg::GnssFix g;
  if (gnss.poll(g)) {
    fc.onGnss(g);
    lastFix = g;
    ++gnssCount;
  }

  xct.service();
  if (xct.poll(b)) fc.onBaro(b, pg::BaroOrigin::XcTracer);
  uint32_t at;
  float alt;
  if (xct.pollAltitude(at, alt)) fc.onAltitude(at, alt, pg::BaroOrigin::XcTracer);
  // XCTracer position only when the onboard GNSS has nothing.
  if (xct.poll(g) && (!gnss.present() || !lastFix.valid() || now - lastFix.t > 3000)) fc.onGnss(g);

  pg::Command c;
  while (ble.popCommand(c)) handleCommand(c);

  FanetRx rx;
  if (lora.service(rx)) onFanet(rx);
  updateRegion(now);
  maybeSendTracking(now);

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
    char txt[48];
    const pg::Status& s = fc.status();
    snprintf(txt, sizeof txt, "%+.1f %.0fm mc%.1f %s", s.vario, s.altitude, s.advisor.mc,
             s.advisor.advice == pg::Advice::Stay ? "STAY" : s.advisor.advice == pg::Advice::Glide ? "GLIDE" : "");
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
