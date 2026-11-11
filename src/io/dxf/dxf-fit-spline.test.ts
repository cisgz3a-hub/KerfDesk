import { describe, expect, it } from 'vitest';

import { parseDxf } from './parse-dxf';

function tags(...pairs: ReadonlyArray<readonly [number, string | number]>): string {
  return pairs.map(([code, value]) => `${code}\n${value}`).join('\n');
}

function entitiesDxf(...entities: ReadonlyArray<string>): string {
  return [
    tags([0, 'SECTION'], [2, 'ENTITIES']),
    ...entities,
    tags([0, 'ENDSEC']),
    tags([0, 'EOF']),
  ].join('\n');
}

// Audit O2-P2-1 (Oracle audit O1): the DXF Reference lets a SPLINE carry only
// fit points (codes 11/21, count 74); AutoCAD builds the curve through them
// and ezdxf's add_spline(fit_points) writes that form. It must import as a
// curve through every fit point, not be skipped.
describe('fit-point-only SPLINE (O2-P2-1)', () => {
  function fitSpline(
    flags: number,
    fit: ReadonlyArray<readonly [number, number]>,
    extra: ReadonlyArray<readonly [number, string | number]> = [],
  ) {
    return tags(
      [0, 'SPLINE'],
      [70, flags],
      [71, 3],
      [72, 0],
      [73, 0],
      [74, fit.length],
      ...extra,
      ...fit.flatMap(([x, y]) => [[11, x] as const, [21, y] as const]),
    );
  }
  function onlyPolyline(dxf: string) {
    const result = parseDxf({ dxfText: dxf, id: 'fit', source: 'fit.dxf' });
    if (result.kind !== 'ok' || result.object === null) throw new Error('nothing imported');
    const polyline = result.object.paths[0]?.polylines[0];
    if (polyline === undefined) throw new Error('no polyline');
    return polyline;
  }
  // Distance from (x, y) to the nearest imported vertex.
  function nearest(points: ReadonlyArray<{ x: number; y: number }>, x: number, y: number) {
    return Math.min(...points.map((point) => Math.hypot(point.x - x, point.y - y)));
  }

  it('passes through every fit point of an open spline', () => {
    const fit = [
      [0, 0],
      [10, 10],
      [20, 0],
      [30, 10],
    ] as const;
    const polyline = onlyPolyline(entitiesDxf(fitSpline(8, fit)));
    expect(polyline.closed).toBe(false);
    // The first vertex is fit point (0, 0); the import moves the drawing to the
    // origin corner and flips Y, so fit (x, y) lands at (first.x + x, first.y - y).
    const first = polyline.points[0] as { x: number; y: number };
    for (const [x, y] of fit) {
      expect(nearest(polyline.points, first.x + x, first.y - y)).toBeLessThan(1e-9);
    }
    expect((polyline.points.at(-1)?.x as number) - first.x).toBeCloseTo(30, 9);
  });

  it('closes a closed fit-point spline through points on a circle', () => {
    const radius = 10;
    const fit = Array.from({ length: 8 }, (_, i) => {
      const angle = (i * Math.PI) / 4;
      return [radius * Math.cos(angle), radius * Math.sin(angle)] as const;
    });
    const polyline = onlyPolyline(entitiesDxf(fitSpline(1 | 8, fit)));
    expect(polyline.closed).toBe(true);
    // The import moves the drawing to the origin corner: the circle's centre
    // is the middle of its bounds. A periodic cubic through 8 points of a
    // circle stays within 0.05 mm of it at r = 10 mm.
    const xs = polyline.points.map((point) => point.x);
    const ys = polyline.points.map((point) => point.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    for (const point of polyline.points) {
      expect(Math.abs(Math.hypot(point.x - cx, point.y - cy) - radius)).toBeLessThan(0.05);
    }
  });

  it('leaves along the start tangent the file gives (codes 12/22)', () => {
    // Fit points on a horizontal line, start tangent straight up: the curve
    // must rise above the line before coming back to it.
    const fit = [
      [0, 0],
      [10, 0],
      [20, 0],
    ] as const;
    const polyline = onlyPolyline(
      entitiesDxf(
        fitSpline(8, fit, [
          [12, 0],
          [22, 1],
          [32, 0],
        ]),
      ),
    );
    const ys = polyline.points.map((point) => point.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(1);
  });
});
