// Apply-time resolution matching for a persisted camera→bed alignment (ADR-108
// precedent, for the alignment path). The homography was solved in the pixel
// basis of the frame it was captured at; applying it to a differently-sized
// frame maps every point off by the resolution ratio. Rescale the homography's
// INPUT so an actual-frame pixel is re-expressed in the solved-frame basis
// before the map. Pure core: math only.

import type { CameraAlignment } from './camera-alignment';
import type { Mat3 } from './homography';
import { multiplyMat3 } from './mat3';

/** Whether the alignment was solved at exactly the given frame resolution. */
export function alignmentMatchesFrame(
  alignment: CameraAlignment,
  frameWidth: number,
  frameHeight: number,
): boolean {
  return alignment.frameWidth === frameWidth && alignment.frameHeight === frameHeight;
}

/**
 * Rescale a solved homography H to a frame of a different resolution.
 *
 * We need H' such that H'·p_actual == H·p_solved for the same physical point.
 * A point at actual-pixel p' sits at solved-pixel S·p' where
 * S = diag(frameWidth_solved / frameWidth_actual, frameHeight_solved / …, 1),
 * so H' = H·S maps p_actual straight to the correct bed-mm.
 *
 * NOTE the ratio is solved/actual — the INVERSE of scaleIntrinsicsToFrame's
 * actual/solved. Correcting a homography's input is the inverse of scaling
 * intrinsics' output; do not copy that function's ratio.
 */
export function scaleAlignmentHomographyToFrame(
  alignment: CameraAlignment,
  frameWidth: number,
  frameHeight: number,
): Mat3 {
  // A non-positive size is a caller error (no real frame yet) — return the
  // solved homography rather than emit a divide-by-zero degenerate map.
  if (frameWidth <= 0 || frameHeight <= 0) return alignment.homography;
  if (alignmentMatchesFrame(alignment, frameWidth, frameHeight)) return alignment.homography;
  const scaleX = alignment.frameWidth / frameWidth;
  const scaleY = alignment.frameHeight / frameHeight;
  const scale: Mat3 = [scaleX, 0, 0, 0, scaleY, 0, 0, 0, 1];
  return multiplyMat3(alignment.homography, scale);
}
