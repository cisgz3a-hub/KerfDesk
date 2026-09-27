import { performance } from 'node:perf_hooks';
import { log } from 'node:console';
import { describe, expect, it, vi } from 'vitest';
import type { Polyline } from '../scene';
import type * as BoundarySegmentIndex from './vcarve-boundary-segment-index';
import {
  originalIsClosedFiniteContour,
  originalStrictContourContainmentDepth,
} from './strict-contour-nesting.test-support';
import { buildVCarveSourceRegionLayout } from './vcarve-region-order';

const probe = vi.hoisted(() => ({ boundaryBuilds: 0 }));

vi.mock('./vcarve-boundary-segment-index', async (importOriginal) => {
  const actual = await importOriginal<typeof BoundarySegmentIndex>();
  return {
    ...actual,
    buildVCarveBoundarySegmentIndex: (
      ...args: Parameters<typeof actual.buildVCarveBoundarySegmentIndex>
    ) => {
      probe.boundaryBuilds += 1;
      return actual.buildVCarveBoundarySegmentIndex(...args);
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

function originalLayout(contours: ReadonlyArray<Polyline>) {
  return contours.flatMap((contour, sourceIndex) => {
    if (!originalIsClosedFiniteContour(contour)) return [];
    const containmentDepth = originalStrictContourContainmentDepth(contour, sourceIndex, contours);
    return containmentDepth % 2 === 0 ? [{ contour, sourceIndex, containmentDepth }] : [];
  });
}

function measured<T>(run: () => T) {
  probe.boundaryBuilds = 0;
  const startedAt = performance.now();
  const result = run();
  return { result, elapsedMs: performance.now() - startedAt, boundaryBuilds: probe.boundaryBuilds };
}

const fixtures = [
  {
    name: '600 disconnected dense contours',
    contours: Array.from({ length: 600 }, (_, i) =>
      circle((i % 30) * 3, Math.floor(i / 30) * 3, 1, 192),
    ),
  },
  {
    name: '64 concentric dense contours',
    contours: Array.from({ length: 64 }, (_, i) => circle(0, 0, 100 - i, 192)),
  },
  {
    name: '240 overlapping dense contours',
    contours: Array.from({ length: 240 }, (_, i) =>
      circle((i % 24) * 1.5, Math.floor(i / 24) * 1.5, 1, 192),
    ),
  },
];

describe('strict contour nesting work reuse', () => {
  for (const fixture of fixtures) {
    it(`preserves the original source layout for ${fixture.name}`, () => {
      const baseline = measured(() => originalLayout(fixture.contours));
      const optimized = measured(() => buildVCarveSourceRegionLayout(fixture.contours));
      expect(optimized.result).toEqual(baseline.result);
      expect(optimized.boundaryBuilds).toBeLessThanOrEqual(fixture.contours.length);
      log(
        JSON.stringify({
          fixture: fixture.name,
          baselineMs: baseline.elapsedMs,
          optimizedMs: optimized.elapsedMs,
          baselineBoundaryBuilds: baseline.boundaryBuilds,
          optimizedBoundaryBuilds: optimized.boundaryBuilds,
        }),
      );
    }, 30_000);
  }
});
