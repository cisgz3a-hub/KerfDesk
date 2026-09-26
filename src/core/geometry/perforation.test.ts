import { describe, expect, it } from 'vitest';
import type { Polyline, Vec2 } from '../scene';
import { perforatePolyline, perforatePolylines } from './perforation';

const PATTERN = { cutMm: 3, skipMm: 1 };

function length(points: ReadonlyArray<Vec2>): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1] as Vec2;
    const b = points[i] as Vec2;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

function square(size: number, closingPoint = true): Polyline {
  const points = [
    { x: 0, y: 0 },
    { x: size, y: 0 },
    { x: size, y: size },
    { x: 0, y: size },
  ];
  return { closed: true, points: closingPoint ? [...points, { x: 0, y: 0 }] : points };
}

describe('perforatePolyline', () => {
  it('cuts an open line into dashes from its start, ending with a partial dash', () => {
    const line: Polyline = {
      closed: false,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
    };
    const dashes = perforatePolyline(line, PATTERN);
    expect(dashes.map((dash) => dash.points)).toEqual([
      [
        { x: 0, y: 0 },
        { x: 3, y: 0 },
      ],
      [
        { x: 4, y: 0 },
        { x: 7, y: 0 },
      ],
      [
        { x: 8, y: 0 },
        { x: 10, y: 0 },
      ],
    ]);
    expect(dashes.every((dash) => !dash.closed)).toBe(true);
  });

  it('keeps corners inside a dash that crosses a vertex', () => {
    const corner: Polyline = {
      closed: false,
      points: [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 5 },
      ],
    };
    const [first] = perforatePolyline(corner, PATTERN);
    expect(first?.points).toEqual([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
    ]);
  });

  it('leaves a full gap before the start of a closed contour so no dash runs across the seam', () => {
    const dashes = perforatePolyline(square(10), PATTERN);
    // 40 mm perimeter, pattern stops at 39 mm: dashes at 0, 4, ... 36.
    expect(dashes).toHaveLength(10);
    const last = dashes[dashes.length - 1]?.points;
    expect(last?.[last.length - 1]).toEqual({ x: 0, y: 1 });
    for (const dash of dashes) expect(length(dash.points)).toBeLessThanOrEqual(3 + 1e-9);
  });

  it('never makes a dash longer than the cut or a gap shorter than the skip', () => {
    const dashes = perforatePolyline(square(10.7), { cutMm: 2.5, skipMm: 0.8 });
    const perimeter = 42.8;
    let travelled = 0;
    for (const dash of dashes) {
      expect(length(dash.points)).toBeLessThanOrEqual(2.5 + 1e-9);
      travelled += length(dash.points);
    }
    const gaps = perimeter - travelled;
    expect(gaps / dashes.length).toBeGreaterThanOrEqual(0.8 - 1e-9);
  });

  it('treats a closed contour without a repeated first point the same way', () => {
    expect(perforatePolyline(square(10, false), PATTERN)).toEqual(
      perforatePolyline(square(10), PATTERN),
    );
  });

  it('cuts nothing on a closed contour too short to hold one gap, keeping it attached', () => {
    expect(perforatePolyline(square(0.2), PATTERN)).toEqual([]);
  });

  it('drops degenerate input', () => {
    expect(perforatePolyline({ closed: false, points: [{ x: 1, y: 1 }] }, PATTERN)).toEqual([]);
    expect(
      perforatePolylines(
        [
          {
            closed: false,
            points: [
              { x: 1, y: 1 },
              { x: 1, y: 1 },
            ],
          },
        ],
        PATTERN,
      ),
    ).toEqual([]);
  });
});
