import { describe, expect, it } from 'vitest';
import { createPolyline, createRectangle } from '../shapes';
import { IDENTITY_TRANSFORM, type RasterImage } from '../scene';
import { applyImageMaskToLuma, hasClosedImageMaskGeometry } from './image-mask';

function raster(overrides: Partial<RasterImage> = {}): RasterImage {
  return {
    kind: 'raster-image',
    id: 'R1',
    source: 'source.png',
    dataUrl: 'data:image/png;base64,source',
    pixelWidth: 4,
    pixelHeight: 2,
    bounds: { minX: 0, minY: 0, maxX: 4, maxY: 2 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'threshold',
    linesPerMm: 1,
    ...overrides,
  };
}

describe('image masks', () => {
  it('whites pixels outside the closed mask geometry', () => {
    const mask = createRectangle({
      id: 'M1',
      color: '#000000',
      spec: { widthMm: 2, heightMm: 2, cornerRadiusMm: 0 },
    });
    const shiftedMask = {
      ...mask,
      transform: { ...IDENTITY_TRANSFORM, x: 1, y: 0 },
    };

    const masked = applyImageMaskToLuma({
      image: raster({ imageMaskId: 'M1' }),
      maskObject: shiftedMask,
      luma: new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]),
      width: 4,
      height: 2,
    });

    expect(Array.from(masked)).toEqual([255, 0, 0, 255, 255, 0, 0, 255]);
  });

  it('detects only closed vector geometry as a valid image mask', () => {
    const closed = createRectangle({
      id: 'M1',
      color: '#000000',
      spec: { widthMm: 2, heightMm: 2, cornerRadiusMm: 0 },
    });
    const open = createPolyline({
      id: 'M2',
      color: '#000000',
      spec: {
        closed: false,
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ],
      },
    });

    expect(hasClosedImageMaskGeometry(closed)).toBe(true);
    expect(hasClosedImageMaskGeometry(open)).toBe(false);
    expect(hasClosedImageMaskGeometry(raster())).toBe(false);
  });
});
