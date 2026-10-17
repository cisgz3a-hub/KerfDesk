import { describe, expect, it } from 'vitest';
import { cameraAuditHeldOutErrorMm } from '../../../__fixtures__/camera-audit-target';
import { wideLens, overheadPose } from '../../../core/camera/model/model-fixtures';
import { bedTargetLayout } from '../../../core/camera/target/bed-target';
import { renderTargetScene } from '../../../core/camera/target/target-render-fixtures';
import { calibrateFromBedTarget } from '../../../core/camera/target/bed-calibration';
import { targetLayoutMismatch } from '../../../core/camera/target/target-coverage';
import { cameraModelFromCalibration } from './calibration-result';

describe('camera audit synthetic photo qualification', () => {
  it.each([960, 1280])(
    'checks held-out bed coordinates independently at width %i',
    (width) => {
      const area = { x: 5, y: 5, width: 390, height: 390 };
      const lens = wideLens(width);
      const pose = overheadPose();
      const layout = bedTargetLayout({ area });
      const rendered = renderTargetScene({
        lens,
        pose,
        layout,
        sheet: area,
        sheetThicknessMm: 3,
        noise: 4,
      });
      // PNG/canvas capture rounds the synthetic floating pixels to 8-bit samples.
      const frame = { ...rendered, data: Float32Array.from(new Uint8ClampedArray(rendered.data)) };
      const result = calibrateFromBedTarget({ frame, layout, sheetThicknessMm: 3 });
      expect(result.kind).toBe('ok');
      if (result.kind !== 'ok') throw new Error('Synthetic fixture calibration failed');
      const record = cameraModelFromCalibration({
        calibration: result,
        capture: null,
        targetArea: area,
        targetHeightMm: 3,
        calibratedAt: new Date('2026-10-16T00:00:00Z'),
      });
      expect(cameraAuditHeldOutErrorMm(record, width)).toBeLessThan(0.4);
      if (width === 960)
        expect(targetLayoutMismatch(record)).toMatchObject({ foundCols: 10, foundRows: 9 });
      else {
        expect(targetLayoutMismatch(record)).toBeNull();
        expect(result.foundMarks).toBeGreaterThanOrEqual(95);
      }
    },
    20_000,
  );
});
