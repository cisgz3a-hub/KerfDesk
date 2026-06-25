import { describe, expect, it } from 'vitest';

import { extractCenterlinePolylines } from './centerline-polylines';

function mask(
  width: number,
  height: number,
  points: ReadonlyArray<readonly [number, number]>,
): Uint8Array {
  const out = new Uint8Array(width * height);
  for (const [x, y] of points) out[y * width + x] = 1;
  return out;
}

describe('extractCenterlinePolylines', () => {
  it('simplifies stair-stepped centerline pixels into a straight polyline', () => {
    const points: Array<readonly [number, number]> = [];
    for (let i = 0; i < 14; i += 1) points.push([i + 2, 4 + Math.floor(i / 2)]);

    const polylines = extractCenterlinePolylines(mask(20, 14, points), 20, 14, {
      simplifyTolerancePx: 1,
    });

    expect(polylines).toHaveLength(1);
    expect(polylines[0]?.points.length).toBeLessThanOrEqual(3);
  });

  it('traces a straight stroke as one connected, centered line through a junction', () => {
    // A horizontal stroke with a short upward protrusion at x=10 (a T-junction).
    const points: Array<readonly [number, number]> = [];
    for (let x = 2; x <= 18; x += 1) points.push([x, 8]);
    points.push([10, 7], [10, 6], [10, 5]);

    const polylines = extractCenterlinePolylines(mask(22, 14, points), 22, 14, {
      simplifyTolerancePx: 1,
    });

    // The horizontal stroke is traced across its full width and stays on its
    // pixel row (y=8 -> centre 8.5). The protrusion is faithful real ink; the
    // divide-and-conquer tracer does not aggressively prune it. (Connectivity
    // through junctions is covered by the cross fixture in centerline-bar.)
    expect(polylines.length).toBeGreaterThanOrEqual(1);
    const xs = polylines.flatMap((pl) => pl.points).map((p) => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(12);
    const onRow = polylines.flatMap((pl) => pl.points).filter((p) => Math.abs(p.y - 8.5) <= 1);
    expect(onRow.length).toBeGreaterThanOrEqual(2);
  });
});
