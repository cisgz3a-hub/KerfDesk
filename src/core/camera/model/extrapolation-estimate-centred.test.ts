// Camera audit v2 K1-P1-1 and K1-P2-1 (ADR-441 Amendment 11). Ordinary
// centred webcams on the default sheet were graded "Accurate enough" with an
// estimate of 1.1-1.5 mm while the bed's near corners were 2.7-4.5 mm off,
// and a full-bed sheet 80 mm off-centre was graded fair at 4 mm while 0.4 mm
// off. Brown truth cameras of the audit's geometry, calibrated through the
// real chain, hold the estimate to its promise at every grid point.

import { describe, expect, it } from 'vitest';
import { calibrateTruthCamera, centredWebcam } from './extrapolation-fixtures';
import {
  estimateWithin,
  extrapolationEstimate,
  GOOD_EXTRAPOLATED_MM,
} from './extrapolation-estimate';
import { lookAt } from './model-fixtures';

// ADR-441 Amendment 9: the estimate is never under this share of the truth.
const LEAST_SHARE = 0.66;

describe('the estimate for centred webcams (K1-P1-1)', () => {
  it.each([
    ['a standard lens', centredWebcam()],
    ['a strong lens', centredWebcam({ k1: -0.36, k2: 0.13, k3: -0.02 })],
    [
      'a standard lens a little higher',
      centredWebcam({ pose: lookAt([200, 0, -410], [200, 200, 0]) }),
    ],
  ])(
    'warns wherever %s puts the bed more than 1.5 mm off, at two thirds of the truth or more',
    (_, truth) => {
      const { record, trueOffTarget, trueOffTargetMm } = calibrateTruthCamera(truth);
      // The rings alone say all is well, and the near corners are millimetres off.
      expect(record.accuracy.rmsErrorMm).toBeLessThan(0.25);
      expect(trueOffTargetMm).toBeGreaterThan(2);
      const estimate = extrapolationEstimate(record);
      if (estimate === null) throw new Error('expected an estimate');
      expect(estimate.worstMm).toBeGreaterThan(GOOD_EXTRAPOLATED_MM);
      const short = trueOffTarget
        .filter((point) => point.mm > GOOD_EXTRAPOLATED_MM)
        .map((point) => ({
          ...point,
          said:
            estimateWithin(estimate, {
              minX: point.x,
              minY: point.y,
              maxX: point.x,
              maxY: point.y,
            }) ?? 0,
        }))
        .filter(
          (point) => point.said <= GOOD_EXTRAPOLATED_MM || point.said < LEAST_SHARE * point.mm,
        );
      expect(short).toEqual([]);
    },
    90_000,
  );
});

describe('a full-bed sheet (K1-P2-1)', () => {
  it('keeps a camera 80 mm off-centre under the good limit', () => {
    const { record, trueOffTargetMm } = calibrateTruthCamera(
      centredWebcam({ pose: lookAt([280, 0, -410], [280, 200, 0]) }),
      { width: 400, height: 400 },
    );
    expect(trueOffTargetMm).toBeLessThan(1);
    expect(extrapolationEstimate(record)?.worstMm ?? 0).toBeLessThanOrEqual(GOOD_EXTRAPOLATED_MM);
  }, 90_000);
});
