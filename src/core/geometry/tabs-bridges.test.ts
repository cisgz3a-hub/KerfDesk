import { describe, expect, it } from 'vitest';
import type { Polyline } from '../scene';
import { applyAutomaticTabsToPolylines, applyManualTabsToPolyline } from './tabs-bridges';

const SETTINGS = {
  tabsEnabled: true,
  tabSizeMm: 2,
  tabsPerShape: 4,
  tabSkipInnerShapes: true,
};

describe('automatic tabs / bridges geometry', () => {
  it('splits one closed contour into laser-off bridge gaps', () => {
    const result = applyAutomaticTabsToPolylines(
      [
        {
          closed: true,
          points: squarePoints(0, 0, 10),
        },
      ],
      SETTINGS,
    );
    const first = result[0];

    expect(result).toHaveLength(4);
    expect(result.every((segment) => segment.closed === false)).toBe(true);
    expect(first?.points).toEqual([
      { x: 6, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 4 },
    ]);
  });

  it('leaves open paths unchanged', () => {
    const open: Polyline = {
      closed: false,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
    };

    expect(applyAutomaticTabsToPolylines([open], SETTINGS)).toEqual([open]);
  });

  it('can skip inner closed shapes so holes are not weakened by tabs', () => {
    const result = applyAutomaticTabsToPolylines(
      [
        { closed: true, points: squarePoints(0, 0, 20) },
        { closed: true, points: squarePoints(5, 5, 5) },
      ],
      SETTINGS,
    );

    expect(result.filter((segment) => !segment.closed)).toHaveLength(4);
    expect(result.filter((segment) => segment.closed)).toEqual([
      { closed: true, points: squarePoints(5, 5, 5) },
    ]);
  });

  it('splits at explicit normalized contour positions', () => {
    const result = applyManualTabsToPolyline(
      { closed: true, points: squarePoints(0, 0, 10) },
      [0, 0.5],
      2,
    );

    expect(result).toHaveLength(2);
    expect(result[0]?.points[0]).toEqual({ x: 1, y: 0 });
    expect(result[1]?.points[0]).toEqual({ x: 9, y: 10 });
  });
});

function squarePoints(x: number, y: number, size: number): ReadonlyArray<{ x: number; y: number }> {
  return [
    { x, y },
    { x: x + size, y },
    { x: x + size, y: y + size },
    { x, y: y + size },
  ];
}
