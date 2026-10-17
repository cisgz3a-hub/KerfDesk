import { bedPoint, pixelToBed, projectWorldPoint } from '../core/camera/model/camera-model';
import type { CameraModelRecord } from '../core/camera/model/camera-model-record';
import { overheadPose, wideLens } from '../core/camera/model/model-fixtures';

export const CAMERA_AUDIT_WIDTH = 1280;

/** Compare a fitted model with 50 known locations that are not calibration marks.
 * Two heights test the 3D mapping, not merely the fit residual on the ring plane. */
export function cameraAuditHeldOutErrorMm(
  record: CameraModelRecord,
  width = CAMERA_AUDIT_WIDTH,
): number {
  const truthLens = wideLens(width);
  const truthPose = overheadPose();
  let maximum = 0;
  for (const height of [0, 12]) {
    for (let y = 30; y <= 370; y += 85) {
      for (let x = 30; x <= 370; x += 85) {
        const pixel = projectWorldPoint(truthLens, truthPose, bedPoint(x, y, height));
        const mapped = pixel === null ? null : pixelToBed(record.lens, record.pose, pixel, height);
        if (mapped === null) return Infinity;
        maximum = Math.max(maximum, Math.hypot(mapped.x - x, mapped.y - y));
      }
    }
  }
  return maximum;
}
