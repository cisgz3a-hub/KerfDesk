import { describe, expect, it } from 'vitest';
import { testReliefHeightfield } from '../../__fixtures__/relief-heightfield';
import {
  applyTransform,
  createProject,
  IDENTITY_TRANSFORM,
  type ReliefObject,
} from '../../core/scene';
import { applyFreshImport } from './scene-mutations';
import { testLegacyMeshGeometry } from '../../__fixtures__/legacy-relief';

function tallRelief(source: 'mesh' | 'depth-map'): ReliefObject {
  const common = {
    kind: 'relief' as const,
    id: source,
    source: source === 'mesh' ? 'model.stl' : 'depth.png',
    targetWidthMm: 100,
    reliefDepthMm: 5,
    color: '#a0522d',
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 1000 },
    transform: IDENTITY_TRANSFORM,
  };
  return source === 'mesh'
    ? {
        ...common,
        ...testLegacyMeshGeometry({
          positions: [0, 0, 0, 1, 0, 0, 0, 10, 1],
          targetWidthMm: 100,
          emptyCells: 'floor',
        }),
      }
    : {
        ...common,
        reliefSource: testReliefHeightfield({
          width: 1,
          height: 10,
          physicalWidthMm: 100,
          physicalHeightMm: 1000,
          maxDepthMm: 5,
          samplesU8: Array.from({ length: 10 }, () => 0),
          provenance: { sourceName: 'depth.png' },
        }),
      };
}

describe('applyFreshImport relief placement', () => {
  it('centers and offsets a fresh depth map without scaling it to the bed', () => {
    const state = { project: createProject(), undoStack: [] };
    const result = applyFreshImport(state, tallRelief('depth-map'), 2);
    const stored = result.project.scene.objects[0];
    if (stored?.kind !== 'relief') throw new Error('depth-map relief missing');

    expect(stored.transform.scaleX).toBe(1);
    expect(stored.transform.scaleY).toBe(1);
    const center = applyTransform({ x: 50, y: 500 }, stored.transform);
    expect(center.x).toBe(state.project.device.bedWidth / 2 + 20);
    expect(center.y).toBe(state.project.device.bedHeight / 2 + 20);
  });

  it('retains ordinary scale-to-fit placement for a mesh relief', () => {
    const state = { project: createProject(), undoStack: [] };
    const result = applyFreshImport(state, tallRelief('mesh'), 0);
    const stored = result.project.scene.objects[0];
    if (stored?.kind !== 'relief') throw new Error('mesh relief missing');

    expect(stored.transform.scaleX).toBeCloseTo(0.36);
    expect(stored.transform.scaleY).toBeCloseTo(0.36);
  });
});
