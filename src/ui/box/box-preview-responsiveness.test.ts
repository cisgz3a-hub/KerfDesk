import { describe, expect, it } from 'vitest';
import type { BoxSpec } from '../../core/box';
import { estimateBoxWork } from '../../core/box/box-work-estimate';
import {
  BOX_CANVAS_PREVIEW_POINT_BUDGET,
  boxEstimateIsLarge,
  boxPreviewShouldBeSuppressed,
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
    expect(estimate.nominalPointUpper).toBeLessThan(BOX_CANVAS_PREVIEW_POINT_BUDGET);
    expect(boxEstimateIsLarge(estimate)).toBe(true);
  });

  it('keeps the exact output preview threshold strict', () => {
    expect(
      boxPreviewShouldBeSuppressed({
        panelCount: 6,
        ringCount: 6,
        pointCount: BOX_CANVAS_PREVIEW_POINT_BUDGET,
      }),
    ).toBe(false);
    expect(
      boxPreviewShouldBeSuppressed({
        panelCount: 6,
        ringCount: 6,
        pointCount: BOX_CANVAS_PREVIEW_POINT_BUDGET + 1,
      }),
    ).toBe(true);
  });
});
