// Kannala-Brandt fisheye camera model (ADR-095) — the equidistant projection
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

const NEWTON_ITERATIONS = 12;
const RADIUS_EPSILON = 1e-9;

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
 * Recover the undistorted ray (a, b) = (X/Z, Y/Z) from a distorted pixel — the
 * inverse of {@link projectFisheye}. The distorted normalized radius equals
 * theta_d; theta_d -> theta has no closed form, so a few Newton steps solve it,
 * then r = tan(theta) rescales along the preserved direction.
 */
export function undistortPixel(
  u: number,
  v: number,
  k: CameraIntrinsics,
  d: FisheyeDistortion,
): Vec2 {
  const px = (u - k.cx) / k.fx;
  const py = (v - k.cy) / k.fy;
  const thetaD = Math.hypot(px, py);
  if (thetaD < RADIUS_EPSILON) return { x: 0, y: 0 };
  let theta = thetaD;
  for (let i = 0; i < NEWTON_ITERATIONS; i += 1) {
    const residual = distortedAngle(theta, d) - thetaD;
    theta -= residual / distortedAngleDerivative(theta, d);
  }
  const scale = Math.tan(theta) / thetaD;
  return { x: px * scale, y: py * scale };
}
