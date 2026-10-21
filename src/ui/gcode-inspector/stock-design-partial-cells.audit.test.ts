import { expect, it } from 'vitest';
import {
  DEFAULT_RELIEF_LAYER_COLOR,
  IDENTITY_TRANSFORM,
  type ReliefObject,
} from '../../core/scene';
import { designTarget, NO_DESIGN } from './stock-design-target';
import { compareWithDesign } from './stock-compare';

it('compares a planar STL at the physical centres of a partial terminal cell', () => {
  // z = x over 2.5 x 2 mm. The last 1 mm-grid column is only 0.5 mm wide,
  // so its sample lies at x=2.25, rather than x=2.5.
  const relief: ReliefObject = {
    kind: 'relief',
    id: 'plane',
    source: 'plane.stl',
    reliefSource: {
      kind: 'legacy-mesh',
      emptyCells: 'floor',
      meshPositions: [0, 0, 0, 2.5, 0, 2.5, 2.5, 2, 2.5, 0, 0, 0, 2.5, 2, 2.5, 0, 2, 0],
    },
    targetWidthMm: 2.5,
    reliefDepthMm: 2.5,
    color: DEFAULT_RELIEF_LAYER_COLOR,
    bounds: { minX: 0, minY: 0, maxX: 2.5, maxY: 2 },
    transform: IDENTITY_TRANSFORM,
  };
  const target = designTarget(
    { originX: 0.25, originY: 0, mmPerCell: 1, widthCells: 2, heightCells: 2 },
    [{ relief, toProgram: [1, 0, 0, 1, 0, 0] }],
  );
  expect(target).not.toBeNull();
  // Stock samples x=.75 and 1.75. Relative to the highest point, z=x-2.5.
  expect(target?.[0]).toBeCloseTo(-1.75, 6);
  expect(target?.[1]).toBeCloseTo(-0.75, 6);
  if (target === null) throw new Error('Missing design');
  expect(
    compareWithDesign(new Float32Array([-1.75, -0.75, -1.75, -0.75]), target, 0.01),
  ).toMatchObject({
    cells: 4,
    within: 4,
    leftover: 0,
    gouged: 0,
  });
});

it('does not compare across an over-85-degree wall in a shortened final interval', () => {
  // The samples at x=.5 and 1.1 differ by 8 mm: physically steeper than 85deg,
  // although the difference is below tan(85deg) times the nominal 1 mm pitch.
  const relief: ReliefObject = {
    kind: 'relief',
    id: 'wall',
    source: 'wall.stl',
    reliefSource: {
      kind: 'legacy-mesh',
      emptyCells: 'floor',
      meshPositions: [0, 0, 0, 1.2, 0, 16, 1.2, 2, 16, 0, 0, 0, 1.2, 2, 16, 0, 2, 0],
    },
    targetWidthMm: 1.2,
    reliefDepthMm: 16,
    color: DEFAULT_RELIEF_LAYER_COLOR,
    bounds: { minX: 0, minY: 0, maxX: 1.2, maxY: 2 },
    transform: IDENTITY_TRANSFORM,
  };
  const target = designTarget(
    { originX: 0.3, originY: 0, mmPerCell: 1, widthCells: 1, heightCells: 2 },
    [{ relief, toProgram: [1, 0, 0, 1, 0, 0] }],
  );
  // When every candidate sample spans a wall, no design lands to compare.
  expect(target?.[0] ?? NO_DESIGN).toBe(NO_DESIGN);
});
