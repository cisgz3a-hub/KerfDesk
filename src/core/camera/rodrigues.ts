// Axis-angle <-> rotation-matrix conversion (Rodrigues), ADR-095 calibration v2.c.
// The LM solver parameterises each view's orientation as a 3-vector rvec whose
// direction is the rotation axis and whose magnitude is the angle; the forward map
// builds the matrix, the inverse (SO(3) log map) recovers rvec for the warm-start
// seed. Pure core: math only. Row-major Mat3, consistent with homography.ts.

import type { Mat3 } from './homography';

/** Axis-angle rotation: unit axis scaled by the rotation angle (radians). */
export type Rvec = readonly [number, number, number];

const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
// Below this angle the rotation is indistinguishable from identity; the closed
// form divides by theta, so we short-circuit instead.
const ANGLE_EPSILON = 1e-12;
// Within this of pi the skew-symmetric part (R - Rᵀ) vanishes, so the axis must be
// recovered from the symmetric part instead — the near-pi diagonal branch.
const NEAR_PI_THRESHOLD = 1e-4;

/**
 * Build the row-major rotation matrix for an axis-angle vector via Rodrigues'
 * formula R = cosθ·I + (1-cosθ)·kkᵀ + sinθ·[k]ₓ. Returns identity for a near-zero
 * angle.
 */
export function rodriguesToMatrix(rvec: Rvec): Mat3 {
  const theta = Math.hypot(rvec[0], rvec[1], rvec[2]);
  if (theta < ANGLE_EPSILON) return IDENTITY;
  const kx = rvec[0] / theta;
  const ky = rvec[1] / theta;
  const kz = rvec[2] / theta;
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const v = 1 - c;
  return [
    c + kx * kx * v,
    kx * ky * v - kz * s,
    kx * kz * v + ky * s,
    ky * kx * v + kz * s,
    c + ky * ky * v,
    ky * kz * v - kx * s,
    kz * kx * v - ky * s,
    kz * ky * v + kx * s,
    c + kz * kz * v,
  ];
}

/**
 * Recover the axis-angle vector from a rotation matrix (the SO(3) log map). The
 * caller must pass a true rotation (orthonormal, det +1); the near-pi branch keeps
 * it stable where the off-diagonal skew part degenerates.
 */
export function rotationToRvec(r: Mat3): Rvec {
  const trace = r[0] + r[4] + r[8];
  const cosTheta = Math.max(-1, Math.min(1, (trace - 1) / 2));
  const theta = Math.acos(cosTheta);
  if (theta < ANGLE_EPSILON) return [0, 0, 0];
  if (theta > Math.PI - NEAR_PI_THRESHOLD) return nearPiAxis(r, theta);
  const scale = theta / (2 * Math.sin(theta));
  return [(r[7] - r[5]) * scale, (r[2] - r[6]) * scale, (r[3] - r[1]) * scale];
}

// Near pi, R + I = 2·kkᵀ, so kᵢ² = (Rᵢᵢ + 1)/2. Anchor on the largest diagonal for
// numerical stability, then recover the other axis components from the symmetric
// off-diagonals (kᵢkⱼ = (Rᵢⱼ + Rⱼᵢ)/4). The axis sign at exactly pi is ambiguous.
function nearPiAxis(r: Mat3, theta: number): Rvec {
  const dxx = r[0];
  const dyy = r[4];
  const dzz = r[8];
  let axis: readonly [number, number, number];
  if (dxx >= dyy && dxx >= dzz) {
    const kx = Math.sqrt(Math.max(0, (dxx + 1) / 2));
    axis = [kx, (r[1] + r[3]) / (4 * kx), (r[2] + r[6]) / (4 * kx)];
  } else if (dyy >= dzz) {
    const ky = Math.sqrt(Math.max(0, (dyy + 1) / 2));
    axis = [(r[1] + r[3]) / (4 * ky), ky, (r[5] + r[7]) / (4 * ky)];
  } else {
    const kz = Math.sqrt(Math.max(0, (dzz + 1) / 2));
    axis = [(r[2] + r[6]) / (4 * kz), (r[5] + r[7]) / (4 * kz), kz];
  }
  const norm = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  return [(theta * axis[0]) / norm, (theta * axis[1]) / norm, (theta * axis[2]) / norm];
}
