import { describe, expect, it } from 'vitest';
import type { BoxSpec } from '../../core/box';
import { estimateBoxWork } from '../../core/box/box-work-estimate';
import {
  BOX_LARGE_DESIGN_POINT_ADVISORY_THRESHOLD,
  boxEstimateIsLarge,
} from './box-preview-responsiveness';

const RELIEF_HEAVY_SPEC: BoxSpec = {
  widthMm: 300,
  depthMm: 300,
  heightMm: 150,
  dimensionMode: 'inner',
  thicknessMm: 3,
  targetFingerWidthMm: 3,
  style: 'closed',
  clearanceMm: 0,
  relief: { kind: 'corner-overcut', toolDiameterMm: 1.5 },
  partSpacingMm: 8,
};

describe('box preview responsiveness', () => {
  it('classifies relief-heavy clipper input as large before exact output metrics arrive', () => {
    const estimate = estimateBoxWork(RELIEF_HEAVY_SPEC);

    expect(estimate.nominalPointUpper).toBe(4_030);
    expect(estimate.reliefBooleanInputVertexUpper).toBe(100_750);
    expect(estimate.nominalPointUpper).toBeLessThan(BOX_LARGE_DESIGN_POINT_ADVISORY_THRESHOLD);
    expect(boxEstimateIsLarge(estimate)).toBe(true);
  });

  it('uses 20,000 points only as an estimate advisory threshold', () => {
    const estimate = estimateBoxWork({ ...RELIEF_HEAVY_SPEC, relief: { kind: 'none' } });
    expect(
      boxEstimateIsLarge({
        ...estimate,
        nominalPointUpper: BOX_LARGE_DESIGN_POINT_ADVISORY_THRESHOLD,
        reliefBooleanInputVertexUpper: BOX_LARGE_DESIGN_POINT_ADVISORY_THRESHOLD,
        saturatedFields: [],
      }),
    ).toBe(false);
    expect(
      boxEstimateIsLarge({
        ...estimate,
        nominalPointUpper: BOX_LARGE_DESIGN_POINT_ADVISORY_THRESHOLD + 1,
        reliefBooleanInputVertexUpper: BOX_LARGE_DESIGN_POINT_ADVISORY_THRESHOLD,
        saturatedFields: [],
      }),
    ).toBe(true);
  });
});
