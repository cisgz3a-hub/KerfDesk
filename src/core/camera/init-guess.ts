// Robust initial guess for fisheye calibration (ADR-095, v2.c). Levenberg-Marquardt
// needs a seed inside the basin of attraction; under Falcon-class barrel distortion
// Zhang's pinhole closed-form for K is numerically unsafe (it factorises a negative
// focal), so we seed K from the caller's device-nominal focal and D=0, and trust a
// per-view homography ONLY for the well-conditioned R/t part. Pure core.

import type { Vec2 } from '../scene';
import type { CameraIntrinsics, FisheyeDistortion } from './fisheye';
import { undistortPixel } from './fisheye';
import { type Mat3, type PointPair, solveHomography } from './homography';
import type { Tvec, ViewExtrinsic } from './lm-params';
import { rotationToRvec } from './rodrigues';

/** Seeded intrinsics, distortion, and per-view poses for the LM warm start. */
export type InitGuess = {
  readonly intrinsics: CameraIntrinsics;
  readonly distortion: FisheyeDistortion;
  readonly views: ReadonlyArray<ViewExtrinsic>;
};

export type InitInput = {
  readonly boardPoints: ReadonlyArray<Vec2>;
  readonly imagePointsPerView: ReadonlyArray<ReadonlyArray<Vec2 | null>>;
  readonly nominalIntrinsics: CameraIntrinsics;
};

export type InitResult =
  | { readonly kind: 'ok'; readonly guess: InitGuess }
  | { readonly kind: 'failed'; readonly reason: 'rank-deficient' };

type Vec3 = readonly [number, number, number];

const ZERO_DISTORTION: FisheyeDistortion = [0, 0, 0, 0];
const VECTOR_EPSILON = 1e-9;
const MIN_CORNERS = 4;

/** Seed the calibration from device-nominal intrinsics plus per-view homographies. */
export function seedCalibration(input: InitInput): InitResult {
  const views: ViewExtrinsic[] = [];
  for (const detections of input.imagePointsPerView) {
    const view = seedView(input.boardPoints, detections, input.nominalIntrinsics);
    if (view === null) return { kind: 'failed', reason: 'rank-deficient' };
    views.push(view);
  }
  return {
    kind: 'ok',
    guess: { intrinsics: input.nominalIntrinsics, distortion: ZERO_DISTORTION, views },
  };
}

function seedView(
  boardPoints: ReadonlyArray<Vec2>,
  detections: ReadonlyArray<Vec2 | null>,
  k: CameraIntrinsics,
): ViewExtrinsic | null {
  const pairs: PointPair[] = [];
  for (let i = 0; i < boardPoints.length; i += 1) {
    const board = boardPoints[i];
    const detection = detections[i];
    if (board === undefined || detection == null) continue;
    pairs.push({ src: board, dst: pinholePixel(detection, k) });
  }
  const corners = fourExtremes(pairs);
  if (corners === null) return null;
  const homography = solveHomography(corners);
  if (!homography.ok) return null;
  return decomposeHomography(homography.matrix, k);
}

// Map a fisheye-distorted detection toward the pinhole pixel a homography expects,
// by undistorting with the current (zero-distortion) model and re-applying K.
function pinholePixel(pixel: Vec2, k: CameraIntrinsics): Vec2 {
  const ray = undistortPixel(pixel.x, pixel.y, k, ZERO_DISTORTION);
  return { x: k.fx * ray.x + k.cx, y: k.fy * ray.y + k.cy };
}

// Recover R, t from H = K·[r1 r2 t] (up to scale): r1,r2 = normalised K⁻¹h1,K⁻¹h2,
// t = λK⁻¹h3 with λ chosen so the board is in front of the camera (t.z > 0), then
// Gram-Schmidt the columns into a proper rotation before the log map.
function decomposeHomography(h: Mat3, k: CameraIntrinsics): ViewExtrinsic | null {
  const col1 = applyInverseK(k, [h[0], h[3], h[6]]);
  const col2 = applyInverseK(k, [h[1], h[4], h[7]]);
  const col3 = applyInverseK(k, [h[2], h[5], h[8]]);
  const norm1 = length(col1);
  if (norm1 < VECTOR_EPSILON) return null;
  const lambda = (col3[2] >= 0 ? 1 : -1) / norm1;
  const e1 = normalize(scale(col1, lambda));
  const r2raw = scale(col2, lambda);
  if (e1 === null) return null;
  const e2 = normalize(subtract(r2raw, scale(e1, dot(e1, r2raw))));
  if (e2 === null) return null;
  const e3 = cross(e1, e2);
  const rotation: Mat3 = [e1[0], e2[0], e3[0], e1[1], e2[1], e3[1], e1[2], e2[2], e3[2]];
  const tvec: Tvec = scale(col3, lambda);
  return { rvec: rotationToRvec(rotation), tvec };
}

// K⁻¹·(x,y,z) for K = [[fx,0,cx],[0,fy,cy],[0,0,1]].
function applyInverseK(k: CameraIntrinsics, v: Vec3): Vec3 {
  return [(v[0] - k.cx * v[2]) / k.fx, (v[1] - k.cy * v[2]) / k.fy, v[2]];
}

// The four board corners that best span the target: the extremes of x+y and x−y.
function fourExtremes(pairs: ReadonlyArray<PointPair>): PointPair[] | null {
  if (pairs.length < MIN_CORNERS) return null;
  const sums = pairs.map((p) => p.src.x + p.src.y);
  const diffs = pairs.map((p) => p.src.x - p.src.y);
  const indices = uniqueIndices([
    argExtreme(sums, true),
    argExtreme(sums, false),
    argExtreme(diffs, true),
    argExtreme(diffs, false),
  ]);
  if (indices.length < MIN_CORNERS) return null;
  const corners: PointPair[] = [];
  for (const index of indices) {
    const pair = pairs[index];
    if (pair !== undefined) corners.push(pair);
  }
  return corners.length === MIN_CORNERS ? corners : null;
}

function argExtreme(values: ReadonlyArray<number>, findMin: boolean): number {
  let best = 0;
  let bestValue = values[0] ?? 0;
  for (let i = 1; i < values.length; i += 1) {
    const value = values[i];
    if (value === undefined) continue;
    if (findMin ? value < bestValue : value > bestValue) {
      bestValue = value;
      best = i;
    }
  }
  return best;
}

function uniqueIndices(indices: ReadonlyArray<number>): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const index of indices) {
    if (!seen.has(index)) {
      seen.add(index);
      out.push(index);
    }
  }
  return out;
}

function length(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

function normalize(v: Vec3): Vec3 | null {
  const norm = length(v);
  if (norm < VECTOR_EPSILON) return null;
  return [v[0] / norm, v[1] / norm, v[2] / norm];
}

function scale(v: Vec3, factor: number): Vec3 {
  return [v[0] * factor, v[1] * factor, v[2] * factor];
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
