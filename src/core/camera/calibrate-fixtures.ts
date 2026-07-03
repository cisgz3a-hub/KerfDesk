// Synthetic forward model for the calibration recovery harness (ADR-108, v2.c).
// Generates the exact pixels a known camera would record of a known board pose, so
// calibrate() can be asked to invert them back to the ground-truth K/D. The rotation
// here is an INDEPENDENT copy of Rodrigues on purpose — sharing rodrigues.ts would
// let a transposition bug cancel itself between the oracle and the solver. Imported
// only by calibrate.test.ts; no core module may depend on it (test fixture).

import type { Vec2 } from '../scene';
import { type CameraIntrinsics, type FisheyeDistortion, projectFisheye } from './fisheye';
import type { Mat3 } from './homography';

const ANGLE_EPSILON = 1e-12;
// frac(sin(i)·43758.5453)·2−1 has a measured mean of ~+0.0439; subtract it so the
// pseudo-noise is genuinely zero-mean and does not bias the principal point.
const NOISE_BIAS = 0.0439;

/** Independent Rodrigues forward map (axis-angle rvec -> row-major rotation). */
export function rodrigues(rvec: readonly [number, number, number]): Mat3 {
  const theta = Math.sqrt(rvec[0] * rvec[0] + rvec[1] * rvec[1] + rvec[2] * rvec[2]);
  if (theta < ANGLE_EPSILON) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const x = rvec[0] / theta;
  const y = rvec[1] / theta;
  const z = rvec[2] / theta;
  const ct = Math.cos(theta);
  const st = Math.sin(theta);
  const vt = 1 - ct;
  return [
    ct + x * x * vt,
    x * y * vt - z * st,
    x * z * vt + y * st,
    y * x * vt + z * st,
    ct + y * y * vt,
    y * z * vt - x * st,
    z * x * vt - y * st,
    z * y * vt + x * st,
    ct + z * z * vt,
  ];
}

/** Project planar board points through a known pose and the KB fisheye model. */
export function projectBoard(
  k: CameraIntrinsics,
  d: FisheyeDistortion,
  rvec: readonly [number, number, number],
  tvec: readonly [number, number, number],
  objectPoints: ReadonlyArray<Vec2>,
): Vec2[] {
  const r = rodrigues(rvec);
  return objectPoints.map((p) => {
    const camX = r[0] * p.x + r[1] * p.y + tvec[0];
    const camY = r[3] * p.x + r[4] * p.y + tvec[1];
    const camZ = r[6] * p.x + r[7] * p.y + tvec[2];
    return projectFisheye(camX / camZ, camY / camZ, k, d);
  });
}

/** Deterministic, de-biased pseudo-noise in roughly [-1, 1] (no Math.random). */
export function pseudoNoise(index: number): number {
  const raw = Math.sin(index * 12.9898) * 43758.5453;
  const frac = raw - Math.floor(raw);
  return frac * 2 - 1 - NOISE_BIAS;
}

/** A `cols`×`rows` checkerboard of inner corners centred on the origin (mm). */
export function makeCheckerboard(cols: number, rows: number, spacingMm: number): Vec2[] {
  const points: Vec2[] = [];
  const x0 = (-(cols - 1) * spacingMm) / 2;
  const y0 = (-(rows - 1) * spacingMm) / 2;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1)
      points.push({ x: x0 + col * spacingMm, y: y0 + row * spacingMm });
  }
  return points;
}
