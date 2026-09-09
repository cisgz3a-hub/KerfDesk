import { describe, expect, it } from 'vitest';
import { midCrackChain, traceBoundaryLoops, type CrackSubPixelField } from './contour-boundary';

const pixel = [
  { x: 1, y: 1 },
  { x: 2, y: 1 },
  { x: 2, y: 2 },
  { x: 1, y: 2 },
];

describe('local threshold contour interpolation', () => {
  it.each([
    { inkL: 99, bgL: 102, inkT: 100, bgT: 100 },
    { inkL: 100, bgL: 102, inkT: 101, bgT: 100 },
    { inkL: 102, bgL: 101, inkT: 103, bgT: 99 },
  ])('locates the same residual iso-line for %o', ({ inkL, bgL, inkT, bgT }) => {
    const field: CrackSubPixelField = {
      lumaAt: (x, y) => (x === 1 && y === 1 ? inkL : bgL),
      thresholdAt: (x, y) => (x === 1 && y === 1 ? inkT : bgT),
    };
    // Background residual +2, ink residual -1: their linear zero is 2/3
    // of the way from the background centre (x=2.5) toward ink (x=1.5).
    expect(midCrackChain(pixel, field)[1]?.x).toBeCloseTo(2.5 - 2 / 3, 13);
  });

  it('uses the midpoint when cleanup creates a boundary without a residual straddle', () => {
    const field: CrackSubPixelField = {
      lumaAt: (x, y) => (x === 1 && y === 1 ? 100 : 120),
      thresholdAt: (x, y) => (x === 1 && y === 1 ? 90 : 115),
    };
    expect(midCrackChain(pixel, field)).toEqual(midCrackChain(pixel));
  });

  it('keeps a complete boundary invariant under a common local brightness ramp', () => {
    const size = 24;
    const residual = (x: number, y: number) => (x - 11.2) ** 2 + (y - 10.3) ** 2 - 6.3 ** 2;
    const ink = Uint8Array.from({ length: size * size }, (_, i) =>
      Number(residual(i % size, Math.floor(i / size)) <= 0),
    );
    const base: CrackSubPixelField = {
      lumaAt: (x, y) => 128 + residual(x, y),
      thresholdAt: () => 128,
    };
    const ramp = (x: number, y: number) => x * 1.5 - y * 0.75;
    const shifted: CrackSubPixelField = {
      lumaAt: (x, y) => base.lumaAt(x, y) + ramp(x, y),
      thresholdAt: (x, y) => 128 + ramp(x, y),
    };
    const loops = traceBoundaryLoops({ width: size, height: size, ink });
    expect(loops).toHaveLength(1);
    const expected = midCrackChain(loops[0]!.points, base);
    const actual = midCrackChain(loops[0]!.points, shifted);
    expect(actual.length).toBeGreaterThan(30);
    for (let i = 0; i < actual.length; i += 1) {
      expect(actual[i]!.x).toBeCloseTo(expected[i]!.x, 12);
      expect(actual[i]!.y).toBeCloseTo(expected[i]!.y, 12);
    }
  });
});
