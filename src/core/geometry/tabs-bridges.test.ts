import { describe, expect, it } from 'vitest';
import type { Polyline } from '../scene';
import {
  applyAutomaticTabsToPolylines,
  applyManualTabsToPolyline,
  automaticTabAnchorPoints,
  splitClosedPolylineForTabsAtAnchors,
} from './tabs-bridges';

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

  it('projects physical tab anchors onto a contour with a different start vertex', () => {
    const roughing: Polyline = { closed: true, points: squarePoints(0, 0, 20) };
    const finishing: Polyline = {
      closed: true,
      points: [
        { x: 18, y: 2 },
        { x: 18, y: 18 },
        { x: 2, y: 18 },
        { x: 2, y: 2 },
      ],
    };
    const anchors = automaticTabAnchorPoints(roughing, 4);
    const segments = splitClosedPolylineForTabsAtAnchors(finishing, anchors, 2);
    const gapCenters = segments.map((segment, index) => {
      const end = segment.points.at(-1) as { x: number; y: number };
      const next = segments[(index + 1) % segments.length]?.points[0] as { x: number; y: number };
      return { x: (end.x + next.x) / 2, y: (end.y + next.y) / 2 };
    });

    gapCenters.sort((a, b) => a.x - b.x || a.y - b.y);
    expect(gapCenters).toEqual([
      { x: 2, y: 10 },
      { x: 10, y: 2 },
      { x: 10, y: 18 },
      { x: 18, y: 10 },
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
