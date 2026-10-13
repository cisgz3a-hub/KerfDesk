import { describe, expect, it } from 'vitest';
import type { CurveSubpath, Vec2 } from '../scene';
import { filletCurveCorners, removeCurveFillets } from './curve-fillet';
import { contourSegments, segmentPoint, segmentStart } from './trim-curve-split';

const SQUARE: CurveSubpath = {
  start: { x: 0, y: 0 },
  segments: [
    { kind: 'line', to: { x: 20, y: 0 } },
    { kind: 'line', to: { x: 20, y: 20 } },
    { kind: 'line', to: { x: 0, y: 20 } },
  ],
  closed: true,
};

function arcMidpoints(curve: CurveSubpath): Vec2[] {
  const contour = contourSegments(curve, curve.closed);
  return contour.segments.flatMap((segment, index) =>
    segment.kind === 'elliptical-arc'
      ? [segmentPoint(segmentStart(contour, index), segment, 0.5)]
      : [],
  );
}

describe('filletCurveCorners', () => {
  it('rounds every square corner with an arc tangent to both sides', () => {
    const result = filletCurveCorners(SQUARE, 5, 'round');
    expect(result?.count).toBe(4);
    const curve = result?.curve as CurveSubpath;
    expect(curve.start.x).toBeCloseTo(5, 9);
    expect(curve.start.y).toBeCloseTo(0, 9);
    expect(curve.segments.filter((segment) => segment.kind === 'elliptical-arc')).toHaveLength(4);
    // Each arc's midpoint is r from its centre, inset r from both sides.
    const centres = [
      { x: 15, y: 5 },
      { x: 15, y: 15 },
      { x: 5, y: 15 },
      { x: 5, y: 5 },
    ];
    for (const mid of arcMidpoints(curve)) {
      const distances = centres.map((c) => Math.hypot(mid.x - c.x, mid.y - c.y));
      expect(Math.min(...distances)).toBeCloseTo(5, 9);
    }
  });

  it('bites a concave corner centred on the corner for a reverse radius', () => {
    const result = filletCurveCorners(SQUARE, 4, 'reverse', [1]);
    const [mid] = arcMidpoints(result?.curve as CurveSubpath);
    expect(Math.hypot((mid?.x ?? 0) - 20, mid?.y ?? 0)).toBeCloseTo(4, 9);
    // The bite lies inside the square.
    expect(mid?.x).toBeLessThan(20);
    expect(mid?.y).toBeGreaterThan(0);
  });

  it('skips corners whose sides are too short and leaves curves alone', () => {
    expect(filletCurveCorners(SQUARE, 11, 'round')).toBeNull();
    const open: CurveSubpath = { ...SQUARE, closed: false };
    expect(filletCurveCorners(open, 2, 'round')?.count).toBe(2);
  });
});

describe('removeCurveFillets', () => {
  it('restores the sharp corners a fillet replaced', () => {
    const rounded = filletCurveCorners(SQUARE, 5, 'round')?.curve as CurveSubpath;
    const restored = removeCurveFillets(rounded);
    expect(restored?.count).toBe(4);
    const contour = contourSegments(restored?.curve as CurveSubpath, true);
    const corners = [contour.start, ...contour.segments.map((segment) => segment.to)];
    for (const corner of [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      { x: 0, y: 20 },
    ]) {
      expect(corners.some((p) => Math.hypot(p.x - corner.x, p.y - corner.y) < 1e-9)).toBe(true);
    }
    expect(contour.segments.every((segment) => segment.kind === 'line')).toBe(true);
  });

  it('keeps a reverse bite, which is not a tangent fillet', () => {
    const bitten = filletCurveCorners(SQUARE, 4, 'reverse', [1])?.curve as CurveSubpath;
    expect(removeCurveFillets(bitten)).toBeNull();
  });
});
