import { describe, expect, it } from 'vitest';
import { flattenCurveSubpath } from '../scene/curve-path';
import type { CurveSubpath, Polyline, Vec2 } from '../scene/scene-object';
import {
  applyAffine,
  transformCurveSubpathExact,
  type AffineMatrix,
} from '../vector-export/affine-curves';
import { bakePathCurves } from './baked-path-curves';

const TOLERANCE = 0.025;

function flat(curve: CurveSubpath): Polyline {
  const result = flattenCurveSubpath(curve, { toleranceMm: TOLERANCE / 100 });
  if (result.kind !== 'ok') throw new Error('flatten failed');
  return result.polyline;
}

function distanceToPolyline(point: Vec2, polyline: Polyline): number {
  let best = Infinity;
  for (let index = 1; index < polyline.points.length; index += 1) {
    const a = polyline.points[index - 1] as Vec2;
    const b = polyline.points[index] as Vec2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    const t =
      lengthSq === 0
        ? 0
        : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq));
    best = Math.min(best, Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy)));
  }
  return best;
}

/** Hausdorff distance between the mapped source flattening and `candidate`'s. */
function burnError(source: CurveSubpath, matrix: AffineMatrix, candidate: CurveSubpath): number {
  const expected: Polyline = {
    closed: source.closed,
    points: flat(source).points.map((point) => applyAffine(matrix, point)),
  };
  const actual = flat(candidate);
  let worst = 0;
  for (const point of expected.points) worst = Math.max(worst, distanceToPolyline(point, actual));
  for (const point of actual.points) worst = Math.max(worst, distanceToPolyline(point, expected));
  return worst;
}

function bakeError(curve: CurveSubpath, matrix: AffineMatrix): number {
  const [baked] = bakePathCurves([curve], matrix);
  return burnError(curve, matrix, baked as CurveSubpath);
}

const halfEllipse: CurveSubpath = {
  start: { x: -20, y: 0 },
  segments: [
    {
      kind: 'elliptical-arc',
      radiusX: 20,
      radiusY: 8,
      rotationDeg: 15,
      largeArc: true,
      sweep: true,
      to: { x: 20, y: 0 },
    },
  ],
  closed: false,
};

describe('bakePathCurves (T26-P2-1)', () => {
  it('maps an arc through skew and non-uniform scale and keeps it a curve', () => {
    const skew: AffineMatrix = { a: 2.5, b: 0.4, c: 1.3, d: -0.7, e: 12, f: -3 };
    const [baked] = bakePathCurves([halfEllipse], skew);
    expect(baked?.segments.map((segment) => segment.kind)).toEqual(['elliptical-arc']);
    expect(bakeError(halfEllipse, skew)).toBeLessThan(TOLERANCE / 10);
  });

  it('writes only plain, serialisable scene segments', () => {
    const [baked] = bakePathCurves([halfEllipse], { a: 1, b: 0, c: 0.5, d: 1, e: 0, f: 0 });
    for (const segment of baked?.segments ?? []) {
      expect(Object.getOwnPropertySymbols(segment)).toHaveLength(0);
    }
    expect(JSON.parse(JSON.stringify(baked))).toEqual(baked);
  });

  it('writes cubics where the plain endpoint arc would drift on a very thin image', () => {
    // Nearly singular: the image ellipse is a sliver, and re-deriving its
    // centre from the stored endpoints moves the burn by about 0.003 mm.
    const squeeze: AffineMatrix = { a: 1, b: 0.9999999, c: 1, d: 1, e: 0, f: 0 };
    const plain = JSON.parse(
      JSON.stringify(transformCurveSubpathExact(halfEllipse, squeeze)),
    ) as CurveSubpath;
    const [baked] = bakePathCurves([halfEllipse], squeeze);
    expect(burnError(halfEllipse, squeeze, plain)).toBeGreaterThan(TOLERANCE / 10);
    expect(baked?.segments.every((segment) => segment.kind === 'cubic')).toBe(true);
    expect(baked?.segments.at(-1)?.to).toEqual(applyAffine(squeeze, { x: 20, y: 0 }));
    expect(bakeError(halfEllipse, squeeze)).toBeLessThan(TOLERANCE / 100);
  });

  it('maps lines and cubics through their points', () => {
    const curve: CurveSubpath = {
      start: { x: 0, y: 0 },
      segments: [
        { kind: 'line', to: { x: 5, y: 0 } },
        { kind: 'cubic', control1: { x: 6, y: 2 }, control2: { x: 3, y: 4 }, to: { x: 0, y: 5 } },
      ],
      closed: true,
    };
    const matrix: AffineMatrix = { a: 0, b: 2, c: -3, d: 0, e: 7, f: 1 };
    const [baked] = bakePathCurves([curve], matrix);
    expect(baked).toEqual({
      start: applyAffine(matrix, curve.start),
      segments: [
        { kind: 'line', to: applyAffine(matrix, { x: 5, y: 0 }) },
        {
          kind: 'cubic',
          control1: applyAffine(matrix, { x: 6, y: 2 }),
          control2: applyAffine(matrix, { x: 3, y: 4 }),
          to: applyAffine(matrix, { x: 0, y: 5 }),
        },
      ],
      closed: true,
    });
  });
});
