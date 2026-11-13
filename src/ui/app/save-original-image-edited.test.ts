// Tools audit T1, T21: a BMP keeps the image's own density (T21-P2-1), and an
// image cropped or edited in the project is never offered under the imported
// file's own name or called the original (T21-P2-2).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDENTITY_TRANSFORM, type RasterImage } from '../../core/scene';
import type { PlatformAdapter, SaveTarget } from '../../platform/types';
import { imageDpi, imageEditedInProject, saveOriginalImage } from './save-original-image';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const photo: RasterImage = {
  kind: 'raster-image',
  id: 'photo',
  source: 'C:\\photos\\dog.png',
  dataUrl: 'data:image/png;base64,AA==',
  pixelWidth: 4,
  pixelHeight: 2,
  bounds: { minX: 0, minY: 0, maxX: 0.4, maxY: 0.2 },
  transform: IDENTITY_TRANSFORM,
  color: '#808080',
  dither: 'floyd-steinberg',
  linesPerMm: 10,
};

function platformWith(target: SaveTarget | null) {
  const pickFileForSave = vi.fn(async () => target);
  return { platform: { pickFileForSave } as unknown as PlatformAdapter, pickFileForSave };
}

// jsdom's Blob has no arrayBuffer() and Response cannot read it: FileReader can.
function bytesOf(blob: Blob): Promise<DataView> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new DataView(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsArrayBuffer(blob);
  });
}

describe('Save Original Image density (T21-P2-1)', () => {
  it('computes the placed density', () => {
    expect(imageDpi(1000, 100)).toBeCloseTo(254, 9);
    expect(imageDpi(1000, (1000 / 300) * 25.4)).toBeCloseTo(300, 9);
    expect(imageDpi(1000, 0)).toBeNull();
  });

  it('writes the image density, not 96 DPI, into a re-encoded BMP', async () => {
    const width = 4;
    const height = 2;
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width, height, close: () => undefined })),
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: () => undefined,
      fillRect: () => undefined,
      getImageData: () => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
    } as unknown as CanvasRenderingContext2D);
    const write = vi.fn(async (_data: string | Blob) => undefined);
    const { platform } = platformWith({ displayName: 'dog.bmp', write });
    // 4 px across 4 × 25.4 / 300 mm: 300 DPI.
    const image = { ...photo, bounds: { minX: 0, minY: 0, maxX: (4 * 25.4) / 300, maxY: 1 } };

    await saveOriginalImage({
      platform,
      image,
      format: 'bmp',
      pushToast: vi.fn(),
      readSource: async () => new File(['png'], 'dog.png', { type: 'image/png' }),
    });

    const saved = write.mock.calls[0]?.[0];
    if (!(saved instanceof Blob)) throw new Error('nothing written');
    const header = await bytesOf(saved);
    // BITMAPINFOHEADER biXPelsPerMeter at byte 38: 300 DPI = 11811 px/m.
    expect(header.getInt32(38, true)).toBe(Math.round(300 / 0.0254));
  });
});

describe('Save Original Image after an edit (T21-P2-2)', () => {
  it('knows when the stored pixels are no longer the import', () => {
    expect(imageEditedInProject(photo)).toBe(false);
    expect(imageEditedInProject({ ...photo, imageClip: [] })).toBe(true);
  });

  it('suggests a new name and says it saved the edited image', async () => {
    const write = vi.fn(async () => undefined);
    const { platform, pickFileForSave } = platformWith({ displayName: 'dog-edited.png', write });
    const pushToast = vi.fn();
    const source = new File(['png'], 'dog.png', { type: 'image/png' });

    await saveOriginalImage({
      platform,
      image: { ...photo, imageClip: [] },
      format: 'png',
      pushToast,
      readSource: async () => source,
    });

    expect(pickFileForSave).toHaveBeenCalledWith({
      suggestedName: 'dog-edited.png',
      extensions: ['.png'],
    });
    expect(pushToast).toHaveBeenCalledWith('Saved the edited image to dog-edited.png', 'success');
  });

  it('still offers an untouched import under its own name', async () => {
    const write = vi.fn(async () => undefined);
    const { platform, pickFileForSave } = platformWith({ displayName: 'dog.png', write });
    const source = new File(['png'], 'dog.png', { type: 'image/png' });
    await saveOriginalImage({
      platform,
      image: photo,
      format: 'png',
      pushToast: vi.fn(),
      readSource: async () => source,
    });
    expect(pickFileForSave).toHaveBeenCalledWith({
      suggestedName: 'dog.png',
      extensions: ['.png'],
    });
  });
});
