// Apply-time resolution matching (ADR-107, v2.e). A calibration's intrinsics are
// pixels of the frame it was captured at; applying it to a differently-sized frame
// requires rescaling fx,cx by the width ratio and fy,cy by the height ratio. The
// wizard warns on a mismatch and feeds the scaled intrinsics into the rectify map.
// Pure core: math only.

import type { CameraCalibration } from './camera-calibration';
import type { CameraIntrinsics } from './fisheye';

/** Whether the calibration was captured at exactly the given frame resolution. */
export function frameMatchesCalibration(
  calibration: CameraCalibration,
  frameWidth: number,
  frameHeight: number,
): boolean {
  return calibration.imageWidth === frameWidth && calibration.imageHeight === frameHeight;
}

/**
 * Rescale a calibration's intrinsics to a frame of a different resolution. fx and cx
 * scale with the width ratio, fy and cy with the height ratio (the distortion
 * coefficients are dimensionless and unchanged).
 */
export function scaleIntrinsicsToFrame(
  calibration: CameraCalibration,
  frameWidth: number,
  frameHeight: number,
): CameraIntrinsics {
  // A non-positive frame size is a caller error (no real frame yet); fall back to the
  // captured intrinsics rather than emit a divide-by-zero degenerate camera.
  if (frameWidth <= 0 || frameHeight <= 0) return calibration.intrinsics;
  const scaleX = frameWidth / calibration.imageWidth;
  const scaleY = frameHeight / calibration.imageHeight;
  return {
    fx: calibration.intrinsics.fx * scaleX,
    fy: calibration.intrinsics.fy * scaleY,
    cx: calibration.intrinsics.cx * scaleX,
    cy: calibration.intrinsics.cy * scaleY,
  };
}
