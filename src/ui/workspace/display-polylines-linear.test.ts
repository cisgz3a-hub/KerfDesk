import { describe, expect, it } from 'vitest';
import {
  polylineToCurveSubpath,
  type ColoredPath,
  type Polyline,
  type Vec2,
} from '../../core/scene';
import {
  createDisplayPolylineCache,
  DISPLAY_CURVE_MIN_ERROR_PX,
  displayCurveToleranceMm,
  linearCurvePolylines,
} from './display-polylines';

const zigzag: Polyline = {
  closed: false,
  points: Array.from({ length: 200 }, (_, index) => ({ x: index * 0.3, y: index % 3 })),
};

const linePath: ColoredPath = {
  color: '#000000',
  polylines: [zigzag],
  curves: [polylineToCurveSubpath(zigzag)],
};

const cubicPath: ColoredPath = {
  color: '#000000',
  polylines: [zigzag],
  curves: [
    {
      start: { x: 0, y: 0 },
      closed: false,
      segments: [
        {
          kind: 'cubic',
          control1: { x: 10, y: 40 },
          control2: { x: 30, y: -40 },
          to: { x: 40, y: 0 },
        },
      ],
    },
  ],
};

describe('zoom-invariant display of straight-line curves', () => {
  it('returns one display entry for a line-only curve path at every tolerance', () => {
    const cache = createDisplayPolylineCache();
    const wide = cache.getPath(linePath, 0.5);
    const tight = cache.getPath(linePath, 0.005);
    expect(tight).toBe(wide);
    expect(wide.polylines).toHaveLength(1);
    expect(wide.polylines[0]?.points).toEqual(zigzag.points);
    expect(wide.segmentCount).toBe(199);
  });

  // ADR-359 Amendment 2: bent curves re-flatten only when the zoom crosses a
  // power of two, not on every wheel notch.
  it('re-flattens bent curves only when the zoom leaves its tolerance bucket', () => {
    const cache = createDisplayPolylineCache();
    const wide = cache.getPath(cubicPath, displayCurveToleranceMm(4));
    expect(cache.getPath(cubicPath, displayCurveToleranceMm(7.5))).toBe(wide);
    const tight = cache.getPath(cubicPath, displayCurveToleranceMm(8));
    expect(tight).not.toBe(wide);
    expect(tight.segmentCount).toBeGreaterThan(wide.segmentCount);
    expect(cache.getPath(cubicPath, displayCurveToleranceMm(15))).toBe(tight);
  });

  it('memoizes the materialized polylines per curve array and reports bends as null', () => {
    const curves = linePath.curves;
    if (curves === undefined) throw new Error('fixture');
    const first = linearCurvePolylines(curves);
    expect(linearCurvePolylines(curves)).toBe(first);
    expect(first?.[0]?.points).toEqual(zigzag.points);
    const bent = cubicPath.curves;
    if (bent === undefined) throw new Error('fixture');
    expect(linearCurvePolylines(bent)).toBeNull();
  });
});

// The fixture's one cubic, (0,0) (10,40) (30,-40) (40,0), at parameter t.
function cubicAt(t: number): Vec2 {
  const u = 1 - t;
  // Bernstein weights of the three points past the origin.
  const [b, c, d] = [3 * u * u * t, 3 * u * t * t, t * t * t];
  return { x: b * 10 + c * 30 + d * 40, y: b * 40 - c * 40 };
}

function distanceToSegment(point: Vec2, from: Vec2, to: Vec2): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq === 0
      ? 0
      : Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSq));
  return Math.hypot(point.x - (from.x + t * dx), point.y - (from.y + t * dy));
}

// Largest distance from the true curve (densely sampled) to the drawn polyline.
function largestDeviationMm(polyline: Polyline): number {
  let largest = 0;
  for (let i = 0; i <= 4000; i += 1) {
    const point = cubicAt(i / 4000);
    let nearest = Number.POSITIVE_INFINITY;
    for (let j = 1; j < polyline.points.length; j += 1) {
      const from = polyline.points[j - 1]!;
      nearest = Math.min(nearest, distanceToSegment(point, from, polyline.points[j]!));
    }
    largest = Math.max(largest, nearest);
  }
  return largest;
}

