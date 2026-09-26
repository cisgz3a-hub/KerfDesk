// TraceFromCameraButton — capture → flatten onto the bed with the camera
// model at the material's height → the normal Trace dialog (ADR-110,
// ADR-440). Split from OverlayControls: tracing is a capture pipeline, not an
// overlay preference.

import { useStore } from '../state';
import { useCameraStore } from '../state/camera-store';
import { useToastStore } from '../state/toast-store';
import { useUiStore } from '../state/ui-store';
import { cameraModelForFrame } from './camera-model-frame';
import { cameraCaptureBindingForFrame, captureSourceFrame } from './frame-source';
import { buildCameraTraceImage } from './trace-from-camera';
import { useCameraTraceLifetime } from './use-camera-trace-lifetime';

export function TraceFromCameraButton(): JSX.Element {
  const model = useStore((s) => s.project.device.cameraModel);
  const bedWidth = useStore((s) => s.project.device.bedWidth);
  const bedHeight = useStore((s) => s.project.device.bedHeight);
  const sourceState = useCameraStore((s) => s.sourceState);
  const surfaceHeightMm = useCameraStore((s) => s.surfaceHeightMm);
  const activatePlacement = useCameraStore((s) => s.activatePlacement);
  const openImageDialog = useUiStore((s) => s.openImageDialog);
  const pushToast = useToastStore((s) => s.pushToast);
  const captureLifetime = useCameraTraceLifetime();

  const traceFromCamera = async (): Promise<void> => {
    if (sourceState.kind !== 'live' || model === undefined) return;
    const isCurrent = captureLifetime();
    const raw = await captureSourceFrame(sourceState.source);
    if (!isCurrent()) return;
    if (raw === null) {
      pushToast('Could not capture a camera frame.', 'error');
      return;
    }
    const capture = cameraCaptureBindingForFrame(sourceState.source, raw.width, raw.height);
    const fitted = cameraModelForFrame(model, capture, raw.width, raw.height);
    if (fitted.kind === 'issue') {
      pushToast(fitted.message, 'error');
      return;
    }
    const built = buildCameraTraceImage({
      raw,
      lens: fitted.lens,
      pose: fitted.pose,
      bedWidthMm: bedWidth,
      bedHeightMm: bedHeight,
      surfaceHeightMm,
    });
    if (built.kind !== 'ok') {
      pushToast('Could not build the bed image from the camera frame.', 'error');
      return;
    }
    // Keep camera placement visible in the Camera panel without rewriting the
    // operator's selected origin mode. The watched Frame verifies exact motion.
    activatePlacement();
    openImageDialog(built.source, { sourceOrigin: 'camera-capture' });
  };

  return (
    <button
      type="button"
      className="lf-btn"
      disabled={sourceState.kind !== 'live' || model === undefined}
      onClick={() => void traceFromCamera()}
      title="Capture the bed, flatten it top-down at the material height, and trace it. Vectors land at the object's true position."
    >
      Trace from camera
    </button>
  );
}
