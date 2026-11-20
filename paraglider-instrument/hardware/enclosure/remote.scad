// Brake-handle remote: XIAO ESP32-C6, three 12 mm buttons on a perfboard,
// a small LiPo, strap tabs for 20 mm Velcro around the brake toggle, and an
// exit for the SHT40 lead (sensor in shield.scad).
//
// Render one part:   openscad -D 'part="body"' -o body.stl remote.scad
// Parts: body, lid, cap_flat, cap_dome, assembly (preview)
// Buttons (glove-sized, 18 mm apart): the middle one has a dome so you find
// it without looking. Firmware map: docs/physical-build.md.
// Print: PETG, 0.2 mm, body and lid flat, caps upright. Light colour.

part = "assembly";
$fn = 40;
wall = 2.0;
floorT = 2.0;
topT = 2.0;
inner = [58, 30, 15];          // interior L, W, H
xiao = [21, 17.8, 4.6];        // XIAO ESP32-C6 incl. USB-C (MEASURE)
usbZ = 2.9;                    // USB-C centre above the floor
battery = [30, 20, 4.2];       // 402030, ~250 mAh
perf = [54, 26, 1.6];          // perfboard carrying the buttons
switchH = 7.3;                 // 12 × 12 tactile, height incl. stem
buttonX = [11, 29, 47];        // centres along the length (interior coords)
capD = 11.5;                   // cap shaft; lid hole = capD + 0.8
strapW = 21;                   // slot for 20 mm Velcro
cornerR = 4;

L = inner[0] + 2 * wall;
W = inner[1] + 2 * wall;
H = floorT + inner[2];
postZ = inner[2] - 1 - switchH - perf[2];   // switch top 1 mm under the lid (cap flange)
echo(str("remote outside: ", L, " x ", W, " x ", H + topT, " mm (+ strap tabs)"));

module rbox(l, w, h, r) {
  hull() for (x = [r, l - r], y = [r, w - r]) translate([x, y, 0]) cylinder(r = r, h = h);
}
boss = [[wall + 2.6, wall + 2.6], [L - wall - 2.6, wall + 2.6], [wall + 2.6, W - wall - 2.6],
        [L - wall - 2.6, W - wall - 2.6]];
perfPosts = [[3, 3], [inner[0] - 3, 3], [3, inner[1] - 3], [inner[0] - 3, inner[1] - 3]];

module body() {
  difference() {
    union() {
      difference() {
        rbox(L, W, H, cornerR);
        translate([wall, wall, floorT]) rbox(inner[0], inner[1], H, cornerR - wall + 0.5);
      }
      for (b = boss) translate([b[0], b[1], 0]) cylinder(d = 5, h = H);
      // perfboard posts
      translate([wall, wall, floorT - 0.01]) for (p = perfPosts) translate([p[0], p[1], 0]) cylinder(d = 4.5, h = postZ + 0.01);
      // strap tabs at both ends, flush with the floor
      for (e = [0, 1]) translate([e == 0 ? -10 : L - 2, (W - strapW - 8) / 2, 0]) difference() {
        cube([12, strapW + 8, 3]);
        translate([e == 0 ? 2.5 : 6.5, 4, -1]) cube([3, strapW, 5]);
      }
      // XIAO cradle at the +x end
      translate([L - wall - xiao[0] - 1.2, wall + (inner[1] - xiao[1]) / 2 - 1.2, floorT - 0.01]) difference() {
        cube([xiao[0] + 1.2, xiao[1] + 2.4, 1.8]);
        translate([1.2, 1.2, -1]) cube([xiao[0] + 1, xiao[1], 4]);
      }
    }
    for (b = boss) translate([b[0], b[1], 3]) cylinder(d = 1.8, h = H);       // M2 self-tapping
    translate([wall, wall, 0]) for (p = perfPosts) translate([p[0], p[1], floorT + 1]) cylinder(d = 1.8, h = 20);
    // USB-C, +x end
    translate([L - wall - 1, W / 2, floorT + usbZ]) rotate([0, 90, 0])
      hull() for (s = [-1, 1]) translate([0, s * 3, 0]) cylinder(d = 4.2, h = wall + 2);
    // SHT40 lead exit, -x end, high up (a grommet or a knot inside as strain relief)
    translate([-1, W / 2, H - 4]) rotate([0, 90, 0]) cylinder(d = 4, h = wall + 2);
  }
}

module lid() {
  difference() {
    union() {
      rbox(L, W, topT, cornerR);
      // locating lip inside the walls
      translate([wall + 0.25, wall + 0.25, topT - 0.01]) difference() {
        rbox(inner[0] - 0.5, inner[1] - 0.5, 2, cornerR - wall);
        translate([1.4, 1.4, -1]) rbox(inner[0] - 3.3, inner[1] - 3.3, 4, 1);
      }
    }
    for (b = boss) translate([b[0], b[1], -1]) {
      cylinder(d = 2.4, h = 10);
      cylinder(d1 = 4.6, d2 = 2.4, h = 2.2);
    }
    for (b = boss) translate([b[0], b[1], topT]) cylinder(d = 6, h = 5);
    for (x = buttonX) translate([wall + x, W / 2, -1]) cylinder(d = capD + 0.8, h = 10);
  }
}

// Button caps: a shaft through the lid, a flange inside so they can't fall
// out, and a flat or domed top. Print upright.
module cap(dome) {
  cylinder(d = capD + 3.5, h = 1);                    // flange (inside the lid)
  cylinder(d = capD, h = 1 + topT + 2.5);
  if (dome) translate([0, 0, 1 + topT + 2.5]) scale([1, 1, 0.45]) sphere(d = capD);
}

if (part == "body") body();
else if (part == "lid") lid();
else if (part == "cap_flat") cap(false);
else if (part == "cap_dome") cap(true);
else if (part == "assembly") {
  color("WhiteSmoke") body();
  color("SteelBlue", 0.6) translate([L - wall - xiao[0], wall + (inner[1] - xiao[1]) / 2, floorT]) cube(xiao);
  color("Orange", 0.6) translate([wall + 2, wall + (inner[1] - battery[1]) / 2, floorT]) cube(battery);
  color("SeaGreen", 0.6) translate([wall + 2, wall + 2, floorT + postZ]) cube(perf);
  for (i = [0:2]) color("DimGray") translate([wall + buttonX[i] - 6, W / 2 - 6, floorT + postZ + perf[2]]) cube([12, 12, switchH]);
  color("Gainsboro", 0.9) translate([0, W, H + topT + 10]) rotate([180, 0, 0]) lid();
  for (i = [0:2]) color("Tomato") translate([wall + buttonX[i], W / 2, H + 10 - 1 + topT + 1]) cap(i == 1);
}
