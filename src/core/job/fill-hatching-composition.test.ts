import { describe, expect, it } from 'vitest';
import { square } from '../../__fixtures__/square';
import { createLayer, type Polyline } from '../scene';
import { fillHatchingWithMetadata } from './fill-hatching';
import { memoizedFillHatchingWithMetadata } from './fill-hatching-cache';
import type { NonzeroContourGroups } from './fill-contour-groups';

const layer = { ...createLayer({ id: 'fill', color: '#000000', mode: 'fill' }), hatchSpacingMm: 1 };
const reversed = (p: Polyline): Polyline => ({ ...p, points: [...p.points].reverse() });
const row = (paths: ReadonlyArray<Polyline>): number[][] =>
  paths
    .filter((p) => p.points[0]?.y === 5)
    .map((p) => p.points.map((q) => q.x).sort((a, b) => a - b))
    .sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0));
function hatch(polylines: ReadonlyArray<Polyline>, nonzeroGroups: NonzeroContourGroups = []) {
  return fillHatchingWithMetadata({
    polylines,
    nonzeroGroups,
    hatchAngleDeg: 0,
    hatchSpacingMm: 1,
  });
}

describe('constituent fill semantics', () => {
  it('keeps vector overlap blank when distant text has overlapping strokes', () => {
    const vectors = [square(10), square(10, 5, 0)],
      text = [square(10, 100, 0), square(10, 105, 0)];
    expect(row(hatch([...vectors, ...text], [text]))).toEqual([
      [0, 5],
      [10, 15],
      [100, 115],
    ]);
  });
  it('preserves opposite-wound text counters and an island inside a trace hole', () => {
    const trace = [square(10), square(6, 2, 2), square(2, 4, 4)];
    const text = [square(10, 100, 0), reversed(square(6, 102, 2))];
    expect(row(hatch([...trace, ...text], [text]))).toEqual([
      [0, 2],
      [4, 6],
      [8, 10],
      [100, 102],
      [108, 110],
    ]);
  });
  it('applies even-odd between text objects while retaining nonzero within each', () => {
    const a = [square(10), square(10, 5, 0)],
      b = [square(10, 5, 0), square(10, 10, 0)];
    expect(row(hatch([...a, ...b], [a, b]))).toEqual([
      [0, 5],
      [15, 20],
    ]);
    expect(row(hatch([...a, ...b], [[...a, ...b]]))).toEqual([[0, 20]]);
  });
  it('keeps cross-object vector/text overlap even-odd through coincident boundaries', () => {
    const vector = square(10),
      text = [square(10, 5, 0), square(10, 10, 0)];
    expect(row(hatch([vector, ...text], [text]))).toEqual([
      [0, 5],
      [10, 20],
    ]);
    const opposite = reversed(vector);
    expect(hatch([vector, opposite], [[opposite]])).toEqual([]);
  });
  it('is independent of each constituent winding and contour enumeration', () => {
    const a = [square(10), square(10, 5, 0)],
      b = [square(10, 5, 0), square(10, 10, 0)];
    const ar = a.map(reversed).reverse(),
      br = b.map(reversed).reverse();
    expect(row(hatch([...br, ...ar], [ar, br]))).toEqual(row(hatch([...a, ...b], [a, b])));
  });
  it('uses only closed contours present in the hatch subset', () => {
    const open = {
      ...square(20, 100, 0),
      closed: false,
      points: [
        { x: 100, y: 0 },
        { x: 120, y: 10 },
      ],
    };
    const text = [square(10), square(10, 5, 0), open],
      distant = square(10, 200, 0);
    expect(row(hatch(text, [[...text, distant]]))).toEqual([[0, 15]]);
  });
  it('invalidates cached hatches when the same contours belong to different constituents', () => {
    const paths = [square(10), square(10, 5, 0)];
    const together = memoizedFillHatchingWithMetadata(paths, layer, 'evenodd', [paths]);
    const separate = memoizedFillHatchingWithMetadata(
      paths,
      layer,
      'evenodd',
      paths.map((p) => [p]),
    );
    expect(row(together)).toEqual([[0, 15]]);
    expect(row(separate)).toEqual([
      [0, 5],
      [10, 15],
    ]);
    expect(memoizedFillHatchingWithMetadata(paths, layer, 'evenodd', [paths])).toBe(together);
    expect(row(memoizedFillHatchingWithMetadata(paths, layer))).toEqual([
      [0, 5],
      [10, 15],
    ]);
  });
  it('updates crosshatch, direction, angle and pitch without losing text ink', () => {
    const paths = [square(10), square(10, 5, 0)];
    for (const angle of [0, 29, 90])
      for (const spacing of [0.4, 0.7])
        for (const cross of [false, true])
          for (const bidirectional of [false, true]) {
            const settings = {
              ...layer,
              hatchAngleDeg: angle,
              hatchSpacingMm: spacing,
              fillCrossHatch: cross,
              fillBidirectional: bidirectional,
            };
            const actual = memoizedFillHatchingWithMetadata(paths, settings, 'evenodd', [paths]);
            const expected = [angle, ...(cross ? [angle + 90] : [])].flatMap((a) =>
              fillHatchingWithMetadata({
                polylines: paths,
                fillRule: 'nonzero',
                hatchAngleDeg: a,
                hatchSpacingMm: spacing,
                bidirectional,
              }),
            );
            expect(actual).toEqual(expected);
          }
  });
});
