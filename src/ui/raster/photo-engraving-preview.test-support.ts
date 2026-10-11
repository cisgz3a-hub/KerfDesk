import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { createLayer, IDENTITY_TRANSFORM, type RasterImage } from '../../core/scene';
import type { PhotoEngravingPreviewInput } from './photo-engraving-preview-types';

export function photoPreviewFixture(): PhotoEngravingPreviewInput {
  const image: RasterImage = {
    kind: 'raster-image',
    id: 'portrait',
    source: 'portrait.png',
    dataUrl: 'data:image/png;base64,display-only',
    // eslint-disable-next-line no-restricted-syntax -- Fixture artwork colour, not UI chrome.
    color: '#808080',
    pixelWidth: 4,
    pixelHeight: 2,
    bounds: { minX: 0, minY: 0, maxX: 8, maxY: 4 },
    transform: IDENTITY_TRANSFORM,
    dither: 'stucki',
    linesPerMm: 1,
    lumaBase64: Buffer.from([0, 64, 128, 255, 255, 192, 96, 0]).toString('base64'),
  };
  return {
    image,
    layer: {
      ...createLayer({ id: 'image', color: image.color, mode: 'image' }),
      ditherAlgorithm: 'stucki',
      linesPerMm: 1,
      power: 40,
      minPower: 0,
    },
    device: DEFAULT_DEVICE_PROFILE,
    sceneObjects: [image],
  };
}
