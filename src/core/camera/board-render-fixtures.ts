// Synthetic checkerboard IMAGE renderer for the detector harness (ADR-106,
// v2.b). calibrate-fixtures.ts projects ideal corner POINTS; the detector needs
// whole frames, so this renders the pixels a known camera would record of a
// known board pose: each output pixel is un-distorted to a ray, intersected
// with the board plane, and colored by the checker pattern (2×2 supersampled).
// Test fixture like calibrate-fixtures: imported only by tests, never by core.

import type { Vec2 } from '../scene';
import { projectBoard, pseudoNoise, rodrigues } from './calibrate-fixtures';
import type { GrayImage } from './corner-subpix';
import { checkerboardObjectPoints } from './detect-checkerboard';
import { type CameraIntrinsics, type FisheyeDistortion, undistortPixel } from './fisheye';
import type { CheckerboardSpec } from './grid-lattice';
import type { Mat3 } from './homography';

export type BoardRenderOptions = {
  readonly width: number;
  readonly height: number;
  readonly k: CameraIntrinsics;
  readonly d: FisheyeDistortion;
  readonly rvec: readonly [number, number, number];
  readonly tvec: readonly [number, number, number];
  readonly spec: CheckerboardSpec;
  readonly spacingMm: number;
  // Peak-to-peak deterministic noise in gray levels (0 = clean).
  readonly noiseAmplitude?: number;
};

const BLACK_SQUARE = 25;
const WHITE_SQUARE = 235;
const BACKGROUND = 170;
// Quiet-zone margin around the squares, in squares (real prints have one).
const BORDER_SQUARES = 1;
// 2×2 supersampling offsets: anti-aliased edges are what sub-pixel refinement
// needs; hard-quantized edges would bias the refined corner.
const SUBSAMPLES: ReadonlyArray<readonly [number, number]> = [
  [-0.25, -0.25],
  [0.25, -0.25],
  [-0.25, 0.25],
  [0.25, 0.25],
];

/** Render the frame a camera (K, D) at pose (rvec, tvec) records of the board. */
export function renderCheckerboardView(options: BoardRenderOptions): GrayImage {
  const r = rodrigues(options.rvec);
  const data = new Float32Array(options.width * options.height);
  const noise = options.noiseAmplitude ?? 0;
  for (let y = 0; y < options.height; y += 1) {
    for (let x = 0; x < options.width; x += 1) {
      let sum = 0;
      for (const [dx, dy] of SUBSAMPLES) {
        sum += shadeSample(x + dx, y + dy, r, options);
      }
      const index = y * options.width + x;
      data[index] = sum / SUBSAMPLES.length + noise * pseudoNoise(index);
    }
  }
  return { data, width: options.width, height: options.height };
}

/** Ground-truth inner-corner pixel positions for the same render, row-major. */
export function trueCornerPixels(options: BoardRenderOptions): Vec2[] {
  return projectBoard(
    options.k,
    options.d,
    options.rvec,
    options.tvec,
    checkerboardObjectPoints(options.spec, options.spacingMm),
  );
}

// Shade one sub-sample: pixel -> undistorted ray -> board-plane intersection
// -> checker color. Board poses in tests keep the plane in front of the
// camera, so the degenerate behind-camera branch just returns background.
function shadeSample(u: number, v: number, r: Mat3, options: BoardRenderOptions): number {
  const ray = undistortPixel(u, v, options.k, options.d);
  const board = intersectBoardPlane(ray, r, options.tvec);
  if (board === null) return BACKGROUND;
  return checkerShade(board, options.spec, options.spacingMm);
}

// Solve for the board point (X, Y, 0) whose camera-frame projection has the
// ray direction (a, b): two linear equations from the pinhole ratios.
function intersectBoardPlane(
  ray: Vec2,
  r: Mat3,
  tvec: readonly [number, number, number],
): Vec2 | null {
  const a00 = r[0] - ray.x * r[6];
  const a01 = r[1] - ray.x * r[7];
  const a10 = r[3] - ray.y * r[6];
  const a11 = r[4] - ray.y * r[7];
  const b0 = ray.x * tvec[2] - tvec[0];
  const b1 = ray.y * tvec[2] - tvec[1];
  const det = a00 * a11 - a01 * a10;
  if (Math.abs(det) < 1e-12) return null;
  const bx = (b0 * a11 - a01 * b1) / det;
  const by = (a00 * b1 - b0 * a10) / det;
  // Reject intersections behind the camera (negative depth).
  const depth = r[6] * bx + r[7] * by + tvec[2];
  if (depth <= 0) return null;
  return { x: bx, y: by };
}

function checkerShade(board: Vec2, spec: CheckerboardSpec, spacingMm: number): number {
  const minX = -BORDER_SQUARES * spacingMm - spacingMm;
  const minY = -BORDER_SQUARES * spacingMm - spacingMm;
  const maxX = (spec.cols + BORDER_SQUARES) * spacingMm;
  const maxY = (spec.rows + BORDER_SQUARES) * spacingMm;
  if (board.x < minX || board.x > maxX || board.y < minY || board.y > maxY) {
    return BACKGROUND;
  }
  // Squares: square (m, n) covers [(m−1)·s, m·s) × [(n−1)·s, n·s); the quiet
  // zone outside the squares but inside the sheet is white.
  const m = Math.floor(board.x / spacingMm) + 1;
  const n = Math.floor(board.y / spacingMm) + 1;
  if (m < 0 || m > spec.cols || n < 0 || n > spec.rows) return WHITE_SQUARE;
  return (m + n) % 2 === 0 ? WHITE_SQUARE : BLACK_SQUARE;
}
