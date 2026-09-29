// Kannala-Brandt fisheye camera model (ADR-108) — the equidistant projection
// theta = atan(r) with a theta-power distortion polynomial. Used to de-fisheye
// wide-angle laser cameras (Falcon A1 Pro) where the Brown-Conrady r^6 term
// diverges. Pure core: math only, no I/O. Clean-room from the published model.

/**
 * Kannala-Brandt distortion: the coefficients `[k1, k2, k3, k4]` of the angular
 * polynomial `theta_d = theta*(1 + k1*theta^2 + k2*theta^4 + k3*theta^6 + k4*theta^8)`
 * — NOT Brown-Conrady radial terms. Consumed by {@link projectFisheye} (forward:
 * undistorted ray -> distorted pixel) and {@link undistortPixel} (inverse). A rectify
 * map samples the FORWARD direction to read each source pixel for a rectified output.
 */
export type FisheyeDistortion = readonly [number, number, number, number];

/** Pinhole intrinsics in pixels of a specific frame; pair with the image width/height. */
export type CameraIntrinsics = {
  readonly fx: number;
  readonly fy: number;
  readonly cx: number;
  readonly cy: number;
};

type Vec2 = { readonly x: number; readonly y: number };

const RADIUS_EPSILON = 1e-9;
// The inverse stops once a step moves theta by less than this (radians); at
// any real focal length that is far below a millionth of a pixel.
const THETA_TOLERANCE = 1e-12;
// Enough for bisection alone to close the bracket to the tolerance; Newton
// normally settles in a handful of steps.
const MAX_INVERSE_STEPS = 64;
// Samples of the polynomial's slope when looking for its first turning point.
const TURN_SCAN_STEPS = 512;
const HALF_PI = Math.PI / 2;

// theta_d = theta * (1 + k1 t^2 + k2 t^4 + k3 t^6 + k4 t^8), with t = theta.
function distortedAngle(theta: number, d: FisheyeDistortion): number {
  const t2 = theta * theta;
  const t4 = t2 * t2;
  const t6 = t4 * t2;
  const t8 = t4 * t4;
  return theta * (1 + d[0] * t2 + d[1] * t4 + d[2] * t6 + d[3] * t8);
}

// d(theta_d)/d(theta) — the polynomial's derivative, for the Newton inverse.
function distortedAngleDerivative(theta: number, d: FisheyeDistortion): number {
  const t2 = theta * theta;
  const t4 = t2 * t2;
  const t6 = t4 * t2;
  const t8 = t4 * t4;
  return 1 + 3 * d[0] * t2 + 5 * d[1] * t4 + 7 * d[2] * t6 + 9 * d[3] * t8;
}

/**
 * Forward-project an undistorted normalized ray direction (a, b) = (X/Z, Y/Z)
 * to distorted normalized image coordinates: r = |(a,b)|, theta = atan(r),
 * scaled to theta_d along the same direction. The optical axis (r=0) maps to
 * the origin (identity there).
 */
export function distortFisheye(a: number, b: number, d: FisheyeDistortion): Vec2 {
  const r = Math.hypot(a, b);
  if (r < RADIUS_EPSILON) return { x: a, y: b };
  const scale = distortedAngle(Math.atan(r), d) / r;
  return { x: a * scale, y: b * scale };
}

/** Project an undistorted ray (a, b) to a distorted pixel via K and D. */
export function projectFisheye(
  a: number,
  b: number,
  k: CameraIntrinsics,
  d: FisheyeDistortion,
): Vec2 {
  const distorted = distortFisheye(a, b, d);
  return { x: k.fx * distorted.x + k.cx, y: k.fy * distorted.y + k.cy };
}

/**
 * The widest ray angle theta (radians from the optical axis) at which the lens
 * can be inverted: the polynomial's first turning point, where theta_d stops
 * increasing, or pi/2 when it keeps rising (a wider ray has no (X/Z, Y/Z)).
 * Past a turning point one distorted radius belongs to two rays, so a pixel
 * there has no single answer.
 */
export function fisheyeAngleLimit(d: FisheyeDistortion): number {
  let rising = 0;
  for (let i = 1; i <= TURN_SCAN_STEPS; i += 1) {
    const theta = (HALF_PI * i) / TURN_SCAN_STEPS;
    if (distortedAngleDerivative(theta, d) <= 0) return firstTurn(rising, theta, d);
    rising = theta;
  }
  return HALF_PI;
}

/**
 * The distorted radius at which the lens turns back (theta_d's peak before
 * pi/2), or null when theta_d keeps rising to pi/2. A pixel at or beyond it
 * has no ray, and a wider ray is drawn back inside it.
 */
export function fisheyeFoldRadius(d: FisheyeDistortion): number | null {
  const limit = fisheyeAngleLimit(d);
  return limit < HALF_PI ? distortedAngle(limit, d) : null;
}

// Bisect between a rising angle and a later one where the slope is no longer
// positive, down to the tolerance.
function firstTurn(rising: number, falling: number, d: FisheyeDistortion): number {
  let lo = rising;
  let hi = falling;
  while (hi - lo > THETA_TOLERANCE) {
    const mid = (lo + hi) / 2;
    if (distortedAngleDerivative(mid, d) > 0) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * Recover the undistorted ray (a, b) = (X/Z, Y/Z) from a distorted pixel — the
 * inverse of {@link projectFisheye}. The distorted normalized radius equals
 * theta_d; theta_d -> theta has no closed form, so Newton steps solve it, then
 * r = tan(theta) rescales along the preserved direction.
 *
 * Null when the pixel has no ray: it lies beyond the widest distorted radius
 * the lens produces, or the solve did not settle. OpenCV's
 * cv::fisheye::undistortPoints marks such points invalid for the same reasons
 * rather than returning a ray on the wrong side of the curve or of the axis.
 * `angleLimit` is {@link fisheyeAngleLimit} of `d`, passed in by callers that
 * invert many pixels of one lens.
 */
export function undistortPixel(
  u: number,
  v: number,
  k: CameraIntrinsics,
  d: FisheyeDistortion,
  angleLimit = fisheyeAngleLimit(d),
): Vec2 | null {
  const px = (u - k.cx) / k.fx;
  const py = (v - k.cy) / k.fy;
  const thetaD = Math.hypot(px, py);
  if (thetaD < RADIUS_EPSILON) return { x: 0, y: 0 };
  const theta = solveTheta(thetaD, d, angleLimit);
  if (theta === null) return null;
  const scale = Math.tan(theta) / thetaD;
  return { x: px * scale, y: py * scale };
}

// theta_d(theta) rises from 0 to its peak over (0, limit), so exactly one
// theta there gives `thetaD` when thetaD is below the peak. Newton steps are
// kept inside a bracket around that root and fall back to bisection when a
// step would leave it, so the answer is never negative (a ray flipped through
// the axis) or past the turning point.
function solveTheta(thetaD: number, d: FisheyeDistortion, limit: number): number | null {
  if (!(thetaD < distortedAngle(limit, d))) return null;
  let lo = 0;
  let hi = limit;
  let theta = thetaD < limit ? thetaD : limit / 2;
  for (let i = 0; i < MAX_INVERSE_STEPS; i += 1) {
    const residual = distortedAngle(theta, d) - thetaD;
    if (residual === 0) return theta;
    if (residual > 0) hi = theta;
    else lo = theta;
    let next = theta - residual / distortedAngleDerivative(theta, d);
    if (!(next > lo && next < hi)) next = (lo + hi) / 2;
    if (Math.abs(next - theta) < THETA_TOLERANCE) return next;
    theta = next;
  }
  return null;
}
