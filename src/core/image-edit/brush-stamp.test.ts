import { describe, expect, it } from 'vitest';
import {
  type BrushParams,
  clampBrushDiameter,
  createCoverageWindow,
  MAX_BRUSH_DIAMETER_PX,
  stampInto,
} from './brush-stamp';

function pencil(diameterPx: number): BrushParams {
  return { diameterPx, opacity: 1, tip: { kind: 'pixel' } };
}

function countCovered(alpha: Float32Array): number {
  let count = 0;
  for (const value of alpha) if (value > 0) count += 1;
  return count;
}

describe('clampBrushDiameter', () => {
  it('floors and clamps into the supported range', () => {
    expect(clampBrushDiameter(0)).toBe(1);
    expect(clampBrushDiameter(7.9)).toBe(7);
    expect(clampBrushDiameter(99999)).toBe(MAX_BRUSH_DIAMETER_PX);
  });
});

describe('stampInto — pixel tip', () => {
  it('a 1 px pencil stamp inks exactly the pixel under the cursor', () => {
    const window = createCoverageWindow(0, 0, 5, 5);
    stampInto(window, 2.5, 2.5, pencil(1));
    expect(countCovered(window.alpha)).toBe(1);
    expect(window.alpha[2 * 5 + 2]).toBe(1);
  });

  it('a diameter-4 disc at a pixel-grid centre covers the classic 12-pixel disc', () => {
    const window = createCoverageWindow(0, 0, 8, 8);
    stampInto(window, 4, 4, pencil(4));
    // r=2 disc sampled at pixel centres: rows of 2,4,4,2.
    expect(countCovered(window.alpha)).toBe(12);
    expect(window.alpha.every((alpha) => alpha === 0 || alpha === 1)).toBe(true);
  });

  it('clips against the window edges without wrapping', () => {
    const window = createCoverageWindow(0, 0, 4, 4);
    stampInto(window, 0, 0, pencil(4));
    // Only the quarter of the disc inside the window is written.
    expect(countCovered(window.alpha)).toBe(3);
    expect(window.alpha[3]).toBe(0);
  });
});

describe('stampInto — soft tip', () => {
  const soft: BrushParams = { diameterPx: 10, opacity: 1, tip: { kind: 'soft', hardness: 0.5 } };

  it('is opaque inside the hard core and fades monotonically to the rim', () => {
    const window = createCoverageWindow(0, 0, 12, 12);
    stampInto(window, 6, 6, soft);
    const alphaAt = (x: number) => window.alpha[6 * 12 + x] ?? 0;
    // Pixel centres at distance <= hardness*radius (2.5) are fully opaque.
    expect(alphaAt(5)).toBe(1);
    expect(alphaAt(4)).toBe(1);
    // Alpha decreases towards the rim and reaches zero outside it.
    expect(alphaAt(3)).toBeLessThan(1);
    expect(alphaAt(3)).toBeGreaterThan(alphaAt(2));
    expect(alphaAt(2)).toBeGreaterThan(alphaAt(1));
    expect(alphaAt(0)).toBeLessThan(alphaAt(1));
  });

  it('MAX-blends overlapping stamps instead of accumulating', () => {
    const window = createCoverageWindow(0, 0, 12, 12);
    stampInto(window, 6, 6, soft);
    const once = Float32Array.from(window.alpha);
    stampInto(window, 6, 6, soft);
    expect(Array.from(window.alpha)).toEqual(Array.from(once));
  });
});
