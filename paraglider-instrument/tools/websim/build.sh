#!/usr/bin/env bash
# Builds the browser simulator: the real lib/core (flight logic + display
# pages) plus the simulated world, compiled to WebAssembly → sim/sim.wasm.
# Needs Zig (pip install ziglang) for a C++ → wasm32-wasi toolchain.
set -euo pipefail
cd "$(dirname "$0")/../.."
ZIG="${ZIG:-python3 -m ziglang}"
$ZIG c++ -target wasm32-wasi -mexec-model=reactor -Os -fno-exceptions -fno-rtti \
  -Ilib/core/src -Itools/websim \
  tools/websim/sim_api.cpp lib/core/src/*.cpp lib/core/src/display/*.cpp \
  -Wl,--strip-all -o sim/sim.wasm
ls -l sim/sim.wasm
