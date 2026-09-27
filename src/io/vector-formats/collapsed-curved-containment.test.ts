import { describe, expect, it } from 'vitest';
import { flattenCurveSubpath } from '../../core/scene/curve-path';
import type { CubicPathSegment, CurveSubpath, Vec2 } from '../../core/scene/scene-object';
import { writeEpsDocument } from './eps-writer';
import { writePdfDocument } from './pdf-writer';
import type { VectorFillRule, VectorPaintItem } from './vector-artwork';

const point = (x: number, y: number): Vec2 => ({ x, y });
const micro = (x: number, y: number): Vec2 => point(x / 1000, y / 1000);
const polygon = (points: Vec2[]): CurveSubpath => ({
  start: points[0] as Vec2,
  closed: true,
  segments: points.slice(1).map((to) => ({ kind: 'line', to })),
});
const item = (curves: CurveSubpath[], fillRule: VectorFillRule = 'evenodd'): VectorPaintItem => ({
  color: '#000000',
  paint: 'fill',
  fillRule,
  curves,
});
const FINE_PAGE = { precisionMm: 0.001, page: { minX: 0, minY: 0, maxX: 0.02, maxY: 0.02 } };
const LONE = polygon([micro(12, 12), micro(16, 12), micro(16, 16), micro(12, 16)]);
const WRITERS = [
  ['PDF', writePdfDocument],
  ['EPS', writeEpsDocument],
] as const;

function fineLens(): CurveSubpath {
  return {
    start: micro(0, 0),
    closed: true,
    segments: [
      {
        kind: 'cubic',
        control1: micro(2.49, 0.51),
        control2: micro(6.49, 2.51),
        to: micro(8, 4),
      },
      {
        kind: 'cubic',
        control1: micro(5.51, 3.49),
        control2: micro(1.51, 1.49),
        to: micro(0, 0),
      },
    ],
  };
}

// Independent cubic polynomial: solve each monotone side at an authored x.
// This verifies the fixture's child lies inside the real lens, not just its
// endpoints or the production containment flattener.
function yAtX(from: Vec2, segment: CubicPathSegment, x: number): number {
  const evaluate = (t: number, axis: 'x' | 'y'): number => {
    const u = 1 - t;
    return (
      u ** 3 * from[axis] +
      3 * u ** 2 * t * segment.control1[axis] +
      3 * u * t ** 2 * segment.control2[axis] +
      t ** 3 * segment.to[axis]
    );
  };
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 50; i += 1) {
    const mid = (lo + hi) / 2;
    if (evaluate(mid, 'x') < x === from.x < segment.to.x) lo = mid;
    else hi = mid;
  }
  return evaluate((lo + hi) / 2, 'y');
}

describe('collapsed curved contour containment', () => {
  it.each(['evenodd', 'nonzero'] as const)(
    'removes the fine-grid lens and its surviving child together under %s',
    (fillRule) => {
      const lens = fineLens();
      const childPoints = [micro(3, 1.3), micro(5, 2.3), micro(5, 2.7), micro(3, 1.7)];
      const upper = lens.segments[0] as CubicPathSegment;
      const lower = lens.segments[1] as CubicPathSegment;
      for (const [index, from] of childPoints.entries()) {
        const to = childPoints[(index + 1) % childPoints.length] as Vec2;
        for (let sample = 0; sample <= 100; sample += 1) {
          const t = sample / 100;
          const p = point(from.x + t * (to.x - from.x), from.y + t * (to.y - from.y));
          expect(p.y).toBeGreaterThan(yAtX(lens.start, upper, p.x));
          expect(p.y).toBeLessThan(yAtX(upper.to, lower, p.x));
        }
      }
      for (const [, write] of WRITERS) {
        const document = write([item([lens, polygon(childPoints), LONE], fillRule)], FINE_PAGE);
        const moves = [...document.text.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?) m(?=\s)/g)];
        expect(moves.map((match) => [match[1], match[2]])).toEqual([['0.012', '0.008']]);
      }
    },
  );

  it.each(WRITERS)(
    '%s reports a real flattening limit instead of trusting endpoints',
    (_, write) => {
      const band = polygon([
        point(0.49, -0.49),
        point(8.49, 3.51),
        point(7.51, 4.49),
        point(-0.49, 0.49),
      ]);
      const hole = [point(1.1, 0.2), point(7.1, 3.2), point(6.9, 3.8), point(0.9, 0.8)];
      const crossing: CurveSubpath = {
        start: hole[0] as Vec2,
        closed: true,
        segments: [
          { kind: 'cubic', control1: point(3, -10), control2: point(5, -10), to: hole[1] as Vec2 },
          ...hole.slice(2).map((to) => ({ kind: 'line' as const, to })),
          ...Array.from({ length: 200_001 }, () => ({
            kind: 'line' as const,
            to: hole[0] as Vec2,
          })),
        ],
      };
      // At t=.5 the actual cubic reaches y=-7.075, outside the band's entire
      // y range [-.49,4.49], although all segment endpoints fit inside it.
      expect((0.2 - 30 - 30 + 3.2) / 8).toBeLessThan(-0.49);
      expect(flattenCurveSubpath(crossing, { toleranceMm: 0.01 }).kind).toBe(
        'segment-budget-exceeded',
      );
      expect(() =>
        write([item([band, crossing])], {
          precisionMm: 1,
          page: { minX: -10, minY: -20, maxX: 30, maxY: 20 },
        }),
      ).toThrow(/containment.*200000/i);
    },
  );

  it.each(WRITERS)(
    '%s reports an unresolved thinner lens instead of orphaning its child',
    (_, write) => {
      const delta = 0.0001;
      const lens: CurveSubpath = {
        start: micro(0, 0),
        closed: true,
        segments: [
          {
            kind: 'cubic',
            control1: micro(2, 1 - delta),
            control2: micro(6, 3 - delta),
            to: micro(8, 4),
          },
          {
            kind: 'cubic',
            control1: micro(6, 3 + delta),
            control2: micro(2, 1 + delta),
            to: micro(0, 0),
          },
        ],
      };
      const child = polygon([
        micro(3, 1.5 - delta / 4),
        micro(5, 2.5 - delta / 4),
        micro(5, 2.5 + delta / 4),
        micro(3, 1.5 + delta / 4),
      ]);
      expect(() => write([item([lens, child, LONE])], FINE_PAGE)).toThrow(
        /cannot resolve.*collapsed curved contour/i,
      );
    },
  );
});
