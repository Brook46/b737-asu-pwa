# Desktop build of the hardware-free logic layer: tests and the flight simulator.
# Firmware is built with PlatformIO (`pio run`), not with this Makefile.

CXX      ?= g++
CXXFLAGS ?= -std=c++17 -O2 -g -Wall -Wextra -Wshadow -Werror
CORE     := $(wildcard lib/core/src/*.cpp) $(wildcard lib/core/src/display/*.cpp)
INC      := -Ilib/core/src -Itest
BUILD    := build

.PHONY: all test sim websim websim-native clean

all: test sim

$(BUILD):
	mkdir -p $(BUILD)

$(BUILD)/test_core: test/test_core.cpp $(CORE) $(wildcard lib/core/src/*.h test/*.h) | $(BUILD)
	$(CXX) $(CXXFLAGS) $(INC) test/test_core.cpp $(CORE) -o $@

$(BUILD)/sim: tools/sim/sim.cpp $(CORE) $(wildcard lib/core/src/*.h test/*.h) | $(BUILD)
	$(CXX) $(CXXFLAGS) $(INC) tools/sim/sim.cpp $(CORE) -o $@

test: $(BUILD)/test_core
	./$(BUILD)/test_core

sim: $(BUILD)/sim

# Native run of the browser simulator's world + screens (writes PBM screenshots).
$(BUILD)/sim_native: tools/websim/sim_native.cpp tools/websim/sim_api.cpp tools/websim/world.h $(CORE) $(wildcard lib/core/src/*.h lib/core/src/display/*.h) | $(BUILD)
	$(CXX) $(CXXFLAGS) $(INC) -Itools/websim tools/websim/sim_native.cpp tools/websim/sim_api.cpp $(CORE) -o $@

websim-native: $(BUILD)/sim_native

# Browser simulator: rebuild sim/sim.wasm after ANY change under lib/core.
websim:
	./tools/websim/build.sh

clean:
	rm -rf $(BUILD)
