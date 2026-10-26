// All held-picture entry points share this owner: panel Refresh, Alt+C and
// automatic refresh. A newer request or viewing intent permanently retires
// the old capture, even if its camera/context is selected again later.
import { useStore } from '../state';
import { useCameraStore } from '../state/camera-store';
import { cameraCaptureBindingForFrame, captureSourceFrame } from './frame-source';

export type OverlayCaptureOutcome = 'captured' | 'superseded' | 'failed' | 'no-camera';
let cancelCurrent: (() => void) | null = null;

/** Live/hide/exit can abandon a request even if the store values were already the same. */
export function cancelOverlayCapture(): void {
  cancelCurrent?.();
}

export async function captureOverlayStill(
  capture: typeof captureSourceFrame = captureSourceFrame,
  options: { readonly showOverlay?: boolean; readonly activatePlacement?: boolean } = {},
): Promise<OverlayCaptureOutcome> {
  cancelOverlayCapture();
  const camera = useCameraStore.getState();
  const app = useStore.getState();
  if (camera.sourceState.kind !== 'live') return 'no-camera';
  const source = camera.sourceState.source;
  let current = true;
  const stops: Array<() => void> = [];
  const release = (): void => {
    stops.splice(0).forEach((stop) => stop());
    if (cancelCurrent === cancel) cancelCurrent = null;
  };
  const cancel = (): void => {
    current = false;
    release();
  };
  cancelCurrent = cancel;
  const checkContext = (): void => {
    const now = useCameraStore.getState();
    const document = useStore.getState();
    if (
      now.sourceEpoch !== camera.sourceEpoch ||
      now.sourceState !== camera.sourceState ||
      now.overlayStill !== camera.overlayStill ||
      now.bedPicture !== camera.bedPicture ||
      now.overlayVisible !== camera.overlayVisible ||
      now.placementActive !== camera.placementActive ||
      document.projectDocumentEpoch !== app.projectDocumentEpoch ||
      document.project.device !== app.project.device
    )
      cancel();
  };
  stops.push(useCameraStore.subscribe(checkContext), useStore.subscribe(checkContext));
  try {
    const frame = await capture(source).catch(() => null);
    checkContext();
    if (!current) return 'superseded';
    if (frame === null) return 'failed';
    // Our publication is not an operator changing intent.
    release();
    // Publish the picture and requested viewing state together: a caller
    // awaiting us must not reactivate an overlay abandoned in the meantime.
    useCameraStore.setState({
      overlayStill: frame,
      overlayStillCapture: cameraCaptureBindingForFrame(source, frame.width, frame.height),
      bedPicture: null,
      ...(options.showOverlay ? { overlayVisible: true } : {}),
      ...(options.activatePlacement ? { placementActive: true } : {}),
    });
    return 'captured';
  } finally {
    release();
  }
}
