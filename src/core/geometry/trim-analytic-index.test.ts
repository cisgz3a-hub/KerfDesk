import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDENTITY_TRANSFORM, type CurveSubpath, type PathSegment } from '../scene';
import { curveSubpathBounds } from '../scene/curve-path';
import { collectAnalyticCrossings } from './trim-analytic-crossings';
import * as contours from './trim-contours';
import type { TrimCrossing } from './trim-crossings';

afterEach(() => vi.restoreAllMocks());

function contour(count: number, curved: boolean): contours.TrimContour {
  const y = curved ? 0.25 : 0;
  const segments: PathSegment[] = Array.from({ length: count }, (_, i) =>
    curved
      ? {
          kind: 'cubic',
          control1: { x: i * 10 + 10 / 3, y: -1 / 12 },
          control2: { x: i * 10 + 20 / 3, y: -1 / 12 },
          to: { x: (i + 1) * 10, y },
        }
      : { kind: 'line', to: { x: (i + 1) * 10, y } },
  );
  const curve: CurveSubpath = { start: { x: 0, y }, segments, closed: false };
  return {
    key: String(curved),
    objectId: String(curved),
    pathIndex: 0,
    polylineIndex: 0,
    closed: false,
    trimmable: true,
    segments: curve,
    transform: IDENTITY_TRANSFORM,
    // Deliberately coarse chords miss every tangent: only canonical bounds can retain them.
    points: [curve.start, ...segments.map((segment) => segment.to)],
    params: Array.from({ length: count + 1 }, (_, i) => i),
    chordParams: Array.from({ length: count }, (_, i) => [i, i + 1] as const),
    bounds: curveSubpathBounds(curve),
  };
}

describe('canonical analytic Trim candidate index', () => {
  it.each([false, true])('avoids quadratic sparse pair scans with curved source=%s', (curved) => {
    const count = 1024;
    const source = contour(count, curved);
    const boundary = contour(count, !curved);
    const overlaps = vi.spyOn(contours, 'boundsOverlap');
    const found: TrimCrossing[] = [];
    collectAnalyticCrossings(source, boundary, found);
    // A Cartesian scan performs count^2 (1,048,576) overlap checks here.
    // Count tree and leaf checks, not elapsed time or only accepted candidates.
    expect(overlaps.mock.calls.length).toBeLessThan(count * 50);
    expect(found).toHaveLength(count);
    for (const [index, hit] of found.entries()) {
      expect(hit.exact).toBe(true);
      expect(hit.p).toBeCloseTo(index + 0.5, 7);
      expect(hit.point?.x).toBeCloseTo(index * 10 + 5, 6);
      expect(hit.point?.y).toBeCloseTo(0, 6);
    }
  });

  it('keeps a long boundary spanning many sparse source segments', () => {
    const source = contour(128, true);
    const boundary = contour(1, false);
    const longBoundary = {
      ...boundary,
      segments: {
        ...boundary.segments,
        segments: [{ kind: 'line' as const, to: { x: 1280, y: 0 } }],
      },
    };
    const found: TrimCrossing[] = [];
    collectAnalyticCrossings(source, longBoundary, found);
    expect(found).toHaveLength(128);
    expect(found.at(-1)?.point?.x).toBeCloseTo(1275, 6);
  });
});
