import { describe, expect, it } from 'vitest';
import {
  copyAlongPathCount,
  copyAlongPathLayout,
  tangentAtDistance,
  type CopyAlongPathSpec,
} from './copy-along-path';
import { pathWalk } from './path-walk';
import { scaledGapDistances } from './copy-along-path-scaled-gap';

const SOURCE = { minX: -5, minY: -2, maxX: 5, maxY: 2 };
const SPEC: CopyAlongPathSpec = {
  mode: 'gap',
  count: 5,
  spacingMm: 2,
  startOffsetMm: 0,
  endOffsetMm: 0,
  rotateCopies: true,
  endScalePercent: 300,
};
function guide(points: readonly (readonly [number, number])[], closed = false) {
  const walk = pathWalk({ closed, points: points.map(([x, y]) => ({ x, y })) });
  if (walk === null) throw new Error('empty guide');
  return { walk, closed };
}
const LINE = guide([
  [0, 0],
  [100, 0],
]);
const SQUARE = guide(
  [
    [0, 0],
    [100, 0],
    [100, 100],
    [0, 100],
  ],
  true,
);

describe('scaled edge gaps', () => {
  it.each([true, false])('uses final sizes for a 2mm gap, rotate=%s', (rotateCopies) => {
    const spec = { ...SPEC, rotateCopies };
    const result = copyAlongPathLayout(LINE, SOURCE, spec, 100);
    expect(result.kind).toBe('placed');
    if (result.kind !== 'placed') return;
    expect(result.placements).toHaveLength(5);
    const widths = result.placements.map((p) => 10 * (p.scale?.factor ?? 1));
    expect(widths).toEqual([10, 15, 20, 25, 30]);
    result.placements.slice(1).forEach((p, i) => {
      expect(p.dx - result.placements[i]!.dx - (widths[i]! + widths[i + 1]!) / 2).toBeCloseTo(2, 9);
    });
    expect(result.placements.at(-1)!.dx).toBeCloseTo(88, 9);
    expect(copyAlongPathCount(LINE, SOURCE, spec, 100)).toEqual({
      kind: 'counted',
      count: 5,
      stepMm: null,
    });
  });

  it('includes the last-to-first gap and both final sizes at a closed seam', () => {
    const result = copyAlongPathLayout(SQUARE, SOURCE, SPEC, 100);
    if (result.kind !== 'placed') throw new Error(result.kind);
    expect(result.placements).toHaveLength(18);
    expect(result.placements.at(-1)!.scale?.factor).toBe(3);
    // The last centre is 374mm around the 400mm guide: seam gap = 26 - (30+10)/2.
    expect(result.placements.at(-1)!.dy).toBeCloseTo(26, 9);
    expect(copyAlongPathCount(SQUARE, SOURCE, SPEC, 17)).toEqual({ kind: 'too-many' });
  });

  it('uses the first edge extent when a growing upright copy crosses the closed seam', () => {
    const path = guide(
      [
        [0, 0],
        [100, 0],
        [100, 100],
      ],
      true,
    );
    const source = { minX: 0, minY: 0, maxX: 1, maxY: 13 };
    const spec = { ...SPEC, spacingMm: 1, startOffsetMm: 10, rotateCopies: false };
    const result = scaledGapDistances(path, source, spec, 10, Infinity);
    if (result.kind !== 'ok') throw new Error(result.kind);
    const extent = (index: number) => {
      const wrapped = result.at(index) % path.walk.lengthMm;
      const distance = wrapped > path.walk.lengthMm - 1e-6 ? 0 : wrapped;
      const tangent = tangentAtDistance(path.walk, distance);
      return (
        (Math.abs(tangent.x) + 13 * Math.abs(tangent.y)) * (1 + (2 * index) / (result.count - 1))
      );
    };
    for (let index = 1; index < result.count; index += 1) {
      expect(
        result.at(index) - result.at(index - 1) - (extent(index) + extent(index - 1)) / 2,
      ).toBeGreaterThanOrEqual(1 - 1e-6);
    }
  });

  it('keeps the closing edge extent at the exact wrap threshold of a start offset', () => {
    const source = { minX: 0, minY: 0, maxX: 2, maxY: 20 };
    const start = SQUARE.walk.lengthMm - 1e-6;
    const spec = { ...SPEC, rotateCopies: false, startOffsetMm: start, endScalePercent: 200 };
    const result = scaledGapDistances(SQUARE, source, spec, start, Infinity);
    if (result.kind !== 'ok') throw new Error(result.kind);
    expect(result.count).toBeGreaterThan(1);
    const nextScale = 1 + 1 / (result.count - 1);
    expect(result.at(1) - start - (20 + 2 * nextScale) / 2).toBeGreaterThanOrEqual(2 - 1e-6);
  });

  it('shrinks evenly and respects trimmed ends and the exact project budget', () => {
    const spec = { ...SPEC, startOffsetMm: 10, endOffsetMm: 20, endScalePercent: 20 };
    const result = copyAlongPathLayout(LINE, SOURCE, spec, 9);
    if (result.kind !== 'placed') throw new Error(result.kind);
    expect(result.placements).toHaveLength(9);
    expect(result.placements[0]!.dx).toBe(10);
    expect(result.placements.at(-1)!.dx).toBeCloseTo(74, 9);
    expect(result.placements.at(-1)!.scale?.factor).toBe(0.2);
    expect(copyAlongPathCount(LINE, SOURCE, spec, 8)).toEqual({ kind: 'too-many' });
  });

  it('preserves projected edge clearance for upright copies around a bend', () => {
    const path = guide([
      [0, 0],
      [40, 0],
      [40, 100],
    ]);
    const spec = { ...SPEC, rotateCopies: false };
    const result = copyAlongPathLayout(path, SOURCE, spec, 100);
    if (result.kind !== 'placed') throw new Error(result.kind);
    const distances = result.placements.map((p) => (p.dy === 0 ? p.dx : 40 + p.dy));
    const extents = distances.map((distance, i) => {
      const tangent = tangentAtDistance(path.walk, distance);
      return (
        (10 * Math.abs(tangent.x) + 4 * Math.abs(tangent.y)) *
        (result.placements[i]!.scale?.factor ?? 1)
      );
    });
    distances.slice(1).forEach((distance, i) => {
      expect(distance - distances[i]! - (extents[i]! + extents[i + 1]!) / 2).toBeGreaterThanOrEqual(
        2 - 1e-6,
      );
    });
    expect(result.placements.at(-1)!.scale?.factor).toBe(3);
    expect(copyAlongPathCount(path, SOURCE, spec, 100)).toEqual({
      kind: 'counted',
      count: result.placements.length,
      stepMm: null,
    });
  });

  it('counts a very long scaled layout without materializing copies', () => {
    const path = guide([
      [0, 0],
      [1e12, 0],
    ]);
    expect(copyAlongPathCount(path, SOURCE, SPEC, 10000)).toEqual({ kind: 'too-many' });
    expect(copyAlongPathCount(LINE, SOURCE, SPEC, 0)).toEqual({ kind: 'too-many' });
  });

  it('keeps a bend layout independent of the project budget when nine fails but ten fits', () => {
    const path = guide([
      [0, 0],
      [59, 0],
      [59, 84],
      [92, 84],
      [92, 117],
    ]);
    const source = { minX: 0, minY: 0, maxX: 32, maxY: 8 };
    const spec = {
      ...SPEC,
      spacingMm: 2.5,
      startOffsetMm: 9,
      endOffsetMm: 9,
      rotateCopies: false,
      endScalePercent: 192,
    };
    expect(copyAlongPathCount(path, source, spec, 100)).toEqual({
      kind: 'counted',
      count: 10,
      stepMm: null,
    });
    expect(copyAlongPathCount(path, source, spec, 10)).toEqual({
      kind: 'counted',
      count: 10,
      stepMm: null,
    });
    expect(copyAlongPathCount(path, source, spec, 8)).toEqual({ kind: 'too-many' });
  });

  it('handles a thin short segment without scanning thousands of rejected counts', () => {
    const path = guide([
      [0, 0],
      [5000, 0],
      [5000, 0.001],
    ]);
    const source = { minX: 0, minY: 0, maxX: 1, maxY: 0.0001 };
    const spec = { ...SPEC, spacingMm: 0, rotateCopies: false };
    const full = copyAlongPathCount(path, source, spec);
    expect(full.kind).toBe('counted');
    if (full.kind !== 'counted') return;
    expect(full.count).toBeGreaterThanOrEqual(2501);
    expect(copyAlongPathCount(path, source, spec, full.count)).toEqual(full);
    expect(copyAlongPathCount(path, source, spec, full.count - 1)).toEqual({ kind: 'too-many' });
  });

  it.each([false, true])(
    'keeps scaled projected gaps and a stable count on varied bends, closed=%s',
    (closed) => {
      const path = guide(
        [
          [0, 0],
          [34, 0],
          [34, 91],
          [70, 110],
          [0, 140],
        ],
        closed,
      );
      for (const endScalePercent of [0.00001, 10, 80, 101, 192, 1000, 1e10]) {
        const spec = { ...SPEC, rotateCopies: false, startOffsetMm: 13, endScalePercent };
        const distances = scaledGapDistances(path, SOURCE, spec, 13, Infinity);
        if (distances.kind !== 'ok') throw new Error(distances.kind);
        const count = copyAlongPathCount(path, SOURCE, spec);
        expect(count).toEqual({ kind: 'counted', count: distances.count, stepMm: null });
        expect(copyAlongPathCount(path, SOURCE, spec, distances.count)).toEqual(count);
        expect(copyAlongPathCount(path, SOURCE, spec, distances.count - 1)).toEqual({
          kind: 'too-many',
        });
        const extent = (index: number) => {
          const tangent = tangentAtDistance(path.walk, distances.at(index) % path.walk.lengthMm);
          const t = distances.count < 2 ? 0 : index / (distances.count - 1);
          return (
            (10 * Math.abs(tangent.x) + 4 * Math.abs(tangent.y)) *
            (1 - t + (endScalePercent / 100) * t)
          );
        };
        for (let index = 1; index < distances.count; index += 1) {
          expect(
            distances.at(index) - distances.at(index - 1) - (extent(index) + extent(index - 1)) / 2,
          ).toBeGreaterThanOrEqual(spec.spacingMm - 1e-6);
        }
        if (closed && distances.count > 1) {
          expect(
            13 +
              path.walk.lengthMm -
              distances.at(distances.count - 1) -
              (extent(0) + extent(distances.count - 1)) / 2,
          ).toBeGreaterThanOrEqual(spec.spacingMm - 1e-6);
        }
      }
    },
  );
});
