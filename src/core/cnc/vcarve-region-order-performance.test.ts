import { log } from 'node:console';
import { performance } from 'node:perf_hooks';
import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import type * as Geometry from '../geometry';
import type { Polyline, Vec2 } from '../scene';
import {
  buildVCarveSourceRegionLayout,
  vcarveRegionBucketsWithLayout,
  vcarveSourceRegionRankFromLayout,
  type VCarveRegionLayout,
} from './vcarve-region-order';
import * as original from './vcarve-region-order.test-support';

const probe = vi.hoisted(() => ({ pointInPolygonCalls: 0 }));

vi.mock('../geometry', async (importOriginal) => {
  const actual = await importOriginal<typeof Geometry>();
  return {
    ...actual,
    pointInPolygon: (...args: Parameters<typeof actual.pointInPolygon>) => {
      probe.pointInPolygonCalls += 1;
      return actual.pointInPolygon(...args);
    },
  };
});

function circle(x: number, y: number, radius: number, count: number): Polyline {
  return {
    closed: true,
    points: Array.from({ length: count }, (_, i) => {
      const angle = (i / count) * Math.PI * 2;
      return { x: x + Math.cos(angle) * radius, y: y + Math.sin(angle) * radius };
    }),
  };
}

function measured<T>(run: () => T) {
  probe.pointInPolygonCalls = 0;
  const startedAt = performance.now();
  const result = run();
  return {
    result,
    elapsedMs: performance.now() - startedAt,
    pointInPolygonCalls: probe.pointInPolygonCalls,
  };
}

function ring(point: Vec2): Polyline {
  return { closed: false, points: [point, { x: point.x + 0.1, y: point.y + 0.1 }] };
}

function assertRankAndBucketsMatch(
  layout: VCarveRegionLayout,
  witnesses: ReadonlyArray<Vec2>,
): void {
  const rings = [witnesses.map(ring), [...witnesses].reverse().map(ring)];
  expect(witnesses.map((witness) => vcarveSourceRegionRankFromLayout(witness, layout))).toEqual(
    witnesses.map((witness) => original.vcarveSourceRegionRankFromLayout(witness, layout)),
  );
  expect(vcarveRegionBucketsWithLayout(layout, rings)).toEqual(
    original.vcarveRegionBucketsWithLayout(layout, rings),
  );
}

describe('indexed V-carve source ranking and ring assignment', () => {
  it('retains source ranks and first-layout ties for overlapping and nested roots', () => {
    const outer = circle(0, 0, 20, 32);
    const overlap = circle(10, 0, 20, 32);
    const island = circle(0, 0, 5, 32);
    const layout = [
      { contour: overlap, containmentDepth: 0, sourceIndex: 5 },
      { contour: outer, containmentDepth: 0, sourceIndex: 1 },
      { contour: island, containmentDepth: 2, sourceIndex: 3 },
      { contour: island, containmentDepth: 2, sourceIndex: 0 },
    ];
    assertRankAndBucketsMatch(layout, [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 50, y: 50 },
      { x: -20, y: 0 },
    ]);
    expect(vcarveSourceRegionRankFromLayout({ x: 0, y: 0 }, layout)).toBe(0);
    expect(vcarveRegionBucketsWithLayout(layout, [[ring({ x: 0, y: 0 })]])[2]).toHaveLength(1);
    expect(vcarveSourceRegionRankFromLayout(undefined, layout)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('matches vertex, edge, near-boundary and nonfinite witness semantics', () => {
    const layout = buildVCarveSourceRegionLayout([circle(0, 0, 10, 32), circle(30, 0, 10, 32)]);
    const witnesses = [
      { x: 10, y: 0 },
      { x: -10, y: 0 },
      { x: 0, y: 10 },
      { x: 0, y: -10 },
      { x: 10 + Number.EPSILON * 16, y: 0 },
      { x: -10 - Number.EPSILON * 16, y: 0 },
      { x: NaN, y: 0 },
      { x: Infinity, y: 0 },
      { x: -Infinity, y: 0 },
      { x: 0, y: NaN },
      { x: 0, y: Infinity },
    ];
    assertRankAndBucketsMatch(layout, witnesses);
  });

  it('keeps the original ray predicate for extreme coordinates and malformed direct layouts', () => {
    const layout = [
      { contour: circle(0, 0, 1e200, 4), containmentDepth: 0, sourceIndex: 0 },
      { contour: { closed: true, points: [] }, containmentDepth: 0, sourceIndex: 1 },
      { contour: circle(0, 0, Infinity, 4), containmentDepth: 0, sourceIndex: 2 },
      { contour: circle(0, 0, 1e-300, 4), containmentDepth: 2, sourceIndex: 3 },
    ];
    assertRankAndBucketsMatch(layout, [
      { x: 0, y: 0 },
      { x: 0, y: 1e190 },
      { x: 1e201, y: 1e190 },
      { x: 1e-301, y: 0 },
      { x: -Infinity, y: 1 },
    ]);
  });

  it('matches the old rank and ring oracle for arbitrary roots and witness order', () => {
    const point = fc.record({
      x: fc.integer({ min: -30, max: 30 }),
      y: fc.integer({ min: -30, max: 30 }),
    });
    const region = fc.record({
      contour: fc.record({ closed: fc.boolean(), points: fc.array(point, { maxLength: 10 }) }),
      containmentDepth: fc.constantFrom(0, 2, 4),
      sourceIndex: fc.integer({ min: 0, max: 12 }),
    });
    fc.assert(
      fc.property(
        fc.array(region, { maxLength: 12 }),
        fc.array(point, { maxLength: 16 }),
        assertRankAndBucketsMatch,
      ),
      { seed: 270, numRuns: 200 },
    );
  });

  it('ranks and assigns 600 dense disconnected witnesses with local polygon tests', () => {
    const centers = Array.from({ length: 600 }, (_, i) => ({
      x: (i % 30) * 3,
      y: Math.floor(i / 30) * 3,
    }));
    const layout = buildVCarveSourceRegionLayout(centers.map(({ x, y }) => circle(x, y, 1, 192)));
    const baseline = measured(() =>
      centers.map((center) => original.vcarveSourceRegionRankFromLayout(center, layout)),
    );
    const optimized = measured(() =>
      centers.map((center) => vcarveSourceRegionRankFromLayout(center, layout)),
    );
    expect(optimized.result).toEqual(baseline.result);
    expect(baseline.pointInPolygonCalls).toBe(600 * 600);
    expect(optimized.pointInPolygonCalls).toBe(600);
    const rings = [[...centers].reverse().map(ring)];
    const originalBuckets = measured(() => original.vcarveRegionBucketsWithLayout(layout, rings));
    const indexedBuckets = measured(() => vcarveRegionBucketsWithLayout(layout, rings));
    expect(indexedBuckets.result).toEqual(originalBuckets.result);
    expect(indexedBuckets.pointInPolygonCalls).toBe(600);
    log(
      JSON.stringify({
        fixture: '600 dense disconnected source witnesses',
        baselineRankMs: baseline.elapsedMs,
        indexedRankMs: optimized.elapsedMs,
        baselineRankPolygonCalls: baseline.pointInPolygonCalls,
        indexedRankPolygonCalls: optimized.pointInPolygonCalls,
        baselineBucketsMs: originalBuckets.elapsedMs,
        indexedBucketsMs: indexedBuckets.elapsedMs,
        baselineBucketPolygonCalls: originalBuckets.pointInPolygonCalls,
        indexedBucketPolygonCalls: indexedBuckets.pointInPolygonCalls,
      }),
    );
  }, 30_000);
});
