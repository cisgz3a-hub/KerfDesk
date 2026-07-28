import { describe, expect, it } from 'vitest';
import { sourceOverPixelInPlace } from './source-over-pixel';

const MAX_BYTE = 255;
const HALF_BYTE = 128;
const DESTINATION_ALPHA = 128;
const EXPECTED_MIXED_ALPHA = 192;
const EXPECTED_MIXED_RED = 170;
const EXPECTED_MIXED_BLUE = 85;

describe('sourceOverPixelInPlace', () => {
  it('leaves the destination unchanged for a transparent source', () => {
    const data = new Uint8ClampedArray([10, 20, 30, 40]);
    sourceOverPixelInPlace(data, 0, { r: 200, g: 150, b: 100, alpha: 0 });
    expect(Array.from(data)).toEqual([10, 20, 30, 40]);
  });

  it('writes an opaque source exactly', () => {
    const data = new Uint8ClampedArray([10, 20, 30, 40]);
    sourceOverPixelInPlace(data, 0, { r: 200, g: 150, b: 100, alpha: 1 });
    expect(Array.from(data)).toEqual([200, 150, 100, MAX_BYTE]);
  });

  it('composites straight-alpha RGBA without flattening the destination alpha', () => {
    const data = new Uint8ClampedArray([0, 0, MAX_BYTE, DESTINATION_ALPHA]);
    sourceOverPixelInPlace(data, 0, {
      r: MAX_BYTE,
      g: 0,
      b: 0,
      alpha: HALF_BYTE / MAX_BYTE,
    });
    expect(Array.from(data)).toEqual([
      EXPECTED_MIXED_RED,
      0,
      EXPECTED_MIXED_BLUE,
      EXPECTED_MIXED_ALPHA,
    ]);
  });
});
