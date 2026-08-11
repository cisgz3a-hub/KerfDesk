import { describe, expect, it } from 'vitest';
import { testLegacyMeshGeometry } from '../../../__fixtures__/legacy-relief';
import { testReliefHeightfield } from '../../../__fixtures__/relief-heightfield';
import { IDENTITY_TRANSFORM, type ReliefObject } from '../../../core/scene';
import {
  validateReliefHeightfield,
  validateReliefHeightfieldBounds,
} from '../../../io/project/project-relief-heightfield-validator';
import { requireScale } from '../../../io/project/project-shape-primitives';
import { relief3dViewerDialogPlan } from './relief-3d-viewer-dialog-plan';

function heightfieldRelief(input: {
  readonly physicalWidthMm: number;
  readonly targetWidthMm: number;
  readonly scaleX: number;
  readonly scaleY: number;
}): ReliefObject {
  return {
    kind: 'relief',
    id: 'viewer-width-authority',
    source: 'height-map.png',
    reliefSource: testReliefHeightfield({
      width: 1,
      height: 1,
      physicalWidthMm: input.physicalWidthMm,
      physicalHeightMm: input.physicalWidthMm,
      maxDepthMm: 5,
      samplesU8: [0],
      provenance: { sourceName: 'height-map.png' },
    }),
    targetWidthMm: input.targetWidthMm,
    reliefDepthMm: 5,
    color: '#a0522d',
    bounds: {
      minX: 0,
      minY: 0,
      maxX: input.physicalWidthMm,
      maxY: input.physicalWidthMm,
    },
    transform: { ...IDENTITY_TRANSFORM, scaleX: input.scaleX, scaleY: input.scaleY },
  };
}

describe('relief3dViewerDialogPlan', () => {
  it('uses canonical width for a validator-accepted duplicate at persisted scale', () => {
    const canonicalWidthMm = 1_000_000;
    const toleratedTargetWidthMm = 1_000_000.0009;
    const scale = 1_000;
    const object = heightfieldRelief({
      physicalWidthMm: canonicalWidthMm,
      targetWidthMm: toleratedTargetWidthMm,
      scaleX: -scale,
      scaleY: scale,
    });
    const persistedObject: Record<string, unknown> = { ...object };
    const persistedTransform: Record<string, unknown> = { ...object.transform };
    expect(validateReliefHeightfield(object.reliefSource, 'reliefSource')).toBeNull();
    expect(validateReliefHeightfieldBounds(persistedObject, 'relief')).toBeNull();
    expect(requireScale(persistedTransform, 'transform.scaleX')).toBeNull();
    expect(requireScale(persistedTransform, 'transform.scaleY')).toBeNull();

    const plan = relief3dViewerDialogPlan(object);

    expect(plan.title).toContain('1000000000 mm wide');
    expect(plan.planningWidthMm).toBe(canonicalWidthMm);
    expect(plan.machineSpace).toMatchObject({
      widthMm: 1_000_000_000,
      heightMm: 1_000_000_000,
      targetScaleX: scale,
      targetScaleY: scale,
    });
    expect(plan.resolution).toEqual({
      requestedMmPerCell: 0.25,
      effectiveMmPerCell: 3_906_250,
      reason: 'display-mesh-cell-budget',
    });
  });

  it('uses the stored target width for exact-zero compatibility', () => {
    const object = heightfieldRelief({
      physicalWidthMm: Number.MIN_VALUE,
      targetWidthMm: 1e-9,
      scaleX: 0,
      scaleY: 1,
    });

    const plan = relief3dViewerDialogPlan(object);

    expect(plan.planningWidthMm).toBe(1e-9);
    expect(plan.machineSpace.widthMm).toBe(1e-9);
  });

  it('keeps legacy-mesh target width behavior', () => {
    const object: ReliefObject = {
      ...heightfieldRelief({
        physicalWidthMm: 20,
        targetWidthMm: 20.00000001,
        scaleX: -3,
        scaleY: 1,
      }),
      ...testLegacyMeshGeometry({
        positions: [0, 0, 0, 20, 0, 1, 0, 10, 0],
        targetWidthMm: 20.00000001,
      }),
      bounds: { minX: 0, minY: 0, maxX: 20, maxY: 5 },
    };

    const plan = relief3dViewerDialogPlan(object);

    expect(plan.planningWidthMm).toBe(20.00000001);
    expect(plan.machineSpace.widthMm).toBe(60.00000003);
    expect(plan.machineSpace.heightMm).toBe(10.000000005);
    expect(plan.title).toContain('60 mm wide');
  });
});
