// Native harness for the simulator: flies the autopilot for a while, prints
// every cue with the truth beside it, and writes each screen page as a PBM.
//   make websim-native && build/sim_native [minutes] [outdir] [inversion m]
#include <cstdio>
#include <cstdlib>
#include <string>

#include "display/gfx.h"

extern "C" {
void sim_reset(uint32_t);
void sim_set(int, float);
void sim_step(int);
void sim_page(int);
const uint8_t* sim_render();
const float* sim_state();
}

static void writePbm(const std::string& path, const uint8_t* fb) {
  FILE* f = std::fopen(path.c_str(), "wb");
  if (!f) return;
  std::fprintf(f, "P4\n%d %d\n", pg::gfx::kWidth, pg::gfx::kHeight);
  std::fwrite(fb, 1, pg::gfx::kStride * pg::gfx::kHeight, f);
  std::fclose(f);
}

int main(int argc, char** argv) {
  const int minutes = argc > 1 ? std::atoi(argv[1]) : 20;
  const std::string out = argc > 2 ? argv[2] : "build";
  sim_reset(42);
  if (argc > 3) sim_set(11, static_cast<float>(std::atof(argv[3])));
  const char* names[] = {"", "STAY", "GLIDE", "MESSAGE", "ACK", "MC+", "MC-", "BOOT", "ERROR", "NEAR BASE", "INVERSION"};
  float lastAlertT = -1;
  int stays = 0, glides = 0;
  for (int s = 0; s < minutes * 60; ++s) {
    sim_step(1000);
    const float* st = sim_state();
    if (st[30] != lastAlertT && st[29] > 0) {
      lastAlertT = st[30];
      const int a = static_cast<int>(st[29]);
      if (a == 1) ++stays;
      if (a == 2) ++glides;
      std::printf("%6.0f s  %-9s alt %5.0f (true %5.0f)  vario %+4.1f (true %+4.1f)  circle %+4.1f  mc %.1f  base %4.0f (true %4.0f)\n",
                  st[30], a < 11 ? names[a] : "?", st[1], st[4], st[2], st[5], st[36], st[12], st[16], st[18]);
    }
    if (s % 60 == 59 && s / 60 % 5 == 4)
      std::printf("   -- %2d min: alt %.0f, wind est %.0f km/h from %.0f (true %.0f from %.0f), lapse %.1f%s (true %.1f), landings %.0f\n",
                  s / 60 + 1, st[1], st[13], st[14], st[31], st[32], st[19], st[20] > 0 ? "" : "?", st[39], st[33]);
  }
  const float* st = sim_state();
  std::printf("\n%d STAY, %d GLIDE cues; thermals counted %.0f; MC %.2f; base est %.0f vs true %.0f (offset %.1f)\n", stays,
              glides, st[38], st[12], st[16], st[18], st[21]);
  for (int p = 0; p < 4; ++p) {
    sim_page(p);
    writePbm(out + "/page" + std::to_string(p) + ".pbm", sim_render());
  }
  std::printf("screens: %s/page0..3.pbm\n", out.c_str());
  return 0;
}
