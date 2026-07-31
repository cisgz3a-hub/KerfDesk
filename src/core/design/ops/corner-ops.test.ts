import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../../scene';
import type { SketchPath } from '../sketch-entity';
import { chamferPathCorner, cornerNeighbours } from './chamfer-corner';
import { filletPathCorner } from './fillet-corner';

// A right-angled elbow: A(0,0) -> B(100,0) -> C(100,100). The corner at index 1 is
// 90 degrees, so a fillet's setback equals its radius (tan 45 = 1) — which makes
// every number here checkable by hand.
const elbow: SketchPath = {
  kind: 'path',
  id: 'p',
  points: [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ],
  closed: false,
};

const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

describe('cornerNeighbours', () => {
  it('finds the three points of an interior corner', () => {
    const corner = cornerNeighbours(elbow, 1);
    expect(corner?.cornerMm).toEqual({ x: 100, y: 0 });
    expect(corner?.previousMm).toEqual({ x: 0, y: 0 });
    expect(corner?.nextMm).toEqual({ x: 100, y: 100 });
  });

  it('refuses the ends of an open path, which are not corners', () => {
    expect(cornerNeighbours(elbow, 0)).toBeNull();
    expect(cornerNeighbours(elbow, 2)).toBeNull();
  });

  it('wraps around on a closed path, so every vertex is a corner', () => {
    const closed: SketchPath = { ...elbow, closed: true };
    expect(cornerNeighbours(closed, 0)?.previousMm).toEqual({ x: 100, y: 100 });
    expect(cornerNeighbours(closed, 2)?.nextMm).toEqual({ x: 0, y: 0 });
  });

  it('refuses an out-of-range or non-integer index', () => {
    expect(cornerNeighbours(elbow, -1)).toBeNull();
    expect(cornerNeighbours(elbow, 9)).toBeNull();
    expect(cornerNeighbours(elbow, 1.5)).toBeNull();
  });
});

describe('chamferPathCorner', () => {
  it('replaces the vertex with exactly two setback points', () => {
    const result = chamferPathCorner(elbow, 1, 20);
    expect(result?.points).toHaveLength(4);
    expect(result?.points[1]).toEqual({ x: 80, y: 0 });
    expect(result?.points[2]).toEqual({ x: 100, y: 20 });
  });

  it('leaves the untouched vertices exactly where they were', () => {
    const result = chamferPathCorner(elbow, 1, 20);
    expect(result?.points[0]).toEqual({ x: 0, y: 0 });
    expect(result?.points[3]).toEqual({ x: 100, y: 100 });
  });

  it('is exact — the setback distance is the distance asked for', () => {
    const result = chamferPathCorner(elbow, 1, 37.5);
    const corner = { x: 100, y: 0 };
    expect(distance(result!.points[1]!, corner)).toBeCloseTo(37.5, 9);
    expect(distance(result!.points[2]!, corner)).toBeCloseTo(37.5, 9);
  });

  it('refuses a distance longer than a neighbouring leg rather than clamping it', () => {
    // The shorter leg is 100 mm, so 150 cannot fit.
    expect(chamferPathCorner(elbow, 1, 150)).toBeNull();
  });

  it('accepts a distance exactly equal to the shortest leg', () => {
    expect(chamferPathCorner(elbow, 1, 100)).not.toBeNull();
  });

  it('refuses a non-positive or non-finite distance', () => {
    expect(chamferPathCorner(elbow, 1, 0)).toBeNull();
    expect(chamferPathCorner(elbow, 1, -5)).toBeNull();
    expect(chamferPathCorner(elbow, 1, Number.NaN)).toBeNull();
  });

  it('refuses a collinear corner, which has no tip to remove', () => {
    const straight: SketchPath = {
      ...elbow,
      points: [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 100, y: 0 },
      ],
    };
    expect(chamferPathCorner(straight, 1, 10)).toBeNull();
  });

  it('refuses a doubled vertex', () => {
    const doubled: SketchPath = {
      ...elbow,
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
    };
    expect(chamferPathCorner(doubled, 1, 10)).toBeNull();
  });

  it('does not mutate the input path', () => {
    chamferPathCorner(elbow, 1, 20);
    expect(elbow.points).toHaveLength(3);
  });
});

