// Minimal 1-bit graphics for a 400 × 240 Sharp Memory LCD (LS027B7DH01).
// The framebuffer is the LCD's own format: rows top to bottom, 50 bytes per
// row, MSB = leftmost pixel, bit = 1 → dark. The firmware will only have to
// push it over SPI; the browser simulator reads the same buffer.
#pragma once
#include <cstdint>

#include "fonts.h"

namespace pg::gfx {

constexpr int kWidth = 400;
constexpr int kHeight = 240;
constexpr int kStride = kWidth / 8;

enum class Align : uint8_t { Left, Center, Right };

class Canvas {
 public:
  // Portrait: you draw on a 240 × 400 canvas, turned onto the 400 × 240
  // panel (the panel mounted with its long side vertical, its left edge up).
  // The framebuffer stays in the panel's own format either way.
  void setPortrait(bool p) { portrait_ = p; }
  bool portrait() const { return portrait_; }
  int width() const { return portrait_ ? kHeight : kWidth; }
  int height() const { return portrait_ ? kWidth : kHeight; }
  void clear() { fill(false); }
  void fill(bool dark);
  void pixel(int x, int y, bool dark = true);
  bool get(int x, int y) const;
  void hline(int x, int y, int w, bool dark = true);
  void vline(int x, int y, int h, bool dark = true);
  void rect(int x, int y, int w, int h, bool dark = true);
  void fillRect(int x, int y, int w, int h, bool dark = true);
  void line(int x0, int y0, int x1, int y1, bool dark = true, int thickness = 1);
  void circle(int cx, int cy, int r, bool dark = true);
  void fillCircle(int cx, int cy, int r, bool dark = true);
  void fillTriangle(int x0, int y0, int x1, int y1, int x2, int y2, bool dark = true);
  void dotted(int x, int y, int w, int step, bool dark = true);
  // Text: `y` is the top of the line box. Returns the advance width.
  int text(int x, int y, const char* s, const Font& f, Align a = Align::Left, bool dark = true);
  static int textWidth(const char* s, const Font& f);
  // Invert a region (for banners).
  void invert(int x, int y, int w, int h);

  const uint8_t* buffer() const { return buf_; }

 private:
  uint8_t buf_[kStride * kHeight] = {};
  bool portrait_ = false;
};

}  // namespace pg::gfx
