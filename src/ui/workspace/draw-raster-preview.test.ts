import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  captureLayerOperationSettings,
  createLayer,
  createLayerSubLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type RasterImage,
} from '../../core/scene';
import { drawRasterPreview } from './draw-raster-preview';
import type { ViewTransform } from './view-transform';

function traceSourceRaster(): RasterImage {
  return {
    kind: 'raster-image',
    id: 'R1',
    source: 'source.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: 2,
    pixelHeight: 2,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'floyd-steinberg',
    linesPerMm: 10,
    role: 'trace-source',
  };
}

describe('drawRasterPreview', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('skips trace-source backing images because they do not burn', () => {
    const project: Project = {
      ...createProject(),
      scene: {
        objects: [traceSourceRaster()],
        layers: [createLayer({ id: 'image', color: '#808080', mode: 'image' })],
      },
    };
    const createElement = vi.spyOn(document, 'createElement');
    const ctx = {} as CanvasRenderingContext2D;
    const view: ViewTransform = { scale: 1, offsetX: 0, offsetY: 0 };

    drawRasterPreviewSync(ctx, project, view);

    expect(createElement).not.toHaveBeenCalled();
  });

  it('prunes preview canvases for deleted raster images', () => {
    const createdCanvases: unknown[] = [];
    vi.stubGlobal('ImageData', FakeImageData);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag !== 'canvas') throw new Error(`unexpected element ${tag}`);
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => ({ putImageData: vi.fn() }),
      };
      createdCanvases.push(canvas);
      return canvas as unknown as HTMLCanvasElement;
    });
    const ctx = noOpContext();
    const view: ViewTransform = { scale: 1, offsetX: 0, offsetY: 0 };
    const projectWithRaster = projectForRaster(burnRaster('data:image/png;base64,preview-cache-a'));

    drawRasterPreviewSync(ctx, projectWithRaster, view);
    drawRasterPreviewSync(ctx, emptyProject(), view);
    drawRasterPreviewSync(ctx, projectWithRaster, view);

    expect(createdCanvases).toHaveLength(2);
  });

  it('skips over-budget raster previews before creating an offscreen canvas', () => {
    vi.stubGlobal('ImageData', FakeImageData);
    const createElement = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag !== 'canvas') throw new Error(`unexpected element ${tag}`);
      return {
        width: 0,
        height: 0,
        getContext: () => ({ putImageData: vi.fn() }),
      } as unknown as HTMLCanvasElement;
    });
    const ctx = noOpContext();
    const view: ViewTransform = { scale: 1, offsetX: 0, offsetY: 0 };
    const project = projectForRaster(
      burnRasterWithBounds('data:image/png;base64,over-budget-preview', {
        minX: 0,
        minY: 0,
        maxX: 200.1,
        maxY: 200.1,
      }),
    );

    drawRasterPreviewSync(ctx, project, view);

    expect(createElement).not.toHaveBeenCalled();
  });

  it('uses image-layer minPower in grayscale preview while leaving white pixels white', () => {
    let capturedImageData: FakeImageData | undefined;
    vi.stubGlobal('ImageData', FakeImageData);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag !== 'canvas') throw new Error(`unexpected element ${tag}`);
      return {
        width: 0,
        height: 0,
        getContext: () => ({
          putImageData: vi.fn((imageData: FakeImageData) => {
            capturedImageData = imageData;
          }),
        }),
      } as unknown as HTMLCanvasElement;
    });
    const layer = {
      ...createLayer({ id: 'image', color: '#808080', mode: 'image' }),
      ditherAlgorithm: 'grayscale' as const,
      minPower: 10,
      power: 30,
      linesPerMm: 1,
    };
    const raster = {
      ...burnRaster('data:image/png;base64,min-power-preview'),
      pixelWidth: 3,
      pixelHeight: 1,
      bounds: { minX: 0, minY: 0, maxX: 3, maxY: 1 },
      lumaBase64: 'AID/',
    };
    const project: Project = {
      ...createProject(),
      scene: { objects: [raster], layers: [layer] },
    };

    drawRasterPreviewSync(noOpContext(), project, { scale: 1, offsetX: 0, offsetY: 0 });

    expect(Array.from(capturedImageData?.data ?? [])).toEqual([
      0, 0, 0, 255, 85, 85, 85, 255, 255, 255, 255, 255,
    ]);
  });

  it('renders raster previews for image sub-layers', () => {
    const createdCanvases: unknown[] = [];
    vi.stubGlobal('ImageData', FakeImageData);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag !== 'canvas') throw new Error(`unexpected element ${tag}`);
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => ({ putImageData: vi.fn() }),
      };
      createdCanvases.push(canvas);
      return canvas as unknown as HTMLCanvasElement;
    });
    const layer = createLayer({ id: 'image', color: '#808080', mode: 'line' });
    const subLayer = createLayerSubLayer(layer, {
      id: 'image-pass',
      label: 'Image',
      settings: { ...captureLayerOperationSettings(layer), mode: 'image' },
    });
    const project: Project = {
      ...createProject(),
      scene: {
        objects: [burnRaster('data:image/png;base64,image-sub-layer')],
        layers: [{ ...layer, subLayers: [subLayer] }],
      },
    };

    drawRasterPreviewSync(noOpContext(), project, { scale: 1, offsetX: 0, offsetY: 0 });

    expect(createdCanvases).toHaveLength(1);
  });

  it('inverts image-mode luma before rendering raster preview when negative image is enabled', () => {
    let capturedImageData: FakeImageData | undefined;
    vi.stubGlobal('ImageData', FakeImageData);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag !== 'canvas') throw new Error(`unexpected element ${tag}`);
      return {
        width: 0,
        height: 0,
        getContext: () => ({
          putImageData: vi.fn((imageData: FakeImageData) => {
            capturedImageData = imageData;
          }),
        }),
      } as unknown as HTMLCanvasElement;
    });
    const layer = {
      ...createLayer({ id: 'image', color: '#808080', mode: 'image' }),
      ditherAlgorithm: 'threshold' as const,
      negativeImage: true,
      power: 30,
      linesPerMm: 1,
    };
    const raster = {
      ...burnRaster('data:image/png;base64,negative-preview'),
      pixelWidth: 2,
      pixelHeight: 1,
      bounds: { minX: 0, minY: 0, maxX: 2, maxY: 1 },
      lumaBase64: 'AP8=',
    };
    const project: Project = {
      ...createProject(),
      scene: { objects: [raster], layers: [layer] },
    };

    drawRasterPreviewSync(noOpContext(), project, { scale: 1, offsetX: 0, offsetY: 0 });

    expect(Array.from(capturedImageData?.data ?? [])).toEqual([255, 255, 255, 255, 0, 0, 0, 255]);
  });

  it('uses the source image pixel grid in raster preview when pass-through is enabled', () => {
    let capturedCanvas: { width: number; height: number } | undefined;
    let capturedImageData: FakeImageData | undefined;
    vi.stubGlobal('ImageData', FakeImageData);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag !== 'canvas') throw new Error(`unexpected element ${tag}`);
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => ({
          putImageData: vi.fn((imageData: FakeImageData) => {
            capturedCanvas = { width: canvas.width, height: canvas.height };
            capturedImageData = imageData;
          }),
        }),
      };
      return canvas as unknown as HTMLCanvasElement;
    });
    const layer = {
      ...createLayer({ id: 'image', color: '#808080', mode: 'image' }),
      ditherAlgorithm: 'threshold' as const,
      passThrough: true,
      power: 30,
      linesPerMm: 10,
    };
    const raster = {
      ...burnRaster('data:image/png;base64,pass-through-preview'),
      pixelWidth: 2,
      pixelHeight: 1,
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 1 },
      lumaBase64: 'AP8=',
    };
    const project: Project = {
      ...createProject(),
      scene: { objects: [raster], layers: [layer] },
    };

    drawRasterPreviewSync(noOpContext(), project, { scale: 1, offsetX: 0, offsetY: 0 });

    expect(capturedCanvas).toEqual({ width: 2, height: 1 });
    expect(Array.from(capturedImageData?.data ?? [])).toEqual([0, 0, 0, 255, 255, 255, 255, 255]);
  });

  it('does not reuse stale preview canvases when image mode toggles change', () => {
    const captures: Array<{
      readonly width: number;
      readonly height: number;
      readonly data: number[];
    }> = [];
    vi.stubGlobal('ImageData', FakeImageData);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag !== 'canvas') throw new Error(`unexpected element ${tag}`);
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => ({
          putImageData: vi.fn((imageData: FakeImageData) => {
            captures.push({
              width: canvas.width,
              height: canvas.height,
              data: Array.from(imageData.data),
            });
          }),
        }),
      };
      return canvas as unknown as HTMLCanvasElement;
    });
    const raster = {
      ...burnRaster('data:image/png;base64,same-preview-cache-key-source'),
      pixelWidth: 2,
      pixelHeight: 1,
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 1 },
      lumaBase64: 'AP8=',
    };
    const baseLayer = {
      ...createLayer({ id: 'image', color: '#808080', mode: 'image' }),
      ditherAlgorithm: 'threshold' as const,
      power: 30,
      linesPerMm: 1,
    };
    const drawWithLayer = (layer: typeof baseLayer): void => {
      drawRasterPreviewSync(
        noOpContext(),
        { ...createProject(), scene: { objects: [raster], layers: [layer] } },
        { scale: 1, offsetX: 0, offsetY: 0 },
      );
    };

    drawWithLayer(baseLayer);
    drawWithLayer({ ...baseLayer, negativeImage: true });
    drawWithLayer({ ...baseLayer, passThrough: true });

    expect(captures).toHaveLength(3);
    expect(captures.map(({ width, height }) => `${width}x${height}`)).toEqual([
      '10x1',
      '10x1',
      '2x1',
    ]);
    expect(captures[0]?.data).not.toEqual(captures[1]?.data);
  });

  it('uses raster image brightness in grayscale preview', () => {
    let capturedImageData: FakeImageData | undefined;
    vi.stubGlobal('ImageData', FakeImageData);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag !== 'canvas') throw new Error(`unexpected element ${tag}`);
      return {
        width: 0,
        height: 0,
        getContext: () => ({
          putImageData: vi.fn((imageData: FakeImageData) => {
            capturedImageData = imageData;
          }),
        }),
      } as unknown as HTMLCanvasElement;
    });
    const layer = {
      ...createLayer({ id: 'image', color: '#808080', mode: 'image' }),
      ditherAlgorithm: 'grayscale' as const,
      power: 30,
      linesPerMm: 1,
    };
    const raster = {
      ...burnRaster('data:image/png;base64,brightness-preview'),
      pixelWidth: 1,
      pixelHeight: 1,
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      lumaBase64: 'gA==',
      brightness: 20,
    };
    const project: Project = {
      ...createProject(),
      scene: { objects: [raster], layers: [layer] },
    };

    drawRasterPreviewSync(noOpContext(), project, { scale: 1, offsetX: 0, offsetY: 0 });

    expect(Array.from(capturedImageData?.data ?? [])).toEqual([179, 179, 179, 255]);
  });
});

