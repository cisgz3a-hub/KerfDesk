import { describe, expect, it } from 'vitest';
import { cannyEdges } from './canny-edges';
import type { RawImageData } from './trace-image';

// A `size`x`size` RGBA image: a filled dark square in [lo, hi) on white.
function filledSquare(size: number, lo: number, hi: number): RawImageData {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const o = (y * size + x) * 4;
      const value = x >= lo && x < hi && y >= lo && y < hi ? 0 : 255;
      data[o] = value;
      data[o + 1] = value;
      data[o + 2] = value;
      data[o + 3] = 255;
    }
  }
  return { width: size, height: size, data };
}

function countEdges(edges: Uint8Array): number {
  let count = 0;
  for (const v of edges) count += v;
  return count;
}

describe('cannyEdges', () => {
  it('marks the boundary of a filled square but not its flat interior', () => {
    const size = 48;
    const edges = cannyEdges(filledSquare(size, 14, 34));
    let interior = 0;
    for (let y = 22; y < 26; y += 1) {
      for (let x = 22; x < 26; x += 1) interior += edges[y * size + x] ?? 0;
    }
    expect(interior).toBe(0);
    // The 20px-square perimeter survives non-max suppression as a thin ring.
    expect(countEdges(edges)).toBeGreaterThan(60);
  });

  it('returns no edges for a flat image (no contrast)', () => {
    // lo > hi => no dark pixels => uniform white, zero gradient everywhere.
    expect(countEdges(cannyEdges(filledSquare(24, 1, 0)))).toBe(0);
  });

  it('is deterministic for the same input', () => {
    expect(cannyEdges(filledSquare(48, 14, 34))).toEqual(cannyEdges(filledSquare(48, 14, 34)));
  });
});
