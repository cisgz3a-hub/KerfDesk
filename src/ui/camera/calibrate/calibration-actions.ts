// The two machine-facing steps of the camera calibration wizard (ADR-441):
// engrave the ring target through the normal Frame and Start path as a
// temporary job, and photograph it to fit the camera. The target covers the
// whole bed inside a margin, so engraving and photographing agree on where
// every ring is without the operator entering coordinates. A camera on the
// laser head (ADR-449) sees a small patch of the bed, so its target is a small
// square in the middle of the bed, and the photo records where the head was.
// The calibration records the bed frame the rings were placed in, so a later
// change of bed size, origin or native frame is noticed (rolling audit 12-P2-2).

import { toGrayImage } from '../../../core/camera/gray';
import { warpFrameToBedImage } from '../../../core/camera/model/bed-image';
import type { CameraBedFrame } from '../../../core/camera/model/camera-bed-frame';
import type { BedArea } from '../../../core/camera/model/camera-model-accuracy';
import type { CameraModelRecord } from '../../../core/camera/model/camera-model-record';
import { isHeadCameraModel, modelAtHead } from '../../../core/camera/model/head-camera';
import { viewThumbnail } from '../../../core/camera/model/view-shift';
import type { RgbaImage } from '../../../core/camera/rgba-image';
import type {
  BedCalibration,
  BedCalibrationFailure,
} from '../../../core/camera/target/bed-calibration';
import {
  bedTargetLayoutWithRings,
  type BedTargetArea,
} from '../../../core/camera/target/bed-target';
import { generateCameraBedTarget } from '../../../core/job/camera-bed-target-pattern';
import type { Project, Vec2 } from '../../../core/scene';
import { useStore } from '../../state';
import { useLaserStore } from '../../state/laser-store';
import { cameraBedFrameFor } from '../../state/native-bed-frame';
import {
  cameraCaptureBindingForFrame,
  captureSourceFrame,
  type ActiveCameraSource,
} from '../frame-source';
import {
  calibrationFailureMessage,
  cameraModelFromCalibration,
  ringsTooSmallMessage,
} from './calibration-result';
import type { CalibrationResult, CalibrationSettings } from './camera-calibration-store';
import { rememberEngravedTarget } from './engraved-target-memory';
import { runBedCalibration } from './run-bed-calibration';
import { checkSavedCalibration } from './saved-calibration-check';
import { runTransientCameraJob } from './transient-camera-job';

// The review picture only needs to show the rings clearly.
const REVIEW_PIXELS_PER_MM = 1;
const HEAD_REVIEW_PIXELS_PER_MM = 8;
export const HEAD_POSITION_NEEDED =
  'KerfDesk needs to know where the head is when the photo is taken: connect the machine, home it, and move the head over the target.';

export function targetAreaForBed(
  bedWidthMm: number,
  bedHeightMm: number,
  marginMm: number,
): BedTargetArea {
  const margin = Math.max(0, Math.min(marginMm, bedWidthMm / 4, bedHeightMm / 4));
  return {
    x: margin,
    y: margin,
    width: bedWidthMm - 2 * margin,
    height: bedHeightMm - 2 * margin,
  };
}

/**
 * Where the calibration target goes: the operator's sheet in the middle of
 * the bed, inside its margin (ADR-441 Amendment 8), or a head camera's small
 * square. A sheet larger than the bed covers the whole bed.
 */
export function calibrationTargetArea(
  bedWidthMm: number,
  bedHeightMm: number,
  settings: Pick<CalibrationSettings, 'marginMm' | 'headCamera' | 'headTargetSizeMm'> &
    Partial<Pick<CalibrationSettings, 'sheetWidthMm' | 'sheetHeightMm'>>,
): BedTargetArea {
  if (!settings.headCamera) {
    const sheetWidth = Math.min(settings.sheetWidthMm ?? bedWidthMm, bedWidthMm);
    const sheetHeight = Math.min(settings.sheetHeightMm ?? bedHeightMm, bedHeightMm);
    const onSheet = targetAreaForBed(sheetWidth, sheetHeight, settings.marginMm);
    return {
      ...onSheet,
      x: onSheet.x + (bedWidthMm - sheetWidth) / 2,
      y: onSheet.y + (bedHeightMm - sheetHeight) / 2,
    };
  }
  const size = Math.min(settings.headTargetSizeMm, bedWidthMm, bedHeightMm);
  return { x: (bedWidthMm - size) / 2, y: (bedHeightMm - size) / 2, width: size, height: size };
}

