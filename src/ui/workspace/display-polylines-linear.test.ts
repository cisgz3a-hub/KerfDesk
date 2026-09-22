import { describe, expect, it } from 'vitest';
import { polylineToCurveSubpath, type ColoredPath, type Polyline } from '../../core/scene';
import { createDisplayPolylineCache, linearCurvePolylines } from './display-polylines';

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

  it('still re-flattens bent curves when the tolerance changes', () => {
    const cache = createDisplayPolylineCache();
    const wide = cache.getPath(cubicPath, 0.5);
    const tight = cache.getPath(cubicPath, 0.005);
    expect(tight).not.toBe(wide);
    expect(tight.segmentCount).toBeGreaterThan(wide.segmentCount);
    expect(cache.getPath(cubicPath, 0.005)).toBe(tight);
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
