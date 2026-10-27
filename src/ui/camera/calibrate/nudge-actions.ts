// The quick nudge fix's actions (ADR-663 Amendment 2): burn one ring in the
// middle of the bed as a temporary job, find it in a new photo, and move the
// saved camera so its picture shows the ring where the laser burned it. Only a
// camera fixed above the bed is nudged: a head camera's picture is placed by
// where the head is (ADR-449), and its own Check measures it there.

import {
  cameraBedFrameNote,
  type CameraBedFrame,
} from '../../../core/camera/model/camera-bed-frame';
import { isHeadCameraModel } from '../../../core/camera/model/head-camera';
import type { Vec2 } from '../../../core/camera/model/camera-model';
import {
  measureNudge,
  nudgedCameraModel,
  nudgeRingBeforeBedWasKnown,
  withUnknownNativeOffset,
  type NudgeMeasure,
} from '../../../core/camera/model/nudge';
import { withSavedCameraModel } from '../../../core/camera/model/saved-cameras';
import { toGrayImage } from '../../../core/camera/gray';
import { detectRingMarks } from '../../../core/camera/target/ring-detect';
import { generateCameraNudgeRing } from '../../../core/job/camera-bed-target-pattern';
import type { Project } from '../../../core/scene';
import { useStore } from '../../state';
import { useCameraStore } from '../../state/camera-store';
import { activeCameraModelNow, ownCameraModel } from '../active-camera-model';
import { cameraBedFrameNow } from '../camera-bed-frame-now';
import { cameraModelForFrame } from '../camera-model-frame';
import {
  cameraCaptureBindingForFrame,
  captureSourceFrame,
  type ActiveCameraSource,
} from '../frame-source';
import { markCameraSteady } from '../helpers/moved-check';
import { saveViewReference } from '../helpers/view-reference';
import { viewThumbnail } from '../../../core/camera/model/view-shift';
import { refreshCameraPicture } from '../helpers/refresh-picture';
import type { CalibrationSettings } from './camera-calibration-store';
import { runTransientCameraJob } from './transient-camera-job';

/** Where the nudge ring burns: the middle of the bed, scene millimetres. */
export function nudgeRingCentre(): Vec2 {
  const { bedWidth, bedHeight } = useStore.getState().project.device;
  return { x: bedWidth / 2, y: bedHeight / 2 };
}

export async function engraveNudgeRing(
  settings: CalibrationSettings,
  startTransientJob: (project: Project) => Promise<boolean> = runTransientCameraJob,
): Promise<boolean> {
  const { project } = useStore.getState();
  // A laser engraving in either canvas mode, as the calibration target (ADR-416).
  return startTransientJob({
    ...project,
    machine: { kind: 'laser' },
    scene: generateCameraNudgeRing({
      centre: nudgeRingCentre(),
      // The calibration's ring size: the size this camera was shown it can find.
      ringDiameterMm: settings.ringDiameterMm,
      power: settings.powerPercent,
      speed: settings.speedMmPerMin,
    }),
  });
}

export type NudgePhotoOutcome =
  | {
      readonly kind: 'ok';
      readonly offsetMm: Vec2;
      /** The ring was burned before the bed position was known (nudgeRingBeforeBedWasKnown). */
      readonly ringBedUnknown?: true;
    }
  | { readonly kind: 'failed'; readonly message: string };