/** Stream the target as a temporary job; true once it has started. */
export async function engraveCalibrationTarget(
  settings: CalibrationSettings,
  startTransientJob: (project: Project) => Promise<boolean> = runTransientCameraJob,
): Promise<boolean> {
  const { project } = useStore.getState();
  const { device } = project;
  const bedFrame = cameraBedFrameFor(device, useLaserStore.getState());
  const area = calibrationTargetArea(device.bedWidth, device.bedHeight, settings);
  const pattern = targetPattern(area, settings);
  // A laser engraving in either canvas mode (ADR-416): the rings mark where
  // the laser fires, and the wizard's power and speed are laser settings.
  const started = await startTransientJob({
    ...project,
    machine: { kind: 'laser' },
    scene: pattern.scene,
  });
  // Remember where these rings went, so a later "Target already engraved"
  // labels them from this layout, not from whatever the settings say then.
  if (started) rememberTarget(device, settings, area, bedFrame, false);
  return started;
}

function targetPattern(area: BedTargetArea, settings: CalibrationSettings) {
  return generateCameraBedTarget({
    area,
    ringDiameterMm: settings.ringDiameterMm,
    power: settings.powerPercent,
    speed: settings.speedMmPerMin,
  });
}

// Remember where these rings went and how large they are, so a later "Target
// already engraved" labels them from this layout, not from whatever the
// settings say then.
function rememberTarget(
  device: Project['device'],
  settings: CalibrationSettings,
  area: BedTargetArea,
  bedFrame: CameraBedFrame,
  onCanvas: boolean,
): void {
  rememberEngravedTarget(device, settings.headCamera, {
    area,
    bedWidthMm: device.bedWidth,
    bedHeightMm: device.bedHeight,
    layoutMm: settings.headCamera ? settings.headTargetSizeMm : settings.marginMm,
    engravedAt: new Date().toISOString(),
    bedFrame,
    ringDiameterMm: settings.ringDiameterMm,
    ...(onCanvas ? { onCanvas: true as const } : {}),
  });
}

/**
 * Put the target on the canvas as the project's artwork (undoable), for an
 * operator who engraves it like any job: Frame, review and Start, or later
 * from another session. The rings are locked so a stray drag cannot move them
 * off the bed positions the photo will look for, and Start from becomes
 * Absolute Coordinates, the only mode that burns them there. The bed frame
 * remembered here stands only until a Start streams the rings, which takes
 * it again (canvas-target-burn.ts, ADR-440 Amendment 5).
 */
export function addCalibrationTargetToCanvas(settings: CalibrationSettings): void {
  const store = useStore.getState();
  const { device } = store.project;
  const area = calibrationTargetArea(device.bedWidth, device.bedHeight, settings);
  const pattern = targetPattern(area, settings);
  store.replaceSceneWithGeneratedScene({
    ...pattern.scene,
    objects: pattern.scene.objects.map((object) => ({ ...object, locked: true })),
  });
  if (store.jobPlacement.startFrom !== 'absolute') store.setJobPlacement({ startFrom: 'absolute' });
  rememberTarget(device, settings, area, cameraBedFrameFor(device, useLaserStore.getState()), true);
}

export type PhotoOutcome =
  | { readonly kind: 'ok'; readonly result: CalibrationResult }
  | { readonly kind: 'failed'; readonly message: string };

