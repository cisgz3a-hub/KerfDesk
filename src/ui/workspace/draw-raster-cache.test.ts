import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type RasterImage,
} from '../../core/scene';
import { drawScene } from './draw-scene';

type FakeImageInstance = {
  complete: boolean;
  naturalWidth: number;
  naturalHeight: number;
  src: string;
  onload: ((event: Event) => void) | null;
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('drawScene raster cache lifecycle', () => {
  it('prunes deleted raster images and trace-source tint canvases', () => {
    const images = completeImageInstances();
    const createdCanvases: unknown[] = [];
    const realCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag !== 'canvas') return realCreateElement(tag);
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => ({
          drawImage: vi.fn(),
          fillRect: vi.fn(),
          putImageData: vi.fn(),
          globalCompositeOperation: 'source-over',
          globalAlpha: 1,
          fillStyle: '#000000',
        }),
      };
      createdCanvases.push(canvas);
      return canvas as unknown as HTMLCanvasElement;
    });
    const ctx = noOpContext();
    const projectWithRaster = rasterProject(
      traceSourceRaster('data:image/png;base64,trace-source-cache-a'),
    );

    drawScene(ctx, 800, 600, projectWithRaster, { selectedId: null, preview: false });
    drawScene(ctx, 800, 600, emptyProject(), { selectedId: null, preview: false });
    drawScene(ctx, 800, 600, projectWithRaster, { selectedId: null, preview: false });

    expect(images).toHaveLength(2);
    expect(createdCanvases).toHaveLength(2);
  });
});

function completeImageInstances(): FakeImageInstance[] {
  const instances: FakeImageInstance[] = [];
  class CompleteImage {
    complete = true;
    naturalWidth = 2;
    naturalHeight = 2;
    src = '';
    onload: ((event: Event) => void) | null = null;

    constructor() {
      instances.push(this);
    }
  }
  vi.stubGlobal('Image', CompleteImage);
  return instances;
}

function noOpContext(): CanvasRenderingContext2D {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'measureText') return () => ({ width: 100 });
        return () => undefined;
      },
      set() {
        return true;
      },
    },
  ) as CanvasRenderingContext2D;
}

function rasterProject(obj: RasterImage): Project {
  const project = createProject();
  return {
    ...project,
    scene: {
      layers: [createLayer({ id: obj.color, color: obj.color, mode: 'image' })],
      objects: [obj],
    },
  };
}

function emptyProject(): Project {
  const project = createProject();
  return { ...project, scene: { layers: [], objects: [] } };
}

function traceSourceRaster(dataUrl: string): RasterImage {
  return {
    kind: 'raster-image',
    id: 'raster-1',
    source: 'source.png',
    dataUrl,
    pixelWidth: 2,
    pixelHeight: 2,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'threshold',
    linesPerMm: 10,
    role: 'trace-source',
  };
}
