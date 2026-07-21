import { describe, expect, it } from 'vitest';
import { rectSelection } from './marquee';
import { borderMask, contractMask, expandMask, featherMask, smoothMask } from './mask-morphology';
import { createEmptyMask, MASK_SOLID, maskBounds } from './selection-mask';

function count(alpha: Uint8Array): number {
  let selected = 0;
  for (const value of alpha) if (value > 0) selected += 1;
  return selected;
}

describe('expand / contract', () => {
  it('expand grows a single pixel into the full square element', () => {
    const mask = createEmptyMask(11, 11);
    mask.alpha[5 * 11 + 5] = MASK_SOLID;
    const grown = expandMask(mask, 2);
    // Square structuring element: (2r+1)^2 pixels.
    expect(count(grown.alpha)).toBe(25);
    expect(maskBounds(grown)).toEqual({ x: 3, y: 3, width: 5, height: 5 });
  });

  it('contract shrinks a square symmetrically and expand restores it', () => {
    const square = rectSelection(12, 12, { x: 2, y: 2, width: 8, height: 8 });
    const shrunk = contractMask(square, 2);
    expect(maskBounds(shrunk)).toEqual({ x: 4, y: 4, width: 4, height: 4 });
    const restored = expandMask(shrunk, 2);
    expect(maskBounds(restored)).toEqual({ x: 2, y: 2, width: 8, height: 8 });
  });

  it('contracting past the selection empties it', () => {
    const small = rectSelection(10, 10, { x: 4, y: 4, width: 2, height: 2 });
    expect(count(contractMask(small, 2).alpha)).toBe(0);
  });
});

describe('borderMask', () => {
  it('produces a hollow band around the edge', () => {
    const square = rectSelection(14, 14, { x: 3, y: 3, width: 8, height: 8 });
    const border = borderMask(square, 2);
    // The centre is not in the band; the edge is.
    expect(border.alpha[7 * 14 + 7]).toBe(0);
    expect(border.alpha[3 * 14 + 7]).toBeGreaterThan(0);
  });
});

describe('featherMask', () => {
  it('keeps the selection core solid and softens the edge monotonically', () => {
    const square = rectSelection(20, 20, { x: 5, y: 5, width: 10, height: 10 });
    const soft = featherMask(square, 3);
    const at = (x: number) => soft.alpha[10 * 20 + x] ?? 0;
    expect(at(10)).toBe(MASK_SOLID);
    // Ramp across the boundary: inside > edge > outside.
    expect(at(5)).toBeGreaterThan(at(4));
    expect(at(4)).toBeGreaterThan(at(2));
  });

  it('radius 0 is the identity', () => {
    const square = rectSelection(8, 8, { x: 2, y: 2, width: 3, height: 3 });
    expect(featherMask(square, 0)).toBe(square);
  });
});

describe('smoothMask', () => {
  it('re-thresholds to hard 0/255 values', () => {
    const square = rectSelection(16, 16, { x: 4, y: 4, width: 8, height: 8 });
    const smoothed = smoothMask(square, 2);
    expect(smoothed.alpha.every((a) => a === 0 || a === MASK_SOLID)).toBe(true);
    expect(smoothed.alpha[8 * 16 + 8]).toBe(MASK_SOLID);
  });
});
