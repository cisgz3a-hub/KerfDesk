import {
  cameraBindingCompatibility,
  type CameraCaptureBinding,
} from '../../core/camera/camera-capture-binding';

export function cameraBindingIssue(
  label: 'lens calibration' | 'bed alignment',
  saved: CameraCaptureBinding | undefined,
  current: CameraCaptureBinding,
): string | null {
  const compatibility = cameraBindingCompatibility(saved, current);
  if (compatibility === 'match') return null;
  if (compatibility === 'unbound') {
    return `The saved ${label} is not bound to a camera. Re-run it with the active camera before using precision placement.`;
  }
  if (compatibility === 'source-mismatch') {
    return `The saved ${label} belongs to a different camera. Switch back to that camera or re-run setup.`;
  }
  return `The active camera capture shape differs from the saved ${label}. Restore its calibrated resolution/aspect ratio or re-run setup.`;
}
