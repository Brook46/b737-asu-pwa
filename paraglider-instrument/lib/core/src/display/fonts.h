// 1-bit bitmap fonts (generated: tools/fontgen/fontgen.py). Characters 32..126
// plus 127, which is the degree sign — write it as "\x7f" in strings.
#pragma once
#include <cstdint>

namespace pg::gfx {

struct Glyph {
  uint32_t offset;  // into the font's bitmap
  uint8_t w, h;     // bitmap box
  int8_t xo, yo;    // box offset from the pen position / top of the line
  uint8_t adv;      // pen advance
};

struct Font {
  const uint8_t* bits;  // each glyph row-major, rows padded to whole bytes, MSB first
  const Glyph* glyphs;
  uint8_t first, last;
  uint8_t lineHeight;
  uint8_t ascent;
};

extern const Font kFontTiny;    // 11 px, status bar
extern const Font kFontSmall;   // 14 px, labels
extern const Font kFontMedium;  // 20 px bold, values
extern const Font kFontLarge;   // 34 px bold, main values
extern const Font kFontHuge;    // 64 px bold, the vario number

}  // namespace pg::gfx
