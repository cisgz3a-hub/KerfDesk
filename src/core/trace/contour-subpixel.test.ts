// Sub-pixel crack interpolation tests (research brief 2026-07-10, rec #1).
// The mid-crack walker quantizes every boundary vertex to the lattice-edge
// midpoint (t = 0.5); with the pre-threshold grayscale available, each
// vertex moves to the true threshold iso-line crossing between the two
// pixel centres — the anti-aliasing ramp encodes the sub-pixel edge
// position that binarization throws away.

import { describe, expect, it } from 'vitest';
import { midCrackChain, type CrackSubPixelField } from './contour-boundary';

// A vertical boundary: background column luma 255, edge column luma 64,
// threshold 128. The iso-crossing between centres sits at
// t = (255 − 128) / (255 − 64) ≈ 0.665 from the background centre.
function fieldFromLuma(width: number, height: number, luma: number[]): CrackSubPixelField {
  return {
    lumaAt: (x: number, y: number): number => {
      if (x < 0 || y < 0 || x >= width || y >= height) return 255;
      return luma[y * width + x] ?? 255;
    },
    thresholdAt: (): number => 128,
  };
}

describe('midCrackChain sub-pixel interpolation', () => {
  // One ink pixel at (1,1) inside a 3x3 white frame; its right-side crack
  // runs between pixel centres (1.5,1.5) ink and (2.5,1.5) background.
  const loop: ReadonlyArray<{ x: number; y: number }> = [
    { x: 1, y: 1 },
    { x: 2, y: 1 },
    { x: 2, y: 2 },
    { x: 1, y: 2 },
  ];

  it('reproduces the plain mid-crack chain when no field is given', () => {
    const chain = midCrackChain(loop);
    expect(chain).toEqual([
      { x: 1.5, y: 1 },
      { x: 2, y: 1.5 },
      { x: 1.5, y: 2 },
      { x: 1, y: 1.5 },
    ]);
  });

  it('stays at the midpoint for a pure binary field (t = 0.5)', () => {
    // Ink pixel luma 0, all else 255, threshold 128: t = 127/255 ≈ 0.498 —
    // within half a hundredth of a pixel of the old behaviour.
    const luma = Array.from({ length: 9 }, () => 255);
    luma[4] = 0; // pixel (1,1)
    const chain = midCrackChain(loop, fieldFromLuma(3, 3, luma));
    const plain = midCrackChain(loop);
    for (let i = 0; i < chain.length; i += 1) {
      expect(chain[i]!.x).toBeCloseTo(plain[i]!.x, 1);
      expect(chain[i]!.y).toBeCloseTo(plain[i]!.y, 1);
    }
  });

  it('moves the vertex toward the ink pixel on an anti-aliased edge', () => {
    // Ink pixel (1,1) is mid-gray 64 (dark side of a soft edge): the true
    // iso-crossing sits closer to the ink centre. For the RIGHT-side crack
    // (edge (2,1)->(2,2), background pixel (2,1) at luma 255):
    // t = (255-128)/(255-64) = 0.665 -> x = 2 + (0.5 - t) = 1.835.
    const luma = Array.from({ length: 9 }, () => 255);
    luma[4] = 64; // pixel (1,1) — still ink (64 <= 128) but barely dark
    const chain = midCrackChain(loop, fieldFromLuma(3, 3, luma));
    const rightCrack = chain[1]!;
    expect(rightCrack.y).toBeCloseTo(1.5, 6);
    expect(rightCrack.x).toBeCloseTo(2 - (0.665 - 0.5), 2);
  });

  it('clamps extreme interpolation and falls back to the midpoint when the pair does not straddle the threshold', () => {
    // Both pixels dark (a filled pinhole crack): no threshold crossing
    // between the centres — the vertex must stay at the midpoint rather
    // than extrapolate.
    const luma = Array.from({ length: 9 }, () => 40);
    luma[4] = 0;
    const chain = midCrackChain(loop, fieldFromLuma(3, 3, luma));
    const plain = midCrackChain(loop);
    expect(chain).toEqual(plain);
  });
});
