import { describe, expect, it } from 'vitest';
import { testReliefHeightfield } from '../../__fixtures__/relief-heightfield';
import { IDENTITY_TRANSFORM } from '../../core/scene';
import type { HeightfieldReliefObject } from '../../core/scene/relief';
import { drawReliefHeightfieldPreviewRequest } from './draw-relief-heightfield-preview-request';

const DISPLAY_CELLS_ACROSS = 256;

function relief(input: {
  readonly physicalWidthMm: number;
  readonly targetWidthMm: number;
  readonly scaleX: number;
}): HeightfieldReliefObject {
  return {
    kind: 'relief',
    id: 'preview-width-authority',
    source: 'field.png',
    targetWidthMm: input.targetWidthMm,
    reliefDepthMm: 1,
    reliefSource: testReliefHeightfield({
      width: 1,
      height: 1,
      physicalWidthMm: input.physicalWidthMm,
      physicalHeightMm: input.physicalWidthMm,
      maxDepthMm: 1,
    }),
    color: '#a0522d',
    bounds: {
      minX: 0,
      minY: 0,
      maxX: input.physicalWidthMm,
      maxY: input.physicalWidthMm,
    },
    transform: { ...IDENTITY_TRANSFORM, scaleX: input.scaleX },
  };
}

describe('drawReliefHeightfieldPreviewRequest', () => {
  it('uses canonical unscaled width and resolution for nonzero X scale', () => {
    const object = relief({
      physicalWidthMm: 20,
      targetWidthMm: 20.00000001,
      scaleX: -2,
    });

    expect(drawReliefHeightfieldPreviewRequest(object, DISPLAY_CELLS_ACROSS).options).toEqual({
      targetWidthMm: 20,
      reliefDepthMm: 1,
      mmPerCell: 20 / DISPLAY_CELLS_ACROSS,
    });
  });

  it('retains canonical native underflow in preview resolution', () => {
    const object = relief({
      physicalWidthMm: Number.MIN_VALUE,
      targetWidthMm: 1e-9,
      scaleX: 0.5,
    });

    expect(drawReliefHeightfieldPreviewRequest(object, DISPLAY_CELLS_ACROSS).options).toEqual({
      targetWidthMm: Number.MIN_VALUE,
      reliefDepthMm: 1,
      mmPerCell: 0,
    });
  });

  it('uses stored target width for exact-zero compatibility', () => {
    const object = relief({
      physicalWidthMm: Number.MIN_VALUE,
      targetWidthMm: 1e-9,
      scaleX: 0,
    });

    expect(drawReliefHeightfieldPreviewRequest(object, DISPLAY_CELLS_ACROSS).options).toEqual({
      targetWidthMm: 1e-9,
      reliefDepthMm: 1,
      mmPerCell: 1e-9 / DISPLAY_CELLS_ACROSS,
    });
  });

  it('does not split request identity on a tolerated duplicate target width', () => {
    const first = relief({ physicalWidthMm: 20, targetWidthMm: 20, scaleX: 1 });
    const duplicate = { ...first, targetWidthMm: 20.00000001 };

    expect(drawReliefHeightfieldPreviewRequest(first, DISPLAY_CELLS_ACROSS).cacheKey).toBe(
      drawReliefHeightfieldPreviewRequest(duplicate, DISPLAY_CELLS_ACROSS).cacheKey,
    );
  });
});
