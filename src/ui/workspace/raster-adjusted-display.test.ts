import { describe, expect, it } from 'vitest';
import { createLayer, IDENTITY_TRANSFORM, type RasterImage } from '../../core/scene';
import { burnedImageAdjustments } from './draw-raster';
import { adjustedGreyRgba, hasLumaAdjustments } from './raster-adjusted-display';

function rgba(...pixels: ReadonlyArray<readonly [number, number, number, number]>) {
  return Uint8ClampedArray.from(pixels.flat());
}

describe('adjusted raster display', () => {
  it('only takes over the canvas when an adjustment is off its default', () => {
    expect(hasLumaAdjustments({})).toBe(false);
    expect(hasLumaAdjustments({ brightness: 0, contrast: 0, gamma: 1 })).toBe(false);
    expect(hasLumaAdjustments({ brightness: -20 })).toBe(true);
    expect(hasLumaAdjustments({ contrast: 15 })).toBe(true);
    expect(hasLumaAdjustments({ gamma: 0.8 })).toBe(true);
  });

  it('shows a darkened white line as the grey that burns, not as source white', () => {
    const out = adjustedGreyRgba(rgba([255, 255, 255, 255], [0, 0, 0, 255]), { brightness: -20 });
    // 255 + (-20 × 2.55) = 204: the fine white line is no longer paper-white.
    expect(Array.from(out)).toEqual([204, 204, 204, 255, 0, 0, 0, 255]);
  });

  it('uses the import luma of colour pixels composited over white', () => {
    // Pure red at 128/255 opacity composites to (255, 127, 127) over white;
    // the BT.601 luma of that is 165, and +10 brightness lifts it to 191.
    const out = adjustedGreyRgba(rgba([255, 0, 0, 128]), { brightness: 10 });
    expect(Array.from(out)).toEqual([191, 191, 191, 255]);
  });

  it('keeps transparent areas clear when the adjustment leaves white unburned', () => {
    const out = adjustedGreyRgba(rgba([12, 34, 56, 0], [0, 0, 0, 255]), { brightness: 10 });
    expect(Array.from(out)).toEqual([255, 255, 255, 0, 26, 26, 26, 255]);
  });

  it('paints transparent areas opaque when the adjustment darkens white, because they burn', () => {
    const out = adjustedGreyRgba(rgba([12, 34, 56, 0]), { brightness: -10 });
    expect(Array.from(out)).toEqual([230, 230, 230, 255]);
  });

  it('shows no adjustment for an image whose operation burns it as Pass-Through', () => {
    const image: RasterImage = {
      kind: 'raster-image',
      id: 'img',
      source: 'img.png',
      dataUrl: 'data:image/png;base64,AAAA',
      pixelWidth: 1,
      pixelHeight: 1,
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      transform: IDENTITY_TRANSFORM,
      color: '#808080',
      dither: 'floyd-steinberg',
      linesPerMm: 10,
      brightness: -40,
    };
    const layer = createLayer({ id: 'L1', color: '#808080', mode: 'image' });
    expect(burnedImageAdjustments(image, new Map([['#808080', layer]]))).toBe(image);
    const passThrough = new Map([['#808080', { ...layer, passThrough: true }]]);
    expect(hasLumaAdjustments(burnedImageAdjustments(image, passThrough))).toBe(false);
  });
});
