#include "ble_link.h"

#include <Arduino.h>
#include <NimBLEDevice.h>
#include <freertos/queue.h>
#include <freertos/stream_buffer.h>

#include <cstring>
#include <string>

// Written against the NimBLE-Arduino 1.4.x API (pinned in platformio.ini).

namespace {

BleLink* gLink = nullptr;
NimBLEClient* gClient = nullptr;

void xctNotify(NimBLERemoteCharacteristic*, uint8_t* data, size_t len, bool) {
  if (gLink) gLink->onXctBytes(data, len);
}

class ClientCb : public NimBLEClientCallbacks {
  void onConnect(NimBLEClient*) override {}
  void onDisconnect(NimBLEClient*) override {
    if (gLink) gLink->setXctConnected(false);
  }
};

class ServerCb : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer* srv, ble_gap_conn_desc* desc) override {
    const std::string addr = NimBLEAddress(desc->peer_ota_addr).toString();
    if (gLink && !gLink->remoteAllowed(addr.c_str())) {
      srv->disconnect(desc->conn_handle);
      return;
    }
    if (gLink) gLink->setRemoteConnected(true);
    // Keep advertising so a second remote (or nRF Connect) can still find us.
    NimBLEDevice::startAdvertising();
  }
  void onDisconnect(NimBLEServer* srv) override {
    if (gLink) gLink->setRemoteConnected(srv->getConnectedCount() > 0);
  }
};

class CommandCb : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* c) override {
    if (!gLink) return;
    NimBLEAttValue v = c->getValue();
    gLink->onCommandBytes(v.data(), v.length());
  }
};

void taskEntry(void* arg) {
  static_cast<BleLink*>(arg)->centralTask();
}

}  // namespace

void BleLink::begin(const char* deviceName, const char* remoteAllowedAddr) {
  gLink = this;
  std::strncpy(allowed_, remoteAllowedAddr ? remoteAllowedAddr : "", sizeof allowed_ - 1);
  stream_ = xStreamBufferCreate(2048, 1);
  cmdQueue_ = xQueueCreate(16, sizeof(pg::Command));

  NimBLEDevice::init(deviceName);
  NimBLEDevice::setPower(ESP_PWR_LVL_P9);

  // Peripheral side: remote command service.
  NimBLEServer* srv = NimBLEDevice::createServer();
  srv->setCallbacks(new ServerCb());
  NimBLEService* svc = srv->createService(BleUuids::kRemoteService);
  NimBLECharacteristic* cmd = svc->createCharacteristic(
      BleUuids::kRemoteCommand, NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR);
  cmd->setCallbacks(new CommandCb());
  NimBLECharacteristic* st = svc->createCharacteristic(
      BleUuids::kRemoteStatus, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);
  static const char kBoot[] = "booting";
  st->setValue(reinterpret_cast<const uint8_t*>(kBoot), sizeof kBoot - 1);
  statusChr_ = st;
  svc->start();
  NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
  adv->addServiceUUID(BleUuids::kRemoteService);
  adv->setScanResponse(true);
  adv->start();

  // Central side runs in its own task: scan/connect block for seconds.
  xTaskCreatePinnedToCore(taskEntry, "ble-central", 6144, this, 1, nullptr, 0);
}

bool BleLink::remoteAllowed(const char* addr) const {
  if (!allowed_[0]) return true;
  return strcasecmp(addr, allowed_) == 0;
}

void BleLink::onXctBytes(const uint8_t* d, size_t n) {
  if (!stream_) return;
  xStreamBufferSend(static_cast<StreamBufferHandle_t>(stream_), d, n, 0);  // drop if full
  xctBytes_ += n;
}

void BleLink::onCommandBytes(const uint8_t* d, size_t n) {
  const pg::Command c = pg::parseCommand(d, n);
  if (c != pg::Command::None && cmdQueue_)
    xQueueSend(static_cast<QueueHandle_t>(cmdQueue_), &c, 0);
}

size_t BleLink::readXct(uint8_t* buf, size_t cap) {
  if (!stream_) return 0;
  return xStreamBufferReceive(static_cast<StreamBufferHandle_t>(stream_), buf, cap, 0);
}

bool BleLink::popCommand(pg::Command& c) {
  return cmdQueue_ && xQueueReceive(static_cast<QueueHandle_t>(cmdQueue_), &c, 0) == pdTRUE;
}

void BleLink::setStatusText(const char* text) {
  if (!statusChr_) return;
  auto* c = static_cast<NimBLECharacteristic*>(statusChr_);
  // Not setValue(text): NimBLE 1.4's template overload would store the
  // pointer's 4 bytes, not the string.
  c->setValue(reinterpret_cast<const uint8_t*>(text), std::strlen(text));
  if (remoteConnected_) c->notify();
}

bool BleLink::connectXct() {
  NimBLEScan* scan = NimBLEDevice::getScan();
  scan->setActiveScan(true);
  scan->setInterval(100);
  scan->setWindow(60);
  NimBLEScanResults res = scan->start(5, false);  // blocking 5 s scan (this task only)
  const NimBLEUUID nus(BleUuids::kNusService), hm(BleUuids::kHm10Service);  // hm used below
  NimBLEAddress target;
  bool found = false;
  for (int i = 0; i < res.getCount() && !found; ++i) {
    NimBLEAdvertisedDevice dev = res.getDevice(i);
    const std::string name = dev.getName();
    const bool nameHit = name.find("XC") != std::string::npos || name.find("xc") != std::string::npos;
    // NUS advertised, or a name that looks like an XCTracer (it may not
    // advertise its service UUID). Pin it with an address setting if a
    // neighbour's device ever gets picked instead.
    if (dev.isAdvertisingService(nus) || nameHit) {
      target = dev.getAddress();
      found = true;
    }
  }
  scan->clearResults();
  if (!found) return false;

  if (!gClient) {
    gClient = NimBLEDevice::createClient();
    gClient->setClientCallbacks(new ClientCb(), true);
    gClient->setConnectTimeout(5);
  }
  if (!gClient->connect(target)) return false;

  NimBLERemoteCharacteristic* chr = nullptr;
  if (NimBLERemoteService* s = gClient->getService(nus)) chr = s->getCharacteristic(BleUuids::kNusTx);
  if (!chr) {
    if (NimBLERemoteService* s = gClient->getService(hm)) chr = s->getCharacteristic(BleUuids::kHm10Char);
  }
  if (!chr || !chr->canNotify() || !chr->subscribe(true, xctNotify)) {
    gClient->disconnect();
    return false;
  }
  std::strncpy(xctAddr_, target.toString().c_str(), sizeof xctAddr_ - 1);
  xctConnected_ = true;
  return true;
}

void BleLink::centralTask() {
  for (;;) {
    if (rescan_ && xctConnected_ && gClient) {
      gClient->disconnect();
      rescan_ = false;
    }
    if (!xctConnected_) {
      if (!connectXct()) vTaskDelay(pdMS_TO_TICKS(2000));  // back off between scans
    } else {
      vTaskDelay(pdMS_TO_TICKS(500));
    }
  }
}
