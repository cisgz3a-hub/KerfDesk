import { describe, expect, it } from 'vitest';
import { flattenCurveSubpath } from '../scene/curve-path';
import type { CurveSubpath, PathSegment, Vec2 } from '../scene/scene-object';
import { transformCurveSubpathExact } from './affine-curves';
import { splitCircularBulge } from './bulge-arc-fit';
import { curveToBulgeRing } from './bulge-rings';
import { hausdorff, sampleBulges } from './bulge-sampling.test-support';

const TOLERANCE_MM = 0.01;
const KAPPA = 0.5522847498307936;

/** Dense points of the true curve. */
function source(curve: CurveSubpath): Vec2[] {
  const result = flattenCurveSubpath(curve, { toleranceMm: 1e-5 });
  if (result.kind !== 'ok') throw new Error('flatten failed');
  return [...result.polyline.points];
}

function cubicCircle(cx: number, cy: number, r: number, clockwiseOnScreen: boolean): CurveSubpath {
  const k = r * KAPPA;
  const s = clockwiseOnScreen ? 1 : -1;
  const segments: PathSegment[] = [];
  const quad = [
    { x: cx + r, y: cy },
    { x: cx, y: cy + s * r },
    { x: cx - r, y: cy },
    { x: cx, y: cy - s * r },
  ];
  for (let q = 0; q < 4; q += 1) {
    const a = quad[q]!;
    const b = quad[(q + 1) % 4]!;
    const ta = { x: -(a.y - cy) * s, y: (a.x - cx) * s };
    const tb = { x: -(b.y - cy) * s, y: (b.x - cx) * s };
    segments.push({
      kind: 'cubic',
      control1: { x: a.x + (ta.x / r) * k, y: a.y + (ta.y / r) * k },
      control2: { x: b.x - (tb.x / r) * k, y: b.y - (tb.y / r) * k },
      to: b,
    });
  }
  return { start: quad[0]!, segments, closed: true };
}

const ellipseArcs: CurveSubpath = {
  start: { x: 40, y: 10 },
  closed: true,
  segments: [
    { x: 20, y: 20 },
    { x: 0, y: 10 },
    { x: 20, y: 0 },
    { x: 40, y: 10 },
  ].map((to) => ({
    kind: 'elliptical-arc' as const,
    radiusX: 20,
    radiusY: 10,
    rotationDeg: 30,
    largeArc: false,
    sweep: true,
    to,
  })),
};

const cases: ReadonlyArray<readonly [string, CurveSubpath]> = [
  ['a cubic circle, clockwise on screen', cubicCircle(10, 10, 8, true)],
  ['a cubic circle, counter-clockwise on screen', cubicCircle(10, 10, 8, false)],
  ['a large cubic circle', cubicCircle(0, 0, 400, true)],
  ['a rotated elliptical ellipse', ellipseArcs],
  [
    'a circle under a non-uniform scale',
    transformCurveSubpathExact(cubicCircle(0, 0, 5, true), {
      a: 3,
      b: 0,
      c: 0.4,
      d: 1,
      e: 0,
      f: 0,
    }),
  ],
  [
    'an S-curve',
    {
      start: { x: 0, y: 0 },
      closed: false,
      segments: [
        {
          kind: 'cubic',
          control1: { x: 30, y: -25 },
          control2: { x: -10, y: 45 },
          to: { x: 25, y: 20 },
        },
      ],
    },
  ],
  ['a tiny arc (radius 0.2 mm)', cubicCircle(1, 1, 0.2, true)],
  ['a tinier arc (radius 0.03 mm)', cubicCircle(1, 1, 0.03, false)],
  [
    'a near-straight cubic',
    {
      start: { x: 0, y: 0 },
      closed: false,
      segments: [
        {
          kind: 'cubic',
          control1: { x: 20, y: 0.02 },
          control2: { x: 40, y: -0.015 },
          to: { x: 60, y: 0.01 },
        },
      ],
    },
  ],
  [
    'a cusp',
    {
      start: { x: 0, y: 0 },
      closed: false,
      segments: [
        {
          kind: 'cubic',
          control1: { x: 10, y: 10 },
          control2: { x: 0, y: 10 },
          to: { x: 10, y: 0 },
        },
      ],
    },
  ],
  [
    'curves meeting lines at corners',
    {
      start: { x: 0, y: 0 },
      closed: true,
      segments: [
        { kind: 'line', to: { x: 20, y: 0 } },
        {
          kind: 'cubic',
          control1: { x: 25, y: 5 },
          control2: { x: 25, y: 15 },
          to: { x: 20, y: 20 },
        },
        { kind: 'line', to: { x: 0, y: 20 } },
      ],
    },
  ],
];

