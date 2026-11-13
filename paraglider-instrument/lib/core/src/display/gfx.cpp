#include "gfx.h"

#include <cstdlib>
#include <cstring>

namespace pg::gfx {

void Canvas::fill(bool dark) { std::memset(buf_, dark ? 0xFF : 0x00, sizeof buf_); }

void Canvas::pixel(int x, int y, bool dark) {
  if (portrait_) {  // logical 240 × 400 → panel: x' = y, y' = 239 − x
    if (x < 0 || y < 0 || x >= kHeight || y >= kWidth) return;
    const int px = y, py = kHeight - 1 - x;
    x = px;
    y = py;
  }
  if (x < 0 || y < 0 || x >= kWidth || y >= kHeight) return;
  uint8_t& b = buf_[y * kStride + (x >> 3)];
  const uint8_t m = static_cast<uint8_t>(0x80 >> (x & 7));
  if (dark) b |= m;
  else b &= static_cast<uint8_t>(~m);
}

bool Canvas::get(int x, int y) const {
  if (portrait_) {
    if (x < 0 || y < 0 || x >= kHeight || y >= kWidth) return false;
    const int px = y, py = kHeight - 1 - x;
    x = px;
    y = py;
  }
  if (x < 0 || y < 0 || x >= kWidth || y >= kHeight) return false;
  return buf_[y * kStride + (x >> 3)] & (0x80 >> (x & 7));
}

void Canvas::hline(int x, int y, int w, bool dark) {
  for (int i = 0; i < w; ++i) pixel(x + i, y, dark);
}

void Canvas::vline(int x, int y, int h, bool dark) {
  for (int i = 0; i < h; ++i) pixel(x, y + i, dark);
}

void Canvas::rect(int x, int y, int w, int h, bool dark) {
  hline(x, y, w, dark);
  hline(x, y + h - 1, w, dark);
  vline(x, y, h, dark);
  vline(x + w - 1, y, h, dark);
}

void Canvas::fillRect(int x, int y, int w, int h, bool dark) {
  for (int j = 0; j < h; ++j) hline(x, y + j, w, dark);
}

void Canvas::invert(int x, int y, int w, int h) {
  for (int j = y; j < y + h; ++j)
    for (int i = x; i < x + w; ++i) pixel(i, j, !get(i, j));
}

void Canvas::line(int x0, int y0, int x1, int y1, bool dark, int thickness) {
  const int dx = std::abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  const int dy = -std::abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  int err = dx + dy;
  const int r = thickness / 2;
  for (;;) {
    if (thickness <= 1) pixel(x0, y0, dark);
    else fillRect(x0 - r, y0 - r, thickness, thickness, dark);
    if (x0 == x1 && y0 == y1) break;
    const int e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

void Canvas::circle(int cx, int cy, int r, bool dark) {
  int x = r, y = 0, err = 1 - r;
  while (x >= y) {
    pixel(cx + x, cy + y, dark); pixel(cx - x, cy + y, dark);
    pixel(cx + x, cy - y, dark); pixel(cx - x, cy - y, dark);
    pixel(cx + y, cy + x, dark); pixel(cx - y, cy + x, dark);
    pixel(cx + y, cy - x, dark); pixel(cx - y, cy - x, dark);
    ++y;
    if (err < 0) {
      err += 2 * y + 1;
    } else {
      --x;
      err += 2 * (y - x) + 1;
    }
  }
}

void Canvas::fillCircle(int cx, int cy, int r, bool dark) {
  for (int y = -r; y <= r; ++y)
    for (int x = -r; x <= r; ++x)
      if (x * x + y * y <= r * r + r) pixel(cx + x, cy + y, dark);
}

void Canvas::fillTriangle(int x0, int y0, int x1, int y1, int x2, int y2, bool dark) {
  int minX = x0, maxX = x0, minY = y0, maxY = y0;
  const int xs[3] = {x0, x1, x2}, ys[3] = {y0, y1, y2};
  for (int i = 1; i < 3; ++i) {
    if (xs[i] < minX) minX = xs[i];
    if (xs[i] > maxX) maxX = xs[i];
    if (ys[i] < minY) minY = ys[i];
    if (ys[i] > maxY) maxY = ys[i];
  }
  auto edge = [](int ax, int ay, int bx, int by, int px, int py) {
    return (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  };
  const int area = edge(x0, y0, x1, y1, x2, y2);
  if (area == 0) return;
  for (int y = minY; y <= maxY; ++y)
    for (int x = minX; x <= maxX; ++x) {
      const int w0 = edge(x1, y1, x2, y2, x, y), w1 = edge(x2, y2, x0, y0, x, y), w2 = edge(x0, y0, x1, y1, x, y);
      if ((area > 0 && w0 >= 0 && w1 >= 0 && w2 >= 0) || (area < 0 && w0 <= 0 && w1 <= 0 && w2 <= 0))
        pixel(x, y, dark);
    }
}

void Canvas::dotted(int x, int y, int w, int step, bool dark) {
  for (int i = 0; i < w; i += step) pixel(x + i, y, dark);
}

int Canvas::textWidth(const char* s, const Font& f) {
  int w = 0;
  for (; *s; ++s) {
    const uint8_t c = static_cast<uint8_t>(*s);
    if (c < f.first || c > f.last) continue;
    w += f.glyphs[c - f.first].adv;
  }
  return w;
}

int Canvas::text(int x, int y, const char* s, const Font& f, Align a, bool dark) {
  const int w = textWidth(s, f);
  if (a == Align::Center) x -= w / 2;
  else if (a == Align::Right) x -= w;
  for (; *s; ++s) {
    const uint8_t c = static_cast<uint8_t>(*s);
    if (c < f.first || c > f.last) continue;
    const Glyph& g = f.glyphs[c - f.first];
    const int stride = (g.w + 7) / 8;
    const uint8_t* bits = f.bits + g.offset;
    for (int r = 0; r < g.h; ++r)
      for (int col = 0; col < g.w; ++col)
        if (bits[r * stride + col / 8] & (0x80 >> (col % 8))) pixel(x + g.xo + col, y + g.yo + r, dark);
    x += g.adv;
  }
  return w;
}

}  // namespace pg::gfx
