import { describe, expect, it } from 'vitest';
import type { Polyline, Vec2 } from '../scene';
import { collapseTinySegments, MIN_OFFSET_SEGMENT_MM } from './collapse-tiny-segments';

// Build a closed ring the way pathDToPolyline emits one: last vertex repeats the first.
function ring(pts: ReadonlyArray<readonly [number, number]>): Polyline {
  const points: Vec2[] = pts.map(([x, y]) => ({ x, y }));
  return { closed: true, points: [...points, points[0] as Vec2] };
}

function minSegment(pl: Polyline): number {
  let min = Infinity;
  for (let i = 1; i < pl.points.length; i += 1) {
    const a = pl.points[i - 1] as Vec2;
    const b = pl.points[i] as Vec2;
    min = Math.min(min, Math.hypot(b.x - a.x, b.y - a.y));
  }
  return min;
}

function maxTurnDeg(pl: Polyline): number {
  const p = pl.points;
  let max = 0;
  for (let i = 1; i < p.length - 1; i += 1) {
    const a = p[i - 1] as Vec2;
    const q = p[i] as Vec2;
    const b = p[i + 1] as Vec2;
    const v1x = q.x - a.x;
    const v1y = q.y - a.y;
    const v2x = b.x - q.x;
    const v2y = b.y - q.y;
    const l1 = Math.hypot(v1x, v1y);
    const l2 = Math.hypot(v2x, v2y);
    if (l1 < 1e-12 || l2 < 1e-12) continue;
    let cos = (v1x * v2x + v1y * v2y) / (l1 * l2);
    cos = Math.max(-1, Math.min(1, cos));
    max = Math.max(max, (Math.acos(cos) * 180) / Math.PI);
  }
  return max;
}

function isClosed(pl: Polyline): boolean {
  const f = pl.points[0] as Vec2;
  const l = pl.points[pl.points.length - 1] as Vec2;
  return f.x === l.x && f.y === l.y;
}

describe('collapseTinySegments', () => {
  it('drops a 1µm needle and its ~180° reversal along an edge', () => {
    // [5,0] -> [4.999,0] is a 1µm backward step (a reversal), then forward to [10,0].
    const needled = ring([
      [0, 0],
      [5, 0],
      [4.999, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]);
    expect(minSegment(needled)).toBeCloseTo(0.001, 6);
    expect(maxTurnDeg(needled)).toBeGreaterThan(170);

    const clean = collapseTinySegments(needled, MIN_OFFSET_SEGMENT_MM);
    expect(minSegment(clean)).toBeGreaterThanOrEqual(MIN_OFFSET_SEGMENT_MM);
    expect(maxTurnDeg(clean)).toBeLessThan(120);
    expect(isClosed(clean)).toBe(true);
  });

  it('collapses a needle straddling the closure seam and keeps the ring closed', () => {
    const needled = ring([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0.0009, 0.0004], // ~1µm from the start point, across the seam
    ]);
    const clean = collapseTinySegments(needled, MIN_OFFSET_SEGMENT_MM);
    expect(minSegment(clean)).toBeGreaterThanOrEqual(MIN_OFFSET_SEGMENT_MM);
    expect(isClosed(clean)).toBe(true);
    expect(clean.points.length).toBe(5); // 4 corners + closing repeat
  });

  it('leaves a clean shape unchanged', () => {
    const square = ring([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]);
    expect(collapseTinySegments(square, MIN_OFFSET_SEGMENT_MM)).toEqual(square);
  });

  it('never collapses a ring below a triangle', () => {
    const tiny = ring([
      [0, 0],
      [0.001, 0],
      [0, 0.001],
    ]);
    expect(collapseTinySegments(tiny, MIN_OFFSET_SEGMENT_MM)).toEqual(tiny);
  });
});
