import { describe, expect, it } from 'vitest';
import { DEFAULT_RELIEF_LAYER_COLOR, IDENTITY_TRANSFORM } from '../../core/scene';
import type { MeshReliefObject } from '../../core/scene/relief';
import { meshBounds } from '../../core/relief';
import { modelProportionDepthMm, proportionalReliefPatch } from './ReliefProportionControls';

// ADR-580: an STL relief's Width and Depth move together while proportions
// are kept, and "Use model proportions" restores the model's own ratio.

const relief = { targetWidthMm: 100, reliefDepthMm: 5 };

describe('proportionalReliefPatch', () => {
  it('scales Depth with a Width edit and Width with a Depth edit when locked', () => {
    expect(proportionalReliefPatch(relief, 'targetWidthMm', 60, true)).toEqual({
      targetWidthMm: 60,
      reliefDepthMm: 3,
    });
    expect(proportionalReliefPatch(relief, 'reliefDepthMm', 10, true)).toEqual({
      reliefDepthMm: 10,
      targetWidthMm: 200,
    });
  });

  it('edits one value alone when unlocked', () => {
    expect(proportionalReliefPatch(relief, 'targetWidthMm', 60, false)).toEqual({
      targetWidthMm: 60,
    });
  });
});

describe('modelProportionDepthMm', () => {
  it('is the placed width times the model height to width ratio', () => {
    // A 60 x 40 x 12 model placed 100 mm wide, at transform scale 1.5.
    const positions = [0, 0, 0, 60, 0, 0, 60, 40, 12];
    const mesh: MeshReliefObject = {
      kind: 'relief',
      id: 'r',
      source: 'r.stl',
      reliefSource: { kind: 'legacy-mesh', meshPositions: positions, emptyCells: 'floor' },
      targetWidthMm: 100,
      reliefDepthMm: 5,
      color: DEFAULT_RELIEF_LAYER_COLOR,
      bounds: { minX: 0, minY: 0, maxX: 100, maxY: 66.7 },
      transform: IDENTITY_TRANSFORM,
    };
    expect(modelProportionDepthMm(mesh, meshBounds({ positions }), 1.5)).toBeCloseTo(30, 12);
  });
});