/** Find the burned ring in a new photo and say how far the picture is from it. */
export async function photographNudgeRing(args: {
  readonly source: ActiveCameraSource;
  readonly sheetThicknessMm: number;
  /** The bed frame as the ring started burning; the frame now for a ring burned earlier. */
  readonly ringBedFrame?: CameraBedFrame;
  readonly capture?: typeof captureSourceFrame;
  readonly signal?: AbortSignal;
}): Promise<NudgePhotoOutcome> {
  const model = activeCameraModelNow();
  if (model === undefined || isHeadCameraModel(model)) {
    return {
      kind: 'failed',
      message:
        unusableCalibrationReason() ?? 'This fix needs a calibrated camera fixed above the bed.',
    };
  }
  const burnedAtMm = nudgeRingCentre();
  const frame = await (args.capture ?? captureSourceFrame)(args.source).catch(() => null);
  if (args.signal?.aborted) return { kind: 'failed', message: 'The photo was cancelled.' };
  if (frame === null) return { kind: 'failed', message: 'The camera picture could not be read.' };
  const binding = cameraCaptureBindingForFrame(args.source, frame.width, frame.height);
  const forFrame = cameraModelForFrame(model, binding, frame.width, frame.height);
  if (forFrame.kind === 'issue') return { kind: 'failed', message: forFrame.message };
  const measure = measureNudge({
    lens: forFrame.lens,
    pose: forFrame.pose,
    rings: detectRingMarks(toGrayImage(frame)),
    burnedAtMm,
    heightMm: args.sheetThicknessMm,
  });
  const ringBedUnknown = nudgeRingBeforeBedWasKnown(
    model.bedFrame,
    args.ringBedFrame ?? cameraBedFrameNow(),
  );
  return nudgeOutcome(measure, ringBedUnknown);
}

function nudgeOutcome(measure: NudgeMeasure, ringBedUnknown: boolean): NudgePhotoOutcome {
  switch (measure.kind) {
    case 'found':
      return {
        kind: 'ok',
        offsetMm: measure.offsetMm,
        ...(ringBedUnknown ? { ringBedUnknown: true as const } : {}),
      };
    case 'ambiguous':
      return {
        kind: 'failed',
        message: `There are ${measure.rings} rings near the middle of the bed, so KerfDesk cannot tell which one it burned. Burn the ring on a clean piece of scrap with no old target on it.`,
      };
    case 'not-found':
      return {
        kind: 'failed',
        message:
          'No ring was found near the middle of the bed. Check that the ring burned dark enough, the head is not over it, and the sheet thickness is right, then take the photo again.',
      };
  }
}

// Why the running camera's own calibration is not used in the bed frame now
// (another origin corner, or no frame recorded), so the fix says that instead.
function unusableCalibrationReason(): string | null {
  const { sourceState } = useCameraStore.getState();
  const own = ownCameraModel(useStore.getState().project.device, sourceState);
  const note = own === undefined ? null : cameraBedFrameNote(own, cameraBedFrameNow());
  return note !== null && !note.usable ? note.message : null;
}

/**
 * Move the running camera's saved calibration by `offsetMm` (one undo step)
 * and show a fresh picture with it. A ring burned before the bed position was
 * known leaves the calibration flagged as such (ADR-440 Amendment 5). False
 * when there is no such calibration.
 */
export function applyNudge(offsetMm: Vec2, ringBedUnknown = false): boolean {
  const { project, updateDeviceProfile } = useStore.getState();
  const { sourceState } = useCameraStore.getState();
  // Never another camera's calibration: with no camera running, "own" is just the newest.
  if (sourceState.kind !== 'live') return false;
  const own = ownCameraModel(project.device, sourceState);
  if (own === undefined || isHeadCameraModel(own)) return false;
  const moved = nudgedCameraModel(own, offsetMm);
  const nudged = ringBedUnknown ? withUnknownNativeOffset(moved) : moved;
  updateDeviceProfile(withSavedCameraModel(project.device, nudged));
  const owner = useStore.getState();
  // Keep the refreshed frame itself; a second asynchronous capture could
  // belong to a camera/document selected after this Fix.
  void refreshCameraPicture().then((outcome) => {
    const now = useStore.getState();
    const camera = useCameraStore.getState();
    if (
      outcome !== 'refreshed' ||
      now.projectDocumentEpoch !== owner.projectDocumentEpoch ||
      now.project.device !== owner.project.device ||
      camera.sourceState !== sourceState ||
      camera.overlayStill === null
    )
      return;
    saveViewReference(nudged, viewThumbnail(camera.overlayStill));
    markCameraSteady();
  });
  return true;
}
