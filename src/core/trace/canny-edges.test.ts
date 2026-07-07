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

  it('clamps a non-finite blurSigma instead of allocating an unbounded kernel', () => {
    const image = filledSquare(48, 14, 34);
    // Infinite sigma → Math.ceil(sigma*3) kernel radius would be Infinity
    // (unbounded alloc / hang). NaN sigma corrupts the kernel. Both must
    // produce a bounded edge field of the right length without throwing.
    for (const bad of [Number.POSITIVE_INFINITY, Number.NaN, -5]) {
      const edges = cannyEdges(image, { blurSigma: bad });
      expect(edges.length).toBe(48 * 48);
      expect(countEdges(edges)).toBeGreaterThanOrEqual(0);
    }
  });

  it('clamps non-finite / out-of-range threshold ratios to a valid edge field', () => {
    const image = filledSquare(48, 14, 34);
    for (const bad of [Number.NaN, -1, Number.POSITIVE_INFINITY, 5]) {
      const edges = cannyEdges(image, { lowThresholdRatio: bad, highThresholdRatio: bad });
      expect(edges.length).toBe(48 * 48);
      expect(countEdges(edges)).toBeGreaterThanOrEqual(0);
    }
  });

  it('leaves valid-path output unchanged (default options are a bounded case)', () => {
    // Explicit valid params equal to the defaults must match the no-options call.
    const image = filledSquare(48, 14, 34);
    const withExplicit = cannyEdges(image, {
      blurSigma: 1.2,
      lowThresholdRatio: 0.08,
      highThresholdRatio: 0.2,
    });
    expect(withExplicit).toEqual(cannyEdges(image));
  });
});
