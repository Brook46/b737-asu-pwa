// BLE: one NimBLE stack, two roles.
//
//  * Central → XCTracer Maxx II. Scans for the Nordic UART Service (or the
//    HM-10 style FFE0/FFE1 service some firmwares use), connects, subscribes
//    to the TX characteristic, and pushes every byte into a stream buffer.
//    Scanning and connecting block for seconds, so they run in their own
//    FreeRTOS task on core 0; loop() on core 1 never waits on BLE.
//  * Peripheral ← brake-handle remote (XIAO ESP32-C6). Advertises a command
//    service; writes are queued as pg::Command for loop() to handle.
//
// ⚠ A BLE peripheral usually accepts one central at a time. While this unit
//   holds the XCTracer link, a phone running XCTrack may not be able to
//   connect to the XCTracer. Check this on the bench (docs/bringup.md, step 5).
#pragma once
#include <cstddef>
#include <cstdint>

#include "remote.h"

namespace BleUuids {
// Nordic UART Service (what the XCTracer exposes per its docs).
constexpr const char* kNusService = "6E400001-B5A3-F393-E0A9-E50E24DCCA9E";
constexpr const char* kNusTx = "6E400003-B5A3-F393-E0A9-E50E24DCCA9E";  // notify, device → us
// HM-10 style fallback.
constexpr const char* kHm10Service = "FFE0";
constexpr const char* kHm10Char = "FFE1";
// Our own remote-command service (random v4 UUIDs, fixed here and in the remote).
constexpr const char* kRemoteService = "7d2a0001-6c39-4b8e-9f4e-3a1c5b8e2f10";
constexpr const char* kRemoteCommand = "7d2a0002-6c39-4b8e-9f4e-3a1c5b8e2f10";  // write, 1 byte
constexpr const char* kRemoteStatus = "7d2a0003-6c39-4b8e-9f4e-3a1c5b8e2f10";   // read/notify, text
}  // namespace BleUuids

class BleLink {
 public:
  void begin(const char* deviceName, const char* remoteAllowedAddr);
  // Bytes received from the XCTracer since the last call.
  size_t readXct(uint8_t* buf, size_t cap);
  bool popCommand(pg::Command& c);
  void setStatusText(const char* text);  // readable by the remote / nRF Connect

  bool xctConnected() const { return xctConnected_; }
  bool remoteConnected() const { return remoteConnected_; }
  const char* xctAddress() const { return xctAddr_; }
  uint32_t xctBytes() const { return xctBytes_; }
  void rescan() { rescan_ = true; }

  // Internal, called from NimBLE callbacks / the BLE task.
  void onXctBytes(const uint8_t* d, size_t n);
  void onCommandBytes(const uint8_t* d, size_t n);
  void setRemoteConnected(bool c) { remoteConnected_ = c; }
  void setXctConnected(bool c) { xctConnected_ = c; }
  bool remoteAllowed(const char* addr) const;
  void centralTask();

 private:
  bool connectXct();
  volatile bool xctConnected_ = false;
  volatile bool remoteConnected_ = false;
  volatile bool rescan_ = false;
  volatile uint32_t xctBytes_ = 0;
  char xctAddr_[20] = "";
  char allowed_[20] = "";
  void* stream_ = nullptr;  // StreamBufferHandle_t
  void* cmdQueue_ = nullptr;  // QueueHandle_t
  void* statusChr_ = nullptr;  // NimBLECharacteristic*
};
