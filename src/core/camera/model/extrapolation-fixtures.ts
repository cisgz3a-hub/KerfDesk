// Test support (ADR-441 Amendment 9): the default part-bed target (a 300 ×
// 200 mm sheet, 5 mm margin) photographed by a truth camera of another lens
// family than the fitted one, calibrated through the real chain, with the
// true overlay error off the target to hold the estimate against. Not
// shipped code.

import { savedMarkErrors } from './camera-model-accuracy';
import { projectWorldPoint } from './camera-model';
import type { CameraModelRecord } from './camera-model-record';
import { brownToBed, trueOverlayErrorMm, type BrownCamera } from './brown-truth-camera';
import { lookAt, wideLens } from './model-fixtures';
import { calibrateFromBedTarget } from '../target/bed-calibration';
import { bedTargetLayout } from '../target/bed-target';
import { renderTargetScene } from '../target/target-render-fixtures';

const SHEET_MM = 3;

/** A 1280 × 960 webcam with a Brown lens, 400 mm up over the back edge of the bed and aimed at its centre (camera audit v2 K1). */
export function centredWebcam(over: Partial<BrownCamera> = {}): BrownCamera {
  return {
    fx: 760,
    fy: 760,
    cx: 643,
    cy: 478,
    k1: -0.28,
    k2: 0.08,
    k3: -0.01,
    p1: 0.0008,
    p2: -0.0006,
    width: 1280,
    height: 960,
    pose: lookAt([200, 0, -400], [200, 200, 0]),
    ...over,
  };
}

/** A 1280 × 720 webcam with a Brown lens, 400 mm up and 90 mm behind the bed. */
export function brownWebcam(
  over: Partial<BrownCamera> & { readonly centreX?: number } = {},
): BrownCamera {
  const x = over.centreX ?? 200;
  return {
    fx: 640,
    fy: 640,
    cx: 640,
    cy: 360,
    k1: -0.25,
    k2: 0.07,
    k3: -0.008,
    p1: 0.001,
    p2: -0.0008,
    width: 1280,
    height: 720,
    pose: lookAt([x, -90, -400], [x, 200, 0]),
    ...over,
  };
}

export type TruthCalibration = {
  readonly record: CameraModelRecord;
  /** The true overlay error, worst over the bed the camera sees outside the target, mm. */
  readonly trueOffTargetMm: number;
  /** The true overlay error at each 10 mm grid point the camera sees outside the target. */
  readonly trueOffTarget: ReadonlyArray<{
    readonly x: number;
    readonly y: number;
    readonly mm: number;
  }>;
};

/** Calibrate `truth` on a `sheet` centred on a `bed`, as the wizard would. */
export function calibrateTruthCamera(
  truth: BrownCamera,
  sheet: { readonly width: number; readonly height: number } = { width: 300, height: 200 },
  bed: { readonly width: number; readonly height: number } = { width: 400, height: 400 },
): TruthCalibration {
  const sheetArea = {
    x: (bed.width - sheet.width) / 2,
    y: (bed.height - sheet.height) / 2,
    ...sheet,
  };
  const area = {
    x: sheetArea.x + 5,
    y: sheetArea.y + 5,
    width: sheet.width - 10,
    height: sheet.height - 10,
  };
  const layout = bedTargetLayout({ area });
  const frame = renderTargetScene({
    lens: wideLens(truth.width),
    pose: truth.pose,
    layout,
    sheet: sheetArea,
    sheetThicknessMm: SHEET_MM,
    noise: 2,
    toBed: brownToBed(truth),
  });
  const calibration = calibrateFromBedTarget({ frame, layout, sheetThicknessMm: SHEET_MM });
  if (calibration.kind !== 'ok') throw new Error(`calibration failed: ${calibration.reason}`);
  const record: CameraModelRecord = {
    version: 1,
    lens: calibration.lens,
    pose: calibration.pose,
    calibratedAt: '2026-11-10T00:00:00.000Z',
    accuracy: {
      rmsErrorMm: calibration.rmsErrorMm,
      maxErrorMm: calibration.maxErrorMm,
      foundMarks: calibration.foundMarks,
      expectedMarks: calibration.expectedMarks,
      targetHeightMm: SHEET_MM,
      targetArea: area,
      marks: savedMarkErrors(calibration.markErrors),
    },
  };
  let worst = 0;
  const trueOffTarget: Array<{ x: number; y: number; mm: number }> = [];
  for (let y = 0; y <= bed.height; y += 10) {
    for (let x = 0; x <= bed.width; x += 10) {
      const inside =
        x >= area.x && y >= area.y && x <= area.x + area.width && y <= area.y + area.height;
      if (inside) continue;
      const error = trueOverlayErrorMm(
        truth,
        (world) => projectWorldPoint(calibration.lens, calibration.pose, world),
        { x, y },
        SHEET_MM,
      );
      if (error === null) continue;
      worst = Math.max(worst, error);
      trueOffTarget.push({ x, y, mm: error });
    }
  }
  return { record, trueOffTargetMm: worst, trueOffTarget };
}
