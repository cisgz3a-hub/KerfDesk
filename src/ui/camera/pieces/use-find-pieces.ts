// Capture → flatten onto the bed → find the pieces on it (ADR-442). The
// selected design's centre, when it lies on the bed, is the colour reference,
// so blanks as bright as the bed are still told apart by their colour. The
// overlay is turned on so the found outlines sit over the camera picture.

import { useStore } from '../../state';
import { useCameraStore } from '../../state/camera-store';
import { useToastStore } from '../../state/toast-store';
import { cameraModelForFrame } from '../camera-model-frame';
import { cameraCaptureBindingForFrame, captureSourceFrame } from '../frame-source';
import { useCameraTraceLifetime } from '../use-camera-trace-lifetime';
import { usePieceScanStore } from './piece-scan-store';
import { scanBedPieces } from './scan-bed-pieces';
import { selectionFrame } from './selection-frame';

export type FindPieces = {
  /** A live camera and a saved camera model: a search can start. */
  readonly available: boolean;
  readonly find: () => Promise<void>;
};

export function useFindPieces(): FindPieces {
  const model = useStore((s) => s.project.device.cameraModel);
  const sourceState = useCameraStore((s) => s.sourceState);
  const pushToast = useToastStore((s) => s.pushToast);
  const captureLifetime = useCameraTraceLifetime();

  const find = async (): Promise<void> => {
    if (sourceState.kind !== 'live' || model === undefined) return;
    const scans = usePieceScanStore.getState();
    const isCurrent = captureLifetime();
    scans.setFinding(true);
    const raw = await captureSourceFrame(sourceState.source);
    // Let "Finding pieces…" paint before the search takes the thread.
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (!isCurrent()) {
      scans.setFinding(false);
      return;
    }
    if (raw === null) {
      scans.setFinding(false);
      pushToast('Could not capture a camera frame.', 'error');
      return;
    }
    const capture = cameraCaptureBindingForFrame(sourceState.source, raw.width, raw.height);
    const fitted = cameraModelForFrame(model, capture, raw.width, raw.height);
    if (fitted.kind === 'issue') {
      scans.setFinding(false);
      pushToast(fitted.message, 'error');
      return;
    }
    const { project, selectedObjectId, additionalSelectedIds } = useStore.getState();
    const camera = useCameraStore.getState();
    const { bedWidth, bedHeight } = project.device;
    const design = selectionFrame(project, selectedObjectId, additionalSelectedIds);
    const onBed =
      design !== null &&
      design.centre.x >= 0 &&
      design.centre.y >= 0 &&
      design.centre.x <= bedWidth &&
      design.centre.y <= bedHeight;
    const pieces = scanBedPieces({
      raw,
      lens: fitted.lens,
      pose: fitted.pose,
      bedWidthMm: bedWidth,
      bedHeightMm: bedHeight,
      surfaceHeightMm: camera.surfaceHeightMm,
      heightAreas: camera.heightAreas,
      reference: onBed ? design.centre : null,
    });
    if (pieces === null) {
      scans.setFinding(false);
      pushToast('Could not build the bed image from the camera frame.', 'error');
      return;
    }
    scans.setPieces(pieces);
    camera.setOverlayVisible(true);
  };

  return { available: sourceState.kind === 'live' && model !== undefined, find };
}
