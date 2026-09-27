import { describe, expect, it } from 'vitest';
import { flattenCurveSubpath } from '../scene/curve-path';
import type { CubicPathSegment, CurveSubpath, Vec2 } from '../scene/scene-object';
import { applyAffine, curvesBounds, transformCurveSubpathExact } from './affine-curves';
import { circularBulge, curveToBulgeRing, segmentDistance } from './bulge-rings';
import { groupContoursWithHoles } from './contour-nesting';
import {
  decimalGridAtMost,
  formatGridIndex,
  formatOnGrid,
  outwardGridIndices,
} from './decimal-grid';

function flat(curve: CurveSubpath, tolerance = 1e-6): Vec2[] {
  const result = flattenCurveSubpath(curve, { toleranceMm: tolerance });
  if (result.kind !== 'ok') throw new Error('flatten failed');
  return [...result.polyline.points];
}

function distanceToPolyline(p: Vec2, line: ReadonlyArray<Vec2>): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i += 1) {
    best = Math.min(best, segmentDistance(p, line[i - 1] as Vec2, line[i] as Vec2));
  }
  return best;
}

function cubicPoint(p0: Vec2, s: CubicPathSegment, t: number): Vec2 {
  const u = 1 - t;
  const b = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t] as const;
  return {
    x: b[0] * p0.x + b[1] * s.control1.x + b[2] * s.control2.x + b[3] * s.to.x,
    y: b[0] * p0.y + b[1] * s.control1.y + b[2] * s.control2.y + b[3] * s.to.y,
  };
}

function rect(x: number, y: number, w: number, h: number): CurveSubpath {
  return {
    start: { x, y },
    closed: true,
    segments: [
      { kind: 'line', to: { x: x + w, y } },
      { kind: 'line', to: { x: x + w, y: y + h } },
      { kind: 'line', to: { x, y: y + h } },
    ],
  };
}

describe('decimal grid', () => {
  it('prints snapped coordinates without binary noise', () => {
    const grid = decimalGridAtMost(0.001);
    expect(grid.exponent).toBe(-3);
    expect(formatOnGrid(0.1 + 0.2, grid)).toBe('0.3');
    expect(formatOnGrid(-0.0004, grid)).toBe('0');
    expect(formatOnGrid(-12.3456, grid)).toBe('-12.346');
    expect(formatGridIndex(5, grid)).toBe('0.005');
    expect(decimalGridAtMost(0.0025).exponent).toBe(-3);
  });

  it('rounds an interval outward without pushing exact grid values a step out', () => {
    const grid = decimalGridAtMost(0.001);
    expect(outwardGridIndices(0, 10, grid)).toEqual({ lo: 0, hi: 10000 });
    expect(outwardGridIndices(-0.0001, 9.9989, grid)).toEqual({ lo: -1, hi: 9999 });
  });
});

describe('exact affine curve transform and bounds', () => {
  const arc: CurveSubpath = {
    start: { x: 10, y: 0 },
    closed: false,
    segments: [
      {
        kind: 'elliptical-arc',
        radiusX: 10,
        radiusY: 4,
        rotationDeg: 25,
        largeArc: true,
        sweep: true,
        to: { x: -3, y: 5 },
      },
    ],
  };

  it('maps an elliptical arc to the exact image arc under shear, scale and mirror', () => {
    const matrix = { a: 1.7, b: 0.4, c: -0.9, d: -1.2, e: 5, f: -2 };
    const mapped = flat(arc, 1e-4).map((p) => applyAffine(matrix, p));
    const image = flat(transformCurveSubpathExact(arc, matrix), 1e-4);
    // Both sides are flattened within 1e-4 before the (at most ~2.3x) map.
    for (const point of mapped) expect(distanceToPolyline(point, image)).toBeLessThan(1e-3);
    for (const point of image) expect(distanceToPolyline(point, mapped)).toBeLessThan(1e-3);
    expect(mapped.at(-1)?.x).toBeCloseTo(image.at(-1)?.x ?? NaN, 12);
  });

  it('bounds cubics by their derivative roots, not their control hull', () => {
    const bulge: CurveSubpath = {
      start: { x: 0, y: 0 },
      closed: false,
      segments: [
        {
          kind: 'cubic',
          control1: { x: 0, y: -8 },
          control2: { x: 10, y: -8 },
          to: { x: 10, y: 0 },
        },
      ],
    };
    // The curve peaks at t = 1/2: y = -8 * 3/4 = -6, not the hull's -8.
    expect(curvesBounds([bulge])).toEqual({ minX: 0, minY: -6, maxX: 10, maxY: 0 });
  });
});

