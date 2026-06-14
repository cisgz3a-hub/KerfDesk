import { describe, expect, it } from 'vitest';
import { addLayer, addObject, createLayer, EMPTY_SCENE } from '../scene';
import { compileJob } from '../job';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { createRectangle } from './create-rectangle';

describe('createRectangle', () => {
  it('materializes a kind:shape SceneObject with paths, bounds, and the parametric spec', () => {
    const shape = createRectangle({
      id: 'S1',
      color: '#ff0000',
      spec: { widthMm: 80, heightMm: 50, cornerRadiusMm: 0 },
    });
    expect(shape.kind).toBe('shape');
    expect(shape.id).toBe('S1');
    expect(shape.color).toBe('#ff0000');
    expect(shape.spec).toEqual({ kind: 'rect', widthMm: 80, heightMm: 50, cornerRadiusMm: 0 });
    expect(shape.bounds).toEqual({ minX: 0, minY: 0, maxX: 80, maxY: 50 });
    expect(shape.paths).toHaveLength(1);
    expect(shape.paths[0]?.color).toBe('#ff0000');
    expect(shape.paths[0]?.polylines[0]?.points).toEqual([
      { x: 0, y: 0 },
      { x: 80, y: 0 },
      { x: 80, y: 50 },
      { x: 0, y: 50 },
    ]);
  });

  it('compiles to a non-empty job through the existing pipeline (line layer)', () => {
    const shape = createRectangle({
      id: 'S1',
      color: '#ff0000',
      spec: { widthMm: 20, heightMm: 10, cornerRadiusMm: 0 },
    });
    const layer = createLayer({ id: 'L1', color: '#ff0000' });
    const scene = addLayer(addObject(EMPTY_SCENE, shape), layer);

    const job = compileJob(scene, DEFAULT_DEVICE_PROFILE);

    // The shape flows through compile like any vector object (its paths match the
    // layer color), so it produces at least one output group — no special arm.
    expect(job.groups.length).toBeGreaterThan(0);
  });
});
