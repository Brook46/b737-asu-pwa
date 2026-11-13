#include "terrain.h"

#include <cstring>

namespace pg {

namespace {
uint16_t rd16(const uint8_t* p) { return static_cast<uint16_t>(p[0] | (p[1] << 8)); }
double rdf64(const uint8_t* p) {
  double d;
  std::memcpy(&d, p, 8);  // little-endian on both targets (ESP32, x86, wasm)
  return d;
}
constexpr size_t kHeader = 44;
}  // namespace

bool Terrain::load(const uint8_t* d, size_t len) {
  z_ = nullptr;
  if (!d || len < kHeader || std::memcmp(d, "PGTR", 4) != 0 || rd16(d + 4) != 1) return false;
  const int rows = rd16(d + 6), cols = rd16(d + 8);
  if (rows < 2 || cols < 2 || len < kHeader + static_cast<size_t>(rows) * cols * 2) return false;
  rows_ = rows;
  cols_ = cols;
  s_ = rdf64(d + 12);
  w_ = rdf64(d + 20);
  dlat_ = rdf64(d + 28);
  dlon_ = rdf64(d + 36);
  if (dlat_ <= 0 || dlon_ <= 0) return false;
  z_ = d + kHeader;
  return true;
}

float Terrain::at(int r, int c) const {
  const uint8_t* p = z_ + (static_cast<size_t>(r) * cols_ + c) * 2;
  return static_cast<float>(static_cast<int16_t>(rd16(p)));
}

bool Terrain::elevation(double lat, double lon, float& out) const {
  if (!z_) return false;
  const double fr = (lat - s_) / dlat_, fc = (lon - w_) / dlon_;
  if (fr < 0 || fc < 0 || fr > rows_ - 1 || fc > cols_ - 1) return false;
  int r = static_cast<int>(fr), c = static_cast<int>(fc);
  if (r >= rows_ - 1) r = rows_ - 2;
  if (c >= cols_ - 1) c = cols_ - 2;
  const float ar = static_cast<float>(fr - r), ac = static_cast<float>(fc - c);
  out = at(r, c) * (1 - ar) * (1 - ac) + at(r, c + 1) * (1 - ar) * ac + at(r + 1, c) * ar * (1 - ac) +
        at(r + 1, c + 1) * ar * ac;
  return true;
}

}  // namespace pg
