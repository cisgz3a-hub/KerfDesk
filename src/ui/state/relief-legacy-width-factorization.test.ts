import { describe, expect, it } from 'vitest';
import type { MeshReliefObject } from '../../core/scene/relief';
import { cachedFloat32Array } from '../../core/util';
import { prepareProjectForAutosave, prepareProjectForPersistence } from '../../io/project';
import {
  DISPLAYED_WIDTH_MM,
  FACTOR,
  FACTORED_HEIGHT_MM,
  FACTORED_WIDTH_MM,
  INITIAL_SCALE,
  INTENDED_HEIGHT_MM,
  INTENDED_WIDTH_MM,
  LOCAL_COORDINATE_LIMIT_MM,
  MESH_POSITIONS,
  RELIEF_ID,
  boundsAspect,
  expectPersistence,
  infiniteBoundsAspectRelief,
  installRelief,
  legacyRelief,
  materializedArtifact,
  meshAspect,
  meshBytes,
  preparedArtifact,
  projectWithRelief,
  resizeLegacyMesh,
  storedLegacyRelief,
  transformedBoundsCorners,
} from './relief-legacy-width-factorization-test-helpers';
import { factorReliefLegacyWidth } from './relief-legacy-width-factorization';
import { useStore } from './store';

describe('legacy-mesh Width project-v4 factorization', () => {
  it('repairs the real Width edit without changing mesh CAM, prepared-job JSON, or Frame', () => {
    const initial = legacyRelief({
      targetWidthMm: 2,
      boundsWidthMm: 2,
      boundsHeightMm: 1,
      scaleX: -INITIAL_SCALE,
      scaleY: INITIAL_SCALE,
    });
    const warmedMesh = cachedFloat32Array(initial.reliefSource, initial.reliefSource.meshPositions);
    expect(warmedMesh).not.toBe(initial.reliefSource.meshPositions);
    installRelief(initial);
    expectPersistence('ok');

    const intended = legacyRelief({
      targetWidthMm: INTENDED_WIDTH_MM,
      boundsWidthMm: INTENDED_WIDTH_MM,
      boundsHeightMm: INTENDED_HEIGHT_MM,
      scaleX: -INITIAL_SCALE,
      scaleY: INITIAL_SCALE,
    });
    const intendedProject = projectWithRelief(intended);
    expect(prepareProjectForPersistence(intendedProject).kind).toBe('invalid');
    expect(prepareProjectForAutosave(intendedProject).kind).toBe('invalid');
    const intendedMaterialized = materializedArtifact(intended);
    const intendedPrepared = preparedArtifact(intendedProject);

    useStore.getState().setReliefParams(RELIEF_ID, {
      targetWidthMm: DISPLAYED_WIDTH_MM / INITIAL_SCALE,
    });

    const updated = storedLegacyRelief();
    expect(updated).toMatchObject({
      targetWidthMm: FACTORED_WIDTH_MM,
      bounds: {
        minX: 0,
        minY: 0,
        maxX: FACTORED_WIDTH_MM,
        maxY: FACTORED_HEIGHT_MM,
      },
      transform: { scaleX: -INITIAL_SCALE * FACTOR, scaleY: INITIAL_SCALE * FACTOR },
    });
    expect(updated.targetWidthMm).toBeLessThanOrEqual(LOCAL_COORDINATE_LIMIT_MM);
    expect(updated.reliefSource).toBe(initial.reliefSource);
    expect(updated.reliefSource.meshPositions).toBe(initial.reliefSource.meshPositions);
    expect(cachedFloat32Array(updated.reliefSource, updated.reliefSource.meshPositions)).toBe(
      warmedMesh,
    );
    expect(meshBytes(updated)).toEqual(meshBytes(initial));
    expect(boundsAspect(updated)).toBe(boundsAspect(intended));
    expect(meshAspect(updated)).toBe(meshAspect(intended));
    expect(meshAspect(updated)).not.toBe(boundsAspect(updated));
    expect(transformedBoundsCorners(updated)).toEqual(transformedBoundsCorners(intended));
    expect(materializedArtifact(updated)).toEqual(intendedMaterialized);
    expect(preparedArtifact(useStore.getState().project)).toEqual(intendedPrepared);
    expect(useStore.getState()).toMatchObject({ dirty: true });
    expect(useStore.getState().undoStack).toHaveLength(1);
    expectPersistence('ok');
  });

  it('retains the real Width edit when intrinsic mesh-bound reading throws', () => {
    const meshPositions = Array.from(MESH_POSITIONS);
    Object.defineProperty(meshPositions, 0, {
      get: () => {
        throw new RangeError('injected mesh read failure');
      },
    });
    const { initial, updated } = resizeLegacyMesh(meshPositions);
    expect(updated).toMatchObject({
      targetWidthMm: INTENDED_WIDTH_MM,
      bounds: { maxX: INTENDED_WIDTH_MM, maxY: INTENDED_HEIGHT_MM },
      transform: initial.transform,
    });
    expect(updated.reliefSource).toBe(initial.reliefSource);
  });

  it.each([
    ['X', [0, 0, 0, Number.MAX_VALUE, 0, 1, 0, 1.5, 0]],
    ['Z', [0, 0, 0, 2, 0, Number.MAX_VALUE, 0, 1.5, 0]],
  ] as const)(
    'retains a schema-valid Width edit when Float32 %s conversion overflows',
    (_axis, meshPositions) => {
      const { initial, updated } = resizeLegacyMesh(meshPositions);
      expect(prepareProjectForPersistence(projectWithRelief(initial)).kind).toBe('ok');
      expect(factorReliefLegacyWidth(updated)).toEqual({
        kind: 'unavailable',
        reason: 'geometry-drift',
        relief: updated,
      });
      expect(updated.reliefSource).toBe(initial.reliefSource);
    },
  );

  it('uses the smallest common power-of-two and retains the legacy source by reference', () => {
    const intended = legacyRelief({
      targetWidthMm: INTENDED_WIDTH_MM * FACTOR,
      boundsWidthMm: INTENDED_WIDTH_MM * FACTOR,
      boundsHeightMm: INTENDED_HEIGHT_MM * FACTOR,
      scaleX: -INITIAL_SCALE,
      scaleY: INITIAL_SCALE,
    });

    const result = factorReliefLegacyWidth(intended);

    expect(result).toMatchObject({
      kind: 'factored',
      relief: {
        targetWidthMm: FACTORED_WIDTH_MM,
        bounds: { maxX: FACTORED_WIDTH_MM, maxY: FACTORED_HEIGHT_MM },
        transform: {
          scaleX: -INITIAL_SCALE * FACTOR * FACTOR,
          scaleY: INITIAL_SCALE * FACTOR * FACTOR,
        },
      },
    });
    expect(result.relief.reliefSource).toBe(intended.reliefSource);
    expect(materializedArtifact(result.relief)).toEqual(materializedArtifact(intended));
    expect(transformedBoundsCorners(result.relief)).toEqual(transformedBoundsCorners(intended));
  });

  it('retains an already bounded legacy object by reference', () => {
    const relief = legacyRelief({
      targetWidthMm: 100,
      boundsWidthMm: 100,
      boundsHeightMm: 50,
      scaleX: 1,
      scaleY: 1,
    });

    expect(factorReliefLegacyWidth(relief)).toEqual({ kind: 'unchanged', relief });
  });

  it.each([
    ['exact-zero compatibility', 0, 1, MESH_POSITIONS, 'zero-scale'],
    ['scale-domain exhaustion', 1, 100_000, MESH_POSITIONS, 'scale-domain'],
    ['invalid native mesh geometry', 1, 1, new Float32Array(), 'geometry-drift'],
  ] as const)(
    'reports %s without rewriting the accepted edit',
    (_label, scaleX, scaleY, meshPositions, reason) => {
      const relief = {
        ...legacyRelief({
          targetWidthMm: INTENDED_WIDTH_MM,
          boundsWidthMm: INTENDED_WIDTH_MM,
          boundsHeightMm: INTENDED_HEIGHT_MM,
          scaleX,
          scaleY,
        }),
        reliefSource: { kind: 'legacy-mesh', meshPositions, emptyCells: 'floor' },
      } satisfies MeshReliefObject;

      expect(factorReliefLegacyWidth(relief)).toEqual({ kind: 'unavailable', reason, relief });
    },
  );

  it('reports numeric erasure and exact-factor drift without changing the edit', () => {
    const erased = legacyRelief({
      targetWidthMm: INTENDED_WIDTH_MM,
      boundsWidthMm: INTENDED_WIDTH_MM,
      boundsHeightMm: Number.MIN_VALUE,
      scaleX: 1,
      scaleY: 1,
    });
    const drifted = legacyRelief({
      targetWidthMm: INTENDED_WIDTH_MM,
      boundsWidthMm: INTENDED_WIDTH_MM,
      boundsHeightMm: Number.MIN_VALUE * 3,
      scaleX: INITIAL_SCALE,
      scaleY: Number.MIN_VALUE,
    });
    const infiniteAspect = infiniteBoundsAspectRelief();

    expect(factorReliefLegacyWidth(erased)).toEqual({
      kind: 'unavailable',
      reason: 'numeric-domain',
      relief: erased,
    });
    expect(factorReliefLegacyWidth(drifted)).toEqual({
      kind: 'unavailable',
      reason: 'factor-drift',
      relief: drifted,
    });
    expect(factorReliefLegacyWidth(infiniteAspect)).toEqual({
      kind: 'unavailable',
      reason: 'geometry-drift',
      relief: infiniteAspect,
    });
  });

  it.each([
    ['overflowing', Number.MIN_VALUE, 1, Number.POSITIVE_INFINITY],
    ['underflowing', LOCAL_COORDINATE_LIMIT_MM, Number.MIN_VALUE, 0],
    ['indeterminate', 1, Number.NaN, Number.NaN],
  ] as const)(
    'retains the real Width edit when legacy stored-bounds aspect is %s',
    (_label, boundsWidthMm, boundsHeightMm, expectedHeightMm) => {
      const initial = legacyRelief({
        targetWidthMm: boundsWidthMm,
        boundsWidthMm,
        boundsHeightMm,
        scaleX: 1,
        scaleY: 1,
      });
      installRelief(initial);

      useStore.getState().setReliefParams(RELIEF_ID, { targetWidthMm: INTENDED_WIDTH_MM });

      const updated = storedLegacyRelief();
      expect(updated).toMatchObject({
        targetWidthMm: INTENDED_WIDTH_MM,
        bounds: { minX: 0, minY: 0, maxX: INTENDED_WIDTH_MM, maxY: expectedHeightMm },
        transform: initial.transform,
      });
      expect(updated.reliefSource.meshPositions).toBe(initial.reliefSource.meshPositions);
      expect(useStore.getState()).toMatchObject({ dirty: true });
      expect(useStore.getState().undoStack).toHaveLength(1);
    },
  );
});
