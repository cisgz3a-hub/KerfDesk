import { describe, expect, it } from 'vitest';
import { createRgbaBuffer, RGBA_CHANNELS, rgbaBuffersEqual } from '../image-edit/rgba-buffer';
import { rectSelection } from './marquee';
import { blitFloatingInPlace, extractFloatingRegion, fillMaskedInPlace } from './region-ops';
import { createEmptyMask } from './selection-mask';

const BLACK = { r: 0, g: 0, b: 0 };
const WHITE = { r: 255, g: 255, b: 255 };
const MAX_BYTE = 255;
const PARTIAL_ALPHA = 200;
const HALF_MASK_ALPHA = 128;

function channelAt(buffer: ReturnType<typeof createRgbaBuffer>, x: number, y: number): number {
  return buffer.data[(y * buffer.width + x) * RGBA_CHANNELS] ?? -1;
}

describe('fillMaskedInPlace', () => {
  it('fills exactly the selected pixels and reports the touched bounds', () => {
    const buffer = createRgbaBuffer(8, 8);
    const mask = rectSelection(8, 8, { x: 2, y: 3, width: 3, height: 2 });
    const rect = fillMaskedInPlace(buffer, mask, BLACK);
    expect(rect).toEqual({ x: 2, y: 3, width: 3, height: 2 });
    expect(channelAt(buffer, 2, 3)).toBe(0);
    expect(channelAt(buffer, 4, 4)).toBe(0);
    expect(channelAt(buffer, 1, 3)).toBe(255);
    expect(channelAt(buffer, 2, 5)).toBe(255);
  });

  it('an empty mask touches nothing', () => {
    const buffer = createRgbaBuffer(4, 4);
    const before = Uint8ClampedArray.from(buffer.data);
    const rect = fillMaskedInPlace(buffer, createEmptyMask(4, 4), BLACK);
    expect(rect.width).toBe(0);
    expect(Array.from(buffer.data)).toEqual(Array.from(before));
  });
});

describe('extractFloatingRegion + blitFloatingInPlace (the move protocol)', () => {
  it('extract -> white-fill -> blit moves the selected pixels', () => {
    const buffer = createRgbaBuffer(10, 10);
    // A recognizable 2x2 black block at (2, 2).
    fillMaskedInPlace(buffer, rectSelection(10, 10, { x: 2, y: 2, width: 2, height: 2 }), BLACK);
    const mask = rectSelection(10, 10, { x: 2, y: 2, width: 2, height: 2 });

    const floating = extractFloatingRegion(buffer, mask);
    expect(floating).not.toBeNull();
    if (floating === null) return;
    expect(floating.rect).toEqual({ x: 2, y: 2, width: 2, height: 2 });

    fillMaskedInPlace(buffer, mask, WHITE);
    const touched = blitFloatingInPlace(buffer, floating, 4, 3);
    expect(touched).toEqual({ x: 6, y: 5, width: 2, height: 2 });

    // Source is white again; destination carries the block.
    expect(channelAt(buffer, 2, 2)).toBe(255);
    expect(channelAt(buffer, 6, 5)).toBe(0);
    expect(channelAt(buffer, 7, 6)).toBe(0);
    expect(channelAt(buffer, 8, 5)).toBe(255);
  });

  it('a zero-offset round-trip is byte-identical', () => {
    const buffer = createRgbaBuffer(8, 8);
    fillMaskedInPlace(buffer, rectSelection(8, 8, { x: 1, y: 1, width: 3, height: 3 }), BLACK);
    const original = {
      width: buffer.width,
      height: buffer.height,
      data: Uint8ClampedArray.from(buffer.data),
    };
    const mask = rectSelection(8, 8, { x: 1, y: 1, width: 3, height: 3 });
    const floating = extractFloatingRegion(buffer, mask);
    if (floating === null) throw new Error('expected a floating region');
    fillMaskedInPlace(buffer, mask, WHITE);
    blitFloatingInPlace(buffer, floating, 0, 0);
    expect(rgbaBuffersEqual(buffer, original)).toBe(true);
  });

  it('blit clamps at the document edge and reports the visible rect', () => {
    const buffer = createRgbaBuffer(6, 6);
    fillMaskedInPlace(buffer, rectSelection(6, 6, { x: 4, y: 4, width: 2, height: 2 }), BLACK);
    const floating = extractFloatingRegion(
      buffer,
      rectSelection(6, 6, { x: 4, y: 4, width: 2, height: 2 }),
    );
    if (floating === null) throw new Error('expected a floating region');
    const touched = blitFloatingInPlace(buffer, floating, 1, 1);
    expect(touched).toEqual({ x: 5, y: 5, width: 1, height: 1 });
    const gone = blitFloatingInPlace(buffer, floating, 10, 10);
    expect(gone.width).toBe(0);
  });

  it('preserves intrinsic RGBA alpha while applying selection alpha', () => {
    const buffer = {
      width: 1,
      height: 1,
      data: new Uint8ClampedArray(RGBA_CHANNELS),
    };
    const floating = {
      rect: { x: 0, y: 0, width: 1, height: 1 },
      pixels: new Uint8ClampedArray([10, 20, 30, PARTIAL_ALPHA]),
      alpha: new Uint8Array([HALF_MASK_ALPHA]),
    };
    blitFloatingInPlace(buffer, floating, 0, 0);
    expect(Array.from(buffer.data)).toEqual([10, 20, 30, 100]);
  });

  it('does not make transparent coloured source pixels opaque', () => {
    const buffer = {
      width: 1,
      height: 1,
      data: new Uint8ClampedArray(RGBA_CHANNELS),
    };
    const floating = {
      rect: { x: 0, y: 0, width: 1, height: 1 },
      pixels: new Uint8ClampedArray([0, MAX_BYTE, 0, 0]),
      alpha: new Uint8Array([MAX_BYTE]),
    };
    blitFloatingInPlace(buffer, floating, 0, 0);
    expect(Array.from(buffer.data)).toEqual([0, 0, 0, 0]);
  });
});
