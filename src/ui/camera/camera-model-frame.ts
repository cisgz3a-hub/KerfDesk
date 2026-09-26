// The saved camera model applied to one captured frame (ADR-440). The model
// is fitted at one resolution; a frame of the same shape at another size uses
// the lens scaled to it, a frame of another shape cannot be placed with it,
// and a frame from another camera would be placed by the wrong lens and pose.

import type { CameraCaptureBinding } from '../../core/camera/camera-capture-binding';
import type { CameraPose, LensModel } from '../../core/camera/model/camera-model';
import { lensForFrame, type CameraModelRecord } from '../../core/camera/model/camera-model-record';

export type ModelForFrame =
  | { readonly kind: 'ok'; readonly lens: LensModel; readonly pose: CameraPose }
  | { readonly kind: 'issue'; readonly message: string };

export function cameraModelForFrame(
  model: CameraModelRecord,
  capture: CameraCaptureBinding | null,
  width: number,
  height: number,
): ModelForFrame {
  const saved = model.capture;
  if (
    saved !== undefined &&
    capture !== null &&
    (saved.sourceKind !== capture.sourceKind || saved.sourceId !== capture.sourceId)
  ) {
    return {
      kind: 'issue',
      message:
        'The camera calibration belongs to a different camera. Switch back to that camera or calibrate this one.',
    };
  }
  const lens = lensForFrame(model, width, height);
  if (lens === null) {
    return {
      kind: 'issue',
      message: `The camera picture is ${width} × ${height}, a different shape from the ${model.lens.imageWidth} × ${model.lens.imageHeight} it was calibrated at. Set the camera back to that resolution or calibrate again.`,
    };
  }
  return { kind: 'ok', lens, pose: model.pose };
}

/** Why camera placement cannot compile against the saved setup, or null. */
export function cameraPlacementGeometryIssue(model: CameraModelRecord | undefined): string | null {
  return model === undefined
    ? 'Camera placement needs a saved camera calibration. Calibrate the active camera before framing or starting.'
    : null;
}
