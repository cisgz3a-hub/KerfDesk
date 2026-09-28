// The two machine-facing steps of the camera calibration wizard (ADR-441):
// engrave the ring target through the normal Frame and Start path as a
// temporary job, and photograph it to fit the camera. The target covers the
// whole bed inside a margin, so engraving and photographing agree on where
// every ring is without the operator entering coordinates. A camera on the
// laser head (ADR-449) sees a small patch of the bed, so its target is a small
// square in the middle of the bed, and the photo records where the head was.

import { toGrayImage } from '../../../core/camera/gray';
import { warpFrameToBedImage } from '../../../core/camera/model/bed-image';
import type { BedArea } from '../../../core/camera/model/camera-model-accuracy';
import type { CameraModelRecord } from '../../../core/camera/model/camera-model-record';
import { isHeadCameraModel, modelAtHead } from '../../../core/camera/model/head-camera';
import { bedTargetLayout, type BedTargetArea } from '../../../core/camera/target/bed-target';
import { generateCameraBedTarget } from '../../../core/job/camera-bed-target-pattern';
import type { Project, Vec2 } from '../../../core/scene';
import { useStore } from '../../state';
import {
  cameraCaptureBindingForFrame,
  captureSourceFrame,
  type ActiveCameraSource,
} from '../frame-source';
import { calibrationFailureMessage, cameraModelFromCalibration } from './calibration-result';
import type { CalibrationResult, CalibrationSettings } from './camera-calibration-store';
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

/** Where the calibration target goes: the whole bed, or a head camera's small square. */
export function calibrationTargetArea(
  bedWidthMm: number,
  bedHeightMm: number,
  settings: Pick<CalibrationSettings, 'marginMm' | 'headCamera' | 'headTargetSizeMm'>,
): BedTargetArea {
  if (!settings.headCamera) return targetAreaForBed(bedWidthMm, bedHeightMm, settings.marginMm);
  const size = Math.min(settings.headTargetSizeMm, bedWidthMm, bedHeightMm);
  return { x: (bedWidthMm - size) / 2, y: (bedHeightMm - size) / 2, width: size, height: size };
}

/** Stream the target as a temporary job; true once it has started. */
export async function engraveCalibrationTarget(
  settings: CalibrationSettings,
  startTransientJob: (project: Project) => Promise<boolean> = runTransientCameraJob,
): Promise<boolean> {
  const { project } = useStore.getState();
  const pattern = generateCameraBedTarget({
    area: calibrationTargetArea(project.device.bedWidth, project.device.bedHeight, settings),
    power: settings.powerPercent,
    speed: settings.speedMmPerMin,
  });
  // A laser engraving in either canvas mode (ADR-416): the rings mark where
  // the laser fires, and the wizard's power and speed are laser settings.
  return startTransientJob({ ...project, machine: { kind: 'laser' }, scene: pattern.scene });
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
  /** The calibration saved before this photo, to measure on it. */
  readonly saved?: CameraModelRecord;
  /** The head's bed position now, for a camera on the head; null when unknown. */
  readonly headMm?: Vec2 | null;
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
  const layout = bedTargetLayout({ area });
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
    return { kind: 'failed', message: calibrationFailureMessage(outcome.reason) };
  }
  const capture = cameraCaptureBindingForFrame(args.source, raw.width, raw.height);
  const record = cameraModelFromCalibration({
    calibration: outcome,
    capture,
    targetHeightMm: settings.sheetThicknessMm,
    targetArea: area,
    calibratedAt: (args.now ?? (() => new Date()))(),
    headAtCalibrationMm: head,
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
  const bedImage = warpFrameToBedImage(raw, outcome.lens, outcome.pose, {
    ...reviewArea(args, area, head !== null),
    surfaceHeightMm: settings.sheetThicknessMm,
  });
  return {
    kind: 'ok',
    result: {
      record,
      markErrors: outcome.markErrors,
      bedImage,
      cameraHeightSigmaMm: outcome.cameraHeightSigmaMm,
      usedMeasuredHeight: settings.cameraHeightMm !== null,
      savedCheck,
    },
  };
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
