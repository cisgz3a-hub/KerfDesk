import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import {
  createLayer,
  DITHER_ALGORITHMS,
  IDENTITY_TRANSFORM,
  type RasterImage,
} from '../../core/scene';
import { drawAdjustImagePreview } from './AdjustImageDialog.preview';
import { buildProcessedRasterBitmap } from './processed-bitmap';

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
    drawAdjustImagePreview(canvas, image, draft, 'processed', 100);
    expect(Array.from((putImageData.mock.calls[0]?.[0] as ImageData).data)).toEqual([
      0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255,
    ]);
    drawAdjustImagePreview(
      canvas,
      image,
      { ...draft, passThrough: false, negativeImage: false, contrast: 0, gamma: 1 },
      'processed',
      100,
    );
    expect(Array.from((putImageData.mock.calls[1]?.[0] as ImageData).data)).toEqual(
      new Array<number>(12).fill(255),
    );
  },
);

it.each([
  { power: 50, expected: [0, 77, 255] },
  { power: 0, expected: [255, 255, 255] },
])(
  'uses the selected maximum power of $power percent in the processed preview',
  ({ power, expected }) => {
    vi.stubGlobal('CanvasRenderingContext2D', vi.fn());
    const canvas = document.createElement('canvas');
    const putImageData = vi.fn();
    vi.spyOn(canvas, 'getContext').mockReturnValue({
      putImageData,
    } as unknown as CanvasRenderingContext2D);
    const layer = {
      ...createLayer({ id: 'image', color: image.color, mode: 'image' }),
      power,
      minPower: 20,
      passThrough: true,
    };
    const draft = {
      brightness: 100,
      contrast: -100,
      gamma: 5,
      negativeImage: true,
      ditherAlgorithm: layer.ditherAlgorithm,
      minPower: layer.minPower,
      invertDisplay: false,
      passThrough: true,
    };
    drawAdjustImagePreview(canvas, image, draft, 'processed', power);
    const preview = (putImageData.mock.calls[0]?.[0] as ImageData).data;
    expect(Array.from(preview)).toEqual(expected.flatMap((value) => [value, value, value, 255]));
    const exported = buildProcessedRasterBitmap(image, layer, DEFAULT_DEVICE_PROFILE);
    expect(exported.kind).toBe('ok');
    expect(exported.kind === 'ok' ? exported.rgba : null).toEqual(preview);
  },
);
