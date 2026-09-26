// The two machine-facing steps of the camera calibration wizard (ADR-441):
// engrave the ring target through the normal Frame and Start path as a
// temporary job, and photograph it to fit the camera. The target covers the
// whole bed inside a margin, so engraving and photographing agree on where
// every ring is without the operator entering coordinates.

import { toGrayImage } from '../../../core/camera/gray';
import { warpFrameToBedImage } from '../../../core/camera/model/bed-image';
import { bedTargetLayout, type BedTargetArea } from '../../../core/camera/target/bed-target';
import { generateCameraBedTarget } from '../../../core/job/camera-bed-target-pattern';
import type { Project } from '../../../core/scene';
import { useStore } from '../../state';
import {
  cameraCaptureBindingForFrame,
  captureSourceFrame,
  type ActiveCameraSource,
} from '../frame-source';
import { calibrationFailureMessage, cameraModelFromCalibration } from './calibration-result';
import type { CalibrationResult, CalibrationSettings } from './camera-calibration-store';
import { runBedCalibration } from './run-bed-calibration';
import { runTransientCameraJob } from './transient-camera-job';

// The review picture only needs to show the rings clearly.
const REVIEW_PIXELS_PER_MM = 1;

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

/** Stream the target as a temporary job; true once it has started. */
export async function engraveCalibrationTarget(
  settings: CalibrationSettings,
  startTransientJob: (project: Project) => Promise<boolean> = runTransientCameraJob,
): Promise<boolean> {
  const { project } = useStore.getState();
  const pattern = generateCameraBedTarget({
    area: targetAreaForBed(project.device.bedWidth, project.device.bedHeight, settings.marginMm),
    power: settings.powerPercent,
    speed: settings.speedMmPerMin,
  });
  return startTransientJob({ ...project, scene: pattern.scene });
}

export type PhotoOutcome =
  | { readonly kind: 'ok'; readonly result: CalibrationResult }
  | { readonly kind: 'failed'; readonly message: string };

export async function photographTarget(args: {
  readonly source: ActiveCameraSource;
  readonly settings: CalibrationSettings;
  readonly bedWidthMm: number;
  readonly bedHeightMm: number;
  readonly signal?: AbortSignal;
  readonly now?: () => Date;
}): Promise<PhotoOutcome> {
  const { settings } = args;
  const raw = await captureSourceFrame(args.source);
  if (raw === null) {
    return { kind: 'failed', message: 'Could not take a photo. Check that the camera is running.' };
  }
  const layout = bedTargetLayout({
    area: targetAreaForBed(args.bedWidthMm, args.bedHeightMm, settings.marginMm),
  });
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
  const record = cameraModelFromCalibration({
    calibration: outcome,
    capture: cameraCaptureBindingForFrame(args.source, raw.width, raw.height),
    targetHeightMm: settings.sheetThicknessMm,
    calibratedAt: (args.now ?? (() => new Date()))(),
  });
  const bedImage = warpFrameToBedImage(raw, outcome.lens, outcome.pose, {
    bedWidthMm: args.bedWidthMm,
    bedHeightMm: args.bedHeightMm,
    pixelsPerMm: REVIEW_PIXELS_PER_MM,
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
    },
  };
}
