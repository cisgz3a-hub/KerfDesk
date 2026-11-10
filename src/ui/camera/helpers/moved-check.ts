// "Camera moved?" (ADR-663 Amendments 3 and 5): a picture from the running
// camera, compared over the view around the bed with the reference kept when
// its calibration was last known good. Each patch of that surround is matched
// on its own and their moves are fitted on the bed, so a camera that turned or
// tipped is measured as well as one that slid; a point of the bed a millimetre
// or more off is a warning in the Camera panel, with the quick nudge fix and
// Check camera one click away, and in Job Review while camera placement is on.
// A view that no longer matches at all, check after check, warns that the
// camera may have moved. A warning stays until the view is confirmed where it
// was or the operator dismisses it. It never blocks anything; a camera on the
// laser head is not checked.

import { isHeadCameraModel } from '../../../core/camera/model/head-camera';
import type { CameraModelRecord } from '../../../core/camera/model/camera-model-record';
import { compareViews } from '../../../core/camera/model/view-motion';
import { MOVED_MM, viewThumbnail, type ViewThumbnail } from '../../../core/camera/model/view-shift';
import type { RgbaImage } from '../../../core/camera/rgba-image';
import { useStore } from '../../state';
import { useCameraStore } from '../../state/camera-store';
import { useToastStore } from '../../state/toast-store';
import { activeCameraModelNow, ownCameraModel } from '../active-camera-model';
import { cameraModelForFrame } from '../camera-model-frame';
import {
  frameRescaleFromView,
  frameRescaleVerdict,
  recordFrameRescale,
} from '../frame-rescale-check';
import {
  cameraCaptureBindingForFrame,
  captureSourceFrame,
  type ActiveCameraSource,
} from '../frame-source';
import {
  cameraMovedWarningDismissed,
  furthestChangeMm,
  useCameraMovedStore,
  type CameraMovedState,
} from './camera-moved-store';
import { loadViewReference, saveViewReference } from './view-reference';

export {
  cameraMovedWarningDismissed,
  useCameraMovedStore,
  type CameraMovedDismissal,
  type CameraMovedState,
} from './camera-moved-store';

/** Weak or failed matches in a row before "the view no longer matches" is said. */
export const WEAK_CHECKS_FOR_CHANGED = 2;

/** Compare `frame` from `source` with the running camera's reference. */
export function checkCameraMoved(source: ActiveCameraSource, frame: RgbaImage): CameraMovedState {
  const own = ownCameraModel(useStore.getState().project.device, {
    kind: 'live',
    source,
  });
  const model = activeCameraModelNow();
  if (own === undefined || model === undefined || isHeadCameraModel(own)) return publish(unknown);
  const reference = loadViewReference(own);
  if (reference === null) return publish(unknown);
  const binding = cameraCaptureBindingForFrame(source, frame.width, frame.height);
  checkFrameRescale(model, binding, frame, reference);
  const forFrame = cameraModelForFrame(model, binding, frame.width, frame.height);
  if (forFrame.kind === 'issue') return publish(unknown);
  const current = viewThumbnail(frame, reference.width);
  if (current.height !== reference.height) return publish(unknown);
  const { bedWidth, bedHeight } = useStore.getState().project.device;
  const outcome = compareViews({
    reference,
    current,
    lens: forFrame.lens,
    pose: forFrame.pose,
    bedWidthMm: bedWidth,
    bedHeightMm: bedHeight,
  });
  if (outcome.kind === 'none') return publish(unknown);
  if (outcome.kind === 'weak') return publishWeak(own);
  useCameraMovedStore.setState({ weakChecks: 0 });
  return publish(
    outcome.worstMm >= MOVED_MM
      ? {
          kind: 'moved',
          mm: outcome.worstMm,
          displacementsMm: outcome.displacementsMm,
          calibratedAt: own.calibratedAt,
        }
      : steady,
  );
}

