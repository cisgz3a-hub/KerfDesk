// De-fisheye rectify map (ADR-106, v2.d). For every pixel of the rectified
// (pinhole) output image, compute which pixel of the distorted source frame to
// sample. This is the math the WebGL undistort shader runs per fragment, and the
// CPU fallback for contexts without WebGL. Pure core: math only, no I/O.
//
// Output->input sampling: a rectified output pixel is a virtual PINHOLE ray
// (`outputK`); we project that ray through the calibrated fisheye (`sourceK`,
// `distortion`) to find the source pixel it lands on. Using the FORWARD projection
// (projectFisheye) is what removes the curvature — sampling the inverse would add it.

import type { Vec2 } from '../scene';
import { type CameraIntrinsics, type FisheyeDistortion, projectFisheye } from './fisheye';

/**
 * Map a rectified output pixel to the source (distorted) pixel to sample.
 * `outputK` is the virtual pinhole camera the rectified image is rendered through
 * (commonly the calibrated K, or a widened "new camera matrix" to retain field of
 * view); `sourceK`/`distortion` are the calibrated fisheye parameters.
 */
export function rectifySamplePoint(
  out: Vec2,
  outputK: CameraIntrinsics,
  sourceK: CameraIntrinsics,
  distortion: FisheyeDistortion,
): Vec2 {
  const a = (out.x - outputK.cx) / outputK.fx;
  const b = (out.y - outputK.cy) / outputK.fy;
  return projectFisheye(a, b, sourceK, distortion);
}

/**
 * Build a dense rectify lookup table for a `width`x`height` output: a Float32Array
 * of length `width*height*2`, row-major, holding the (u, v) source-pixel coordinate
 * for each output pixel. For the CPU fallback and for testing the GPU shader's math.
 */
export function buildRectifyMap(
  width: number,
  height: number,
  outputK: CameraIntrinsics,
  sourceK: CameraIntrinsics,
  distortion: FisheyeDistortion,
): Float32Array {
  const map = new Float32Array(width * height * 2);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sample = rectifySamplePoint({ x, y }, outputK, sourceK, distortion);
      const index = (y * width + x) * 2;
      map[index] = sample.x;
      map[index + 1] = sample.y;
    }
  }
  return map;
}
