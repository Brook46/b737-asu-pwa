// GPS jamming and spoofing guard, with dead reckoning while GPS is untrusted.
//
// Jamming usually shows as no fix, few satellites, or fixes that jump around.
// Spoofing (Israel's spoofers typically put you at Beirut airport) gives a
// confident fix that is simply wrong, so it's caught by disagreement with the
// sensors that can't be spoofed:
//   * the barometer: GPS altitude minus baro altitude is steady in normal
//     flight; a spoofer rarely gets it right
//   * the gyro: if the gyro says you've turned 270° and the GPS track hasn't,
//     the GPS is lying
//   * physics: a paraglider doesn't jump 200 m between 5 Hz fixes or fly at
//     150 km/h
// A few bad fixes within seconds mark GPS as LOST or SPOOFED. It's trusted
// again only after 20 s of fixes that are consistent with each other, the
// barometer and the gyro.
//
// While untrusted, the position is dead-reckoned: gyro heading × estimated
// airspeed plus the last good wind, with an error estimate that grows with
// time. Everything that doesn't need position (vario, circling, thermal
// assistant, STAY/GLIDE, cloud base) keeps working on baro + IMU.
#pragma once
#include "types.h"

namespace pg {

enum class GpsState : uint8_t { NoData, Ok, Lost, Spoofed };
const char* gpsStateName(GpsState s);

enum class GpsReason : uint8_t { None, NoFix, Weak, Jump, Speed, Altitude, Motion };
const char* gpsReasonName(GpsReason r);

struct GuardedPosition {
  double lat = 0, lon = 0;
  bool valid = false;
  bool deadReckoned = false;
  float errorM = 0;  // 1-sigma-ish estimate
};

class GnssGuard {
 public:
  void reset();
  // Judge one fix. `baroAlt` = vario altitude (NaN if none). `gyroTurnDeg` =
  // heading change the gyro measured since the previous fix (NaN if no IMU).
  // Returns true if the fix can be used.
  bool check(const GnssFix& f, float baroAlt, float gyroTurnDeg);
  // Call every tick: times out a silent receiver and moves the DR position.
  // heading/airspeed/wind describe our motion through the air (heading NaN if
  // unknown).
  void propagate(TimeMs t, float headingDeg, float airspeed, float windN, float windE);

  GpsState state() const { return state_; }
  GpsReason reason() const { return reason_; }
  TimeMs since() const { return since_; }
  bool trusted() const { return state_ == GpsState::Ok; }
  const GuardedPosition& position() const { return pos_; }
  const GnssFix& lastGood() const { return good_; }

 private:
  void bad(TimeMs t, GpsReason r);
  void setState(TimeMs t, GpsState s, GpsReason r);
  GpsState state_ = GpsState::NoData;
  GpsReason reason_ = GpsReason::None;
  TimeMs since_ = 0, lastFixT_ = 0, lastProp_ = 0;
  GnssFix good_, prev_;
  bool haveGood_ = false, havePrev_ = false;
  float altOffset_ = 0;  // GPS alt − baro alt, learned while trusted
  bool haveOffset_ = false;
  int badCount_ = 0;
  TimeMs firstBad_ = 0;
  TimeMs goodRunStart_ = 0;
  float gyroAcc_ = 0, trackAcc_ = 0;  // turn accumulated over the motion window
  TimeMs motionStart_ = 0;
  GuardedPosition pos_;
};

}  // namespace pg
