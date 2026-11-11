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
//
// ADR-663 Amendment 6 (rolling audit v14 Z1-P2-1): the check needs only the
// picture's size and a small thumbnail of it. The thumbnail of a camera that
// has just started, or of a held picture, is made in the camera picture
// worker, and the two thumbnails are compared there too (185-290 ms in the
// window), so neither holds the UI thread while a job runs.

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
import { cameraCaptureBindingForFrame, type ActiveCameraSource } from '../frame-source';
import { pictureClient, type PictureClient } from '../picture-worker/camera-picture-client';
import { stillCompanion } from '../still-capture';
import {
  cameraMovedWarningDismissed,
  furthestChangeMm,
  useCameraMovedStore,
  type CameraMovedState,
} from './camera-moved-store';
import { loadViewReference } from './view-reference';

export {
  cameraMovedWarningDismissed,
  useCameraMovedStore,
  type CameraMovedDismissal,
  type CameraMovedState,
} from './camera-moved-store';

/** Weak or failed matches in a row before "the view no longer matches" is said. */
export const WEAK_CHECKS_FOR_CHANGED = 2;

/** A picture as the check sees it: its own size, and its thumbnail at a given width. */
export type FrameView = {
  readonly width: number;
  readonly height: number;
  readonly thumbnail: (width: number) => ViewThumbnail;
};

/** A picture's view; a thumbnail the worker already made for it is used as is. */
export function rgbaView(frame: RgbaImage): FrameView {
  return {
    width: frame.width,
    height: frame.height,
    thumbnail: (width) => {
      const made = stillCompanion(frame)?.thumbnail ?? null;
      return made !== null && made.width === width ? made : viewThumbnail(frame, width);
    },
  };
}

/** Width of the thumbnail the check compares for `source`, or null when it has no reference. */
export function movedCheckThumbWidth(source: ActiveCameraSource): number | null {
  const own = ownCameraModel(useStore.getState().project.device, { kind: 'live', source });
  if (own === undefined || isHeadCameraModel(own)) return null;
  return loadViewReference(own)?.width ?? null;
}

/** Compare `frame` from `source` with the running camera's reference. */
export function checkCameraMoved(source: ActiveCameraSource, frame: RgbaImage): CameraMovedState {
  return checkCameraMovedView(source, rgbaView(frame));
}

/** The same for a picture seen as `view`; null when no picture could be taken. */
export function checkCameraMovedView(
  source: ActiveCameraSource,
  view: FrameView | null,
): CameraMovedState {
  const prepared = prepareCheck(source, view);
  return 'kind' in prepared ? prepared : verdict(prepared.own, compareViews(prepared.compare));
}

/**
 * The same, with the thumbnails compared in the camera picture worker. A
 * verdict for a camera no longer running is dropped. Without the worker, or
 * when it fails, they are compared here, at once.
 */
export async function checkCameraMovedInWorker(
  source: ActiveCameraSource,
  view: FrameView | null,
  client: PictureClient | null = pictureClient(),
): Promise<CameraMovedState> {
  const prepared = prepareCheck(source, view);
  if ('kind' in prepared) return prepared;
  if (client === null) return verdict(prepared.own, compareViews(prepared.compare));
  const reply = await client.run({ op: 'compare-views', args: prepared.compare });
  const now = useCameraStore.getState().sourceState;
  if (now.kind !== 'live' || now.source !== source) return unknown;
  return verdict(
    prepared.own,
    reply.kind === 'views' ? reply.comparison : compareViews(prepared.compare),
  );
}

type PreparedCheck = {
  readonly own: CameraModelRecord;
  readonly compare: Parameters<typeof compareViews>[0];
};

// Everything up to the comparison, which is cheap: a state when there is
// nothing to compare.
function prepareCheck(
  source: ActiveCameraSource,
  view: FrameView | null,
): PreparedCheck | CameraMovedState {
  const own = ownCameraModel(useStore.getState().project.device, {
    kind: 'live',
    source,
  });
  const model = activeCameraModelNow();
  if (own === undefined || model === undefined || isHeadCameraModel(own)) return publish(unknown);
  const reference = loadViewReference(own);
  if (reference === null || view === null) return publish(unknown);
  const binding = cameraCaptureBindingForFrame(source, view.width, view.height);
  const current = view.thumbnail(reference.width);
  checkFrameRescale(model, binding, view, current, reference);
  const forFrame = cameraModelForFrame(model, binding, view.width, view.height);
  if (forFrame.kind === 'issue') return publish(unknown);
  if (current.height !== reference.height) return publish(unknown);
  const { bedWidth, bedHeight } = useStore.getState().project.device;
  return {
    own,
    compare: {
      reference,
      current,
      lens: forFrame.lens,
      pose: forFrame.pose,
      bedWidthMm: bedWidth,
      bedHeightMm: bedHeight,
    },
  };
}

function verdict(
  own: CameraModelRecord,
  outcome: ReturnType<typeof compareViews>,
): CameraMovedState {
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
  size: { readonly width: number; readonly height: number },
  current: ViewThumbnail,
  reference: ViewThumbnail,
): void {
  const { width, height } = size;
  if (width === model.lens.imageWidth && height === model.lens.imageHeight) return;
  if (frameRescaleVerdict(model, width, height) === 'resize') return;
  const measuring = cameraModelForFrame(model, binding, width, height, { rescale: 'measuring' });
  if (measuring.kind === 'issue') return;
  const { bedWidth, bedHeight } = useStore.getState().project.device;
  const verdict = frameRescaleFromView({
    reference,
    current,
    scaledLens: measuring.lens,
    pose: measuring.pose,
    bedWidthMm: bedWidth,
    bedHeightMm: bedHeight,
  });
  if (verdict !== null) recordFrameRescale(model, width, height, verdict);
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
