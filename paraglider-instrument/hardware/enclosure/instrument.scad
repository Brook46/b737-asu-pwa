// Paraglider instrument: main case (tray + lid), two lids (headless or with
// the 2.7" Sharp Memory screen), and a strap plate for riser mounting.
//
// Render one part:   openscad -D 'part="tray"' -o tray.stl instrument.scad
// Parts: tray, lid_headless, lid_screen, strap_plate, assembly (preview only)
// `screen=true` makes the tray long enough for the screen lid.
//
// All sizes in mm. Board sizes marked MEASURE are from datasheets/listings,
// not from boards in hand: measure yours and edit before printing.
// Print: PETG (heat in a car or in the sun on the cockpit softens PLA),
// 0.2 mm layers, 3 walls, 30 % infill; tray and lid flat side down, no supports.
// Light colour: a black case in the sun heats the air the sensors read.

part = "assembly";
screen = false;        // case for the screen lid (longer)

$fn = 40;
wall = 2.2;
floorT = 2.0;
topT = 2.0;            // lid top
skirt = 3.0;           // lid skirt that drops inside the tray walls
fit = 0.25;            // clearance per side, skirt to wall
cornerR = 4;

// Parts (MEASURE)
xiaoStack = [21, 17.8, 10.5];   // XIAO ESP32S3 on Wio-SX1262 (L, W, height incl. B2B)
usbZ = 7.5;                     // USB-C centre above the floor, XIAO on its cradle
l76k = [21, 18, 4];
patch = [25.5, 25.5, 4.5];      // L76K active patch antenna
bme = [40, 20];                 // Grove BME280
imu = [20, 20];                 // Grove LSM6DS3
buzzer = [20, 20, 10];          // Grove passive buzzer
battery = [35, 30, 5.5];        // 503035, 500 mAh (1000 mAh 603450: [50, 34, 6.5])
switchBody = [8.8, 3.8];        // slide switch SS12D00 body; actuator slot below
// Screen: Adafruit 4694 breakout for the Sharp LS027B7DH01 (MEASURE the board)
screenActive = [58.8, 35.3];    // active area (datasheet)
screenPanel = [62.8, 42.8, 1.7];// glass outline
screenBoard = [72, 50, 1.6];    // breakout PCB — MEASURE
screenHoles = [66, 44];         // hole spacing (centres) — MEASURE
screenStandoff = 3.0;           // board back to lid underside, around the panel
windowCover = 1.0;              // clear PC/acrylic sheet over the window

// Case size
innerL = screen ? max(76, screenBoard[0] + patch[0] + 6) : 76;
innerW = screen ? max(52, screenBoard[1] + 2) : 52;
trayH = 22;            // tray outside height incl. floor
L = innerL + 2 * wall;
W = innerW + 2 * wall;
lidH = topT + skirt;
echo(str("case outside: ", L, " x ", W, " x ", trayH + topT, " mm"));

module rbox(l, w, h, r) {
  hull() for (x = [r, l - r], y = [r, w - r]) translate([x, y, 0]) cylinder(r = r, h = h);
}

// Corner screw bosses (M2): tray bosses take heat-set inserts (Ø3.2) or
// self-tapping M2 (Ø1.8). Lid gets clearance holes.
bossD = 6.4;
insertD = 3.2;
bo = wall + 3.0;      // bosses overlap the walls a little (a clean, printable union)
boss = [[bo, bo], [L - bo, bo], [bo, W - bo], [L - bo, W - bo]];

// Layout inside (x along the length, y across, from the inner corner)
xiaoAt = [innerL - xiaoStack[0], 2];          // USB-C end wall at +x
l76kAt = [innerL - l76k[0], innerW - l76k[1] - 2];
batAt = [2, 2];
bmeAt = [0.5, innerW - bme[1] - 0.5];          // sensor end at the vent wall (-x)
ventY = innerW - bme[1] / 2;
ventZ = floorT + 4;

