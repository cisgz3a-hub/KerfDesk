// Rolling audit v13 Y1-P2-1 (ADR-441 Amendment 9): on the default part-bed
// sheet the rings read about 0.1 mm while the bed beyond them was
// millimetres off, and nothing estimated it. Truth cameras of another lens
// family than the fitted one, calibrated through the real chain, hold the
// estimate against the true error.

import { describe, expect, it } from 'vitest';
import { brownWebcam, calibrateTruthCamera } from './extrapolation-fixtures';
import {
  estimateWithin,
  extrapolationEstimate,
  GOOD_EXTRAPOLATED_MM,
} from './extrapolation-estimate';
import { lookAt } from './model-fixtures';

describe('extrapolationEstimate', () => {
  it.each([
    ['a centred webcam', brownWebcam()],
    ['a strong lens, centred', brownWebcam({ k1: -0.31, k2: 0.1, k3: -0.012 })],
    [
      'a strong lens 100 mm off-centre',
      brownWebcam({ k1: -0.31, k2: 0.1, k3: -0.012, centreX: 300 }),
    ],
    [
      'a wide pinhole 100 mm off-centre',
      brownWebcam({
        fx: 600,
        fy: 600,
        k1: 0,
        k2: 0,
        k3: 0,
        p1: 0,
        p2: 0,
        pose: lookAt([300, -60, -380], [300, 200, 0]),
      }),
    ],
  ])(
    'estimates the far bed for %s on the default sheet within about a factor of three',
    (_, truth) => {
      const { record, trueOffTargetMm } = calibrateTruthCamera(truth);
      // The rings alone say all is well.
      expect(record.accuracy.rmsErrorMm).toBeLessThan(0.25);
      // 1.4 to 7.8 mm in truth.
      expect(trueOffTargetMm).toBeGreaterThan(1);
      const estimate = extrapolationEstimate(record);
      expect(estimate).not.toBeNull();
      if (estimate === null) return;
      expect(estimate.worstMm).toBeGreaterThan(GOOD_EXTRAPOLATED_MM);
      expect(estimate.worstMm).toBeGreaterThan(0.6 * trueOffTargetMm);
      // A bound since Amendment 11: its floor may read up to about three times a mild lens.
      expect(estimate.worstMm).toBeLessThan(3 * trueOffTargetMm);
    },
    60_000,
  );

  it('keeps a sheet over the whole bed under the good limit', () => {
    const { record, trueOffTargetMm } = calibrateTruthCamera(brownWebcam(), {
      width: 400,
      height: 400,
    });
    expect(trueOffTargetMm).toBeLessThan(1);
    expect(extrapolationEstimate(record)?.worstMm ?? 0).toBeLessThanOrEqual(GOOD_EXTRAPOLATED_MM);
  }, 60_000);

  it('is small on the target and grows past it', () => {
    const { record } = calibrateTruthCamera(
      brownWebcam({ k1: -0.31, k2: 0.1, k3: -0.012, centreX: 300 }),
    );
    const estimate = extrapolationEstimate(record);
    if (estimate === null) throw new Error('expected an estimate');
    const area = record.accuracy.targetArea;
    if (area === undefined) throw new Error('expected a target area');
    const middle = { x: 200, y: 200 };
    expect(
      estimateWithin(estimate, { minX: middle.x, minY: middle.y, maxX: middle.x, maxY: middle.y }),
    ).toBeLessThan(1);
    expect(estimateWithin(estimate, { minX: 0, minY: 0, maxX: 40, maxY: 40 }) ?? 0).toBeGreaterThan(
      GOOD_EXTRAPOLATED_MM,
    );
  }, 60_000);

  it('makes none for a head camera or a calibration saved without its rings', () => {
    const { record } = calibrateTruthCamera(brownWebcam());
    expect(
      extrapolationEstimate({
        ...record,
        mount: { kind: 'head', headAtCalibrationMm: { x: 0, y: 0 } },
      }),
    ).toBeNull();
    const { marks: _marks, ...withoutRings } = record.accuracy;
    expect(extrapolationEstimate({ ...record, accuracy: withoutRings })).toBeNull();
  }, 60_000);
});
