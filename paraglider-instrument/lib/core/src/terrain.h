// Terrain elevation from a baked grid (tools/terrain/build_terrain.py → .ter).
// The grid lives wherever the caller keeps it (flash on the device, a fetched
// buffer in the simulator); this class only reads it.
#pragma once
#include <cstddef>
#include <cstdint>

namespace pg {

class Terrain {
 public:
  // Points at a .ter image. Returns false if it isn't one. The buffer must
  // outlive the Terrain.
  bool load(const uint8_t* data, size_t len);
  bool valid() const { return z_ != nullptr; }
  // Elevation in metres (bilinear). Returns false outside the grid.
  bool elevation(double lat, double lon, float& out) const;
  double south() const { return s_; }
  double west() const { return w_; }
  double north() const { return s_ + (rows_ - 1) * dlat_; }
  double east() const { return w_ + (cols_ - 1) * dlon_; }

 private:
  float at(int r, int c) const;
  const uint8_t* z_ = nullptr;  // i16 little-endian
  int rows_ = 0, cols_ = 0;
  double s_ = 0, w_ = 0, dlat_ = 1, dlon_ = 1;
};

}  // namespace pg
