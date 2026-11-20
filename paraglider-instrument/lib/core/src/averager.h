// Time-windowed running average over a fixed-capacity ring buffer.
// Unlike a sample-count average this stays honest when the update rate jitters
// (BLE notifications arrive in bursts) — the window is in milliseconds.
// Capacity N must cover window × feed rate, or the oldest samples are dropped
// early and the window silently shrinks; full() then reports false.
#pragma once
#include <cstddef>

#include "types.h"

namespace pg {

template <size_t N>
class WindowAverage {
 public:
  explicit WindowAverage(TimeMs windowMs) : window_(windowMs) {}
  void setWindow(TimeMs w) { window_ = w; }
  TimeMs window() const { return window_; }
  void clear() { head_ = count_ = 0; sum_ = 0; }

  void add(TimeMs t, float v) {
    if (count_ == N) popOldest();
    const size_t idx = (head_ + count_) % N;
    t_[idx] = t;
    v_[idx] = v;
    sum_ += v;
    ++count_;
    while (count_ > 1 && t - t_[head_] > window_) popOldest();
  }

  bool empty() const { return count_ == 0; }
  size_t size() const { return count_; }
  float mean() const { return count_ ? static_cast<float>(sum_ / count_) : 0.0f; }
  // Time span actually covered by the buffered samples.
  TimeMs span() const {
    if (count_ < 2) return 0;
    return t_[(head_ + count_ - 1) % N] - t_[head_];
  }
  // True once the buffer covers (nearly) the whole window.
  bool full() const { return span() + window_ / 10 >= window_; }

 private:
  void popOldest() {
    sum_ -= v_[head_];
    head_ = (head_ + 1) % N;
    --count_;
  }
  TimeMs window_;
  TimeMs t_[N] = {};
  float v_[N] = {};
  size_t head_ = 0, count_ = 0;
  double sum_ = 0;
};

// Mean climb since a start point: (alt_now - alt_start) / (t_now - t_start).
// This is the honest "thermal average" — it includes every bit of sink inside
// the circle, which a mean of filtered vario samples smooths away less cleanly.
class GainAverage {
 public:
  void start(TimeMs t, float alt) { t0_ = t; a0_ = alt; active_ = true; }
  void stop() { active_ = false; }
  bool active() const { return active_; }
  float rate(TimeMs t, float alt) const {
    if (!active_ || t <= t0_) return 0;
    return (alt - a0_) / ((t - t0_) / 1000.0f);
  }
  float gain(float alt) const { return active_ ? alt - a0_ : 0; }
  TimeMs elapsed(TimeMs t) const { return active_ && t > t0_ ? t - t0_ : 0; }

 private:
  TimeMs t0_ = 0;
  float a0_ = 0;
  bool active_ = false;
};

}  // namespace pg
