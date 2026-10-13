import { describe, expect, it } from 'vitest';
import { applyTransform, IDENTITY_TRANSFORM, type Polyline, type Vec2 } from '../../core/scene';
import { hitIndexedPathNode } from './path-node-hit-index';

describe('exact node picking index', () => {
  it('matches exhaustive picking under rotation, nonuniform scale and mirroring', () => {
    const polyline: Polyline = {
      closed: false,
      points: Array.from({ length: 1000 }, (_, index) => ({
        x: Math.sin(index * 1.37) * 50,
        y: Math.cos(index * 0.93) * 50,
      })),
    };
    const transform = {
      ...IDENTITY_TRANSFORM,
      rotationDeg: 31,
      scaleX: 2,
      scaleY: 0.7,
      mirrorX: true,
    };
    const points = polyline.points.map((point) => applyTransform(point, transform));
    for (let i = 0; i < 50; i += 1) {
      const pointer = { x: Math.sin(i) * 100, y: Math.cos(i * 0.3) * 50 };
      expect(hitIndexedPathNode(polyline, transform, pointer, 64)).toEqual(
        exhaustive(points, pointer, 64),
      );
    }
  });

  it('retains original-index ties and refreshes changed geometry and placement', () => {
    const source: Polyline = {
      closed: false,
      points: [
        { x: 1, y: 0 },
        { x: -1, y: 0 },
        { x: 1, y: 0 },
      ],
    };
    expect(hitIndexedPathNode(source, IDENTITY_TRANSFORM, { x: 0, y: 0 }, 1)?.pointIndex).toBe(0);
    expect(
      hitIndexedPathNode(source, { ...IDENTITY_TRANSFORM, x: 100 }, { x: 0, y: 0 }, 1),
    ).toBeNull();
    const changed = { ...source, points: [{ x: 20, y: 0 }, ...source.points.slice(1)] };
    expect(hitIndexedPathNode(changed, IDENTITY_TRANSFORM, { x: 0, y: 0 }, 1)?.pointIndex).toBe(1);
  });
});

function exhaustive(points: ReadonlyArray<Vec2>, point: Vec2, radiusSq: number) {
  let best: { pointIndex: number; distanceSq: number } | null = null;
  points.forEach((node, pointIndex) => {
    const distanceSq = (node.x - point.x) ** 2 + (node.y - point.y) ** 2;
    if (distanceSq <= radiusSq && (best === null || distanceSq < best.distanceSq)) {
      best = { pointIndex, distanceSq };
    }
  });
  return best;
}
