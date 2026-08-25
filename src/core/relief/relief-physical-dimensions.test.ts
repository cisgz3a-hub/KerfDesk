import { describe, expect, it } from 'vitest';
import { testReliefHeightfield } from '../../__fixtures__/relief-heightfield';
import { IDENTITY_TRANSFORM, type ReliefObject } from '../scene';
import { meshToHeightmap } from './mesh-to-heightmap';
import { reliefPhysicalDimensions, reliefPlanningScale } from './relief-physical-dimensions';

function depthMapRelief(): ReliefObject {
  return {
    kind: 'relief',
    id: 'D1',
    source: 'depth.png',
    reliefSource: testReliefHeightfield({
      width: 2,
      height: 1,
      physicalWidthMm: 100,
      physicalHeightMm: 50,
      maxDepthMm: 5,
      samplesU8: [0, 255],
      provenance: { sourceName: 'depth.png' },
    }),
    targetWidthMm: 100,
    reliefDepthMm: 5,
    color: '#a0522d',
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 50 },
    transform: IDENTITY_TRANSFORM,
  };
}

describe('reliefPhysicalDimensions', () => {
  it('uses the same positive nonuniform scale magnitudes as CAM', () => {
    const relief = depthMapRelief();
    const dimensions = reliefPhysicalDimensions({
      ...relief,
      transform: { ...relief.transform, scaleX: -0.36, scaleY: 2 },
    });

    expect(dimensions).toEqual({
      widthMm: 36,
      heightMm: 100,
      targetScaleX: 0.36,
      targetScaleY: 2,
    });
  });

  it('derives mesh aspect from vertices when persisted scene bounds disagree', () => {
    const relief: ReliefObject = {
      kind: 'relief',
      id: 'M1',
      source: 'mesh.stl',
      targetWidthMm: 100,
      reliefDepthMm: 5,
      reliefSource: {
        kind: 'legacy-mesh',
        meshPositions: [0, 0, 0, 10, 0, 0, 0, 5, 1],
        emptyCells: 'floor',
      },
      color: '#a0522d',
      bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
      transform: { ...IDENTITY_TRANSFORM, scaleX: 2, scaleY: 0.5 },
    };

    expect(reliefPhysicalDimensions(relief)).toMatchObject({ widthMm: 200, heightMm: 25 });
    expect(relief.targetWidthMm).toBe(100);
  });

  it('matches mesh materialization after durable numbers round to Float32', () => {
    const meshPositions = [
      0.123456789, 0.234567891, 0, 10.123456849, 0.234567891, 0, 0.123456789, 3.567890179, 1,
    ];
    const relief: ReliefObject = {
      kind: 'relief',
      id: 'M2',
      source: 'precision.stl',
      targetWidthMm: 100,
      reliefDepthMm: 5,
      reliefSource: { kind: 'legacy-mesh', meshPositions, emptyCells: 'floor' },
      color: '#a0522d',
      bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
      transform: { ...IDENTITY_TRANSFORM, scaleX: 0.36, scaleY: 1.75 },
    };
    const materialized = meshToHeightmap(
      { positions: Float32Array.from(meshPositions) },
      {
        targetWidthMm: relief.targetWidthMm,
        reliefDepthMm: relief.reliefDepthMm,
        targetScaleX: 0.36,
        targetScaleY: 1.75,
        mmPerCell: 10,
      },
    );
    if (materialized.kind !== 'ok') throw new Error(materialized.reason);

    expect(reliefPhysicalDimensions(relief)).toMatchObject({
      widthMm: materialized.widthMm,
      heightMm: materialized.heightMm,
    });
  });

  it('preserves the legacy zero and non-finite planning fallback', () => {
    expect(reliefPlanningScale(0)).toBe(1);
    expect(reliefPlanningScale(Number.NaN)).toBe(1);
    expect(reliefPlanningScale(Number.POSITIVE_INFINITY)).toBe(1);
    expect(reliefPlanningScale(-3)).toBe(3);
  });
});