describe('filletPathCorner', () => {
  const radius = 20;
  const result = filletPathCorner(elbow, 1, radius);

  it('places the arc centre on the bisector at the right distance', () => {
    // At 90 degrees the centre sits at (corner - r, corner + r) = (80, 20).
    expect(result?.centreMm.x).toBeCloseTo(80, 9);
    expect(result?.centreMm.y).toBeCloseTo(20, 9);
  });

  // The defining property of a fillet: EVERY sampled point is exactly one radius
  // from the centre. This is what proves it is a real arc and not a rounded guess.
  it('puts every arc point exactly one radius from the centre', () => {
    const centre = result!.centreMm;
    const arcPoints = result!.path.points.slice(1, -1);
    expect(arcPoints.length).toBeGreaterThan(2);
    for (const point of arcPoints) {
      expect(distance(point, centre)).toBeCloseTo(radius, 6);
    }
  });

  it('stays tangent to both legs — the arc ends sit on them', () => {
    const points = result!.path.points;
    const first = points[1]!;
    const last = points[points.length - 2]!;
    // The incoming leg runs along y = 0; the outgoing leg along x = 100. Compared
    // to a tolerance rather than exactly, because the setback is r / tan(theta/2)
    // and tan(PI/4) is not exactly 1 in floating point — the residual here is
    // about 4e-15 mm, which no machine can express.
    expect(first.x).toBeCloseTo(80, 9);
    expect(first.y).toBeCloseTo(0, 9);
    expect(last.x).toBeCloseTo(100, 9);
    expect(last.y).toBeCloseTo(20, 9);
  });

  it('keeps the path endpoints untouched', () => {
    const points = result!.path.points;
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points[points.length - 1]).toEqual({ x: 100, y: 100 });
  });

  it('reports the radius it applied', () => {
    expect(result?.radiusMm).toBe(radius);
  });

  // A fillet needs setback = r / tan(theta/2), which at a sharp corner exceeds the
  // radius — so a radius that chamfers happily can still fail to fillet.
  it('needs more room at a sharper corner than a chamfer of the same size', () => {
    const sharp: SketchPath = {
      kind: 'path',
      id: 'sharp',
      points: [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 0, y: 6 },
      ],
      closed: false,
    };
    // The chamfer fits at 40 mm; the fillet at the same size does not.
    expect(chamferPathCorner(sharp, 1, 40)).not.toBeNull();
    expect(filletPathCorner(sharp, 1, 40)).toBeNull();
  });

  it('refuses a radius too large for the legs', () => {
    expect(filletPathCorner(elbow, 1, 500)).toBeNull();
  });

  it('refuses a non-positive or non-finite radius', () => {
    expect(filletPathCorner(elbow, 1, 0)).toBeNull();
    expect(filletPathCorner(elbow, 1, -3)).toBeNull();
    expect(filletPathCorner(elbow, 1, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('refuses a collinear corner', () => {
    const straight: SketchPath = {
      ...elbow,
      points: [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 100, y: 0 },
      ],
    };
    expect(filletPathCorner(straight, 1, 10)).toBeNull();
  });

  it('rounds an interior corner of a closed path', () => {
    const square: SketchPath = {
      kind: 'path',
      id: 'sq',
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
      closed: true,
    };
    const rounded = filletPathCorner(square, 0, 15);
    expect(rounded).not.toBeNull();
    for (const point of rounded!.path.points.slice(0, 3)) {
      expect(distance(point, rounded!.centreMm)).toBeCloseTo(15, 5);
    }
  });

  it('is deterministic', () => {
    expect(filletPathCorner(elbow, 1, radius)).toEqual(filletPathCorner(elbow, 1, radius));
  });

  it('does not mutate the input path', () => {
    filletPathCorner(elbow, 1, radius);
    expect(elbow.points).toHaveLength(3);
  });
});
