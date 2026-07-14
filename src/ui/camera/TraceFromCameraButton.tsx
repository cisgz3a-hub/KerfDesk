// TraceFromCameraButton — capture → basis-correct → top-down bed warp → the
// normal Trace dialog (ADR-110). Split from OverlayControls: tracing is a
// capture pipeline, not an overlay preference.

import { useStore } from '../state';
import { useCameraStore } from '../state/camera-store';
import { useToastStore } from '../state/toast-store';
import { useUiStore } from '../state/ui-store';
import { captureSourceFrame } from './frame-source';
import { cameraCaptureBindingForFrame } from './frame-source';
import { buildCameraTraceImage } from './trace-from-camera';
import { cameraBindingIssue } from './camera-binding-guard';
import { cameraSurfaceHeightIssue, resolveCameraSurfaceHeight } from './camera-surface-height';

export function TraceFromCameraButton(): JSX.Element {
  const alignment = useStore((s) => s.project.device.cameraAlignment);
  const calibration = useStore((s) => s.project.device.cameraCalibration);
  const bedWidth = useStore((s) => s.project.device.bedWidth);
  const bedHeight = useStore((s) => s.project.device.bedHeight);
  const sourceState = useCameraStore((s) => s.sourceState);
  const surfaceHeightMm = useCameraStore((s) => s.surfaceHeightMm);
  const activatePlacement = useCameraStore((s) => s.activatePlacement);
  const setJobPlacement = useStore((s) => s.setJobPlacement);
  const openImageDialog = useUiStore((s) => s.openImageDialog);
  const pushToast = useToastStore((s) => s.pushToast);

  const traceFromCamera = async (): Promise<void> => {
    if (sourceState.kind !== 'live') return;
    const raw = await captureSourceFrame(sourceState.source);
    if (raw === null) {
      pushToast('Could not capture a camera frame.', 'error');
      return;
    }
    const capture = cameraCaptureBindingForFrame(sourceState.source, raw.width, raw.height);
    const bindingIssue =
      (alignment === undefined
        ? null
        : cameraBindingIssue('bed alignment', alignment.capture, capture)) ??
      (calibration === undefined
        ? null
        : cameraBindingIssue('lens calibration', calibration.capture, capture));
    if (bindingIssue !== null) {
      pushToast(bindingIssue, 'error');
      return;
    }
    const built = buildCameraTraceImage({
      raw,
      alignment,
      calibration,
      bedWidthMm: bedWidth,
      bedHeightMm: bedHeight,
      surfaceHeightMm,
    });
    if (built.kind !== 'ok') {
      const surfaceIssue =
        alignment === undefined
          ? null
          : cameraSurfaceHeightIssue(
              resolveCameraSurfaceHeight(alignment, calibration, surfaceHeightMm),
            );
      pushToast(cameraTraceFailureMessage(built.reason, surfaceIssue), 'error');
      return;
    }
    // The traced image is emitted in physical bed coordinates. Keep the job in
    // that same coordinate frame even if the overlay is later hidden.
    activatePlacement();
    setJobPlacement({ startFrom: 'absolute' });
    openImageDialog(built.source);
  };

  return (
    <button
      type="button"
      className="lf-btn"
      disabled={sourceState.kind !== 'live'}
      onClick={() => void traceFromCamera()}
      title="Capture the bed, flatten it top-down, and trace it — vectors land at the object's true position."
    >
      Trace from camera
    </button>
  );
}

function cameraTraceFailureMessage(reason: string, surfaceIssue: string | null): string {
  if (surfaceIssue !== null) return surfaceIssue;
  return reason === 'basis-mismatch'
    ? 'The alignment expects a lens-corrected frame but no calibration is saved — recalibrate or re-align.'
    : 'Could not build the bed image from the camera frame.';
}
