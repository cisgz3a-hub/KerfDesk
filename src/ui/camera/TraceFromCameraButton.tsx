// TraceFromCameraButton — capture → basis-correct → top-down bed warp → the
// normal Trace dialog (ADR-110). Split from OverlayControls: tracing is a
// capture pipeline, not an overlay preference.

import { useStore } from '../state';
import { useCameraStore } from '../state/camera-store';
import { useToastStore } from '../state/toast-store';
import { useUiStore } from '../state/ui-store';
import { captureSourceFrame } from './frame-source';
import { buildCameraTraceImage } from './trace-from-camera';

export function TraceFromCameraButton(): JSX.Element {
  const alignment = useStore((s) => s.project.device.cameraAlignment);
  const calibration = useStore((s) => s.project.device.cameraCalibration);
  const bedWidth = useStore((s) => s.project.device.bedWidth);
  const bedHeight = useStore((s) => s.project.device.bedHeight);
  const sourceState = useCameraStore((s) => s.sourceState);
  const openImageDialog = useUiStore((s) => s.openImageDialog);
  const pushToast = useToastStore((s) => s.pushToast);

  const traceFromCamera = async (): Promise<void> => {
    if (sourceState.kind !== 'live') return;
    const raw = await captureSourceFrame(sourceState.source);
    if (raw === null) {
      pushToast('Could not capture a camera frame.', 'error');
      return;
    }
    const built = buildCameraTraceImage({
      raw,
      alignment,
      calibration,
      bedWidthMm: bedWidth,
      bedHeightMm: bedHeight,
    });
    if (built.kind !== 'ok') {
      pushToast(
        built.reason === 'basis-mismatch'
          ? 'The alignment expects a lens-corrected frame but no calibration is saved — recalibrate or re-align.'
          : 'Could not build the bed image from the camera frame.',
        'error',
      );
      return;
    }
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
