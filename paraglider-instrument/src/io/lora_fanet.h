// FANET over the Wio-SX1262 (RadioLib).
//
// Receive is always on once the radio initialises. Transmit is gated twice:
//   1. compile time — PG_LORA_TX_ENABLED must be 1 (build_config.h), and
//   2. run time — `tx arm` on the serial console, every boot (not persisted).
// Until the Israeli legal check is done, leave (1) at 0: the TX code is then
// compiled out and send() only logs what it would have sent.
#pragma once
#include <SPI.h>

#include "build_config.h"
#include "fanet.h"

struct FanetRx {
  pg::fanet::Frame frame;
  float rssi = 0, snr = 0;
  uint32_t t = 0;
};

class LoraFanet {
 public:
  bool begin(SPIClass& spi, const pg::fanet::Region& region);
  // Retune to a FANET zone (frequency, bandwidth, power). No-op if unchanged.
  bool setRegion(const pg::fanet::Region& region);
  const pg::fanet::Region& region() const { return *region_; }
  bool present() const { return ok_; }
  // Call every loop(): moves a received packet out of the radio. Returns true
  // and fills `rx` if a valid FANET frame arrived.
  bool service(FanetRx& rx);

  void setAddress(pg::fanet::Address a) { addr_ = a; }
  pg::fanet::Address address() const { return addr_; }
  bool armTx(bool on);  // returns the resulting armed state
  bool txArmed() const { return armed_; }
  static constexpr bool txCompiledIn() { return PG_LORA_TX_ENABLED != 0; }

  // Each returns true only if the frame actually went on air.
  bool sendTracking(const pg::fanet::Tracking& t);
  bool sendMessage(const char* text, const pg::fanet::Address* to = nullptr);
  bool sendName(const char* name);

  uint32_t rxCount() const { return rxCount_; }
  uint32_t txCount() const { return txCount_; }
  int lastError() const { return lastErr_; }

 private:
  bool send(pg::fanet::Frame& f);
  bool ok_ = false;
  bool armed_ = false;
  const pg::fanet::Region* region_ = &pg::fanet::defaultRegion();
  pg::fanet::Address addr_{0xFC, 0x0001};
  uint32_t rxCount_ = 0, txCount_ = 0;
  uint32_t airtimeMs_ = 0, airtimeWindowStart_ = 0;
  int lastErr_ = 0;
};