// A picture of another size than the calibration's is compared with the kept
// view first (ADR-440 Amendment 9): only a resize is placed with the lens
// scaled to it.
function checkFrameRescale(
  model: CameraModelRecord,
  binding: ReturnType<typeof cameraCaptureBindingForFrame>,
  frame: RgbaImage,
  reference: ViewThumbnail,
): void {
  const { width, height } = frame;
  if (width === model.lens.imageWidth && height === model.lens.imageHeight) return;
  if (frameRescaleVerdict(model, width, height) === 'resize') return;
  const measuring = cameraModelForFrame(model, binding, width, height, { rescale: 'measuring' });
  if (measuring.kind === 'issue') return;
  const { bedWidth, bedHeight } = useStore.getState().project.device;
  const verdict = frameRescaleFromView({
    reference,
    frame,
    scaledLens: measuring.lens,
    pose: measuring.pose,
    bedWidthMm: bedWidth,
    bedHeightMm: bedHeight,
  });
  if (verdict !== null) recordFrameRescale(model, width, height, verdict);
}

/** Take a picture now and keep it as the camera's reference for `record`. */
export async function rememberCameraView(
  record: CameraModelRecord,
  capture: typeof captureSourceFrame = captureSourceFrame,
): Promise<void> {
  const { sourceState } = useCameraStore.getState();
  if (sourceState.kind !== 'live' || isHeadCameraModel(record)) return;
  const frame = await capture(sourceState.source).catch(() => null);
  if (frame === null) return;
  saveViewReference(record, viewThumbnail(frame));
  markCameraSteady();
}

/** The view was just confirmed good (a calibration saved, a check kept). */
export function markCameraSteady(): void {
  useCameraMovedStore.setState({ weakChecks: 0 });
  publish(steady);
}

const unknown: CameraMovedState = { kind: 'unknown' };
const steady: CameraMovedState = { kind: 'steady' };

// One weak match may be a hand or a clamp in the way; the same again says the
// view itself has changed. A measured move already showing is kept.
function publishWeak(own: CameraModelRecord): CameraMovedState {
  const weakChecks = useCameraMovedStore.getState().weakChecks + 1;
  useCameraMovedStore.setState({ weakChecks });
  if (weakChecks < WEAK_CHECKS_FOR_CHANGED) return publish(unknown);
  const { state } = useCameraMovedStore.getState();
  if (state.kind === 'moved' && state.calibratedAt === own.calibratedAt) return state;
  return publish({ kind: 'changed', calibratedAt: own.calibratedAt });
}

function publish(next: CameraMovedState): CameraMovedState {
  const before = useCameraMovedStore.getState();
  // Not knowing never withdraws a warning that is showing.
  if (
    next.kind === 'unknown' &&
    (before.state.kind === 'moved' || before.state.kind === 'changed')
  ) {
    return before.state;
  }
  useCameraMovedStore.setState(
    next.kind === 'steady' ? { state: next, dismissedFor: null } : { state: next },
  );
  toastIfNew(before.state, before.dismissedFor, next);
  return next;
}

// Say it once, where the operator is, when the panel is closed. Re-arm as the
// dismissal ends, even across several smaller shifts.
function toastIfNew(
  before: CameraMovedState,
  dismissedFor: Parameters<typeof cameraMovedWarningDismissed>[1],
  next: CameraMovedState,
): void {
  if (next.kind !== 'moved' && next.kind !== 'changed') return;
  if (cameraMovedWarningDismissed(next, dismissedFor) || useCameraStore.getState().panelOpen)
    return;
  const isNew =
    next.kind === 'changed'
      ? before.kind !== 'changed'
      : before.kind !== 'moved' ||
        cameraMovedWarningDismissed(before, dismissedFor) ||
        furthestChangeMm(before.displacementsMm, next.displacementsMm) >= MOVED_MM;
  if (!isNew) return;
  useToastStore
    .getState()
    .pushToast(
      next.kind === 'changed'
        ? 'The camera may have moved: what it sees around the bed no longer matches its calibration. Open Camera to check it.'
        : `The camera may have moved: the picture may be up to about ${next.mm.toFixed(1)} mm off. Open Camera to fix it.`,
      'warning',
      { key: 'camera-moved' },
    );
}
