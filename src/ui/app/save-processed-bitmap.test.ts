import { describe, expect, it, vi } from 'vitest';
import { createLayer, createProject, IDENTITY_TRANSFORM, type Project } from '../../core/scene';
import type { FileSaveRequest, PlatformAdapter, SaveTarget } from '../../platform/types';
import { handleSaveProcessedBitmap } from './save-processed-bitmap';

describe('handleSaveProcessedBitmap', () => {
  it('saves the selected image as a PNG blob', async () => {
    const written: Array<Blob | string> = [];
    const requests: FileSaveRequest[] = [];
    const target: SaveTarget = {
      displayName: 'logo-processed.png',
      write: async (data) => {
        written.push(data);
      },
    };
    const toast = toasts();

    await handleSaveProcessedBitmap({
      platform: mockPlatform(async (request) => {
        requests.push(request);
        return target;
      }),
      project: rasterProject(),
      selectedObjectId: 'R1',
      pushToast: toast.pushToast,
      encodePng: async () => new Blob(['png'], { type: 'image/png' }),
    });

    expect(requests).toEqual([{ suggestedName: 'logo-processed.png', extensions: ['.png'] }]);
    expect(written).toHaveLength(1);
    expect(written[0]).toBeInstanceOf(Blob);
    expect(toast.messages).toEqual([
      { message: 'Saved processed bitmap to logo-processed.png', variant: 'success' },
    ]);
  });

  it('keeps cancelled saves silent', async () => {
    const toast = toasts();

    await handleSaveProcessedBitmap({
      platform: mockPlatform(async () => null),
      project: rasterProject(),
      selectedObjectId: 'R1',
      pushToast: toast.pushToast,
    });

    expect(toast.messages).toEqual([]);
  });

  it('reports a missing image layer instead of writing an unrelated layer', async () => {
    const toast = toasts();
    const platform = mockPlatform(vi.fn(async () => null));

    await handleSaveProcessedBitmap({
      platform,
      project: { ...rasterProject(), scene: { ...rasterProject().scene, layers: [] } },
      selectedObjectId: 'R1',
      pushToast: toast.pushToast,
    });

    expect(platform.pickFileForSave).not.toHaveBeenCalled();
    expect(toast.messages).toEqual([
      {
        message: 'The selected image needs an enabled Image layer before export.',
        variant: 'error',
      },
    ]);
  });
});

function rasterProject(): Project {
  return {
    ...createProject(),
    scene: {
      layers: [
        {
          ...createLayer({ id: 'image', color: '#808080', mode: 'image' }),
          passThrough: true,
          ditherAlgorithm: 'threshold',
        },
      ],
      objects: [
        {
          kind: 'raster-image',
          id: 'R1',
          source: 'logo.png',
          dataUrl: 'data:image/png;base64,logo',
          pixelWidth: 2,
          pixelHeight: 1,
          bounds: { minX: 0, minY: 0, maxX: 2, maxY: 1 },
          transform: IDENTITY_TRANSFORM,
          color: '#808080',
          dither: 'threshold',
          linesPerMm: 10,
          lumaBase64: Buffer.from([0, 255]).toString('base64'),
        },
      ],
    },
  };
}

function mockPlatform(save: PlatformAdapter['pickFileForSave']): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: save,
    serial: {
      isSupported: () => false,
      requestPort: async () => null,
    },
  };
}

function toasts(): {
  readonly pushToast: (message: string, variant?: string) => void;
  readonly messages: ReadonlyArray<{ readonly message: string; readonly variant?: string }>;
} {
  const messages: Array<{ readonly message: string; readonly variant?: string }> = [];
  return {
    pushToast: (message, variant) => {
      messages.push(variant === undefined ? { message } : { message, variant });
    },
    messages,
  };
}
