import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createLayer,
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

    drawRasterPreview(ctx, project, view);

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

    drawRasterPreview(ctx, projectWithRaster, view);
    drawRasterPreview(ctx, emptyProject(), view);
    drawRasterPreview(ctx, projectWithRaster, view);

    expect(createdCanvases).toHaveLength(2);
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