export async function photographTarget(args: {
  readonly source: ActiveCameraSource;
  readonly settings: CalibrationSettings;
  readonly bedWidthMm: number;
  readonly bedHeightMm: number;
  /** Where the target was engraved when that is known; else from the margin. */
  readonly area?: BedArea;
  /** The bed frame the target's rings were placed in; absent when unknown. */
  readonly bedFrame?: CameraBedFrame;
  /** The calibration saved before this photo, to measure on it. */
  readonly saved?: CameraModelRecord;
  /** The head's bed position now, in the target's bed frame, for a camera on the head; null when unknown. */
  readonly headMm?: Vec2 | null;
  /** The head's machine Z (mm) now, which the calibration holds at (ADR-449 Amendment 2). */
  readonly headZMm?: number | null;
  readonly signal?: AbortSignal;
  readonly now?: () => Date;
}): Promise<PhotoOutcome> {
  const { settings } = args;
  const head = settings.headCamera ? (args.headMm ?? null) : null;
  if (settings.headCamera && head === null)
    return { kind: 'failed', message: HEAD_POSITION_NEEDED };
  const raw = await captureSourceFrame(args.source);
  if (raw === null) {
    return { kind: 'failed', message: 'Could not take a photo. Check that the camera is running.' };
  }
  const area = args.area ?? calibrationTargetArea(args.bedWidthMm, args.bedHeightMm, settings);
  const layout = bedTargetLayoutWithRings(area, settings.ringDiameterMm);
  const outcome = await runBedCalibration(
    {
      frame: toGrayImage(raw),
      layout,
      sheetThicknessMm: settings.sheetThicknessMm,
      ...(settings.cameraHeightMm === null
        ? {}
        : { measuredCameraHeightMm: settings.cameraHeightMm }),
    },
    args.signal,
  );
  if (outcome.kind === 'failed') {
    return { kind: 'failed', message: photoFailureMessage(outcome, settings.ringDiameterMm) };
  }
  const capture = cameraCaptureBindingForFrame(args.source, raw.width, raw.height);
  const record = cameraModelFromCalibration({
    calibration: outcome,
    capture,
    targetHeightMm: settings.sheetThicknessMm,
    targetArea: area,
    targetRingDiameterMm: settings.ringDiameterMm,
    calibratedAt: (args.now ?? (() => new Date()))(),
    headAtCalibrationMm: head,
    headZAtCalibrationMm: args.headZMm ?? null,
    ...(args.bedFrame === undefined ? {} : { bedFrame: args.bedFrame }),
  });
  const savedCheck =
    args.saved === undefined
      ? null
      : checkSavedCalibration({
          saved: savedWhereTheHeadIs(args.saved, head),
          capture,
          frameWidth: raw.width,
          frameHeight: raw.height,
          marks: outcome.markErrors,
          targetHeightMm: settings.sheetThicknessMm,
        });
  return { kind: 'ok', result: reviewResult(raw, outcome, record, savedCheck, args, area, head) };
}

function photoFailureMessage(failure: BedCalibrationFailure, ringDiameterMm: number): string {
  return failure.reason === 'rings-too-small'
    ? ringsTooSmallMessage(failure.ringDiameterPx, ringDiameterMm)
    : calibrationFailureMessage(failure.reason);
}

// The result the wizard reviews: the record, the photo flattened onto the bed
// with what it covers, and how well the height and the saved model held.
function reviewResult(
  raw: RgbaImage,
  outcome: BedCalibration,
  record: CameraModelRecord,
  savedCheck: CalibrationResult['savedCheck'],
  args: {
    readonly settings: CalibrationSettings;
    readonly bedWidthMm: number;
    readonly bedHeightMm: number;
  },
  area: BedArea,
  head: Vec2 | null,
): CalibrationResult {
  const { settings } = args;
  const review = reviewArea(args, area, head !== null);
  const bedImage = warpFrameToBedImage(raw, outcome.lens, outcome.pose, {
    ...review,
    surfaceHeightMm: settings.sheetThicknessMm,
  });
  return {
    record,
    markErrors: outcome.markErrors,
    bedImage,
    bedImageRegion: review.region,
    cameraHeightSigmaMm: outcome.cameraHeightSigmaMm,
    usedMeasuredHeight: settings.cameraHeightMm !== null,
    savedCheck,
    ...fixedCameraView(settings, raw),
  };
}

// The photo's whole view, kept for the "camera moved?" check (ADR-663
// Amendment 3). A head camera sees another patch at every stop, so keeps none.
function fixedCameraView(
  settings: CalibrationSettings,
  raw: RgbaImage,
): Pick<CalibrationResult, 'viewReference'> {
  return settings.headCamera ? {} : { viewReference: viewThumbnail(raw) };
}

// A head camera's saved calibration, placed where the head took this photo.
function savedWhereTheHeadIs(saved: CameraModelRecord, head: Vec2 | null): CameraModelRecord {
  return head !== null && isHeadCameraModel(saved) ? modelAtHead(saved, head) : saved;
}

// The review picture: the whole bed, or for a head camera the target with as
// much again around it, in more detail.
function reviewArea(
  bed: { readonly bedWidthMm: number; readonly bedHeightMm: number },
  area: BedArea,
  headCamera: boolean,
): { readonly region: BedArea; readonly pixelsPerMm: number } {
  if (!headCamera) {
    return {
      region: { x: 0, y: 0, width: bed.bedWidthMm, height: bed.bedHeightMm },
      pixelsPerMm: REVIEW_PIXELS_PER_MM,
    };
  }
  return {
    region: {
      x: area.x - area.width / 2,
      y: area.y - area.height / 2,
      width: area.width * 2,
      height: area.height * 2,
    },
    pixelsPerMm: HEAD_REVIEW_PIXELS_PER_MM,
  };
}
