#include "buzzer.h"

#include <Arduino.h>

namespace {
constexpr uint8_t kChannel = 0;
constexpr uint8_t kResBits = 10;
// 10-bit duty per volume level. 512 = 50 %.
constexpr uint32_t kDuty[4] = {0, 24, 120, 512};
}  // namespace

// Arduino-ESP32 3.x replaced the channel-based LEDC API with a pin-based one.
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
#define PG_LEDC_ATTACH(pin, f) ledcAttach(pin, f, kResBits)
#define PG_LEDC_FREQ(pin, f) ledcChangeFrequency(pin, f, kResBits)
#define PG_LEDC_DUTY(pin, d) ledcWrite(pin, d)
#else
#define PG_LEDC_ATTACH(pin, f) (ledcSetup(kChannel, f, kResBits), ledcAttachPin(pin, kChannel))
#define PG_LEDC_FREQ(pin, f) ledcChangeFrequency(kChannel, f, kResBits)
#define PG_LEDC_DUTY(pin, d) ledcWrite(kChannel, d)
#endif

void Buzzer::begin(int pin) {
  pin_ = pin;
  PG_LEDC_ATTACH(pin_, 1000);
  PG_LEDC_DUTY(pin_, 0);
}

void Buzzer::set(uint16_t freqHz, int volume) {
  if (pin_ < 0) return;
  if (volume < 0) volume = 0;
  if (volume > 3) volume = 3;
  const uint32_t duty = freqHz ? kDuty[volume] : 0;
  if (freqHz && freqHz != freq_) {
    PG_LEDC_FREQ(pin_, freqHz);
    freq_ = freqHz;
    duty_ = UINT32_MAX;  // frequency change resets duty on some cores: rewrite it
  }
  if (duty != duty_) {
    PG_LEDC_DUTY(pin_, duty);
    duty_ = duty;
  }
}

void StatusLed::begin(int pin, bool activeLow) {
  pin_ = pin;
  activeLow_ = activeLow;
  pinMode(pin_, OUTPUT);
  set(false);
}

void StatusLed::set(bool on) {
  if (pin_ < 0 || state_ == static_cast<int>(on)) return;
  state_ = on;
  digitalWrite(pin_, (on != activeLow_) ? HIGH : LOW);
}
