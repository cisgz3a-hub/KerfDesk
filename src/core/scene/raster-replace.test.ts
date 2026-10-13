import { describe, expect, it } from 'vitest';
import { replaceRasterPicture } from './raster-replace';
import { IDENTITY_TRANSFORM, type RasterImage } from './scene-object';
import { applyTransform } from './transform';

const PLACED: RasterImage = {
  kind: 'raster-image',
  id: 'photo',
  source: 'old.png',
  dataUrl: 'data:old',
  lumaBase64: 'old-luma',
  pixelWidth: 100,
  pixelHeight: 50,
  bounds: { minX: 0, minY: 0, maxX: 40, maxY: 20 },
  transform: { ...IDENTITY_TRANSFORM, x: 100, y: 60, rotationDeg: 30, mirrorX: true },
  color: '#ff0000',
  dither: 'jarvis',
  linesPerMm: 12,
  brightness: 10,
  imageMaskId: 'mask',
};

const INCOMING: RasterImage = {
  ...PLACED,
  id: 'fresh',
  source: 'new.png',
  dataUrl: 'data:new',
  lumaBase64: 'new-luma',
  pixelWidth: 300,
  pixelHeight: 300,
  bounds: { minX: 0, minY: 0, maxX: 30, maxY: 30 },
  transform: IDENTITY_TRANSFORM,
  dither: 'floyd-steinberg',
  linesPerMm: 10,
};

const centre = (image: RasterImage) =>
  applyTransform(
    {
      x: (image.bounds.minX + image.bounds.maxX) / 2,
      y: (image.bounds.minY + image.bounds.maxY) / 2,
    },
    image.transform,
  );

describe('replace a placed image', () => {
  it('keeps id, settings and centre; takes the new picture at its own size', () => {
    const next = replaceRasterPicture(PLACED, INCOMING, 'natural');
    expect(next).toMatchObject({
      id: 'photo',
      source: 'new.png',
      dataUrl: 'data:new',
      lumaBase64: 'new-luma',
      pixelWidth: 300,
      dither: 'jarvis',
      linesPerMm: 12,
      brightness: 10,
      imageMaskId: 'mask',
      color: '#ff0000',
    });
    expect(next.bounds.maxX - next.bounds.minX).toBe(30);
    expect(next.transform.rotationDeg).toBe(30);
    expect(centre(next).x).toBeCloseTo(centre(PLACED).x, 9);
    expect(centre(next).y).toBeCloseTo(centre(PLACED).y, 9);
  });

  it('fits the new picture inside the old box keeping its aspect ratio', () => {
    const next = replaceRasterPicture(PLACED, INCOMING, 'fit');
    expect(next.bounds.maxX - next.bounds.minX).toBeCloseTo(20, 9);
    expect(next.bounds.maxY - next.bounds.minY).toBeCloseTo(20, 9);
    expect(centre(next).x).toBeCloseTo(centre(PLACED).x, 9);
  });

  it("drops the old picture's paged asset and photo edits", () => {
    const paged = { ...PLACED, editorDocument: {} as never };
    const next = replaceRasterPicture(paged, INCOMING, 'natural');
    expect('editorDocument' in next).toBe(false);
  });
});
