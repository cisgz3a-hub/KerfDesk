// Shared synthetic plane renderer for camera test fixtures (ADR-107/108):
// renders the frame a known camera records of the z=0 plane, shading each
// plane point through a caller-supplied function. board-render-fixtures
// (checkerboard) and marker-render-fixtures (alignment patches) both build on
// this. Test fixture: imported only by fixtures/tests, never by core.

import type { Vec2 } from '../scene';
import { pseudoNoise, rodrigues } from './calibrate-fixtures';
import type { GrayImage } from './corner-subpix';
import type { CameraIntrinsics, FisheyeDistortion } from './fisheye';
import { undistortPixel } from './fisheye';
import type { Mat3 } from './homography';

export type PlaneRenderCamera = {
  readonly width: number;
  readonly height: number;
  readonly k: CameraIntrinsics;
  readonly d: FisheyeDistortion;
  readonly rvec: readonly [number, number, number];
  readonly tvec: readonly [number, number, number];
  // Peak-to-peak deterministic noise in gray levels (0 = clean).
  readonly noiseAmplitude?: number;
};

export const PLANE_BACKGROUND_GRAY = 170;

// 2×2 supersampling: anti-aliased edges are what sub-pixel refinement needs.
const SUBSAMPLES: ReadonlyArray<readonly [number, number]> = [
  [-0.25, -0.25],
  [0.25, -0.25],
  [-0.25, 0.25],
  [0.25, 0.25],
];

/** Render the z=0 plane through the camera, shading plane points via `shade`. */
export function renderPlaneView(
  camera: PlaneRenderCamera,
  shade: (planePoint: Vec2) => number,
): GrayImage {
  const r = rodrigues(camera.rvec);
  const data = new Float32Array(camera.width * camera.height);
  const noise = camera.noiseAmplitude ?? 0;
  for (let y = 0; y < camera.height; y += 1) {
    for (let x = 0; x < camera.width; x += 1) {
      let sum = 0;
      for (const [dx, dy] of SUBSAMPLES) {
        const ray = undistortPixel(x + dx, y + dy, camera.k, camera.d);
        const plane = intersectPlane(ray, r, camera.tvec);
        sum += plane === null ? PLANE_BACKGROUND_GRAY : shade(plane);
      }
      const index = y * camera.width + x;
      data[index] = sum / SUBSAMPLES.length + noise * pseudoNoise(index);
    }
  }
  return { data, width: camera.width, height: camera.height };
}

// Solve for the plane point (X, Y, 0) whose camera-frame projection has the
// ray direction (a, b): two linear equations from the pinhole ratios.
export function intersectPlane(
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
