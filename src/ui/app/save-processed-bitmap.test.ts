import { describe, expect, it, vi } from 'vitest';
import type { RasterGroup } from '../../core/job';
import { compileJob } from '../../core/job/compile-job';
import { createLayer, createProject, IDENTITY_TRANSFORM, type Project } from '../../core/scene';
import type { FileSaveRequest, PlatformAdapter, SaveTarget } from '../../platform/types';
import { handleSaveProcessedBitmap } from './save-processed-bitmap';

describe('handleSaveProcessedBitmap', () => {
  it('exports pass-through greys using the power range while ignoring image preparation', async () => {
    const base = rasterProject();
    const raster = base.scene.objects[0];
    if (raster?.kind !== 'raster-image') throw new Error('missing raster');
    const encodePng = vi.fn(async () => new Blob(['png'], { type: 'image/png' }));
    const project: Project = {
      ...base,
      scene: {
        layers: base.scene.layers.map((layer) => ({
          ...layer,
          negativeImage: true,
          power: 100,
          minPower: 20,
          ditherAlgorithm: 'jarvis',
        })),
        objects: [
          {
            ...raster,
            brightness: 100,
            contrast: 100,
            gamma: 0.1,
            lumaBase64: Buffer.from([64, 192]).toString('base64'),
          },
        ],
      },
    };
    await handleSaveProcessedBitmap({
      platform: mockPlatform(async () => ({
        displayName: 'pixels.png',
        write: async () => undefined,
      })),
      project,
      selectedObjectId: 'R1',
      pushToast: vi.fn(),
      encodePng,
    });
    expect(encodePng).toHaveBeenCalledWith(
      new Uint8ClampedArray([51, 51, 51, 255, 154, 154, 154, 255]),
      2,
      1,
    );
  });

  it("exports the image's own settings as the job burns them, not its layer's", async () => {
    // The layer passes greys through; this image alone is a thresholded negative
    // on a 2 lines/mm grid, which is what compile burns.
    const project = withRaster(rasterProject(), {
      operationOverride: { passThrough: false, negativeImage: true, linesPerMm: 2 },
    });
    const job = compileJob(
      { objects: project.scene.objects, layers: project.scene.layers },
      project.device,
    );
    const group = job.groups.find(
      (candidate): candidate is RasterGroup => candidate.kind === 'raster',
    );
    if (group === undefined) throw new Error('missing compiled raster');
    const exported = await exportedBitmap(project);

    expect({ width: exported.width, height: exported.height }).toEqual({ width: 4, height: 2 });
    expect({ width: group.pixelWidth, height: group.pixelHeight }).toEqual({ width: 4, height: 2 });
    expect(burnPattern(exported.rgba)).toEqual(Array.from(group.sValues, (s) => s > 0));
    expect(burnPattern(exported.rgba)).toContain(true);
  });

  it('exports nothing burned for an image whose power scale is zero', async () => {
    const project = withRaster(rasterProject(), { powerScale: 0 });

    const exported = await exportedBitmap(project);

    expect(burnPattern(exported.rgba)).toEqual([false, false]);
  });

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

  it('rejects over-budget processed bitmaps before opening the save picker', async () => {
    const toast = toasts();
    const platform = mockPlatform(vi.fn(async () => null));

    await handleSaveProcessedBitmap({
      platform,
      project: overBudgetRasterProject(),
      selectedObjectId: 'R1',
      pushToast: toast.pushToast,
    });

    expect(platform.pickFileForSave).not.toHaveBeenCalled();
    expect(toast.messages).toEqual([
      {
        message:
          'Could not save processed bitmap: ~123 MB materialized working set exceeds the 64 MB budget',
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

function withRaster(project: Project, overrides: Record<string, unknown>): Project {
  return {
    ...project,
    scene: {
      ...project.scene,
      objects: project.scene.objects.map((object) =>
        object.kind === 'raster-image' ? ({ ...object, ...overrides } as typeof object) : object,
      ),
    },
  };
}

async function exportedBitmap(
  project: Project,
): Promise<{ readonly rgba: Uint8ClampedArray; readonly width: number; readonly height: number }> {
  let exported: { rgba: Uint8ClampedArray; width: number; height: number } | undefined;
  await handleSaveProcessedBitmap({
    platform: mockPlatform(async () => ({ displayName: 'x.png', write: async () => undefined })),
    project,
    selectedObjectId: 'R1',
    pushToast: vi.fn(),
    encodePng: async (rgba, width, height) => {
      exported = { rgba, width, height };
      return new Blob(['png'], { type: 'image/png' });
    },
  });
  if (exported === undefined) throw new Error('nothing was exported');
  return exported;
}

// True where the exported pixel is darker than paper, i.e. where the laser fires.
function burnPattern(rgba: Uint8ClampedArray): boolean[] {
  return Array.from({ length: rgba.length / 4 }, (_, index) => (rgba[index * 4] ?? 255) < 255);
}

function overBudgetRasterProject(): Project {
  const project = rasterProject();
  const raster = project.scene.objects.find((object) => object.id === 'R1');
  if (raster?.kind !== 'raster-image') throw new Error('missing raster fixture');
  return {
    ...project,
    scene: {
      layers: [
        {
          ...createLayer({ id: 'image', color: '#808080', mode: 'image' }),
          passThrough: false,
          ditherAlgorithm: 'threshold',
          linesPerMm: 10,
        },
      ],
      objects: [
        {
          ...raster,
          bounds: { minX: 0, minY: 0, maxX: 400.1, maxY: 400.1 },
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
