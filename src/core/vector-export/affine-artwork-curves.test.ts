import { describe, expect, it } from 'vitest';
import type { Bounds, CurveSubpath, Vec2 } from '../scene/scene-object';
import {
  applyAffine,
  curvesBounds,
  flattenArtworkCurve,
  transformCurveSubpathExact,
  type AffineMatrix,
} from './affine-curves';
import { artworkArcReconstructionError, retainedArtworkArc } from './artwork-parametric-arc';
import { formatSvgPathData } from './svg-path-data';
import { decimalGridAtMost } from './decimal-grid';

const semicircle: CurveSubpath = {
  start: { x: 0, y: 1 },
  closed: false,
  segments: [
    {
      kind: 'elliptical-arc',
      radiusX: 1,
      radiusY: 1,
      rotationDeg: 0,
      largeArc: false,
      sweep: false,
      to: { x: 0, y: -1 },
    },
  ],
};

function matrix(scaleY: number, degrees: number, mirrored = false): AffineMatrix {
  const c = Math.cos((degrees * Math.PI) / 180);
  const s = Math.sin((degrees * Math.PI) / 180);
  return {
    a: (mirrored ? -1 : 1) * c,
    b: (mirrored ? -1 : 1) * s,
    c: -s * scaleY,
    d: c * scaleY,
    e: 100_000,
    f: -200_000,
  };
}

// Independent scalar calculus for x=a*cos(theta)+c*sin(theta)+e, and y likewise,
// on the right semicircle -pi/2 <= theta <= pi/2. No production arc helper.
function exactSemicircleBounds(m: AffineMatrix): Bounds {
  const angles = [-Math.PI / 2, Math.PI / 2];
  for (const [u, v] of [
    [m.a, m.c],
    [m.b, m.d],
  ]) {
    const root = Math.atan2(v as number, u as number);
    for (let turn = -2; turn <= 2; turn += 1) {
      const theta = root + turn * Math.PI;
      if (theta >= -Math.PI / 2 && theta <= Math.PI / 2) angles.push(theta);
    }
  }
  const points = angles.map((theta) => ({
    x: m.a * Math.cos(theta) + m.c * Math.sin(theta) + m.e,
    y: m.b * Math.cos(theta) + m.d * Math.sin(theta) + m.f,
  }));
  return {
    minX: Math.min(...points.map((p) => p.x)),
    maxX: Math.max(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxY: Math.max(...points.map((p) => p.y)),
  };
}

function pointDistance(p: Vec2, points: readonly Vec2[]): number {
  let best = Infinity;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1] as Vec2;
    const b = points[i] as Vec2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    const t =
      lengthSq === 0
        ? 0
        : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
    best = Math.min(best, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
  }
  return best;
}

