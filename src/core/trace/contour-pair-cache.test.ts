import { describe, expect, it } from 'vitest';
import { boxesOverlap, type ContourBox } from './contour-bounds';
import { ContourPairCache } from './contour-pair-cache';
import { runTraceSteps } from './trace-steps';

type KeyedBox = ContourBox & { readonly key: object; readonly index: number };

function randomBoxes(count: number, seed: number): KeyedBox[] {
  let state = seed;
  const random = (): number => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
  return Array.from({ length: count }, (_, index) => {
    const x = random() * 100;
    const y = random() * 100;
    return {
      minX: x,
      minY: y,
      maxX: x + random() * 12,
      maxY: y + random() * 12,
      key: {},
      index,
    };
  });
}

function bruteForce(boxes: ReadonlyArray<KeyedBox>): string[] {
  const pairs: string[] = [];
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      if (boxesOverlap(boxes[i] as KeyedBox, boxes[j] as KeyedBox)) pairs.push(`${i}:${j}`);
    }
  }
  return pairs.sort();
}

describe('contour pair cache', () => {
  it('finds every overlapping pair while only some boxes change between rounds', () => {
    const cache = new ContourPairCache();
    let boxes = randomBoxes(300, 5);
    for (let round = 0; round < 6; round += 1) {
      const pairs = runTraceSteps(cache.pairsSteps(boxes, (box) => box.key));
      const found = pairs
        .map(({ first, second }) =>
          first.index < second.index
            ? `${first.index}:${second.index}`
            : `${second.index}:${first.index}`,
        )
        .sort();
      expect(found).toEqual(bruteForce(boxes));
      // Move a few boxes (new keys); the rest keep theirs.
      const moved = randomBoxes(300, 100 + round);
      boxes = boxes.map((box, index) => (index % 37 === round ? (moved[index] as KeyedBox) : box));
    }
  });

  it('recalls a verdict only for a pair whose boxes are both unchanged', () => {
    const cache = new ContourPairCache();
    const boxes = randomBoxes(60, 9);
    for (const { slot } of runTraceSteps(cache.pairsSteps(boxes, (box) => box.key))) {
      cache.remember(slot, true);
    }
    const changed = boxes.map((box, index) => (index === 0 ? { ...box, key: {} } : box));
    for (const { first, second, slot } of runTraceSteps(
      cache.pairsSteps(changed, (box) => box.key),
    )) {
      const touchesChanged = first.index === 0 || second.index === 0;
      expect(cache.recall(slot)).toBe(touchesChanged ? undefined : true);
    }
  });
});
