// Passive piezo on an LEDC PWM channel, through an NPN transistor.
// Volume = PWM duty: 50 % is loudest for a square-driven piezo; lower duty is
// quieter. Level 0 is silent.
#pragma once
#include <cstdint>

class Buzzer {
 public:
  void begin(int pin);
  void set(uint16_t freqHz, int volume);  // volume 0..3
  void off() { set(0, 0); }

 private:
  int pin_ = -1;
  uint16_t freq_ = 0;
  uint32_t duty_ = 0;
};

class StatusLed {
 public:
  void begin(int pin, bool activeLow);
  void set(bool on);

 private:
  int pin_ = -1;
  bool activeLow_ = true;
  int state_ = -1;
};