describe('affine artwork arcs retain their complete parametric image', () => {
  for (const scaleY of [1, 1e-7, 1e-12, 1e-16, 1e-17, 0]) {
    for (const degrees of [0, 17, 90]) {
      for (const mirrored of [false, true]) {
        it(`bounds scaleY=${scaleY}, rotation=${degrees}, mirror=${mirrored}, far from the origin`, () => {
          const m = matrix(scaleY, degrees, mirrored);
          const b = curvesBounds([transformCurveSubpathExact(semicircle, m)]);
          expect(b).not.toBeNull();
          const exact = exactSemicircleBounds(m);
          for (const axis of ['minX', 'minY', 'maxX', 'maxY'] as const) {
            expect(Math.abs((b as Bounds)[axis] - exact[axis])).toBeLessThan(1e-8);
          }
        });
      }
    }
  }

  it('keeps an exact rank-one out-and-back traversal instead of its zero-length endpoint chord', () => {
    const m = { a: 1, b: 0, c: 0, d: 0, e: 0, f: 0 };
    const mapped = transformCurveSubpathExact(semicircle, m);
    expect(mapped.start).toEqual({ x: 0, y: 0 });
    expect(mapped.segments).toEqual([
      { kind: 'line', to: { x: 1, y: 0 } },
      { kind: 'line', to: { x: 0, y: 0 } },
    ]);
    expect(mapped.closed).toBe(false);
  });

  it('retains large-arc turnaround order and its reversed traversal', () => {
    const arc: CurveSubpath = {
      start: { x: 1, y: 0 },
      closed: false,
      segments: [
        {
          kind: 'elliptical-arc',
          radiusX: 1,
          radiusY: 1,
          rotationDeg: 0,
          largeArc: true,
          sweep: true,
          to: { x: 0, y: -1 },
        },
      ],
    };
    const reversed: CurveSubpath = {
      start: { x: 0, y: -1 },
      closed: false,
      segments: [
        {
          ...arc.segments[0],
          kind: 'elliptical-arc',
          radiusX: 1,
          radiusY: 1,
          rotationDeg: 0,
          largeArc: true,
          sweep: false,
          to: { x: 1, y: 0 },
        },
      ],
    };
    const m = { a: 1, b: -2, c: 0, d: 0, e: 5, f: 10 };
    const a = transformCurveSubpathExact(arc, m);
    const b = transformCurveSubpathExact(reversed, m);
    const forward = [a.start, ...a.segments.map((s) => s.to)];
    const backward = [b.start, ...b.segments.map((s) => s.to)].reverse();
    expect(forward).toHaveLength(backward.length);
    for (const [index, p] of forward.entries()) {
      expect(
        Math.hypot(p.x - (backward[index] as Vec2).x, p.y - (backward[index] as Vec2).y),
      ).toBeLessThan(1e-12);
    }
    expect(forward.some((p) => p.x === 4 && p.y === 12)).toBe(true);
  });

  it.each([1e-7, 1e-12, 1e-17])('keeps a positive minor singular value at scaleY=%s', (scaleY) => {
    const mapped = transformCurveSubpathExact(semicircle, {
      a: 1,
      b: 0,
      c: 0,
      d: scaleY,
      e: 0,
      f: 0,
    });
    const segment = mapped.segments[0];
    expect(segment?.kind).toBe('elliptical-arc');
    if (segment?.kind !== 'elliptical-arc') throw new Error('Missing arc');
    expect(segment.radiusY).toBe(scaleY);
    expect(retainedArtworkArc(segment)).not.toBeNull();
  });

  it.each([0.01, 0.0001, 0.000001])(
    'holds the requested world chord tolerance %s under an ill-conditioned shear',
    (toleranceMm) => {
      const m = { a: 700, b: 210, c: -1e-12, d: 4e-12, e: 1_000, f: -500 };
      const mapped = transformCurveSubpathExact(semicircle, m);
      const segment = mapped.segments[0];
      if (segment?.kind !== 'elliptical-arc') throw new Error('Missing arc');
      expect(artworkArcReconstructionError(mapped.start, segment)).toBeGreaterThan(toleranceMm);
      const result = flattenArtworkCurve(mapped, { toleranceMm });
      expect(result.kind).toBe('ok');
      if (result.kind !== 'ok') throw new Error('Flattening failed');
      // A millionth-mm tolerance still keeps the peak. The source endpoints are
      // practically identical in world coordinates, so a single chord fails.
      expect(result.polyline.points.some((p) => Math.abs(p.x - 1_700) < 1e-9)).toBe(true);
      for (let index = 0; index <= 2_000; index += 1) {
        const theta = Math.PI / 2 - (Math.PI * index) / 2_000;
        const point = applyAffine(m, { x: Math.cos(theta), y: Math.sin(theta) });
        expect(pointDistance(point, result.polyline.points)).toBeLessThanOrEqual(
          toleranceMm + 1e-9,
        );
      }
    },
  );

  it('reports a real segment-budget failure instead of accepting an inaccurate chord', () => {
    const mapped = transformCurveSubpathExact(semicircle, matrix(1e-16, 17));
    expect(flattenArtworkCurve(mapped, { toleranceMm: 1e-6, segmentBudget: 1 })).toEqual({
      kind: 'segment-budget-exceeded',
      segmentBudget: 1,
    });
  });

  it('preserves source radius correction, zero-radius lines and omitted coincident source arcs', () => {
    const m = { a: 1, b: 0, c: 0, d: 0, e: 0, f: 0 };
    const corrected: CurveSubpath = {
      ...semicircle,
      segments: [
        {
          ...semicircle.segments[0],
          kind: 'elliptical-arc',
          radiusX: 0.5,
          radiusY: 0.5,
          rotationDeg: 0,
          largeArc: false,
          sweep: false,
          to: { x: 0, y: -1 },
        },
      ],
    };
    expect(curvesBounds([transformCurveSubpathExact(corrected, m)])?.maxX).toBe(1);
    const zeroRadius: CurveSubpath = {
      ...corrected,
      segments: [
        {
          ...corrected.segments[0],
          kind: 'elliptical-arc',
          radiusX: 0,
          radiusY: 1,
          rotationDeg: 0,
          largeArc: false,
          sweep: false,
          to: { x: 0, y: -1 },
        },
      ],
    };
    expect(transformCurveSubpathExact(zeroRadius, m).segments).toHaveLength(1);
    expect(curvesBounds([transformCurveSubpathExact(zeroRadius, m)])?.maxX).toBe(0);
    const coincident: CurveSubpath = {
      ...semicircle,
      segments: [
        {
          ...semicircle.segments[0],
          kind: 'elliptical-arc',
          radiusX: 1,
          radiusY: 1,
          rotationDeg: 0,
          largeArc: true,
          sweep: true,
          to: semicircle.start,
        },
      ],
    };
    expect(curvesBounds([transformCurveSubpathExact(coincident, m)])?.maxX).toBe(0);
  });

  it('does not mutate the source or transform, and can compose another affine map', () => {
    const source = structuredClone(semicircle);
    Object.freeze(source.start);
    Object.freeze(source.segments[0]?.to);
    Object.freeze(source.segments[0]);
    Object.freeze(source.segments);
    Object.freeze(source);
    const m = Object.freeze(matrix(1e-16, 17));
    const first = transformCurveSubpathExact(source, m);
    const second = { a: -2, b: 0.3, c: 0.2, d: 3, e: 12, f: 14 };
    const composed: AffineMatrix = {
      a: second.a * m.a + second.c * m.b,
      b: second.b * m.a + second.d * m.b,
      c: second.a * m.c + second.c * m.d,
      d: second.b * m.c + second.d * m.d,
      e: second.a * m.e + second.c * m.f + second.e,
      f: second.b * m.e + second.d * m.f + second.f,
    };
    expect(source).toEqual(semicircle);
    expect(curvesBounds([transformCurveSubpathExact(first, second)])).toEqual(
      curvesBounds([transformCurveSubpathExact(source, composed)]),
    );
  });

  it('keeps the retained marker immutable and out of JSON serialization', () => {
    const mapped = transformCurveSubpathExact(semicircle, matrix(1e-16, 17));
    const segment = mapped.segments[0];
    if (segment?.kind !== 'elliptical-arc') throw new Error('Missing arc');
    const arc = retainedArtworkArc(segment);
    expect(arc).not.toBeNull();
    expect(Object.isFrozen(arc)).toBe(true);
    expect(Object.isFrozen(arc?.center)).toBe(true);
    expect(Object.isFrozen(arc?.u)).toBe(true);
    expect(Object.isFrozen(arc?.v)).toBe(true);
    expect(JSON.stringify(mapped)).not.toContain('artworkArc');
    const reloaded = JSON.parse(JSON.stringify(mapped)) as CurveSubpath;
    const reloadedSegment = reloaded.segments[0];
    if (reloadedSegment?.kind !== 'elliptical-arc') throw new Error('Missing reloaded arc');
    expect(retainedArtworkArc(reloadedSegment)).toBeNull();
  });

  it('writes a complete grid-bounded traversal for a mapped SVG arc with coincident world endpoints', () => {
    const mapped = transformCurveSubpathExact(semicircle, {
      a: 1,
      b: 0,
      c: 0,
      d: 1e-16,
      e: 100_000,
      f: -200_000,
    });
    expect(formatSvgPathData([mapped], decimalGridAtMost(0.001))).toBe(
      'M100000-200000L100001-200000 100000-200000',
    );
    expect(() => formatSvgPathData([mapped], null)).toThrow(
      'SVG cannot represent this mapped arc at full precision',
    );
    const ordinary = transformCurveSubpathExact(semicircle, { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
    expect(formatSvgPathData([ordinary], null)).toContain('A1 1 0 0 0 0-1');
  });
});
