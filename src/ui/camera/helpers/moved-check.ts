// "Camera moved?" (ADR-663 Amendment 3): a picture from the running camera,
// compared over the view around the bed with the reference kept when its
// calibration was last known good. A confident shift of a millimetre or more
// at the middle of the bed is a warning in the Camera panel, with the quick
// nudge fix and Check camera one click away. It never blocks anything, and a
// view it cannot match well enough, or a camera on the laser head, says nothing.

import { create } from 'zustand';
import { isHeadCameraModel } from '../../../core/camera/model/head-camera';
import { bedPoint, projectWorldPoint, type Vec2 } from '../../../core/camera/model/camera-model';
import type { CameraModelRecord } from '../../../core/camera/model/camera-model-record';
import {
  measureViewShift,
  MIN_MATCH_SCORE,
  MOVED_MM,
  surroundMask,
  viewShiftOnBedOffsetMm,
  viewThumbnail,
} from '../../../core/camera/model/view-shift';
import type { RgbaImage } from '../../../core/camera/rgba-image';
import { useStore } from '../../state';
import { useCameraStore } from '../../state/camera-store';
import { useToastStore } from '../../state/toast-store';
import { activeCameraModelNow, ownCameraModel } from '../active-camera-model';
import { cameraModelForFrame } from '../camera-model-frame';
import {
  cameraCaptureBindingForFrame,
  captureSourceFrame,
  type ActiveCameraSource,
} from '../frame-source';
import { loadViewReference, saveViewReference } from './view-reference';

export type CameraMovedState =
  | { readonly kind: 'unknown' }
  | { readonly kind: 'steady' }
  | {
      readonly kind: 'moved';
      readonly mm: number;
      readonly offsetMm: Vec2;
      readonly calibratedAt: string;
    };

/** The warning the operator dismissed: its calibration and measured shift. */
export type CameraMovedDismissal = { readonly calibratedAt: string; readonly offsetMm: Vec2 };

type CameraMovedStore = {
  readonly state: CameraMovedState;
  readonly dismissedFor: CameraMovedDismissal | null;
  readonly dismiss: () => void;
};

export const useCameraMovedStore = create<CameraMovedStore>((set, get) => ({
  state: { kind: 'unknown' },
  dismissedFor: null,
  dismiss: () => {
    const { state } = get();
    set({
      dismissedFor:
        state.kind === 'moved'
          ? { calibratedAt: state.calibratedAt, offsetMm: state.offsetMm }
          : null,
    });
  },
}));

/** A dismissed warning stays quiet while the camera stays where it was then:
 * the same calibration, and not moved a further millimetre or more. A view
 * confirmed steady since (a nudge fix, a kept check) ends the dismissal, so
 * the next move warns again. */
export function cameraMovedWarningDismissed(
  state: CameraMovedState,
  dismissedFor: CameraMovedDismissal | null,
): boolean {
  return (
    state.kind === 'moved' &&
    dismissedFor !== null &&
    dismissedFor.calibratedAt === state.calibratedAt &&
    movedDistanceMm(state.offsetMm, dismissedFor.offsetMm) < MOVED_MM
  );
}

function movedDistanceMm(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

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
  const forFrame = cameraModelForFrame(model, binding, frame.width, frame.height);
  if (forFrame.kind === 'issue') return publish(unknown);
  const current = viewThumbnail(frame, reference.width);
  if (current.height !== reference.height) return publish(unknown);
  const { bedWidth, bedHeight } = useStore.getState().project.device;
  const mask = surroundMask({
    lens: forFrame.lens,
    pose: forFrame.pose,
    thumbWidth: current.width,
    thumbHeight: current.height,
    bedWidthMm: bedWidth,
    bedHeightMm: bedHeight,
  });
  const shift = measureViewShift(reference, current, mask);
  if (shift === null || shift.score < MIN_MATCH_SCORE) return publish(unknown);
  const bedCentreMm = { x: bedWidth / 2, y: bedHeight / 2 };
  const centrePx = projectWorldPoint(
    forFrame.lens,
    forFrame.pose,
    bedPoint(bedCentreMm.x, bedCentreMm.y),
  );
  if (centrePx === null) return publish(unknown);
  const offsetMm = viewShiftOnBedOffsetMm({
    lens: forFrame.lens,
    pose: forFrame.pose,
    thumbWidth: current.width,
    thumbHeight: current.height,
    bedCentreMm,
    centrePx,
    shift,
  });
  if (offsetMm === null) return publish(unknown);
  const mm = Math.hypot(offsetMm.x, offsetMm.y);
  return publish(
    mm >= MOVED_MM ? { kind: 'moved', mm, offsetMm, calibratedAt: own.calibratedAt } : steady,
  );
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
  publish(steady);
}

/** The view was just confirmed good (a calibration saved, a check kept). */
export function markCameraSteady(): void {
  publish(steady);
}

const unknown: CameraMovedState = { kind: 'unknown' };
const steady: CameraMovedState = { kind: 'steady' };

function publish(state: CameraMovedState): CameraMovedState {
  const before = useCameraMovedStore.getState();
  useCameraMovedStore.setState(state.kind === 'steady' ? { state, dismissedFor: null } : { state });
  // Say it once, where the operator is, when the panel is closed.
  // Re-arm as the dismissal ends, even across several smaller shifts.
  if (
    state.kind === 'moved' &&
    (before.state.kind !== 'moved' ||
      cameraMovedWarningDismissed(before.state, before.dismissedFor) ||
      movedDistanceMm(before.state.offsetMm, state.offsetMm) >= MOVED_MM) &&
    !cameraMovedWarningDismissed(state, before.dismissedFor) &&
    !useCameraStore.getState().panelOpen
  ) {
    useToastStore
      .getState()
      .pushToast(
        `The camera may have moved, by about ${state.mm.toFixed(1)} mm. Open Camera to fix it.`,
        'warning',
        { key: 'camera-moved' },
      );
  }
  return state;
}
