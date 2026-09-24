// groupOperandRegion (ADR-377): the one region a group contributes to Weld,
// Union silhouette and the Boolean tools. Nesting decides holes; overlaps merge.

import { areaPathsD, type PathD, type PathsD } from 'clipper2-ts';
import { describe, expect, it } from 'vitest';
import { groupOperandRegion } from './group-operand-region';

function square(x0: number, y0: number, x1: number, y1: number): PathsD {
  return [
    [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ],
  ];
}

function circle(cx: number, cy: number, radius: number, segments = 96): PathsD {
  const points: PathD = [];
  for (let index = 0; index < segments; index += 1) {
    const angle = (index / segments) * Math.PI * 2;
    points.push({ x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
  }
  return [points];
}

function regionArea(members: ReadonlyArray<PathsD>): number {
  const region = groupOperandRegion(members);
  if (region.kind === 'error') throw new Error(region.error.message);
  return Math.abs(areaPathsD(region.value));
}

function polygonArea(paths: PathsD): number {
  return Math.abs(areaPathsD(paths));
}

describe('groupOperandRegion', () => {
  it('returns a lone member unchanged and ignores empty members', () => {
    const only = square(0, 0, 10, 10);
    const region = groupOperandRegion([[], only, []]);

    expect(region).toEqual({ kind: 'ok', value: only });
    expect(groupOperandRegion([])).toEqual({ kind: 'ok', value: [] });
  });

  it('turns a circle inside a circle into a donut', () => {
    const outer = circle(0, 0, 20);
    const inner = circle(0, 0, 10);

    // Clipper snaps vertices to a 1 um grid, which moves a circle's area slightly.
    const expected = polygonArea(outer) - polygonArea(inner);
    expect(regionArea([outer, inner])).toBeCloseTo(expected, 1);
    expect(regionArea([inner, outer])).toBeCloseTo(expected, 1);
  });

  it('keeps an island inside the hole solid again', () => {
    const outer = square(0, 0, 30, 30);
    const hole = square(5, 5, 25, 25);
    const island = square(10, 10, 20, 20);

    expect(regionArea([island, outer, hole])).toBeCloseTo(900 - 400 + 100, 6);
  });

  it('merges members that only overlap, so grouped letters weld without holes', () => {
    const left = square(0, 0, 10, 10);
    const right = square(5, 0, 15, 10);

    expect(regionArea([left, right])).toBeCloseTo(150, 6);
  });

  it('merges stacked copies instead of cancelling them', () => {
    expect(regionArea([square(0, 0, 10, 10), square(0, 0, 10, 10)])).toBeCloseTo(100, 6);
  });

  it('still treats an inner circle touching the outer edge as a hole', () => {
    // The finer inner circle pokes a sliver past the coarser outer's chords.
    const outer = circle(0, 0, 20, 40);
    const tangent = circle(10, 0, 10, 96);

    expect(regionArea([outer, tangent])).toBeCloseTo(polygonArea(outer) - polygonArea(tangent), 1);
  });

  it('adds a bar that crosses the ring instead of cutting it', () => {
    const outer = square(0, 0, 30, 30);
    const hole = square(10, 10, 20, 20);
    const bar = square(-5, 13, 35, 17);

    // Ring 800 + bar 160, minus the bar's two 10 x 4 overlaps with the ring.
    expect(regionArea([outer, hole, bar])).toBeCloseTo(800 + 160 - 80, 6);
  });
});
