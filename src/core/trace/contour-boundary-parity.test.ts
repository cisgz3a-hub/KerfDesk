// Output-identity proof for the direction-bit boundary walk (ADR-438
// amendment, speed wave 2): on 10k fuzzed masks (saddles, border ink, 1-px
// features, solids, rings) and three saddle policies, traceBoundaryLoops
// returns exactly the loops of the frozen Map/Set walker: same loop order,
// same start vertex, same points and the same area.

import { describe, expect, it } from 'vitest';
import { traceBoundaryLoops } from './contour-boundary';
import { referenceTraceBoundaryLoops } from './contour-boundary-reference.test-support';
import { fuzzMask, fuzzMasks } from './mask-fuzz.test-support';
import type { InkMask } from './centerline';
import type { SaddleResolver } from './saddle-connectivity';

const connectPaper: SaddleResolver = () => false;
const connectInk: SaddleResolver = () => true;
// Position-dependent, like the luma-driven resolver the tracer uses.
const hashed: SaddleResolver = (x, y) => ((x * 73_856_093) ^ (y * 19_349_663)) % 3 === 0;

function expectSameLoops(mask: InkMask, saddles?: SaddleResolver): void {
  const actual =
    saddles === undefined ? traceBoundaryLoops(mask) : traceBoundaryLoops(mask, saddles);
  const expected =
    saddles === undefined
      ? referenceTraceBoundaryLoops(mask)
      : referenceTraceBoundaryLoops(mask, saddles);
  expect(actual).toEqual(expected);
}

describe('traceBoundaryLoops equals the frozen Map/Set walker', () => {
  it('on 10k fuzzed masks with the default saddle rule', () => {
    for (const mask of fuzzMasks(10_000, 7)) expectSameLoops(mask);
  });

  it('on fuzzed masks with paper-joining, ink-joining and position-hashed saddles', () => {
    for (const mask of fuzzMasks(3_000, 8)) {
      expectSameLoops(mask, connectPaper);
      expectSameLoops(mask, connectInk);
      expectSameLoops(mask, hashed);
    }
  });

  it('on large masks of every kind', () => {
    for (const family of ['noise', 'dense', 'blobs', 'border', 'checker', 'all-ink'] as const) {
      for (let seed = 0; seed < 3; seed += 1) {
        const mask = fuzzMask(100 + seed, family, 160);
        expectSameLoops(mask);
        expectSameLoops(mask, hashed);
      }
    }
  });

  it('counts any non-zero mask value as ink, like the reference', () => {
    const ink = Uint8Array.from([1, 2, 0, 255, 0, 1, 0, 1, 7]);
    expectSameLoops({ width: 3, height: 3, ink });
  });

  it('handles empty and short ink arrays like the reference', () => {
    expectSameLoops({ width: 0, height: 0, ink: new Uint8Array(0) });
    expectSameLoops({ width: 4, height: 3, ink: Uint8Array.from([1, 1, 0, 1, 1]) });
  });
});
