// Output-identity proof for the tuned whole-grid distance field (ADR-438
// amendment, speed wave 2): every element must be Object.is-equal to the
// frozen column-major reference on fuzzed masks. The oracle corpus masks are
// checked by src/__fixtures__/perceptual/trace-parity-distance-field.test.ts.

import { describe, expect, it } from 'vitest';
import { fuzzMask, fuzzMasks } from '../mask-fuzz.test-support';
import { referenceSquaredDistanceField } from './distance-field-reference.test-support';
import { squaredDistanceField, type InkMask } from './distance-field';

function firstDifference(actual: Float64Array, expected: Float64Array): number {
  if (actual.length !== expected.length) return 0;
  for (let i = 0; i < actual.length; i += 1) {
    if (!Object.is(actual[i], expected[i])) return i;
  }
  return -1;
}

function expectIdentical(mask: InkMask): void {
  const actual = squaredDistanceField(mask);
  const expected = referenceSquaredDistanceField(mask);
  expect(actual.length).toBe(expected.length);
  const at = firstDifference(actual, expected);
  expect(at, `${mask.width}x${mask.height} differs at ${at}`).toBe(-1);
}

describe('squaredDistanceField equals the frozen reference element for element', () => {
  it('on 3000 fuzzed masks of every family', () => {
    for (const mask of fuzzMasks(3000, 11)) expectIdentical(mask);
  });

  it('on large all-ink, all-paper and border-ink grids', () => {
    for (const family of ['all-ink', 'all-paper', 'border', 'blobs', 'sparse'] as const) {
      for (let seed = 0; seed < 4; seed += 1) expectIdentical(fuzzMask(seed, family, 300));
    }
  });

  it('on degenerate grids', () => {
    for (const [width, height] of [
      [0, 0],
      [0, 5],
      [5, 0],
      [1, 1],
      [1, 40],
      [40, 1],
    ] as const) {
      expectIdentical({ width, height, ink: new Uint8Array(width * height).fill(1) });
      expectIdentical({ width, height, ink: new Uint8Array(width * height) });
    }
  });

  it('treats non-1 mask values as background, like the reference', () => {
    const ink = Uint8Array.from([1, 2, 1, 255, 1, 1, 0, 1, 1]);
    expectIdentical({ width: 3, height: 3, ink });
  });
});