describe('bulge rings', () => {
  const cubics: ReadonlyArray<[Vec2, CubicPathSegment]> = [
    [
      { x: 0, y: 0 },
      {
        kind: 'cubic',
        control1: { x: 10, y: 20 },
        control2: { x: 20, y: -20 },
        to: { x: 30, y: 0 },
      },
    ],
    // Control points past the endpoints along the chord: line distance would be 0.
    [
      { x: 0, y: 0 },
      {
        kind: 'cubic',
        control1: { x: -10, y: 0.001 },
        control2: { x: 20, y: 0 },
        to: { x: 10, y: 0 },
      },
    ],
    // A cusp.
    [
      { x: 0, y: 0 },
      { kind: 'cubic', control1: { x: 10, y: 10 }, control2: { x: 0, y: 10 }, to: { x: 10, y: 0 } },
    ],
  ];

  it.each(cubics)(
    'keeps a flattened cubic within the tolerance in both directions',
    (from, segment) => {
      const tolerance = 0.01;
      const ring = curveToBulgeRing({ start: from, segments: [segment], closed: false }, tolerance);
      const vertices = ring.vertices.map((v) => ({ x: v.x, y: v.y }));
      let worst = 0;
      for (let i = 0; i <= 2000; i += 1) {
        worst = Math.max(worst, distanceToPolyline(cubicPoint(from, segment, i / 2000), vertices));
      }
      expect(worst).toBeLessThanOrEqual(tolerance);
      const dense = Array.from({ length: 4001 }, (_, i) => cubicPoint(from, segment, i / 4000));
      for (const vertex of vertices)
        expect(distanceToPolyline(vertex, dense)).toBeLessThan(1e-9 + 1e-3);
      expect(ring.vertices.every((v) => v.bulge === 0)).toBe(true);
    },
  );

  it('writes circular arcs as exact signed bulges in the Y-up frame', () => {
    const half = {
      kind: 'elliptical-arc' as const,
      radiusX: 5,
      radiusY: 5,
      rotationDeg: 0,
      largeArc: false,
      to: { x: 10, y: 0 },
    };
    expect(circularBulge({ x: 0, y: 0 }, { ...half, sweep: false })).toBeCloseTo(1, 12);
    expect(circularBulge({ x: 0, y: 0 }, { ...half, sweep: true })).toBeCloseTo(-1, 12);
    // Radii too small for the chord scale up to a semicircle, as SVG requires.
    expect(
      circularBulge({ x: 0, y: 0 }, { ...half, radiusX: 1, radiusY: 1, sweep: false }),
    ).toBeCloseTo(1, 12);
    const large = { ...half, radiusX: 10, radiusY: 10, largeArc: true, sweep: false };
    const included = 2 * Math.PI - 2 * Math.asin(0.5);
    expect(circularBulge({ x: 0, y: 0 }, large)).toBeCloseTo(Math.tan(included / 4), 12);
    expect(circularBulge({ x: 0, y: 0 }, { ...half, radiusY: 3, sweep: false })).toBeNull();
  });
});

describe('outer contour and hole grouping', () => {
  it('assigns holes to their smallest container and nested islands to their own group', () => {
    const contours = [
      rect(40, 0, 10, 10), // separate island
      rect(0, 0, 30, 30), // outer
      rect(5, 5, 20, 20), // hole
      rect(10, 10, 5, 5), // island inside the hole
      rect(11, 11, 2, 2), // hole of that island
      rect(26, 26, 2, 2), // second hole of the outer
    ];
    expect(groupContoursWithHoles(contours)).toEqual([
      { outer: 0, holes: [] },
      { outer: 1, holes: [2, 5] },
      { outer: 3, holes: [4] },
    ]);
  });

  it('decides containment past vertices shared at a saddle join', () => {
    // A hole touching its outer at one corner, as a traced diagonal join does.
    const outer = rect(0, 0, 10, 10);
    const hole: CurveSubpath = {
      start: { x: 0, y: 0 },
      closed: true,
      segments: [
        { kind: 'line', to: { x: 4, y: 2 } },
        { kind: 'line', to: { x: 2, y: 4 } },
      ],
    };
    expect(groupContoursWithHoles([outer, hole])).toEqual([{ outer: 0, holes: [1] }]);
  });
});
