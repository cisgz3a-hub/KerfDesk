import { describe, expect, it, vi } from 'vitest';
import { IDENTITY_TRANSFORM, type RasterImage } from '../../core/scene';
import type { PlatformAdapter, SaveTarget } from '../../platform/types';
import { saveOriginalImage } from './save-original-image';

const image: RasterImage = {
  kind: 'raster-image',
  id: 'photo',
  source: 'C:\\photos\\dog: portrait.jpeg',
  dataUrl: 'data:image/jpeg;base64,AA==',
  pixelWidth: 1,
  pixelHeight: 1,
  bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
  transform: IDENTITY_TRANSFORM,
  color: '#808080',
  dither: 'floyd-steinberg',
  linesPerMm: 10,
};

function platformWith(target: SaveTarget | null) {
  const pickFileForSave = vi.fn(async () => target);
  return { platform: { pickFileForSave } as unknown as PlatformAdapter, pickFileForSave };
}

describe('saveOriginalImage', () => {
  it('writes the source bytes unchanged when they already have the chosen format', async () => {
    const write = vi.fn(async () => undefined);
    const { platform, pickFileForSave } = platformWith({ displayName: 'dog.jpg', write });
    const source = new File(['jpeg'], 'dog.jpeg', { type: 'image/jpeg' });
    const encode = vi.fn();

    await saveOriginalImage({
      platform,
      image,
      format: 'jpeg',
      pushToast: vi.fn(),
      readSource: async () => source,
      encode,
    });

    expect(pickFileForSave).toHaveBeenCalledWith({
      suggestedName: 'dog- portrait.jpg',
      extensions: ['.jpg'],
    });
    expect(write).toHaveBeenCalledWith(source);
    expect(encode).not.toHaveBeenCalled();
  });

  it('re-encodes into another format and reports failures', async () => {
    const write = vi.fn(async () => undefined);
    const { platform } = platformWith({ displayName: 'dog.bmp', write });
    const bmp = new Blob(['bmp'], { type: 'image/bmp' });
    const pushToast = vi.fn();

    await saveOriginalImage({
      platform,
      image,
      format: 'bmp',
      pushToast,
      readSource: async () => new File(['jpeg'], 'dog.jpeg', { type: 'image/jpeg' }),
      encode: async () => bmp,
    });
    expect(write).toHaveBeenCalledWith(bmp);

    await saveOriginalImage({
      platform,
      image,
      format: 'png',
      pushToast,
      readSource: async () => {
        throw new Error('source missing');
      },
    });
    expect(pushToast).toHaveBeenLastCalledWith('Could not save the image: source missing', 'error');
  });
});
