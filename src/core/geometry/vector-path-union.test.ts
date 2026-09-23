import { describe, expect, it } from 'vitest';
import {
  repairArtwork,
  repairLine,
  repairMetrics,
  repairRectangle,
} from '../../__fixtures__/vector-repair-fixtures';
import { IDENTITY_TRANSFORM } from '../scene';
import { unionVectorObjects } from './vector-path-union';
import { weldVectorObjects } from './vector-path-weld';

const chosen = { id: 'cut-b', color: '#0000ff' };

function union(objects: Parameters<typeof unionVectorObjects>[0]) {
  const result = unionVectorObjects(objects, chosen, 'union');
  if (result.kind === 'error') throw new Error(result.error.message);
  return result.value;
}

describe('explicit silhouette union', () => {
  it('removes the overlap across operations: independently known 4200 mm² and 300 mm, while Weld keeps 400 mm', () => {
    const objects = [
      repairArtwork('a', [repairRectangle(0, 0, 60, 40)], {
        operationIds: ['cut-a'],
        transform: { ...IDENTITY_TRANSFORM, x: 40, y: 40 },
        powerScale: 50,
        operationOverride: { speed: 100 },
      }),
      repairArtwork('b', [repairRectangle(0, 0, 60, 40)], {
        operationIds: ['cut-b'],
        transform: { ...IDENTITY_TRANSFORM, x: 70, y: 60 },
      }),
    ];
    const original = structuredClone(objects);
    const result = union(objects);
    expect(repairMetrics(result)).toEqual({ area: 4200, length: 300 });
    expect(result.paths).toHaveLength(1);
    expect(result.paths[0]?.polylines).toHaveLength(1);
    expect(result).toMatchObject({
      bounds: { minX: 40, minY: 40, maxX: 130, maxY: 100 },
      operationIds: ['cut-b'],
      transform: IDENTITY_TRANSFORM,
    });
    expect(result.operationOverride).toBeUndefined();
    expect(result.powerScale).toBeUndefined();
    const weld = weldVectorObjects(objects, 'weld');
    if (weld.kind === 'error') throw new Error(weld.error.message);
    expect(repairMetrics(weld.value).length).toBe(400);
    expect(objects).toEqual(original);
  });

  it('preserves a reflected, rotated, nonuniformly scaled hole and fills only its overlapping half', () => {
    const transform = {
      ...IDENTITY_TRANSFORM,
      x: 40,
      y: 70,
      scaleX: 2,
      scaleY: 3,
      mirrorX: true,
      rotationDeg: 90,
    };
    const donut = repairArtwork(
      'donut',
      [repairRectangle(0, 0, 20, 20), repairRectangle(5, 5, 10, 10)],
      { transform },
    );
    const halfHole = repairArtwork('fill', [repairRectangle(5, 5, 5, 10)], {
      transform,
      operationIds: ['other'],
    });
    expect(repairMetrics(union([donut])).area).toBe(1800);
    const result = union([donut, halfHole]);
    expect(repairMetrics(result).area).toBe(2100);
    expect(result.paths[0]?.polylines).toHaveLength(2);
    expect(result.bounds).toEqual({ minX: -20, minY: 30, maxX: 40, maxY: 70 });
    expect(result).toEqual(union([halfHole, donut]));
  });

  it('rejects open input atomically instead of dropping it', () => {
    const objects = [
      repairArtwork('closed', [repairRectangle(0, 0, 10, 10)]),
      repairArtwork('open', [repairLine({ x: 5, y: 0 }, { x: 5, y: 10 })]),
    ];
    expect(unionVectorObjects(objects, chosen, 'out')).toMatchObject({
      kind: 'error',
      error: { kind: 'open-contours' },
    });
    expect(unionVectorObjects([], chosen, 'out')).toMatchObject({
      kind: 'error',
      error: { kind: 'too-few-objects' },
    });
  });
});
