// Perf audit S1, S6-P3-3: the before/after thumbnail draws each outline to a
// thousandth of the selection's span instead of placing every source point.

import { describe, expect, it } from 'vitest';
import { materializeVectorObject, type VectorSceneObject } from '../../core/geometry';
import { IDENTITY_TRANSFORM, type Polyline } from '../../core/scene';
import { comparisonOutline } from './vector-comparison-outline';

function ring(cx: number, cy: number, r: number, nodes: number, seed: number): Polyline {
  let state = seed;
  const noise = (): number => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return (state / 2 ** 32 - 0.5) * 0.08;
  };
  return {
    closed: true,
    points: Array.from({ length: nodes }, (_, index) => {
      const angle = (index / nodes) * Math.PI * 2;
      return { x: cx + (r + noise()) * Math.cos(angle), y: cy + (r + noise()) * Math.sin(angle) };
    }),
  };
}

function outline(id: string, polyline: Polyline, rotationDeg = 0): VectorSceneObject {
  const xs = polyline.points.map((point) => point.x);
  const ys = polyline.points.map((point) => point.y);
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    },
    transform: { ...IDENTITY_TRANSFORM, rotationDeg },
    paths: [{ color: '#000000', polylines: [polyline] }],
  };
}

const drawnPoints = (d: string): number => (d.match(/[ML]/g) ?? []).length;

describe('comparison thumbnail outlines (perf audit S6-P3-3)', () => {
  it('draws 2,000 traced outlines with a fraction of their 400,000 points', () => {
    const side = 45;
    const pitch = 380 / side;
    const objects = Array.from({ length: 2000 }, (_, index) =>
      outline(
        `n${index}`,
        ring(
          10 + pitch * ((index % side) + 0.5),
          10 + pitch * (Math.floor(index / side) + 0.5),
          pitch * 0.35,
          200,
          index + 1,
        ),
      ),
    );
    const drawn = comparisonOutline(objects);
    expect(drawnPoints(drawn.d)).toBeLessThan(400_000 / 4);
    expect(drawn.d.match(/Z/g)).toHaveLength(2000);
    expect(comparisonOutline([]).bounds).toBeNull();
    const step = 380 / 1000;
    const all = objects.flatMap((object) => object.paths[0]?.polylines[0]?.points ?? []);
    const minX = all.reduce((least, point) => Math.min(least, point.x), Infinity);
    const maxY = all.reduce((most, point) => Math.max(most, point.y), -Infinity);
    expect(Math.abs((drawn.bounds?.minX ?? 0) - minX)).toBeLessThan(step);
    expect(Math.abs((drawn.bounds?.maxY ?? 0) - maxY)).toBeLessThan(step);
  });

  it('keeps every point of an outline that fills the view', () => {
    const single = outline('one', ring(50, 50, 3, 200, 7));
    expect(drawnPoints(comparisonOutline([single]).d)).toBe(200);
  });

  it('places a turned outline where the job has it', () => {
    const turned = outline('turned', ring(40, 20, 10, 64, 3), 30);
    const placed = materializeVectorObject(turned).bounds;
    const drawn = comparisonOutline([turned]).bounds;
    expect(drawn?.minX).toBeCloseTo(placed.minX, 2);
    expect(drawn?.maxY).toBeCloseTo(placed.maxY, 2);
  });
});
