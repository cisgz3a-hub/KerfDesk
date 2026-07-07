// runAutoAlign — capture a frame from the active source, de-fisheye it when a
// lens calibration exists, detect the five burned markers, solve the
// camera→bed homography, and persist the alignment (ADR-109). Extracted from
// AutoAlignControls so the alignment wizard's Detect step and any button run
// the identical path.

import {
  alignMarkerLayout,
  detectAlignMarkers,
  frameMatchesCalibration,
  rectifyImage,
  scaleIntrinsicsToFrame,
  solveMarkerAlignment,
  toGrayImage,
  type CameraAlignment,
  type CameraCalibration,
  type RgbaImage,
} from '../../core/camera';
import type { FrameCaptureIo } from './decode-jpeg';
import { captureSourceFrame, type ActiveCameraSource } from './frame-source';

export type AutoAlignOutcome =
  | { readonly kind: 'ok'; readonly basis: 'raw' | 'rectified' }
  | { readonly kind: 'failed'; readonly message: string };

export async function runAutoAlign(deps: {
  readonly source: ActiveCameraSource;
  readonly calibration: CameraCalibration | undefined;
  readonly bedWidth: number;
  readonly bedHeight: number;
  readonly updateDeviceProfile: (patch: { cameraAlignment: CameraAlignment }) => void;
  readonly io?: FrameCaptureIo;
}): Promise<AutoAlignOutcome> {
  const raw = await captureSourceFrame(deps.source, deps.io);
  if (raw === null) return { kind: 'failed', message: 'Could not capture a camera frame.' };
  const { frame, basis } = rectifyIfCalibrated(raw, deps.calibration);
  const detection = detectAlignMarkers(toGrayImage(frame));
  if (detection.kind !== 'ok') {
    return { kind: 'failed', message: alignFailureCopy(detection.reason) };
  }
  const solved = solveMarkerAlignment(detection, alignMarkerLayout(deps.bedWidth, deps.bedHeight));
  if (solved.kind !== 'ok') {
    return { kind: 'failed', message: 'The detected markers were degenerate — re-burn and retry.' };
  }
  deps.updateDeviceProfile({
    cameraAlignment: {
      homography: solved.homography,
      frameWidth: frame.width,
      frameHeight: frame.height,
      basis,
      alignedAt: Date.now(),
    },
  });
  return { kind: 'ok', basis };
}

// De-fisheye the capture when a lens calibration exists — the alignment then
// lives in the rectified pixel basis and stays distortion-free bed-wide.
function rectifyIfCalibrated(
  raw: RgbaImage,
  calibration: CameraCalibration | undefined,
): { readonly frame: RgbaImage; readonly basis: 'raw' | 'rectified' } {
  if (calibration === undefined) return { frame: raw, basis: 'raw' };
  const sourceK = frameMatchesCalibration(calibration, raw.width, raw.height)
    ? calibration.intrinsics
    : scaleIntrinsicsToFrame(calibration, raw.width, raw.height);
  const frame = rectifyImage(raw, {
    width: raw.width,
    height: raw.height,
    outputK: sourceK,
    sourceK,
    distortion: calibration.distortion,
  });
  return { frame, basis: 'rectified' };
}

function alignFailureCopy(reason: 'too-few-markers' | 'ambiguous-origin' | 'degenerate'): string {
  switch (reason) {
    case 'too-few-markers':
      return 'Markers not found — clear the bed, check lighting, and make sure all five patches are in view.';
    case 'ambiguous-origin':
      return 'The origin marker pair was not distinct — re-burn the markers and clear other objects.';
    case 'degenerate':
      return 'The detected markers were degenerate — re-burn and retry.';
  }
}
