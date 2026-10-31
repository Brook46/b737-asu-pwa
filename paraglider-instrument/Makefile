# Desktop build of the hardware-free logic layer: tests and the flight simulator.
# Firmware is built with PlatformIO (`pio run`), not with this Makefile.

CXX      ?= g++
CXXFLAGS ?= -std=c++17 -O2 -g -Wall -Wextra -Wshadow -Werror
CORE     := $(wildcard lib/core/src/*.cpp)
INC      := -Ilib/core/src -Itest
BUILD    := build

.PHONY: all test sim clean

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

clean:
	rm -rf $(BUILD)
