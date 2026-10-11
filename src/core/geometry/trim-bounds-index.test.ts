import { expect, it } from 'vitest';
import { createTrimBoundsIndex, forEachTrimBoundsOverlap } from './trim-bounds-index';
import { boundsOverlap } from './trim-contours';

it('matches exhaustive overlap queries for mixed extents, degenerate boxes and tolerance', () => {
  const entries = Array.from({ length: 257 }, (_, id) => {
    const x = (id * 37) % 101;
    const y = (id * 19) % 97;
    return {
      id,
      bounds: { minX: x, minY: y, maxX: x + (id % 13), maxY: y + (id % 7) },
    };
  });
  entries.push({ id: 257, bounds: { minX: -1e9, minY: 45, maxX: 1e9, maxY: 45 } });
  entries.push({ id: 258, bounds: { minX: NaN, minY: 0, maxX: 50, maxY: 50 } });
  const index = createTrimBoundsIndex(entries);
  for (let x = 0; x < 110; x += 2.5) {
    const query = { minX: x, maxX: x + 1e-7, minY: 44.9999995, maxY: 45 };
    const expected = entries.filter((entry) => boundsOverlap(entry.bounds, query, 1e-6));
    const actual: number[] = [];
    forEachTrimBoundsOverlap(index, query, 1e-6, (entry) => actual.push(entry.id));
    expect(actual.sort((a, b) => a - b)).toEqual(expected.map((entry) => entry.id));
  }
});

it('handles an empty index without candidates', () => {
  const index = createTrimBoundsIndex([]);
  const found: unknown[] = [];
  forEachTrimBoundsOverlap(index, { minX: 0, maxX: 1, minY: 0, maxY: 1 }, 1e-6, (entry) =>
    found.push(entry),
  );
  expect(found).toEqual([]);
});
