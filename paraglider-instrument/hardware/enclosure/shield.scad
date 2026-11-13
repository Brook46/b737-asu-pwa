// Radiation shield for the remote's SHT40 (or any small air sensor): a tube
// with downward louvres, closed on top. Sun and rain stay off the sensor;
// air flows through. Same idea as a weather station's Stevenson screen.
//
// Print WHITE, cap down (as modelled), no supports: louvres are 45°.
//   openscad -o shield.stl shield.scad
// Mount: a loop for 20–25 mm webbing on the side; hang it on the riser or
// brake line, 10–20 cm from your hand, open end down.
// The sensor board hangs inside from the cap: its cable goes through the
// hole and a cable tie through the two slots holds it.

$fn = 64;
outerD = 38;
wallT = 1.8;
height = 46;
capT = 2.4;
board = [20, 21];              // Grove SHT40 (MEASURE)
rows = 5;
perRow = 8;
slot = [10, 2.6];              // louvre opening (width, height)

module louvres() {
  for (r = [0:rows - 1], k = [0:perRow - 1]) {
    z = capT + 8 + r * 7;
    rotate(k * 360 / perRow + (r % 2) * 180 / perRow)
      translate([outerD / 2 - wallT - 1, 0, z])
        // cut slanted 45°: outside opening lower than inside, so (hung cap up)
        // rain has to climb to get in
        rotate([0, -45, 0]) cube([wallT * 3, slot[0], slot[1]], center = true);
  }
}

module shield() {
  difference() {
    union() {
      cylinder(d = outerD, h = height);
      // webbing loop on the side, near the cap
      translate([outerD / 2 - 2, -14, 0]) difference() {
        cube([8, 28, 14]);
        translate([2.5, 2, -1]) cube([3.4, 24, 16]);
      }
    }
    translate([0, 0, capT]) cylinder(d = outerD - 2 * wallT, h = height);   // open at the far end
    louvres();
    // cable hole and tie slots in the cap
    translate([0, 0, -1]) cylinder(d = 4.5, h = capT + 2);
    for (s = [-1, 1]) translate([s * 6 - 1, -2.5, -1]) cube([2, 5, capT + 2]);
  }
}

shield();
