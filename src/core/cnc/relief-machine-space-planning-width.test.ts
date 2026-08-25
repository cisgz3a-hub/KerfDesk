import { describe, expect, it } from 'vitest';
import { testReliefHeightfield } from '../../__fixtures__/relief-heightfield';
import { heightfieldMetadataError } from '../relief/heightfield-metadata-validator';
import { IDENTITY_TRANSFORM, type ReliefObject } from '../scene';
import { reliefMachineSpaceGeometry } from './relief-machine-space';
import { reliefMachineSpacePlanningWidthMm } from './relief-machine-space-planning-width';

function heightfieldRelief(input: {
  readonly physicalWidthMm: number;
  readonly targetWidthMm: number;
  readonly scaleX: number;
}): ReliefObject {
  return {
    kind: 'relief',
    id: 'heightfield-width-authority',
    source: 'field.png',
    targetWidthMm: input.targetWidthMm,
    reliefDepthMm: 1,
    reliefSource: testReliefHeightfield({
      width: 1,
      height: 1,
      physicalWidthMm: input.physicalWidthMm,
      physicalHeightMm: 1,
      maxDepthMm: 1,
    }),
    color: '#a0522d',
    bounds: { minX: 0, minY: 0, maxX: input.physicalWidthMm, maxY: 1 },
    transform: { ...IDENTITY_TRANSFORM, scaleX: input.scaleX },
  };
}

function expectAcceptedHeightfieldBinding(relief: ReliefObject): void {
  if (relief.reliefSource.kind !== 'heightfield-v1')
    throw new Error('heightfield fixture required');
  expect(
    heightfieldMetadataError(relief.reliefSource, {
      targetWidthMm: relief.targetWidthMm,
      reliefDepthMm: relief.reliefDepthMm,
    }),
  ).toBeNull();
}

describe('reliefMachineSpacePlanningWidthMm', () => {
  it('feeds ordinary nonzero geometry from canonical heightfield width', () => {
    const relief = heightfieldRelief({
      physicalWidthMm: 100,
      targetWidthMm: 100.00000005,
      scaleX: -2,
    });
    expectAcceptedHeightfieldBinding(relief);

    expect(reliefMachineSpacePlanningWidthMm(relief)).toBe(100);
    expect(reliefMachineSpaceGeometry(relief).widthMm).toBe(200);
  });

  it('retains native underflow from a validator-accepted canonical width', () => {
    const relief = heightfieldRelief({
      physicalWidthMm: Number.MIN_VALUE,
      targetWidthMm: 1e-9,
      scaleX: 0.5,
    });
    expectAcceptedHeightfieldBinding(relief);

    expect(reliefMachineSpacePlanningWidthMm(relief)).toBe(Number.MIN_VALUE);
    expect(reliefMachineSpaceGeometry(relief).widthMm).toBe(0);
  });

  it('preserves stored target width at exact-zero X scale', () => {
    const relief = heightfieldRelief({
      physicalWidthMm: Number.MIN_VALUE,
      targetWidthMm: 1e-9,
      scaleX: 0,
    });
    expectAcceptedHeightfieldBinding(relief);

    expect(reliefMachineSpacePlanningWidthMm(relief)).toBe(1e-9);
    expect(reliefMachineSpaceGeometry(relief).widthMm).toBe(1e-9);
  });

  it('preserves legacy-mesh target width behavior', () => {
    const relief: ReliefObject = {
      ...heightfieldRelief({ physicalWidthMm: 20, targetWidthMm: 20, scaleX: -3 }),
      reliefSource: {
        kind: 'legacy-mesh',
        meshPositions: [0, 0, 0, 1, 0, 1, 0, 1, 0],
        emptyCells: 'floor',
      },
      targetWidthMm: 20.00000001,
    };

    expect(reliefMachineSpacePlanningWidthMm(relief)).toBe(20.00000001);
    expect(reliefMachineSpaceGeometry(relief).widthMm).toBe(60.00000003);
  });
});