module tray() {
  difference() {
    union() {
      difference() {
        rbox(L, W, trayH, cornerR);
        translate([wall, wall, floorT]) rbox(innerL, innerW, trayH, cornerR - wall + 0.5);
      }
      for (b = boss) translate([b[0], b[1], 0]) cylinder(d = bossD, h = trayH - skirt - 0.2);
      // Internals, relative to the inner corner
      translate([wall, wall, floorT - 0.01]) {
        // XIAO cradle: two low rails along its long sides, stop at the inner end
        translate([xiaoAt[0] - 1.2, xiaoAt[1] - 1.2, 0]) difference() {
          cube([xiaoStack[0] + 1.2, xiaoStack[1] + 2.4, 3]);
          translate([1.2, 1.2, -1]) cube([xiaoStack[0] + 1, xiaoStack[1], 5]);
          translate([4, -1, 1.2]) cube([xiaoStack[0] - 8, xiaoStack[1] + 5, 3]);  // wire exits
        }
        // L76K pad: corner guides
        translate([l76kAt[0] - 1.2, l76kAt[1] - 1.2, 0]) difference() {
          cube([l76k[0] + 1.2, l76k[1] + 2.4, 2]);
          translate([1.2, 1.2, -1]) cube([l76k[0] + 1, l76k[1], 4]);
          translate([5, -1, -1]) cube([l76k[0] - 10, l76k[1] + 5, 4]);
        }
        // Battery bay ribs
        translate([batAt[0] - 1.2, batAt[1] - 1.2, 0]) difference() {
          cube([battery[0] + 2.4, battery[1] + 2.4, 2.5]);
          translate([1.2, 1.2, -1]) cube([battery[0], battery[1], 5]);
          translate([6, -1, -1]) cube([battery[0] - 12, battery[1] + 5, 5]);
          translate([-1, 6, -1]) cube([battery[0] + 5, battery[1] - 12, 5]);
        }
        // Foam pocket around the vent on the inside of the -x wall
        translate([-0.01, ventY - 6, 0]) difference() {
          cube([5, 12, 10]);
          translate([-1, 1.2, 1.2]) cube([5, 9.6, 10]);
        }
      }
    }
    // Insert holes
    for (b = boss) translate([b[0], b[1], 2]) cylinder(d = insertD, h = trayH);
    // USB-C (+x end wall), centred on the XIAO
    translate([L - wall - 1, wall + xiaoAt[1] + xiaoStack[1] / 2, floorT + usbZ])
      rotate([0, 90, 0]) hull() for (s = [-1, 1]) translate([0, s * 3, 0]) cylinder(d = 5.2, h = wall + 2);
    // Slide switch (+x end wall, beside the L76K): body window
    translate([L - wall - 1, wall + l76kAt[1] + l76k[1] / 2 - switchBody[0] / 2, floorT + 9])
      cube([wall + 2, switchBody[0], switchBody[1]]);
    // Pressure vent (-x wall), Ø3, behind foam
    translate([-1, wall + ventY, ventZ + 3]) rotate([0, 90, 0]) cylinder(d = 3, h = wall + 2);
    // Two M2 holes in the floor for the strap plate (centred), with countersinks inside
    for (s = [-1, 1]) translate([L / 2 + s * 12, W / 2, -1]) {
      cylinder(d = 2.4, h = floorT + 2);
      translate([0, 0, floorT + 1 - 1.2]) cylinder(d1 = 2.4, d2 = 4.6, h = 1.21);
    }
  }
}

// Lid: top plate with a skirt that drops inside the tray walls.
module lidShell() {
  difference() {
    union() {
      rbox(L, W, topT, cornerR);
      translate([wall + fit, wall + fit, topT]) difference() {
        rbox(innerL - 2 * fit, innerW - 2 * fit, skirt, cornerR - wall);
        translate([1.6, 1.6, -1]) rbox(innerL - 2 * fit - 3.2, innerW - 2 * fit - 3.2, skirt + 2, cornerR - wall - 1);
      }
    }
    // Screw clearance + countersink (screws from the top)
    for (b = boss) translate([b[0], b[1], -1]) {
      cylinder(d = 2.4, h = lidH + 2);
      cylinder(d1 = 4.6, d2 = 2.4, h = 1.2 + 1);
    }
    // Skirt notches where the corner bosses come up
    for (b = boss) translate([b[0], b[1], topT]) cylinder(d = bossD + 1, h = skirt + 1);
  }
}

// Buzzer: ring of Ø1.6 holes + a square locating frame inside.
module buzzerHoles(c) {
  translate([c[0], c[1], -1]) {
    cylinder(d = 1.6, h = topT + 2);
    for (a = [0:45:315]) rotate(a) translate([4, 0, 0]) cylinder(d = 1.6, h = topT + 2);
  }
}
module buzzerFrame(c) {
  translate([c[0] - buzzer[0] / 2 - 1.2, c[1] - buzzer[1] / 2 - 1.2, topT - 0.01]) difference() {
    cube([buzzer[0] + 2.4, buzzer[1] + 2.4, 2]);
    translate([1.2, 1.2, -1]) cube([buzzer[0], buzzer[1], 4]);
    translate([5, -1, -1]) cube([buzzer[0] - 10, buzzer[1] + 5, 4]);
  }
}
// GNSS patch pocket: frame on the inside of the lid, patch facing the sky.
module patchFrame(c) {
  translate([c[0] - patch[0] / 2 - 1.2, c[1] - patch[1] / 2 - 1.2, topT - 0.01]) difference() {
    cube([patch[0] + 2.4, patch[1] + 2.4, 2.5]);
    translate([1.2, 1.2, -1]) cube([patch[0], patch[1], 5]);
    translate([7, -1, -1]) cube([patch[0] - 14, patch[1] + 5, 5]);  // cable exits
  }
}

