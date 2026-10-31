// Tiny test harness: no dependencies, builds with any C++17 compiler.
#pragma once
#include <cmath>
#include <cstdio>
#include <functional>
#include <vector>

namespace check {

struct Case {
  const char* name;
  std::function<void()> fn;
};
inline std::vector<Case>& cases() {
  static std::vector<Case> c;
  return c;
}
inline int& failures() {
  static int f = 0;
  return f;
}
struct Reg {
  Reg(const char* n, std::function<void()> f) { cases().push_back({n, std::move(f)}); }
};

inline int runAll() {
  int failedCases = 0;
  for (auto& c : cases()) {
    const int before = failures();
    c.fn();
    const bool ok = failures() == before;
    if (!ok) ++failedCases;
    std::printf("%s %s\n", ok ? "  ok  " : " FAIL ", c.name);
  }
  std::printf("\n%zu cases, %d failed\n", cases().size(), failedCases);
  return failedCases ? 1 : 0;
}

}  // namespace check

#define CHECK_CAT2(a, b) a##b
#define CHECK_CAT(a, b) CHECK_CAT2(a, b)
#define TEST(name)                                                           \
  static void CHECK_CAT(test_, __LINE__)();                                  \
  static check::Reg CHECK_CAT(reg_, __LINE__)(name, CHECK_CAT(test_, __LINE__)); \
  static void CHECK_CAT(test_, __LINE__)()

#define EXPECT(cond)                                                          \
  do {                                                                        \
    if (!(cond)) {                                                            \
      std::printf("        %s:%d: expected %s\n", __FILE__, __LINE__, #cond); \
      ++check::failures();                                                    \
    }                                                                         \
  } while (0)

#define EXPECT_NEAR(a, b, tol)                                                          \
  do {                                                                                  \
    const double va_ = (a), vb_ = (b);                                                  \
    if (!(std::fabs(va_ - vb_) <= (tol))) {                                             \
      std::printf("        %s:%d: %s = %g, expected %g ± %g\n", __FILE__, __LINE__, #a, \
                  va_, vb_, static_cast<double>(tol));                                  \
      ++check::failures();                                                              \
    }                                                                                   \
  } while (0)