class FakeImageData {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;

  constructor(data: Uint8ClampedArray, width: number, height: number) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
}

function noOpContext(): CanvasRenderingContext2D {
  return new Proxy(
    {},
    {
      get() {
        return () => undefined;
      },
      set() {
        return true;
      },
    },
  ) as CanvasRenderingContext2D;
}

function drawRasterPreviewSync(
  ctx: CanvasRenderingContext2D,
  project: Project,
  view: ViewTransform,
): void {
  drawRasterPreview(ctx, project, view, { scheduleBuild: runImmediately });
}

function runImmediately(work: () => void): () => void {
  work();
  return () => undefined;
}

function burnRaster(dataUrl: string): RasterImage {
  return {
    kind: 'raster-image',
    id: 'R2',
    source: 'source.png',
    dataUrl,
    pixelWidth: 2,
    pixelHeight: 2,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'threshold',
    linesPerMm: 10,
  };
}

function burnRasterWithBounds(dataUrl: string, bounds: RasterImage['bounds']): RasterImage {
  return { ...burnRaster(dataUrl), bounds };
}

function projectForRaster(obj: RasterImage): Project {
  return {
    ...createProject(),
    scene: {
      objects: [obj],
      layers: [createLayer({ id: 'image', color: '#808080', mode: 'image' })],
    },
  };
}

function emptyProject(): Project {
  return { ...createProject(), scene: { objects: [], layers: [] } };
}
