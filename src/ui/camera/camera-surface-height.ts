import type { CameraAlignment, CameraCalibration } from '../../core/camera';
import {
  compensateAlignmentForSurfaceHeight,
  type SurfaceHeightCompensationResult,
} from '../../core/camera/surface-height-compensation';

export function resolveCameraSurfaceHeight(
  alignment: CameraAlignment,
  calibration: CameraCalibration | undefined,
  surfaceHeightMm: number,
): SurfaceHeightCompensationResult {
  return compensateAlignmentForSurfaceHeight({ alignment, calibration, surfaceHeightMm });
}

export function cameraSurfaceHeightIssue(result: SurfaceHeightCompensationResult): string | null {
  if (result.ok) return null;
  switch (result.reason) {
    case 'alignment-height-unknown':
      return 'This saved alignment does not record its physical plane height. Re-run Align to bed and enter the marker surface height.';
    case 'invalid-height':
      return 'Material surface height must be a finite, non-negative millimetre value.';
    case 'needs-lens-calibration':
      return 'Changing material height needs a saved lens calibration. Calibrate the lens, then re-align the bed.';
    case 'needs-rectified-alignment':
      return 'Changing material height needs a lens-corrected alignment. Calibrate the lens, then re-align the bed.';
    case 'invalid-camera-pose':
      return 'KerfDesk could not recover a stable camera pose for height compensation. Recalibrate the lens and re-align the bed.';
  }
}

export function cameraPlacementGeometryIssue(
  alignment: CameraAlignment | undefined,
  calibration: CameraCalibration | undefined,
  surfaceHeightMm: number,
): string | null {
  if (alignment === undefined) {
    return 'Camera placement needs a saved bed alignment. Align the active camera before framing or starting.';
  }
  return cameraSurfaceHeightIssue(
    resolveCameraSurfaceHeight(alignment, calibration, surfaceHeightMm),
  );
}