describe('DXF arc bulges (ADR-452)', () => {
  it.each(cases)(
    'keeps %s within the tolerance both ways',
    (_name, curve) => {
      const ring = curveToBulgeRing(curve, TOLERANCE_MM);
      const drawn = sampleBulges(ring.vertices, ring.closed);
      expect(hausdorff(source(curve), drawn)).toBeLessThanOrEqual(TOLERANCE_MM);
      for (const vertex of ring.vertices) expect(Math.abs(vertex.bulge)).toBeLessThan(1);
    },
    60_000,
  );

  it('writes far fewer vertices than 0.01 mm chords', () => {
    for (const [, curve] of cases.slice(0, 6)) {
      const ring = curveToBulgeRing(curve, TOLERANCE_MM);
      const chords = flattenCurveSubpath(curve, { toleranceMm: TOLERANCE_MM });
      if (chords.kind !== 'ok') throw new Error('flatten failed');
      // ADR-442's near-fewest chords narrowed the margin from 3x to about 2.4x.
      expect(ring.vertices.length * 2).toBeLessThan(chords.polyline.points.length);
    }
  });

  it('signs every bulge with the ring orientation in the Y-up frame', () => {
    // Mirroring the numbers keeps what the eye sees: a ring clockwise on the
    // Y-down screen is clockwise in the Y-up DXF too, so its bulges are negative.
    const cw = curveToBulgeRing(cubicCircle(0, 0, 8, true), TOLERANCE_MM);
    const ccw = curveToBulgeRing(cubicCircle(0, 0, 8, false), TOLERANCE_MM);
    const arcs = (ring: typeof cw): number[] =>
      ring.vertices.map((v) => v.bulge).filter((b) => b !== 0);
    expect(arcs(cw).length).toBeGreaterThanOrEqual(2);
    expect(arcs(cw).every((b) => b < 0 && b > -1)).toBe(true);
    expect(arcs(ccw).length).toBeGreaterThanOrEqual(2);
    expect(arcs(ccw).every((b) => b > 0 && b < 1)).toBe(true);
    expect(cw.closed && ccw.closed).toBe(true);
  });

  it('keeps corners and run ends at their exact positions', () => {
    const curve = cases[cases.length - 1]![1];
    const ring = curveToBulgeRing(curve, TOLERANCE_MM);
    const at = (x: number, y: number): boolean => ring.vertices.some((v) => v.x === x && v.y === y);
    expect(at(0, 0) && at(20, 0) && at(20, 20) && at(0, 20)).toBe(true);
    // The straight edges stay straight.
    const zero = ring.vertices.find((v) => v.x === 0 && v.y === 0);
    expect(zero?.bulge).toBe(0);
  });

  it('splits native arcs over a half circle into exact parts', () => {
    // A 270-degree arc (bulge tan(67.5 deg)) from (10, 0) to (0, -10).
    const from = { x: 10, y: 0 };
    const to = { x: 0, y: -10 };
    for (const sign of [1, -1]) {
      const bulge = sign * Math.tan((3 * Math.PI) / 8);
      const edges = splitCircularBulge(from, to, bulge);
      expect(edges).toHaveLength(2);
      for (const edge of edges) {
        expect(edge.bulge).toBeCloseTo(sign * Math.tan((3 * Math.PI) / 16), 14);
      }
      const whole = sampleBulges(
        [
          { ...from, bulge },
          { ...to, bulge: 0 },
        ],
        false,
      );
      const parts = sampleBulges(
        [
          { ...from, bulge: edges[0]!.bulge },
          { ...edges[0]!.to, bulge: edges[1]!.bulge },
          { ...to, bulge: 0 },
        ],
        false,
      );
      expect(hausdorff(whole, parts)).toBeLessThan(1e-3);
    }
  });
});
