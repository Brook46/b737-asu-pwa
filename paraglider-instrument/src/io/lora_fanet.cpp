#include "lora_fanet.h"

#include <Arduino.h>
#include <RadioLib.h>

#include "pins.h"

// FANET radio parameters common to every region (see lib/core/src/fanet.h);
// frequency, bandwidth and power come from the Region.
namespace {
constexpr uint8_t kSf = 7;
constexpr uint8_t kCr = 5;          // 4/5
constexpr uint8_t kSyncWord = 0xF1;
constexpr uint16_t kPreamble = 8;   // the reference never changes the SX127x default of 8
constexpr uint32_t kDutyWindowMs = 3600UL * 1000UL;
constexpr uint32_t kDutyBudgetMs = 36UL * 1000UL;  // 1 % of an hour

Module* gModule = nullptr;
SX1262* gRadio = nullptr;
volatile bool gRxFlag = false;

void IRAM_ATTR onDio1() { gRxFlag = true; }
}  // namespace

static int8_t txPower(const pg::fanet::Region& r) {
  return r.dBm < PG_LORA_TX_DBM ? r.dBm : PG_LORA_TX_DBM;  // build flag caps the zone's limit
}

bool LoraFanet::begin(SPIClass& spi, const pg::fanet::Region& region) {
  ok_ = false;
  region_ = &region;
  gModule = new Module(PIN_LORA_NSS, PIN_LORA_DIO1, PIN_LORA_RESET, PIN_LORA_BUSY, spi,
                       SPISettings(4000000, MSBFIRST, SPI_MODE0));
  gRadio = new SX1262(gModule);
  // Power argument is irrelevant while TX is compiled out, but keep it legal.
  int st = gRadio->begin(region.freqMHz, region.bwKHz, kSf, kCr, kSyncWord, txPower(region),
                         kPreamble, LORA_TCXO_VOLTAGE, false);
  if (st != RADIOLIB_ERR_NONE) {
    lastErr_ = st;
    return false;
  }
  gRadio->setDio2AsRfSwitch(true);
  gRadio->setRfSwitchPins(PIN_LORA_RXEN, RADIOLIB_NC);
  gRadio->setCRC(2);  // LoRa: any non-zero length = CRC on (RadioLib default too)
  gRadio->setPacketReceivedAction(onDio1);
  st = gRadio->startReceive();
  if (st != RADIOLIB_ERR_NONE) {
    lastErr_ = st;
    return false;
  }
  ok_ = true;
  return true;
}

bool LoraFanet::setRegion(const pg::fanet::Region& r) {
  if (&r == region_) return true;
  region_ = &r;
  if (!ok_) return false;
  gRadio->standby();
  int st = gRadio->setFrequency(r.freqMHz);
  if (st == RADIOLIB_ERR_NONE) st = gRadio->setBandwidth(r.bwKHz);
  if (st == RADIOLIB_ERR_NONE) st = gRadio->setOutputPower(txPower(r));
  gRxFlag = false;
  gRadio->startReceive();
  if (st != RADIOLIB_ERR_NONE) lastErr_ = st;
  return st == RADIOLIB_ERR_NONE;
}

bool LoraFanet::service(FanetRx& rx) {
  if (!ok_ || !gRxFlag) return false;
  gRxFlag = false;
  uint8_t buf[pg::fanet::kMaxFrame];
  const size_t len = gRadio->getPacketLength();
  bool good = false;
  if (len > 0 && len <= sizeof buf) {
    const int st = gRadio->readData(buf, len);
    if (st == RADIOLIB_ERR_NONE && pg::fanet::decode(buf, len, rx.frame)) {
      rx.rssi = gRadio->getRSSI();
      rx.snr = gRadio->getSNR();
      rx.t = millis();
      ++rxCount_;
      good = true;
    } else {
      lastErr_ = st;
    }
  }
  gRadio->startReceive();
  return good;
}

bool LoraFanet::armTx(bool on) {
  armed_ = on && txCompiledIn() && ok_;
  return armed_;
}

bool LoraFanet::send(pg::fanet::Frame& f) {
  f.src = addr_;
  uint8_t air[pg::fanet::kMaxFrame];
  const size_t n = pg::fanet::encode(f, air, sizeof air);
  if (!n) return false;

  if (!txCompiledIn() || !armed_ || !ok_) {
    Serial.printf("[fanet] TX blocked (%s): type %u, %u bytes\n",
                  !txCompiledIn() ? "compiled out — legal check pending" : !ok_ ? "no radio" : "not armed",
                  f.type, static_cast<unsigned>(n));
    return false;
  }
#if PG_LORA_TX_ENABLED
  const uint32_t now = millis();
  if (now - airtimeWindowStart_ > kDutyWindowMs) {
    airtimeWindowStart_ = now;
    airtimeMs_ = 0;
  }
  const uint32_t toa = static_cast<uint32_t>(gRadio->getTimeOnAir(n) / 1000);
  if (airtimeMs_ + toa > kDutyBudgetMs) {
    Serial.println("[fanet] TX refused: 1 % duty-cycle budget spent for this hour");
    return false;
  }
  const int st = gRadio->transmit(air, n);
  gRxFlag = false;  // TX-done also raises DIO1
  gRadio->startReceive();
  if (st != RADIOLIB_ERR_NONE) {
    lastErr_ = st;
    return false;
  }
  airtimeMs_ += toa;
  ++txCount_;
  return true;
#else
  return false;
#endif
}

bool LoraFanet::sendTracking(const pg::fanet::Tracking& t) {
  pg::fanet::Frame f;
  f.type = pg::fanet::kTracking;
  f.payloadLen = pg::fanet::encodeTracking(t, f.payload, sizeof f.payload);
  return f.payloadLen && send(f);
}

bool LoraFanet::sendMessage(const char* text, const pg::fanet::Address* to) {
  pg::fanet::Frame f;
  f.type = pg::fanet::kMessage;
  if (to) {
    f.unicast = true;
    f.dest = *to;
    f.ack = 1;
  }
  f.payloadLen = pg::fanet::encodeMessage(text, f.payload, sizeof f.payload);
  return f.payloadLen && send(f);
}

bool LoraFanet::sendName(const char* name) {
  pg::fanet::Frame f;
  f.type = pg::fanet::kName;
  f.payloadLen = pg::fanet::encodeName(name, f.payload, sizeof f.payload);
  return f.payloadLen && send(f);
}
