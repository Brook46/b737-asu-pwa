#!/usr/bin/env bash
# Exports every printable part to hardware/stl/ and renders previews to
# docs/build/. Needs OpenSCAD (2021.01 or newer); renders need a display, so
# on a headless machine they run under xvfb-run if it's installed.
set -euo pipefail
cd "$(dirname "$0")"
STL=../stl
IMG=../../docs/build
mkdir -p "$STL" "$IMG"
run() { openscad "$@" 2>&1 | grep -E "ERROR|WARNING" || true; }
render() {  # out.png, scad, camera, extra -D...
  local out=$1 scad=$2 cam=$3; shift 3
  if command -v xvfb-run >/dev/null; then x="xvfb-run -a"; else x=""; fi
  $x openscad -o "$IMG/$out" --imgsize=1200,900 --colorscheme=Tomorrow --camera="$cam" --projection=p "$@" "$scad" 2>&1 \
    | grep -E "ERROR" || true
}

for p in tray lid_headless strap_plate; do run -D "part=\"$p\"" -o "$STL/instrument_$p.stl" instrument.scad; done
run -D 'part="tray"' -D 'screen=true' -o "$STL/instrument_tray_screen.stl" instrument.scad
run -D 'part="lid_screen"' -D 'screen=true' -o "$STL/instrument_lid_screen.stl" instrument.scad
for p in body lid cap_flat cap_dome; do run -D "part=\"$p\"" -o "$STL/remote_$p.stl" remote.scad; done
run -o "$STL/sensor_shield.stl" shield.scad

# camera: translate x,y,z, rotate x,y,z, distance
render instrument_open.png instrument.scad 40,28,18,55,0,30,260 -D 'part="assembly"'
render instrument_screen_open.png instrument.scad 54,28,18,55,0,30,320 -D 'part="assembly"' -D 'screen=true'
render lid_headless_inside.png instrument.scad 40,28,0,35,0,20,220 -D 'part="lid_headless"'
render lid_screen_inside.png instrument.scad 54,28,0,35,0,20,280 -D 'part="lid_screen"' -D 'screen=true'
render lid_screen_outside.png instrument.scad 54,28,0,145,0,20,280 -D 'part="lid_screen"' -D 'screen=true'
render tray_back.png instrument.scad 40,28,10,130,0,30,240 -D 'part="tray"'
render strap_plate.png instrument.scad 0,0,0,45,0,30,140 -D 'part="strap_plate"'
render remote_open.png remote.scad 30,17,14,55,0,30,200 -D 'part="assembly"'
render shield.png shield.scad 0,0,23,60,0,30,170
ls -1 "$STL" "$IMG"
