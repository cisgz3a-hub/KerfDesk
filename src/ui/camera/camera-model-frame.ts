// The saved camera model applied to one captured frame (ADR-440). The model
// is fitted at one resolution; a frame of the same shape at another size uses
// the lens scaled to it once that size is shown to be a resize, not a cut-out
// of the sensor (Amendment 9); a frame of another shape cannot be placed with
// it, and a frame from another camera would be placed by the wrong lens and
// pose.

import {
  cameraBindingCompatibility,
  type CameraCaptureBinding,
} from '../../core/camera/camera-capture-binding';
import type { CameraPose, LensModel } from '../../core/camera/model/camera-model';
import { lensForFrame, type CameraModelRecord } from '../../core/camera/model/camera-model-record';
import { frameRescaleIssue, frameRescaleVerdict } from './frame-rescale-check';

export type ModelForFrame =
  | { readonly kind: 'ok'; readonly lens: LensModel; readonly pose: CameraPose }
  | { readonly kind: 'issue'; readonly message: string };

/** `rescale: 'measuring'`: the caller is checking the rescale itself (Check
 * camera, the view comparison), so an unproved size is used to measure it. */
export function cameraModelForFrame(
  model: CameraModelRecord,
  capture: CameraCaptureBinding | null,
  width: number,
  height: number,
  options: { readonly rescale?: 'measuring' } = {},
): ModelForFrame {
  const bound = bindingIssue(model, capture);
  if (bound !== null) return { kind: 'issue', message: bound };
  const lens = lensForFrame(model, width, height);
  if (lens === null) {
    return {
      kind: 'issue',
      message: `The camera picture is ${width} × ${height}, a different shape from the ${model.lens.imageWidth} × ${model.lens.imageHeight} it was calibrated at. Set the camera back to that resolution or calibrate again.`,
    };
  }
  const resized = width !== model.lens.imageWidth || height !== model.lens.imageHeight;
  if (resized && options.rescale !== 'measuring') {
    const verdict = frameRescaleVerdict(model, width, height);
    if (verdict !== 'resize') {
      return { kind: 'issue', message: frameRescaleIssue(model, width, height, verdict) };
    }
  }
  return { kind: 'ok', lens, pose: model.pose };
}

// Another camera, an unverifiable one, or a browser crop that changed.
function bindingIssue(
  model: CameraModelRecord,
  capture: CameraCaptureBinding | null,
): string | null {
  const saved = model.capture;
  const binding =
    saved !== undefined && capture !== null ? cameraBindingCompatibility(saved, capture) : 'match';
  if (binding === 'source-mismatch') {
    return 'The camera calibration belongs to a different camera. Switch back to that camera or calibrate this one.';
  }
  if (binding === 'unbound') {
    return 'The saved camera resource cannot be verified. Calibrate the active camera again.';
  }
  // A crop changes the rays even at the same aspect ratio. Pure resizing is
  // checked by lensForFrame, with the model's 1% aspect tolerance, and then
  // proved (frame-rescale-check).
  const cropped =
    saved?.resizeMode === 'crop-and-scale' || capture?.resizeMode === 'crop-and-scale';
  return binding === 'geometry-mismatch' && cropped
    ? 'The camera crop differs from its calibration. Restore the calibrated capture settings or calibrate again.'
    : null;
}

/** Why camera placement cannot compile against the saved setup, or null. */
export function cameraPlacementGeometryIssue(model: CameraModelRecord | undefined): string | null {
  return model === undefined
    ? 'Camera placement needs a saved camera calibration. Calibrate the active camera before framing or starting.'
    : null;
}
