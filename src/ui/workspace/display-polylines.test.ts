import { describe, expect, it } from 'vitest';

import type { Polyline, Vec2 } from '../../core/scene';
import { countPolylineSegments } from './draw-complexity';
import { buildDisplayPolylines, createDisplayPolylineCache } from './display-polylines';

describe('display polyline cache', () => {
  it('retessellates canonical curves as screen tolerance tightens and caches the zoom result', () => {
    const cache = createDisplayPolylineCache();
    const path = {
      color: '#000000',
      polylines: [
        {
          points: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
          ],
          closed: false,
        },
      ],
      curves: [
        {
          start: { x: 0, y: 0 },
          segments: [
            {
              kind: 'cubic' as const,
              control1: { x: 0, y: 100 },
              control2: { x: 100, y: 100 },
              to: { x: 100, y: 0 },
            },
          ],
          closed: false,
        },
      ],
    };
    const coarse = cache.getPath(path, 1);
    const fine = cache.getPath(path, 0.01);
    const repeated = cache.getPath(path, 0.01);

    expect(fine.segmentCount).toBeGreaterThan(coarse.segmentCount);
    expect(repeated).toBe(fine);
  });

  it('builds a bounded display copy without reading every source point', () => {
    const cache = createDisplayPolylineCache();
    const pointCount = 30_001;
    const budget = 3_000;
    const readBudget = 8_000;
    let pointReads = 0;
    const points = watchedPoints(pointCount, () => {
      pointReads += 1;
    });

    const display = cache.get([{ closed: false, points }], budget);

    expect(display.isSimplified).toBe(true);
    expect(countPolylineSegments(display.polylines)).toBeLessThanOrEqual(budget);
    expect(pointReads).toBeLessThan(readBudget);
  });

  it('decimates an over-budget polyline into ONE connected coarse polyline', () => {
    // The 2026-07-05 defect: the old sampler emitted every Nth segment as its
    // own two-point polyline, so a freshly traced logo rendered as
    // disconnected dashes — indistinguishable from broken geometry.
    // Decimation must keep each polyline a single connected chain with both
    // endpoints intact.
    const cache = createDisplayPolylineCache();
    const points = Array.from({ length: 9_001 }, (_, x) => ({ x, y: 0 }));
    const display = cache.get([{ closed: false, points }], 3_000);

    expect(display.isSimplified).toBe(true);
    expect(display.polylines).toHaveLength(1);
    const decimated = display.polylines[0];
    expect(decimated).toBeDefined();
    if (decimated === undefined) return;
    expect(decimated.points.length).toBeGreaterThan(2_000);
    expect(decimated.points[0]).toBe(points[0]);
    expect(decimated.points.at(-1)).toBe(points.at(-1));
  });

  it('preserves the closed flag and seam duplicate through decimation', () => {
    const cache = createDisplayPolylineCache();
    const ringPoints = Array.from({ length: 6_000 }, (_, i) => ({
      x: Math.cos((i / 6_000) * 2 * Math.PI),
      y: Math.sin((i / 6_000) * 2 * Math.PI),
    }));
    // Closed rings carry an explicit closing duplicate (job.ts invariant).
    const withSeam = [...ringPoints, { ...(ringPoints[0] as { x: number; y: number }) }];
    const display = cache.get([{ closed: true, points: withSeam }], 1_000);

    const decimated = display.polylines[0];
    expect(decimated).toBeDefined();
    if (decimated === undefined) return;
    expect(decimated.closed).toBe(true);
    expect(decimated.points.at(-1)).toBe(withSeam.at(-1));
  });

  it('reuses the sampled display copy for the same immutable source polylines', () => {
    const cache = createDisplayPolylineCache();
    const pointCount = 30_001;
    let pointReads = 0;
    const source = [
      {
        closed: false,
        points: watchedPoints(pointCount, () => {
          pointReads += 1;
        }),
      },
    ];

    const first = cache.get(source);
    const readsAfterFirst = pointReads;
    const second = cache.get(source);

    expect(second).toBe(first);
    expect(pointReads).toBe(readsAfterFirst);
  });
});

function watchedPoints(length: number, onRead: () => void): ReadonlyArray<Vec2> {
  return new Proxy(
    Array.from({ length }, (_, x) => ({ x, y: 0 })),
    {
      get(target, prop, receiver) {
        if (typeof prop === 'string' && /^\d+$/.test(prop)) onRead();
        return Reflect.get(target, prop, receiver);
      },
    },
  );
}

describe('polyline-count decimation (large-DXF lag fix)', () => {
  // A 200 MB DXF of LINE entities arrives as millions of TWO-POINT polylines.
  // Vertex decimation cannot touch those, so the budget used to do nothing and
  // the canvas built one moveTo/lineTo pair per entity every frame.
  const twoPointLines = (count: number): Polyline[] =>
    Array.from({ length: count }, (_, i) => ({
      closed: false,
      points: [
        { x: i, y: 0 },
        { x: i, y: 1 },
      ],
    }));

  it('thins short polylines as whole units when the count is the cost', () => {
    const result = buildDisplayPolylines(twoPointLines(60_000), 1_000);

    expect(result.isSimplified).toBe(true);
    expect(result.segmentCount).toBe(60_000);
    // Was 60_000 before the fix — the budget had no effect on 2-point lines.
    expect(result.polylines.length).toBeLessThanOrEqual(1_100);
    expect(result.polylines.length).toBeGreaterThan(0);
  });

  it('leaves an in-budget scene of short polylines untouched', () => {
    const source = twoPointLines(500);

    const result = buildDisplayPolylines(source, 1_000);

    expect(result.isSimplified).toBe(false);
    expect(result.polylines).toBe(source);
  });

  it('still decimates vertices (not whole polylines) for long polylines', () => {
    const long: Polyline[] = [
      { closed: false, points: Array.from({ length: 5_000 }, (_, i) => ({ x: i, y: i })) },
    ];

    const result = buildDisplayPolylines(long, 100);

    expect(result.isSimplified).toBe(true);
    expect(result.polylines).toHaveLength(1);
    expect(result.polylines[0]!.points.length).toBeLessThan(5_000);
    // Endpoints are preserved so the shape still reads as connected.
    expect(result.polylines[0]!.points[0]).toEqual({ x: 0, y: 0 });
    expect(result.polylines[0]!.points.at(-1)).toEqual({ x: 4_999, y: 4_999 });
  });
});
