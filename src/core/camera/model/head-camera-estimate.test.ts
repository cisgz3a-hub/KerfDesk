// Camera audit v2 K1-P3-1 (ADR-441 Amendment 12): a head camera calibrated
// on a small target read "0.00 / 0.01 mm" and graded good, while the middle
// 80 % of its picture, which the stitch uses, was up to 3.4 mm off on a
// tilted barrel lens. A Brown truth camera of the refuter's geometry,
// calibrated through the real chain, holds the band estimate to the truth.

import { describe, expect, it } from 'vitest';
import { bedMapper } from './camera-model';
import { brownToBed } from './brown-truth-camera';
import { calibrateTruthCamera } from './extrapolation-fixtures';
import { GOOD_EXTRAPOLATED_MM } from './extrapolation-estimate';
import { headCameraBandEstimateMm } from './head-camera-estimate';
import { HEAD_CAMERA_USABLE_FRACTION } from './head-camera';
import { lookAt } from './model-fixtures';

// The auditor's head target: a 40 mm square of 20 rings on a 60 mm sheet.
const HEAD_TARGET = { marginMm: 10, ringMm: 10 };
const UP_MM = 70;
const TILT = (8.5 * Math.PI) / 180;
const truth = {
  fx: 760,
  fy: 761,
  cx: 642,
  cy: 477,
  k1: -0.3,
  k2: 0.09,
  k3: -0.01,
  p1: 0.0006,
  p2: -0.0004,
  width: 1280,
  height: 960,
  pose: lookAt([200, 200 - UP_MM * Math.tan(TILT), -UP_MM], [200, 200, 0]),
};

describe('headCameraBandEstimateMm', () => {
  it('estimates the band the stitch uses at two thirds of the truth or more', () => {
    const { record: fixed } = calibrateTruthCamera(
      truth,
      { width: 60, height: 60 },
      undefined,
      HEAD_TARGET,
    );
    const record = {
      ...fixed,
      mount: { kind: 'head' as const, headAtCalibrationMm: { x: 170, y: 200 } },
    };
    // The truth over the band: where the saved model puts each pixel, against where it is.
    const height = record.accuracy.targetHeightMm;
    const saved = bedMapper(record.lens, record.pose);
    const real = brownToBed(truth);
    const margin = (1 - HEAD_CAMERA_USABLE_FRACTION) / 2;
    let worst = 0;
    for (let v = margin * 959; v <= (1 - margin) * 959; v += 16) {
      for (let u = margin * 1279; u <= (1 - margin) * 1279; u += 16) {
        const said = saved({ x: u, y: v }, height);
        const is = real({ x: u, y: v }, height);
        if (said !== null && is !== null)
          worst = Math.max(worst, Math.hypot(is.x - said.x, is.y - said.y));
      }
    }
    // The rings say all is well; the band is not.
    expect(record.accuracy.maxErrorMm).toBeLessThan(0.1);
    expect(worst).toBeGreaterThan(GOOD_EXTRAPOLATED_MM);
    const estimate = headCameraBandEstimateMm(record);
    expect(estimate ?? 0).toBeGreaterThan(GOOD_EXTRAPOLATED_MM);
    expect(estimate ?? 0).toBeGreaterThan(0.66 * worst);
  }, 90_000);

  it('makes none for a fixed camera', () => {
    const { record } = calibrateTruthCamera(
      truth,
      { width: 60, height: 60 },
      undefined,
      HEAD_TARGET,
    );
    expect(headCameraBandEstimateMm(record)).toBeNull();
  }, 90_000);
});
