import { describe, expect, it } from 'vitest';
import { createRgbaBuffer, RGBA_CHANNELS } from './rgba-buffer';
import {
  blitTransformedInPlace,
  IDENTITY_AFFINE,
  transformedBounds,
  type FloatingPixels,
} from './transform-blit';

const MAX_BYTE = 255;
const HALF_BYTE = 128;
const QUARTER_BYTE = 64;
const PARTIAL_TRANSFORM_PIXEL_COUNT = 4;
const PARTIAL_TRANSFORM_SCALE_X = 1.5;
const PARTIAL_TRANSFORM_SCALE_Y = 0.75;
const PARTIAL_TRANSFORM_ROTATION_DEG = 37;

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

function transparentBuffer(width: number, height: number): ReturnType<typeof createRgbaBuffer> {
  return { width, height, data: new Uint8ClampedArray(width * height * RGBA_CHANNELS) };
}

function rgba(
  buffer: ReturnType<typeof createRgbaBuffer>,
  x: number,
  y: number,
): readonly number[] {
  const base = (y * buffer.width + x) * RGBA_CHANNELS;
  return Array.from(buffer.data.slice(base, base + RGBA_CHANNELS));
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

  it('multiplies intrinsic source alpha by selection alpha', () => {
    const floating: FloatingPixels = {
      rect: { x: 0, y: 0, width: 1, height: 1 },
      pixels: new Uint8ClampedArray([10, 20, 240, QUARTER_BYTE]),
      alpha: new Uint8Array([HALF_BYTE]),
    };
    const buffer = transparentBuffer(2, 1);
    blitTransformedInPlace(buffer, floating, IDENTITY_AFFINE);
    expect(rgba(buffer, 0, 0)).toEqual([10, 20, 240, 32]);
  });

  it('does not fabricate opacity from transparent coloured pixels', () => {
    const floating: FloatingPixels = {
      rect: { x: 0, y: 0, width: 1, height: 1 },
      pixels: new Uint8ClampedArray([0, MAX_BYTE, 0, 0]),
      alpha: new Uint8Array([MAX_BYTE]),
    };
    const buffer = transparentBuffer(2, 1);
    blitTransformedInPlace(buffer, floating, IDENTITY_AFFINE);
    expect(rgba(buffer, 0, 0)).toEqual([0, 0, 0, 0]);
  });

  it('uses premultiplied taps so transparent RGB cannot create a scaling halo', () => {
    const floating: FloatingPixels = {
      rect: { x: 0, y: 0, width: 2, height: 1 },
      pixels: new Uint8ClampedArray([0, MAX_BYTE, 0, 0, 0, 0, 0, MAX_BYTE]),
      alpha: new Uint8Array([MAX_BYTE, MAX_BYTE]),
    };
    const buffer = transparentBuffer(6, 2);
    blitTransformedInPlace(buffer, floating, {
      ...IDENTITY_AFFINE,
      scaleX: 2,
      scaleY: 2,
    });
    for (let x = 0; x < buffer.width; x += 1) {
      const pixel = rgba(buffer, x, 0);
      if ((pixel[3] ?? 0) > 0) expect(pixel[1]).toBe(0);
    }
  });

  it('keeps partial-alpha pixels partial through combined scale and rotation', () => {
    const floating: FloatingPixels = {
      rect: { x: 2, y: 2, width: 2, height: 2 },
      pixels: new Uint8ClampedArray([
        MAX_BYTE,
        MAX_BYTE,
        MAX_BYTE,
        QUARTER_BYTE,
        0,
        0,
        0,
        QUARTER_BYTE,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
      ]),
      alpha: new Uint8Array(PARTIAL_TRANSFORM_PIXEL_COUNT).fill(MAX_BYTE),
    };
    const buffer = transparentBuffer(8, 8);
    blitTransformedInPlace(buffer, floating, {
      ...IDENTITY_AFFINE,
      scaleX: PARTIAL_TRANSFORM_SCALE_X,
      scaleY: PARTIAL_TRANSFORM_SCALE_Y,
      rotateDeg: PARTIAL_TRANSFORM_ROTATION_DEG,
    });
    const alphas = Array.from(buffer.data).filter(
      (_channel, index) => index % RGBA_CHANNELS === RGBA_CHANNELS - 1,
    );
    expect(alphas.some((alpha) => alpha > 0)).toBe(true);
    expect(Math.max(...alphas)).toBeLessThanOrEqual(QUARTER_BYTE);
  });
});
