import { describe, expect, it } from 'vitest';
import type { VectorRaster } from '../../core/raster';
import {
  IDENTITY_TRANSFORM,
  transformedBBox,
  type ImportedSvg,
  type Transform,
} from '../../core/scene';
import { assembleBitmap } from './bitmap-assembly';

function convert(transform: Partial<Transform> = {}) {
  const source: ImportedSvg = {
    kind: 'imported-svg',
    id: 'fractional-rectangle',
    source: 'fractional-rectangle.svg',
    bounds: { minX: 0, minY: 0, maxX: 10.01, maxY: 7.03 },
    transform: { ...IDENTITY_TRANSFORM, ...transform },
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            closed: true,
            points: [
              { x: 0, y: 0 },
              { x: 10.01, y: 0 },
              { x: 10.01, y: 7.03 },
              { x: 0, y: 7.03 },
            ],
          },
        ],
      },
    ],
  };
  let captured: VectorRaster | undefined;
  const image = assembleBitmap(
    [source],
    (raster) => {
      captured = raster;
      return { dataUrl: 'data:,', lumaBase64: '' };
    },
    'converted',
    { dpi: 254, renderType: 'outlines' },
  );
  if (captured === undefined) throw new Error('Expected raster at the encoder boundary');
  return { image, raster: captured, source };
}

describe('Convert to Bitmap retains fractional outline boundaries', () => {
  it.each([
    {},
    { x: 123.456, y: -78.91 },
    { mirrorX: true },
    { mirrorY: true },
    { rotationDeg: 90 },
    { rotationDeg: 180 },
    { rotationDeg: 270, x: -123.456, y: 78.91, mirrorX: true },
  ])('keeps every perimeter pixel with transform %j', (transform) => {
    const { image, raster, source } = convert(transform);
    const { width, height } = raster;
    expect(image.bounds).toEqual(transformedBBox(source));
    expect(image.transform).toEqual(IDENTITY_TRANSFORM);
    expect([width, height].sort((a, b) => a - b)).toEqual([70, 100]);
    const expected = Uint8Array.from({ length: width * height }, (_, index) => {
      const x = index % width;
      const y = Math.floor(index / width);
      return x === 0 || y === 0 || x === width - 1 || y === height - 1 ? 127 : 255;
    });
    expect(raster.luma).toEqual(expected);
  });

  it('keeps the same mask under an oblique rotation and its mirror/transpose', () => {
    const original = convert({ rotationDeg: 31 }).raster;
    const mirror = convert({ rotationDeg: -31 }).raster;
    const transpose = convert({ rotationDeg: 59, mirrorY: true }).raster;
    expect([mirror.width, mirror.height]).toEqual([original.width, original.height]);
    expect([transpose.width, transpose.height]).toEqual([original.height, original.width]);
    for (let y = 0; y < original.height; y += 1) {
      for (let x = 0; x < original.width; x += 1) {
        const ink = original.luma[y * original.width + x];
        expect(mirror.luma[y * mirror.width + mirror.width - 1 - x]).toBe(ink);
        expect(transpose.luma[x * transpose.width + y]).toBe(ink);
      }
    }
  });
});