module lid_headless() {
  bz = [wall + 14, wall + 14];                  // over the battery
  pt = [wall + 20, W - wall - patch[1] / 2 - 3]; // patch near the -x end, away from the XIAO
  difference() {
    union() {
      lidShell();
      buzzerFrame(bz);
      patchFrame(pt);
    }
    buzzerHoles(bz);
  }
  // Note: the lid prints top-down (flat). Its outside is the face you see.
}

// Screen lid. From the outside in: the lid with a window over the active
// area (chamfered), a clear PC/acrylic cover sheet, the screen's glass, its
// board. A frame inside locates cover and glass; four posts take the board.
// The GNSS patch sits beside the screen, never under it (the board's ground
// plane would shade it).
module lid_screen() {
  scx = L - wall - 2 - screenBoard[0] / 2;      // screen centre, toward the +x end
  scy = W / 2;
  pt = [wall + 2 + patch[0] / 2 + 1, W / 2];
  stack = windowCover + screenPanel[2];          // cover + glass, in the frame
  difference() {
    union() {
      lidShell();
      // locating frame around cover + glass
      translate([scx, scy, topT - 0.01]) difference() {
        linear_extrude(stack + 0.01) square([screenPanel[0] + 0.6 + 2.4, screenPanel[1] + 0.6 + 2.4], center = true);
        translate([0, 0, -1]) linear_extrude(stack + 2) square([screenPanel[0] + 0.6, screenPanel[1] + 0.6], center = true);
        // gap for the glass's flex tail (one short side)
        translate([screenPanel[0] / 2 - 1, -9, -1]) cube([4, 18, stack + 2]);
      }
      // board posts: the board's front rests on them, on top of the glass
      for (sx_ = [-1, 1], sy_ = [-1, 1])
        translate([scx + sx_ * screenHoles[0] / 2, scy + sy_ * screenHoles[1] / 2, topT - 0.01])
          difference() {
            cylinder(d = 5, h = stack + 0.2);
            cylinder(d = 1.8, h = 20);
          }
      patchFrame(pt);
    }
    // window over the active area (+0.5 mm a side), chamfered outside
    translate([scx - screenActive[0] / 2 - 0.5, scy - screenActive[1] / 2 - 0.5, -1])
      cube([screenActive[0] + 1, screenActive[1] + 1, topT + 2]);
    translate([scx, scy, -0.01]) hull() {
      linear_extrude(0.01) square([screenActive[0] + 3, screenActive[1] + 3], center = true);
      translate([0, 0, 1]) linear_extrude(0.01) square([screenActive[0] + 1, screenActive[1] + 1], center = true);
    }
    // buzzer holes in the corner at the -x end (the buzzer is taped under them)
    buzzerHoles([wall + 8, wall + 8]);
  }
}

// Strap plate: a block with a tunnel for 25 mm webbing (a riser strap, or a
// cockpit/leg strap). Two M2 × 4 screws from inside the case hold it; the
// hole pairs at 0° and 90° let the webbing run along or across the case,
// so the same plate mounts it portrait or landscape. Prints flat (the
// 27 mm tunnel roof is a bridge).
module strap_plate() {
  pl = 44;
  t = 7;
  tunnel = [27, 3.4];
  difference() {
    translate([-pl / 2, -pl / 2, 0]) rbox(pl, pl, t, 4);
    // tunnel along y, 1.6 mm floor (outside face), 2 mm roof (against the case)
    translate([-tunnel[0] / 2, -pl / 2 - 1, 1.6]) cube([tunnel[0], pl + 2, tunnel[1]]);
    // pilot holes from the case side, stopping above the tunnel
    for (a = [0, 90]) rotate(a) for (s = [-1, 1]) translate([s * 12, 0, 1.6 + tunnel[1] + 0.4]) cylinder(d = 1.8, h = 10);
  }
}

// Preview: the case with ghost parts in place.
module ghosts() {
  translate([wall, wall, floorT]) {
    color("SteelBlue", 0.6) translate([xiaoAt[0], xiaoAt[1], 0]) cube(xiaoStack);
    color("SeaGreen", 0.6) translate([l76kAt[0], l76kAt[1], 0]) cube(l76k);
    color("Orange", 0.6) translate([batAt[0], batAt[1], 0]) cube(battery);
    color("Purple", 0.6) translate([bmeAt[0], bmeAt[1], 0]) cube([bme[0], bme[1], 4]);
    color("Teal", 0.6) translate([batAt[0] + 8, batAt[1] + 6, battery[2] + 0.5]) cube([imu[0], imu[1], 4]);
  }
}

if (part == "tray") tray();
else if (part == "lid_headless") lid_headless();
else if (part == "lid_screen") lid_screen();
else if (part == "strap_plate") strap_plate();
else if (part == "assembly") {
  color("WhiteSmoke") tray();
  ghosts();
  color("Gainsboro", 0.9) translate([0, W, trayH + topT + 12]) rotate([180, 0, 0])
    if (screen) lid_screen(); else lid_headless();
}
