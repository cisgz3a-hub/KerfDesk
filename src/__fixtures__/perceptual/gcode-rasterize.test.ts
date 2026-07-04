import { describe, expect, it } from 'vitest';
import { rasterizeGcodeBurn } from './gcode-rasterize';
import type { Mask } from './rasterize';

const MASK_SIZE = 16;

describe('rasterizeGcodeBurn', () => {
  it('parses compact signed/exponent words and ignores comments while burning modal G1 moves', () => {
    const mask = rasterize(`
      m4s1
      g0x+1y1
      g1x1.0e1y1(S0 is only a comment)
      y+5 ; S0 is only a semicolon comment
    `);

    expect(pixelAt(mask, 5, 1)).toBe(1);
    expect(pixelAt(mask, 10, 3)).toBe(1);
  });

  it('does not partially parse malformed numeric suffixes as valid coordinates', () => {
    const mask = rasterize(`
      M3 S100
      G0 X2 Y5
      G1 X8e
    `);

    expect(countInk(mask)).toBe(0);
  });

  it('respects positive modal S values and M5 laser-off state', () => {
    const mask = rasterize(`
      M3 S0
      G1 X8 Y2
      S100
      X8 Y8
      M5
      Y12
    `);

    expect(pixelAt(mask, 4, 1)).toBe(0);
    expect(pixelAt(mask, 8, 5)).toBe(1);
    expect(pixelAt(mask, 8, 10)).toBe(0);
  });

  it('ignores rapid moves even when the laser is armed', () => {
    const mask = rasterize(`
      M3 S100
      G0 X1 Y1
      G0 X10 Y1
      G1 X10 Y6
    `);

    expect(pixelAt(mask, 5, 1)).toBe(0);
    expect(pixelAt(mask, 10, 3)).toBe(1);
  });
});

function rasterize(gcode: string): Mask {
  return rasterizeGcodeBurn(gcode, MASK_SIZE, MASK_SIZE, { burnWidthMm: 1 });
}

function pixelAt(mask: Mask, x: number, y: number): number {
  return mask.data[y * mask.width + x] ?? 0;
}

function countInk(mask: Mask): number {
  return mask.data.reduce((sum, value) => sum + value, 0);
}
