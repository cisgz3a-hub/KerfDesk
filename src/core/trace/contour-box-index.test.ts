import { describe, expect, it } from 'vitest';
import { ContourBoxIndex } from './contour-box-index';
import { runTraceSteps } from './trace-steps';

type Box = { minX: number; minY: number; maxX: number; maxY: number; id: number };

function boxes(count: number, seed: number, size: number): Box[] {
  let state = seed;
  const next = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  return Array.from({ length: count }, (_, id) => {
    // Coarse coordinates, so shared edges and corners (inclusive contacts) occur.
    const x = Math.floor(next() * 64) / 2;
    const y = Math.floor(next() * 64) / 2;
    const w = Math.floor(next() * size * 2) / 2;
    const h = Math.floor(next() * size * 2) / 2;
    return { minX: x, minY: y, maxX: x + w, maxY: y + h, id };
  });
}

function pairsByQuery(a: Box[], b: ContourBoxIndex<Box>): string[] {
  return a.flatMap((box) => b.query(box).map((other) => `${box.id}:${other.id}`)).sort();
}

function pairsByTrees(a: ContourBoxIndex<Box>, b: ContourBoxIndex<Box>, cooperate: boolean) {
  const pairs: string[] = [];
  runTraceSteps(
    (function* () {
      yield* a.overlapPairsSteps(b, (box, other) => pairs.push(`${box.id}:${other.id}`), cooperate);
    })(),
  );
  return pairs.sort();
}

describe('ContourBoxIndex.overlapPairsSteps', () => {
  it('finds exactly the pairs a query per item finds, contacts included', () => {
    for (const [countA, countB, size] of [
      [1, 1, 4],
      [7, 300, 2],
      [300, 7, 3],
      [500, 400, 1.5],
      [200, 200, 12],
    ] as const) {
      const a = boxes(countA, countA * 7919 + countB, size);
      const b = boxes(countB, countB * 104729 + countA, size);
      const indexA = ContourBoxIndex.create(a);
      const indexB = ContourBoxIndex.create(b);
      const expected = pairsByQuery(a, indexB);
      if (countA * countB > 1) expect(expected.length).toBeGreaterThan(0);
      expect(pairsByTrees(indexA, indexB, false)).toEqual(expected);
      expect(pairsByTrees(indexA, indexB, true)).toEqual(expected);
    }
  });

  it('pairs an index with itself in both orders, each item with itself too', () => {
    const a = boxes(333, 42, 2);
    const index = ContourBoxIndex.create(a);
    expect(pairsByTrees(index, index, false)).toEqual(pairsByQuery(a, index));
  });

  it('visits nothing when either index is empty', () => {
    const empty = ContourBoxIndex.create<Box>([]);
    const some = ContourBoxIndex.create(boxes(10, 1, 3));
    expect(pairsByTrees(empty, some, false)).toEqual([]);
    expect(pairsByTrees(some, empty, false)).toEqual([]);
  });
});

describe('ContourBoxIndex.overlapIdsSteps with a margin', () => {
  // Every pair whose boxes come within `margin` (inclusive), marked with
  // whether the boxes themselves overlap, found by brute force. Coordinates
  // and margins are multiples of 1/2, so the sums are exact.
  function pairsWithin(a: Box[], b: Box[], margin: number): string[] {
    const within = (p: Box, q: Box, m: number): boolean =>
      p.maxX + m >= q.minX && q.maxX + m >= p.minX && p.maxY + m >= q.minY && q.maxY + m >= p.minY;
    return a
      .flatMap((p) =>
        b.filter((q) => within(p, q, margin)).map((q) => `${p.id}:${q.id}:${within(p, q, 0)}`),
      )
      .sort();
  }

  function pairsByIds(
    a: ContourBoxIndex<Box>,
    b: ContourBoxIndex<Box>,
    cooperate: boolean,
    margin?: number,
  ): string[] {
    const pairs: string[] = [];
    runTraceSteps(
      (function* () {
        yield* a.overlapIdsSteps(
          b,
          (i, j, overlapping) => pairs.push(`${i}:${j}:${overlapping}`),
          cooperate,
          margin,
        );
      })(),
    );
    return pairs;
  }

  it('visits exactly the pairs whose boxes come within the margin, saying which overlap', () => {
    for (const margin of [0.5, 1, 2.5]) {
      for (const [countA, countB, size] of [
        [9, 300, 2],
        [400, 350, 1],
        [120, 120, 6],
      ] as const) {
        const a = boxes(countA, countA * 31 + countB, size);
        const b = boxes(countB, countB * 17 + countA, size);
        const expected = pairsWithin(a, b, margin);
        // Some pairs are visited only for the margin.
        expect(expected.some((pair) => pair.endsWith(':false'))).toBe(true);
        const indexA = ContourBoxIndex.create(a);
        const indexB = ContourBoxIndex.create(b);
        expect(pairsByIds(indexA, indexB, false, margin).sort()).toEqual(expected);
        expect(pairsByIds(indexA, indexB, true, margin).sort()).toEqual(expected);
      }
    }
  });

  it('with no margin visits the overlapping pairs, all marked as overlapping, in one order', () => {
    const a = boxes(300, 5, 2);
    const b = boxes(280, 6, 3);
    const indexA = ContourBoxIndex.create(a);
    const indexB = ContourBoxIndex.create(b);
    const plain = pairsByIds(indexA, indexB, false);
    expect(pairsByIds(indexA, indexB, false, 0)).toEqual(plain);
    expect([...plain].sort()).toEqual(pairsWithin(a, b, 0));
    expect(plain.every((pair) => pair.endsWith(':true'))).toBe(true);
  });
});
