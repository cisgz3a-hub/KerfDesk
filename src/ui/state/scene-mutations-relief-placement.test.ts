import { describe, expect, it } from 'vitest';
import {
  applyTransform,
  createProject,
  IDENTITY_TRANSFORM,
  type ReliefObject,
} from '../../core/scene';
import { applyFreshImport } from './scene-mutations';

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
        meshPositions: [0, 0, 0, 1, 0, 0, 0, 10, 1],
        emptyCells: 'floor',
      }
    : {
        ...common,
        depthMap: {
          schemaVersion: 1,
          width: 1,
          height: 10,
          bitDepth: 8,
          samplesBase64: Buffer.alloc(10).toString('base64'),
          polarity: 'light-is-high',
        },
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
