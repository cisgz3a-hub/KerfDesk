import { describe, expect, it } from 'vitest';
import { createRgbaBuffer, RGBA_CHANNELS } from './rgba-buffer';
import {
  blitTransformedInPlace,
  IDENTITY_AFFINE,
  transformedBounds,
  type FloatingPixels,
} from './transform-blit';

// A 4×4 solid-black floating region whose source sat at (8, 8).
function blackSquare(): FloatingPixels {
  const pixels = new Uint8ClampedArray(4 * 4 * RGBA_CHANNELS);
  for (let i = 0; i < 16; i += 1) {
    pixels[i * 4 + 3] = 255;
  }
  return {
    rect: { x: 8, y: 8, width: 4, height: 4 },
    pixels,
    alpha: new Uint8Array(16).fill(255),
  };
}

function luma(buffer: ReturnType<typeof createRgbaBuffer>, x: number, y: number): number {
  return buffer.data[(y * buffer.width + x) * RGBA_CHANNELS] ?? -1;
}

describe('transformedBounds', () => {
  it('pads the identity bounds by the safety margin', () => {
    const b = transformedBounds(blackSquare(), IDENTITY_AFFINE);
    expect(b.x).toBeLessThanOrEqual(8);
    expect(b.x + b.width).toBeGreaterThanOrEqual(12);
  });

  it('scales and translates the AABB', () => {
    const b = transformedBounds(blackSquare(), {
      ...IDENTITY_AFFINE,
      translateX: 10,
      scaleX: 2,
      scaleY: 2,
    });
    // Centre moved to (20, 10); half extents 4 → spans ~16..24 in x.
    expect(b.x).toBeLessThanOrEqual(16);
    expect(b.x + b.width).toBeGreaterThanOrEqual(24);
  });
});

describe('blitTransformedInPlace', () => {
  it('identity places the region back over its source', () => {
    const buffer = createRgbaBuffer(24, 24);
    blitTransformedInPlace(buffer, blackSquare(), IDENTITY_AFFINE);
    expect(luma(buffer, 9, 9)).toBe(0);
    expect(luma(buffer, 10, 10)).toBe(0);
    expect(luma(buffer, 14, 9)).toBe(255);
  });

  it('translation moves the pixels', () => {
    const buffer = createRgbaBuffer(24, 24);
    blitTransformedInPlace(buffer, blackSquare(), { ...IDENTITY_AFFINE, translateX: 6 });
    expect(luma(buffer, 9, 9)).toBe(255);
    expect(luma(buffer, 16, 9)).toBe(0);
  });

  it('2× scale grows the footprint about the centre', () => {
    const buffer = createRgbaBuffer(24, 24);
    blitTransformedInPlace(buffer, blackSquare(), { ...IDENTITY_AFFINE, scaleX: 2, scaleY: 2 });
    // Centre (10, 10); half extent 4 → x 6..14 painted. Sample interior
    // pixels — transformed edges are bilinear-antialiased by design.
    expect(luma(buffer, 8, 10)).toBe(0);
    expect(luma(buffer, 12, 10)).toBe(0);
    expect(luma(buffer, 3, 10)).toBe(255);
  });

  it('90° rotation of an asymmetric region maps the long axis', () => {
    // 6×2 bar at (4, 8); rotating 90° should make it 2 wide × 6 tall.
    const pixels = new Uint8ClampedArray(6 * 2 * RGBA_CHANNELS);
    for (let i = 0; i < 12; i += 1) pixels[i * 4 + 3] = 255;
    const bar: FloatingPixels = {
      rect: { x: 4, y: 8, width: 6, height: 2 },
      pixels,
      alpha: new Uint8Array(12).fill(255),
    };
    const buffer = createRgbaBuffer(24, 24);
    blitTransformedInPlace(buffer, bar, { ...IDENTITY_AFFINE, rotateDeg: 90 });
    // Centre (7, 9): vertical bar spans y 6..12 at x≈7 — sample interior
    // pixels (transformed edges antialias).
    expect(luma(buffer, 7, 9)).toBe(0);
    expect(luma(buffer, 7, 10)).toBe(0);
    expect(luma(buffer, 11, 9)).toBe(255);
  });

  it('clamps to the document and reports the touched rect', () => {
    const buffer = createRgbaBuffer(24, 24);
    const rect = blitTransformedInPlace(buffer, blackSquare(), {
      ...IDENTITY_AFFINE,
      translateX: -20,
    });
    expect(rect.x).toBe(0);
    const off = blitTransformedInPlace(buffer, blackSquare(), {
      ...IDENTITY_AFFINE,
      translateX: -100,
    });
    expect(off.width).toBe(0);
  });
});
