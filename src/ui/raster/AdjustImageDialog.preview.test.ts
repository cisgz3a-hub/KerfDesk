import { afterEach, expect, it, vi } from 'vitest';
import { DITHER_ALGORITHMS, IDENTITY_TRANSFORM, type RasterImage } from '../../core/scene';
import { drawAdjustImagePreview } from './AdjustImageDialog.preview';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const image: RasterImage = {
  kind: 'raster-image',
  id: 'photo',
  source: 'photo.png',
  color: '#808080',
  dataUrl: 'data:image/png;base64,unused',
  lumaBase64: 'AID/',
  pixelWidth: 3,
  pixelHeight: 1,
  bounds: { minX: 0, minY: 0, maxX: 3, maxY: 1 },
  transform: IDENTITY_TRANSFORM,
  dither: 'threshold',
  linesPerMm: 10,
};

it.each(DITHER_ALGORITHMS)(
  'keeps original pixels in the Adjust Image preview with pass-through (%s)',
  (algorithm) => {
    vi.stubGlobal('CanvasRenderingContext2D', vi.fn());
    const canvas = document.createElement('canvas');
    const putImageData = vi.fn();
    vi.spyOn(canvas, 'getContext').mockReturnValue({
      putImageData,
    } as unknown as CanvasRenderingContext2D);
    const draft = {
      brightness: 100,
      contrast: -100,
      gamma: 5,
      negativeImage: true,
      ditherAlgorithm: algorithm,
      minPower: 0,
      invertDisplay: false,
      passThrough: true,
    };
    drawAdjustImagePreview(canvas, image, draft, 'processed');
    expect(Array.from((putImageData.mock.calls[0]?.[0] as ImageData).data)).toEqual([
      0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255,
    ]);
    drawAdjustImagePreview(
      canvas,
      image,
      { ...draft, passThrough: false, negativeImage: false, contrast: 0, gamma: 1 },
      'processed',
    );
    expect(Array.from((putImageData.mock.calls[1]?.[0] as ImageData).data)).toEqual(
      new Array<number>(12).fill(255),
    );
  },
);
