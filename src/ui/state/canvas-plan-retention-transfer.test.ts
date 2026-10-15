import { describe, expect, it, vi } from 'vitest';
import {
  createProject,
  DEFAULT_OUTPUT_SCOPE,
  IDENTITY_TRANSFORM,
  type Project,
} from '../../core/scene';
import {
  packProjectMessage,
  unpackProjectMessage,
  PACK_MIN_POINTS,
} from '../packed-project-transfer';
import type { MeshReliefObject } from '../../core/scene/scene-object';
import { orderedRetentionValue } from './canvas-retention-json';
import { canvasPlanRetentionKey } from './canvas-motion-plan';

const placement = { startFrom: 'absolute' as const, anchor: 'front-left' as const };

function denseProject(): Project {
  return {
    ...createProject(),
    scene: {
      layers: [],
      objects: [
        {
          kind: 'imported-svg',
          id: 'trace',
          source: 'trace.svg',
          transform: IDENTITY_TRANSFORM,
          bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
          paths: [
            {
              color: '#000000',
              curves: [
                {
                  closed: false,
                  segments: [{ to: { y: 10, x: 20 }, kind: 'line' }],
                  start: { y: 0, x: 0 },
                },
              ],
              polylines: [
                {
                  closed: false,
                  points: Array.from({ length: PACK_MIN_POINTS + 1 }, (_, i) => ({
                    y: i % 10,
                    x: i / 100,
                  })),
                },
              ],
              fillRule: 'evenodd',
            },
          ],
        },
      ],
    },
  };
}

describe('retained execution identity across packed geometry', () => {
  it('keeps identity when the worker reconstructs the same values in a different property order', () => {
    const original = denseProject();
    const packed = packProjectMessage(original);
    const received = unpackProjectMessage(
      structuredClone(packed.message, { transfer: packed.transfer }),
    );
    expect(received).toEqual(original);
    expect(JSON.stringify(received.scene)).not.toBe(JSON.stringify(original.scene));
    expect(canvasPlanRetentionKey(received, DEFAULT_OUTPUT_SCOPE, placement)).toBe(
      canvasPlanRetentionKey(original, DEFAULT_OUTPUT_SCOPE, placement),
    );
  });

  it('still invalidates a changed point, segment, ordering, or placement after transport', () => {
    const original = denseProject();
    const packed = packProjectMessage(original);
    const received = unpackProjectMessage(
      structuredClone(packed.message, { transfer: packed.transfer }),
    );
    const key = canvasPlanRetentionKey(original, DEFAULT_OUTPUT_SCOPE, placement);
    for (const mutation of ['point', 'segment', 'order'] as const) {
      const changed = JSON.parse(JSON.stringify(received)) as Project;
      const object = changed.scene.objects[0];
      if (object?.kind !== 'imported-svg') throw new Error('Expected imported geometry');
      const path = object.paths[0]!;
      if (mutation === 'point') Object.assign(path.polylines[0]!.points[0]!, { x: 1 });
      if (mutation === 'segment') Object.assign(path.curves![0]!.segments[0]!.to, { x: 21 });
      if (mutation === 'order') (path.polylines[0]!.points as unknown[]).reverse();
      expect(canvasPlanRetentionKey(changed, DEFAULT_OUTPUT_SCOPE, placement)).not.toBe(key);
    }
    expect(
      canvasPlanRetentionKey(received, DEFAULT_OUTPUT_SCOPE, { ...placement, anchor: 'center' }),
    ).not.toBe(key);
  });
});

const meshValues = [0, 0, 0, 2, 0, 1, 0, 1.5, 0, 2, 0, 1, 2, 1.5, 1, 0, 1.5, 0];

function reliefProject(positions: Float32Array | Float64Array, packed = false): Project {
  const base = packed ? denseProject() : createProject();
  const relief: MeshReliefObject = {
    kind: 'relief',
    id: 'mesh',
    source: 'relief.stl',
    targetWidthMm: 2,
    reliefDepthMm: 1,
    reliefSource: { kind: 'legacy-mesh', meshPositions: positions, emptyCells: 'floor' },
    color: '#a0522d',
    bounds: { minX: 0, minY: 0, maxX: 2, maxY: 1.5 },
    transform: IDENTITY_TRANSFORM,
  };
  return { ...base, scene: { ...base.scene, objects: [...base.scene.objects, relief] } };
}

const retentionKey = (project: Project): string =>
  canvasPlanRetentionKey(project, DEFAULT_OUTPUT_SCOPE, placement);

describe.each([
  ['Float32Array', Float32Array],
  ['Float64Array', Float64Array],
] as const)('typed relief retention with %s', (_name, ArrayType) => {
  it('leaves numeric views intact without enumerating and copying their coordinate properties', () => {
    const positions = new ArrayType(18000);
    for (let i = 0; i < positions.length; i++) positions[i] = i / 4;
    const keys = vi.spyOn(Object, 'keys');
    try {
      const normalized = orderedRetentionValue(positions);
      expect(keys.mock.calls.some(([value]) => value === positions)).toBe(false);
      expect(normalized).toBe(positions);
      expect(JSON.stringify(normalized)).toBe(JSON.stringify(positions));
    } finally {
      keys.mockRestore();
    }
  });

  it.each([false, true])(
    'retains equal visible coordinates through worker packing %s',
    (packed) => {
      const backing = ArrayType.from([999, ...meshValues, -999]);
      const positions = backing.subarray(1, backing.length - 1);
      const original = reliefProject(positions, packed);
      const transfer = packProjectMessage(original);
      expect(transfer.transfer.length > 0).toBe(packed);
      const received = unpackProjectMessage(
        structuredClone(transfer.message, { transfer: transfer.transfer }),
      );
      expect(retentionKey(received)).toBe(retentionKey(original));
      expect(retentionKey(reliefProject(ArrayType.from(meshValues), packed))).toBe(
        retentionKey(original),
      );
    },
  );

  it('invalidates changed coordinates, coordinate ordering and view length', () => {
    const original = reliefProject(ArrayType.from(meshValues));
    const key = retentionKey(original);
    for (const mutation of ['first', 'last', 'order', 'length'] as const) {
      const changed = ArrayType.from(meshValues);
      if (mutation === 'first') changed[0] = 0.25;
      if (mutation === 'last') changed[changed.length - 1] = 0.25;
      if (mutation === 'order') changed.reverse();
      const positions = mutation === 'length' ? changed.subarray(0, changed.length - 3) : changed;
      expect(retentionKey(reliefProject(positions))).not.toBe(key);
    }
  });
});
