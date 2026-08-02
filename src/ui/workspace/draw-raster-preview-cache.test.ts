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

const VIEW: ViewTransform = { scale: 1, offsetX: 0, offsetY: 0 };

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('drawRasterPreview canvas cache', () => {
  // Keyed on the RasterImage's identity, so a raster that leaves and re-enters
  // the scene keeps its canvas. The entry is released by GC once the deleted
  // object is unreachable, which no sweep can observe from in here.
  it('keeps the preview canvas for a raster that leaves and re-enters the scene', () => {
    const createdCanvases = trackCreatedCanvases();
    const projectWithRaster = projectForRaster(burnRaster('data:image/png;base64,preview-cache-a'));

    drawRasterPreviewSync(projectWithRaster);
    drawRasterPreviewSync(emptyProject());
    drawRasterPreviewSync(projectWithRaster);

    expect(createdCanvases).toHaveLength(1);
  });

  it('reads the base64 source only while building, never to look the cache up', () => {
    trackCreatedCanvases();
    const counted = countingDataUrlRaster('data:image/png;base64,source-key-cost');
    const project = projectForRaster(counted.raster);

    drawRasterPreviewSync(project);
    const afterBuild = counted.reads();
    drawRasterPreviewSync(project);
    drawRasterPreviewSync(project);

    expect(counted.reads()).toBe(afterBuild);
  });

  it('reuses the canvas while the raster and its burn settings are unchanged', () => {
    const createdCanvases = trackCreatedCanvases();
    const raster = burnRaster('data:image/png;base64,unchanged-settings');
    const layer = createLayer({ id: 'image', color: '#808080', mode: 'image' });

    drawRasterPreviewSync(projectOf(raster, layer));
    drawRasterPreviewSync(projectOf(raster, layer));
    drawRasterPreviewSync(projectOf(raster, { ...layer }));

    expect(createdCanvases).toHaveLength(1);
  });

  it('rebuilds the canvas when a burn setting changes', () => {
    const createdCanvases = trackCreatedCanvases();
    const raster = burnRaster('data:image/png;base64,changed-settings');
    const layer = createLayer({ id: 'image', color: '#808080', mode: 'image' });

    drawRasterPreviewSync(projectOf(raster, layer));
    drawRasterPreviewSync(projectOf(raster, { ...layer, negativeImage: true }));

    expect(createdCanvases).toHaveLength(2);
  });

  it('builds a separate preview canvas for a distinct raster object', () => {
    const createdCanvases = trackCreatedCanvases();
    const dataUrl = 'data:image/png;base64,duplicated-raster';

    drawRasterPreviewSync(projectForRaster(burnRaster(dataUrl)));
    drawRasterPreviewSync(projectForRaster(burnRaster(dataUrl)));

    expect(createdCanvases).toHaveLength(2);
  });

  it('cancels an in-flight preview build when its raster leaves the scene', () => {
    vi.stubGlobal('ImageData', FakeImageData);
    const cancelBuild = vi.fn();
    const scheduleBuild = (): (() => void) => cancelBuild;
    const project = projectForRaster(burnRaster('data:image/png;base64,cancelled-preview'));

    drawRasterPreview(noOpContext(), project, VIEW, { scheduleBuild });
    expect(cancelBuild).not.toHaveBeenCalled();

    drawRasterPreview(noOpContext(), emptyProject(), VIEW, { scheduleBuild });

    expect(cancelBuild).toHaveBeenCalledOnce();
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

function trackCreatedCanvases(): unknown[] {
  const createdCanvases: unknown[] = [];
  vi.stubGlobal('ImageData', FakeImageData);
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    if (tag !== 'canvas') throw new Error(`unexpected element ${tag}`);
    const canvas = { width: 0, height: 0, getContext: () => ({ putImageData: vi.fn() }) };
    createdCanvases.push(canvas);
    return canvas as unknown as HTMLCanvasElement;
  });
  return createdCanvases;
}

// Counts every read of the base64 payload. Building the cache key out of it cost
// a full copy of that string per raster per frame on a scene nobody had touched.
function countingDataUrlRaster(dataUrl: string): {
  readonly raster: RasterImage;
  readonly reads: () => number;
} {
  let reads = 0;
  const raster = burnRaster(dataUrl);
  Object.defineProperty(raster, 'dataUrl', {
    enumerable: true,
    get: () => {
      reads += 1;
      return dataUrl;
    },
  });
  return { raster, reads: () => reads };
}

function drawRasterPreviewSync(project: Project): void {
  drawRasterPreview(noOpContext(), project, VIEW, { scheduleBuild: runImmediately });
}

function runImmediately(work: () => void): () => void {
  work();
  return () => undefined;
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
    id: 'R-cache',
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

function projectOf(obj: RasterImage, layer: ReturnType<typeof createLayer>): Project {
  return { ...createProject(), scene: { objects: [obj], layers: [layer] } };
}

function projectForRaster(obj: RasterImage): Project {
  return projectOf(obj, createLayer({ id: 'image', color: '#808080', mode: 'image' }));
}

function emptyProject(): Project {
  return { ...createProject(), scene: { objects: [], layers: [] } };
}