describe('display tolerance buckets (ADR-359 Amendment 2)', () => {
  it('reuses one flattening for all seven 1.1x wheel notches inside a power-of-two bucket', () => {
    const cache = createDisplayPolylineCache();
    const first = cache.getPath(cubicPath, displayCurveToleranceMm(4));
    for (let notch = 1; notch <= 7; notch += 1) {
      const scale = 4 * 1.1 ** notch;
      expect(scale).toBeLessThan(8);
      expect(cache.getPath(cubicPath, displayCurveToleranceMm(scale))).toBe(first);
    }
    const eighth = cache.getPath(cubicPath, displayCurveToleranceMm(4 * 1.1 ** 8));
    expect(eighth).not.toBe(first);
    expect(eighth.segmentCount).toBeGreaterThan(first.segmentCount);
  });

  it('zooms back into the last three buckets without flattening again', () => {
    const cache = createDisplayPolylineCache();
    const [at4, at8, at16] = [4, 8, 16].map((scale) =>
      cache.getPath(cubicPath, displayCurveToleranceMm(scale)),
    );
    expect(cache.getPath(cubicPath, displayCurveToleranceMm(9))).toBe(at8);
    expect(cache.getPath(cubicPath, displayCurveToleranceMm(5))).toBe(at4);
    expect(cache.getPath(cubicPath, displayCurveToleranceMm(17))).toBe(at16);
    // A fourth bucket drops the least recently drawn one, here 8 px/mm, so the
    // kept copies stay bounded; drawing it again flattens it afresh.
    cache.getPath(cubicPath, displayCurveToleranceMm(32));
    expect(cache.getPath(cubicPath, displayCurveToleranceMm(4))).toBe(at4);
    const again = cache.getPath(cubicPath, displayCurveToleranceMm(8));
    expect(again).not.toBe(at8);
    expect(again.polylines).toEqual(at8?.polylines);
  });

  it('keeps recent fill flattenings the same way', () => {
    const curves = (cubicPath.curves ?? []).map((curve) => ({ ...curve, closed: true }));
    const closed: ColoredPath = { ...cubicPath, curves };
    const cache = createDisplayPolylineCache();
    const coarse = cache.getFillPath(closed, displayCurveToleranceMm(4));
    expect(cache.getFillPath(closed, displayCurveToleranceMm(7))).toBe(coarse);
    const fine = cache.getFillPath(closed, displayCurveToleranceMm(8));
    expect(fine).not.toBe(coarse);
    expect(fine.segmentCount).toBeGreaterThan(coarse.segmentCount);
    expect(cache.getFillPath(closed, displayCurveToleranceMm(6))).toBe(coarse);
    expect(cache.getFillPath(closed, displayCurveToleranceMm(12))).toBe(fine);
  });

  it('keeps the screen error between 0.125 and 0.25 px at every scale', () => {
    const scales: number[] = [];
    for (let scale = 1e-3; scale < 1e4; scale *= 1.07) scales.push(scale);
    for (let exponent = -20; exponent <= 20; exponent += 1) {
      const power = 2 ** exponent;
      scales.push(power, power * (1 + Number.EPSILON), power * (1 - Number.EPSILON / 2));
    }
    for (const scale of scales) {
      const errorPx = displayCurveToleranceMm(scale) * scale;
      expect(errorPx).toBeGreaterThanOrEqual(DISPLAY_CURVE_MIN_ERROR_PX);
      expect(errorPx).toBeLessThan(2 * DISPLAY_CURVE_MIN_ERROR_PX);
    }
  });

  it('draws the curve itself within a quarter pixel of its true shape', () => {
    const cache = createDisplayPolylineCache();
    for (const scale of [0.7, 1, 3, 7.9, 8, 50]) {
      const drawn = cache.getPath(cubicPath, displayCurveToleranceMm(scale)).polylines[0]!;
      expect(largestDeviationMm(drawn) * scale).toBeLessThanOrEqual(0.25);
    }
  });
});
