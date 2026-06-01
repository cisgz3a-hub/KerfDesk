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

  it('drops short endpoint-to-junction spurs while keeping longer branches', () => {
    const points: Array<readonly [number, number]> = [];
    for (let x = 2; x <= 18; x += 1) points.push([x, 8]);
    points.push([10, 7], [10, 6], [10, 5]);

    const polylines = extractCenterlinePolylines(mask(22, 14, points), 22, 14, {
      simplifyTolerancePx: 1,
    });

    expect(polylines).toHaveLength(1);
    expect(polylines.every((polyline) => polyline.points.length <= 3)).toBe(true);
    expect(polylines[0]?.points.every((point) => point.y === 8.5)).toBe(true);
  });
});
