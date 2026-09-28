import { describe, expect, it } from 'vitest';
import { bedTargetLayout } from '../target/bed-target';
import { calibrateFromBedTarget } from '../target/bed-calibration';
import { renderTargetScene } from '../target/target-render-fixtures';
import { bedPoint, pixelToBed, projectWorldPoint, type LensModel } from './camera-model';
import type { CameraModelRecord } from './camera-model-record';
import { modelAtHead } from './head-camera';
import { lookAt, savedCameraModel } from './model-fixtures';

// A close-up camera on the head (ADR-449): 70 mm above the bed, looking
// straight down 3 mm right of and 2 mm in front of the beam.
const lens: LensModel = {
  intrinsics: { fx: 900, fy: 900, cx: 639.5, cy: 359.5 },
  distortion: [0.02, -0.01, 0, 0],
  imageWidth: 1280,
  imageHeight: 720,
};
const OFFSET = { x: 3, y: -2 };
const HEIGHT_MM = 70;
const SHEET_MM = 3;

function trueHeadPose(head: { x: number; y: number }) {
  const x = head.x + OFFSET.x;
  const y = head.y + OFFSET.y;
  return lookAt([x, y, -HEIGHT_MM], [x, y + 1e-3, 0]);
}

describe('calibrating a camera on the head from a small engraved target', () => {
  it('places the picture right wherever the head goes afterwards', () => {
    // A 40 mm target in the middle of a 400 × 300 bed, photographed from above it.
    const area = { x: 180, y: 130, width: 40, height: 40 };
    const layout = bedTargetLayout({ area });
    const calibrationHead = { x: 200, y: 150 };
    const frame = renderTargetScene({
      lens,
      pose: trueHeadPose(calibrationHead),
      layout,
      sheet: { x: 150, y: 100, width: 100, height: 100 },
      sheetThicknessMm: SHEET_MM,
      noise: 2,
    });
    const fit = calibrateFromBedTarget({
      frame,
      layout,
      sheetThicknessMm: SHEET_MM,
      measuredCameraHeightMm: HEIGHT_MM,
    });
    expect(fit.kind).toBe('ok');
    if (fit.kind !== 'ok') return;
    expect(fit.foundMarks).toBe(layout.marks.length);
    const record: CameraModelRecord = {
      ...savedCameraModel(),
      lens: fit.lens,
      pose: fit.pose,
      mount: { kind: 'head', headAtCalibrationMm: calibrationHead },
    };

    // Far from the target, the head camera still maps its picture to the bed.
    const head = { x: 80, y: 220 };
    const placed = modelAtHead(record, head);
    const truth = trueHeadPose(head);
    for (const [dx, dy] of [
      [0, 0],
      [-12, -8],
      [12, 8],
      [15, -9],
    ] as const) {
      const at = { x: head.x + OFFSET.x + dx, y: head.y + OFFSET.y + dy };
      const pixel = projectWorldPoint(lens, truth, bedPoint(at.x, at.y, SHEET_MM));
      const seen = pixelToBed(placed.lens, placed.pose, pixel ?? { x: 0, y: 0 }, SHEET_MM);
      expect(Math.hypot((seen?.x ?? NaN) - at.x, (seen?.y ?? NaN) - at.y)).toBeLessThan(0.1);
    }
  });
});
