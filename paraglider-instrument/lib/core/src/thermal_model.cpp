#include "thermal_model.h"

#include <cmath>

#include "circling.h"

namespace pg {

namespace {
// Core radii tried (m). Paraglider-scale thermals: tight cores to broad
// blobs. Each gets its own best centre.
constexpr float kRadiiM[] = {25, 35, 50, 70, 95, 130, 175, 240};
// Mild prior on the surrounding air (m/s), worth this many samples: keeps W
// and B apart when the circle alone can't.
constexpr float kPriorB = -0.4f, kPriorBWeight = 6.0f;
constexpr float kOtherWeight = 0.5f;
constexpr float kOtherSink = 1.2f;  // typical circling sink of another wing
constexpr float kMinR = 12, kMaxR = 90;  // circle radii a paraglider can fly
constexpr float kMaxW = 8.0f;            // no paraglider thermal is stronger
constexpr float kReach = 60.0f;          // the core is within your radius + this of your circle
}  // namespace

const char* turnAdviceName(TurnAdvice a) {
  switch (a) {
    case TurnAdvice::Good: return "GOOD";
    case TurnAdvice::Move: return "MOVE";
    case TurnAdvice::Tighten: return "TIGHTEN";
    case TurnAdvice::Widen: return "WIDEN";
    case TurnAdvice::None: break;
  }
  return "";
}

void ThermalModel::reset() {
  head_ = n_ = 0;
  firstCircling_ = lastFit_ = straightAt_ = 0;
  stable_ = 0;
  prevCx_ = prevCy_ = 1e9f;
  v_ = TurnView{};
}

float ThermalModel::bankFor(float v, float radius) {
  return std::atan(v * v / (kGravity * (radius > 1 ? radius : 1))) * kRadToDeg;
}

float ThermalModel::turnSink(float v, float radius) const {
  const float c = std::cos(bankFor(v, radius) * kDegToRad);
  return polar_.sink(v) / (c * std::sqrt(c));
}

void ThermalModel::add(TimeMs t, float x, float y, float hdg, float airspeed, float rateDeg, float vario) {
  x_ = x;
  y_ = y;
  hdg_ = hdg;
  v_air_ = airspeed;
  rate_ = rateDeg;
  const float omega = std::fabs(rateDeg) * kDegToRad;
  if (omega < 0.05f || airspeed < 3) {  // not in a steady turn (e.g. straightening to move)
    straightAt_ = t;
    return;
  }
  const float r = airspeed / omega;
  const float netto = vario + turnSink(airspeed, r);
  s_[(head_ + n_) % kN] = {t, x, y, netto, false};
  if (n_ < kN) ++n_;
  else head_ = (head_ + 1) % kN;
}

void ThermalModel::addOther(TimeMs t, float x, float y, float climb) {
  s_[(head_ + n_) % kN] = {t, x, y, climb + kOtherSink, true};
  if (n_ < kN) ++n_;
  else head_ = (head_ + 1) % kN;
}

// Weighted least squares for w = W·g + B with g = exp(−d²/R²), plus the B prior.
float ThermalModel::fitAt(float cx, float cy, float R, float& W, float& B) const {
  const float inv = 1.0f / (R * R);
  float sw = kPriorBWeight, sg = 0, sgg = 0, sy = kPriorBWeight * kPriorB, sgy = 0, syy = kPriorBWeight * kPriorB * kPriorB;
  for (int k = 0; k < n_; ++k) {
    const S& s = s_[(head_ + k) % kN];
    const float dx = s.x - cx, dy = s.y - cy;
    const float g = std::exp(-(dx * dx + dy * dy) * inv);
    const float wt = s.other ? kOtherWeight : 1.0f;
    sw += wt;
    sg += wt * g;
    sgg += wt * g * g;
    sy += wt * s.w;
    sgy += wt * g * s.w;
    syy += wt * s.w * s.w;
  }
  // Normal equations; the prior row is g = 0, y = kPriorB.
  const float det = sgg * sw - sg * sg;
  if (std::fabs(det) < 1e-6f) {
    W = 0;
    B = sy / sw;
  } else {
    W = (sgy * sw - sg * sy) / det;
    B = (sgg * sy - sg * sgy) / det;
  }
  if (W < 0) {  // sink, not lift: refit with no thermal
    W = 0;
    B = sy / sw;
  } else if (W > kMaxW) {  // physically impossible: clamp and refit B
    W = kMaxW;
    B = (sy - W * sg) / sw;
  }
  // SSE = Σ(y − Wg − B)² expanded.
  return syy - 2 * W * sgy - 2 * B * sy + W * W * sgg + 2 * W * B * sg + B * B * sw;
}

void ThermalModel::fitSearch(float cx0, float cy0, float R, ThermalFit& f) const {
  // A distant giant's tail and a nearby core look alike from one circle; the
  // core you're feeling is near your circle.
  const float reach = v_.myRadius + kReach;
  float bx = cx0, by = cy0, W = 0, B = 0;
  float best = fitAt(bx, by, R, W, B);
  // Coarse to fine: steps of 40, 15, 5 m, 9×9 / 7×7 / 5×5 grids.
  const float steps[] = {40, 15, 5};
  const int half[] = {4, 3, 2};
  for (int lvl = 0; lvl < 3; ++lvl) {
    const float cx = bx, cy = by;
    for (int i = -half[lvl]; i <= half[lvl]; ++i)
      for (int j = -half[lvl]; j <= half[lvl]; ++j) {
        if (!i && !j) continue;
        const float px = cx + i * steps[lvl], py = cy + j * steps[lvl];
        if ((px - cx0) * (px - cx0) + (py - cy0) * (py - cy0) > reach * reach) continue;
        float w, b;
        const float e = fitAt(px, py, R, w, b);
        if (e < best) {
          best = e;
          bx = cx + i * steps[lvl];
          by = cy + j * steps[lvl];
        }
      }
  }
  fitAt(bx, by, R, W, B);
  f.cx = bx;
  f.cy = by;
  f.radius = R;
  f.strength = W;
  f.around = B;
  f.quality = best;  // SSE for now; turned into R² by the caller
}

void ThermalModel::update(TimeMs t, bool circling) {
  if (!circling) {
    if (firstCircling_) reset();
    return;
  }
  if (!firstCircling_) firstCircling_ = t;
  // Drop samples that no longer describe this thermal.
  while (n_ && t - s_[head_].t > kWindowMs) {
    head_ = (head_ + 1) % kN;
    --n_;
  }
  const float omega = std::fabs(rate_) * kDegToRad;
  v_.myRadius = omega > 0.05f ? v_air_ / omega : 0;
  v_.bankNow = v_.myRadius > 0 ? bankFor(v_air_, v_.myRadius) : 0;
  if (t - lastFit_ < 2000) {
    // Between fits, keep "move now" current with the heading.
    v_.moveNow = v_.advice == TurnAdvice::Move && std::fabs(angleDiffDeg(hdg_, v_.coreBearing)) < 20.0f;
    return;
  }
  lastFit_ = t;
  // Need a full circle of your own samples first.
  int own = 0;
  float mx = 0, my = 0;
  for (int k = 0; k < n_; ++k) {
    const S& s = s_[(head_ + k) % kN];
    if (s.other) continue;
    ++own;
  }
  const float period = omega > 0.05f ? 2 * kPi / omega : 30;
  // ...and a full circle since you last flew straight: the circle you're on
  // now is what the advice is about.
  const TimeMs since0 = firstCircling_ > straightAt_ ? firstCircling_ : straightAt_;
  if (own < 30 || t - since0 < static_cast<TimeMs>(period * 1000) || v_.myRadius <= 0) {
    v_.fit.valid = false;
    v_.advice = TurnAdvice::None;
    v_.moveNow = false;
    return;
  }
  // Your circle's centre: the mean of the last full circle.
  int m = 0;
  const TimeMs since = t - static_cast<TimeMs>(period * 1000);
  for (int k = 0; k < n_; ++k) {
    const S& s = s_[(head_ + k) % kN];
    if (s.other || s.t < since) continue;
    mx += s.x;
    my += s.y;
    ++m;
  }
  if (m) {
    mx /= m;
    my /= m;
  }

  // Fit every radius; each from your circle centre.
  float sst = 0, mean = 0, sw = 0;
  for (int k = 0; k < n_; ++k) {
    const S& s = s_[(head_ + k) % kN];
    const float wt = s.other ? kOtherWeight : 1.0f;
    mean += wt * s.w;
    sw += wt;
  }
  mean /= sw;
  for (int k = 0; k < n_; ++k) {
    const S& s = s_[(head_ + k) % kN];
    sst += (s.other ? kOtherWeight : 1.0f) * (s.w - mean) * (s.w - mean);
  }
  int bi = 0;
  for (int i = 0; i < kRadii; ++i) {
    fitSearch(mx, my, kRadiiM[i], fits_[i]);
    sse_[i] = fits_[i].quality;
    if (sse_[i] < sse_[bi]) bi = i;
  }
  ThermalFit f = fits_[bi];
  f.samples = n_;
  f.quality = sst > 1e-3f ? 1 - sse_[bi] / sst : 0;
  if (f.quality < 0) f.quality = 0;
  f.valid = f.strength > 0.3f;
  // Advice only from a settled fit: two refits in a row put the core within
  // 12 m of each other (one circle alone can put it tens of metres off).
  const float moved = std::sqrt((f.cx - prevCx_) * (f.cx - prevCx_) + (f.cy - prevCy_) * (f.cy - prevCy_));
  stable_ = f.valid && moved < 12 ? stable_ + 1 : 0;
  prevCx_ = f.cx;
  prevCy_ = f.cy;
  v_.fit = f;
  v_.settled = stable_ >= 2;
  if (!f.valid) {
    v_.advice = TurnAdvice::None;
    v_.moveNow = false;
    return;
  }

  v_.coreRelX = f.cx - x_;
  v_.coreRelY = f.cy - y_;
  const float dx = f.cx - mx, dy = f.cy - my;
  v_.coreDist = std::sqrt(dx * dx + dy * dy);
  v_.coreBearing = std::fmod(std::atan2(dx, dy) * kRadToDeg + 360.0f, 360.0f);
  const float r = v_.myRadius;
  auto climbAt = [&](const ThermalFit& tf, float radius, float offset) {
    // Mean lift around a circle of `radius` whose centre is `offset` from the core.
    float s = 0;
    for (int k = 0; k < 12; ++k) {
      const float a = k * kPi / 6;
      const float px = offset + radius * std::cos(a), py = radius * std::sin(a);
      s += std::exp(-(px * px + py * py) / (tf.radius * tf.radius));
    }
    return tf.strength * s / 12 + tf.around - turnSink(v_air_, radius);
  };
  v_.climbNow = climbAt(f, r, v_.coreDist);
  if (!v_.settled) {
    v_.advice = TurnAdvice::None;
    v_.moveNow = false;
    return;
  }

  // MOVE first: an off-centre circle wastes more than a wrong radius.
  const float centred = climbAt(f, r, 0);
  if (v_.coreDist > 15 && v_.coreDist > 0.35f * r && centred - v_.climbNow > 0.15f) {
    v_.advice = TurnAdvice::Move;
    v_.gain = centred - v_.climbNow;
    // Straightening for d/v seconds moves the circle's centre about d.
    v_.moveSeconds = v_.coreDist / (v_air_ > 1 ? v_air_ : 1);
    v_.moveNow = std::fabs(angleDiffDeg(hdg_, v_.coreBearing)) < 20.0f;
    v_.bestRadius = r;
    v_.bankBest = v_.bankNow;
    return;
  }
  v_.moveNow = false;

  // Radius: the best circle for each radius hypothesis that fits about as
  // well as the best; advise only if they all point the same way.
  const float tol = sse_[bi] * 1.08f + 0.02f * n_;
  int votesT = 0, votesW = 0, votes = 0;
  float bestR = r, bestGain = 0;
  for (int i = 0; i < kRadii; ++i) {
    if (sse_[i] > tol || fits_[i].strength <= 0.3f) continue;
    ++votes;
    float rb = r, cb = climbAt(fits_[i], r, 0);
    for (float rr = kMinR; rr <= kMaxR; rr += 2) {
      const float c = climbAt(fits_[i], rr, 0);
      if (c > cb) {
        cb = c;
        rb = rr;
      }
    }
    const float g = cb - climbAt(fits_[i], r, 0);
    if (rb < r - 6 && g > 0.12f) ++votesT;
    else if (rb > r + 6 && g > 0.12f) ++votesW;
    if (i == bi) {
      bestR = rb;
      bestGain = g;
    }
  }
  v_.bestRadius = bestR;
  v_.bankBest = bankFor(v_air_, bestR);
  v_.gain = bestGain;
  if (votes && votesT == votes) v_.advice = TurnAdvice::Tighten;
  else if (votes && votesW == votes) v_.advice = TurnAdvice::Widen;
  else if (votes && !votesT && !votesW) v_.advice = TurnAdvice::Good;
  else v_.advice = TurnAdvice::None;  // the data can't tell
}

}  // namespace pg
