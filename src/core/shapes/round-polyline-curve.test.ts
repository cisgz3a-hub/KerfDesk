import { describe, expect, it } from 'vitest';
import { curveSubpathBounds, type PathSegment, type Vec2 } from '../scene';
import { roundPolylineCurve } from './round-polyline-curve';

describe('roundPolylineCurve', () => {
  it('uses the tracer fitter to consolidate a sampled arc instead of wrapping every chord', () => {
    const points = Array.from({ length: 13 }, (_, index) => {
      const angle = (index / 12) * Math.PI;
      return { x: 50 + 50 * Math.cos(angle), y: 50 * Math.sin(angle) };
    });

    const curve = roundPolylineCurve({ points, closed: false }, 1);

    expect(curve.segments.every((segment) => segment.kind === 'cubic')).toBe(true);
    expect(curve.segments.length).toBeLessThan(points.length - 1);
  });

  it('turns sparse alternating clicks into visibly curved cubic spans', () => {
    const points = [
      { x: 0, y: 80 },
      { x: 30, y: 20 },
      { x: 60, y: 80 },
      { x: 90, y: 20 },
      { x: 120, y: 80 },
    ];
    const curve = roundPolylineCurve({ points, closed: false }, 3);

    expect(curve.start).toEqual(points[0]);
    expect(curve.segments.at(-1)?.to).toEqual(points.at(-1));
    expect(curve.segments.every((segment) => segment.kind === 'cubic')).toBe(true);
    expect(countOffChordControls(curve.start, curve.segments)).toBeGreaterThanOrEqual(2);
    expect(curveSubpathBounds(curve)).toMatchObject({ minX: 0, maxX: 120, maxY: 80 });
    expect(curveSubpathBounds(curve).minY).toBeCloseTo(20);
  });

  it('keeps the final vertex of a closed input that does not repeat its start', () => {
    const curve = roundPolylineCurve(
      {
        closed: true,
        points: [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { x: 20, y: 20 },
          { x: 0, y: 20 },
          { x: -10, y: 10 },
        ],
      },
      1,
    );

    expect(curve.closed).toBe(true);
    expect(curveSubpathBounds(curve).minX).toBeLessThan(-5);
  });
});

function countOffChordControls(start: Vec2, segments: ReadonlyArray<PathSegment>): number {
  let count = 0;
  let from = start;
  for (const segment of segments) {
    if (segment.kind === 'cubic') {
      const offset = Math.max(
        distanceFromChord(segment.control1, from, segment.to),
        distanceFromChord(segment.control2, from, segment.to),
      );
      if (offset > 0.5) count += 1;
    }
    from = segment.to;
  }
  return count;
}

function distanceFromChord(control: Vec2, start: Vec2, end: Vec2): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const cross = (control.x - start.x) * dy - (control.y - start.y) * dx;
  return Math.abs(cross) / Math.hypot(dx, dy);
}
