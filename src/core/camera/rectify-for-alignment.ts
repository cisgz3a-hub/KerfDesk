// rectify-for-alignment — a raw camera frame must be de-fisheyed BEFORE a
// rectified-basis homography is applied to it; a raw-basis alignment warps raw
// pixels directly. Mixing the two silently mis-registers (straight bed edges
// bow). Both Trace (buildCameraTraceImage) and the workspace overlay share this
// one decision so they can never diverge (ADR-110; Codex re-audit R2).

import type { CameraAlignment } from './camera-alignment';
import type { CameraCalibration } from './camera-calibration';
import { rectifyImage, type RgbaImage } from './cpu-rectify';
import { frameMatchesCalibration, scaleIntrinsicsToFrame } from './resolution-match';

export type RectifiedForAlignment =
  | { readonly kind: 'ok'; readonly frame: RgbaImage }
  // The alignment lives in the rectified basis but no calibration is available
  // to de-fisheye by, so the frame cannot be correctly registered — the caller
  // must refuse rather than warp raw pixels with a rectified-basis homography.
  | { readonly kind: 'basis-mismatch' };

export function rectifyForAlignmentBasis(
  raw: RgbaImage,
  alignment: CameraAlignment,
  calibration: CameraCalibration | undefined,
): RectifiedForAlignment {
  if (alignment.basis !== 'rectified') return { kind: 'ok', frame: raw };
  if (calibration === undefined) return { kind: 'basis-mismatch' };
  const sourceK = frameMatchesCalibration(calibration, raw.width, raw.height)
    ? calibration.intrinsics
    : scaleIntrinsicsToFrame(calibration, raw.width, raw.height);
  return {
    kind: 'ok',
    frame: rectifyImage(raw, {
      width: raw.width,
      height: raw.height,
      outputK: sourceK,
      sourceK,
      distortion: calibration.distortion,
    }),
  };
}
