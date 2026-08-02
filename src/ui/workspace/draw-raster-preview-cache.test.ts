import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type RasterImage,
} from '../../core/scene';
import { drawRasterPreview, type RasterPreviewBuildScheduler } from './draw-raster-preview';
import type { ViewTransform } from './view-transform';

const VIEW: ViewTransform = { scale: 1, offsetX: 0, offsetY: 0 };

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('drawRasterPreview canvas cache', () => {
  // Canvases are up to 2048x2048 RGBA (~16.8 MB) and the undo stack pins 50
  // superseded Project versions, so a canvas whose raster left the scene has to
  // be released by the sweep — nothing else can observe that it is dead.
  it('releases the preview canvas of a raster that left the scene', () => {
    const createdCanvases = trackCreatedCanvases();
    const projectWithRaster = projectForRaster(burnRaster('data:image/png;base64,preview-cache-a'));

    drawRasterPreviewSync(projectWithRaster);
    drawRasterPreviewSync(emptyProject());
    drawRasterPreviewSync(projectWithRaster);

    expect(createdCanvases).toHaveLength(2);
  });

  // A move commits `{ ...object, transform }`: a brand-new RasterImage holding
  // the very same pixels. Rebuilding the burn simulation for it blanked the
  // preview for a frame and re-ran resample+dither on the main thread.
  it('reuses the preview canvas after a translation-only move', () => {
    const createdCanvases = trackCreatedCanvases();
    const scheduler = countingScheduler();
    const raster = burnRaster('data:image/png;base64,nudged-raster');

    drawRasterPreviewWith(projectForRaster(raster), scheduler.schedule);
    const buildsAfterFirstDraw = scheduler.count();
    drawRasterPreviewWith(projectForRaster(movedRaster(raster, 12)), scheduler.schedule);

    expect(createdCanvases).toHaveLength(1);
    expect(scheduler.count()).toBe(buildsAfterFirstDraw);
  });

  // Image Studio Apply keeps the object id and swaps dataUrl + lumaBase64, so
  // the id alone must never authorize a cache hit.
  it('rebuilds the preview canvas when the raster pixels change under one id', () => {
    const createdCanvases = trackCreatedCanvases();
    const raster = burnRaster('data:image/png;base64,pixels-before-edit');

    drawRasterPreviewSync(projectForRaster(raster));
    drawRasterPreviewSync(
      projectForRaster({ ...raster, dataUrl: 'data:image/png;base64,pixels-after-edit' }),
    );

    expect(createdCanvases).toHaveLength(2);
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

  // Canvases are scoped to the scene object that owns them, so a duplicate --
  // which is a new scene object with a new id -- builds its own.
  it('builds a separate preview canvas for a distinct scene object', () => {
    const createdCanvases = trackCreatedCanvases();
    const dataUrl = 'data:image/png;base64,duplicated-raster';

    drawRasterPreviewSync(projectForRaster(burnRaster(dataUrl)));
    drawRasterPreviewSync(projectForRaster({ ...burnRaster(dataUrl), id: 'R-cache-copy' }));

    expect(createdCanvases).toHaveLength(2);
  });

  // Cancelling a paged raster's build aborts its IndexedDB hydration, so a drag
  // that cancelled once per frame never let the hydration finish.
  it('keeps an in-flight preview build running across a translation-only move', () => {
    vi.stubGlobal('ImageData', FakeImageData);
    const cancelBuild = vi.fn();
    const scheduleBuild = vi.fn((): (() => void) => cancelBuild);
    const raster = burnRaster('data:image/png;base64,in-flight-move');

    drawRasterPreviewWith(projectForRaster(raster), scheduleBuild);
    drawRasterPreviewWith(projectForRaster(movedRaster(raster, 8)), scheduleBuild);

    expect(cancelBuild).not.toHaveBeenCalled();
    expect(scheduleBuild).toHaveBeenCalledOnce();
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

function drawRasterPreviewWith(project: Project, scheduleBuild: RasterPreviewBuildScheduler): void {
  drawRasterPreview(noOpContext(), project, VIEW, { scheduleBuild });
}

/** Exactly what a nudge, drag or align commits: a new object, the same pixels. */
function movedRaster(raster: RasterImage, xMm: number): RasterImage {
  return { ...raster, transform: { ...raster.transform, x: xMm } };
}

function countingScheduler(): {
  readonly schedule: RasterPreviewBuildScheduler;
  readonly count: () => number;
} {
  let scheduled = 0;
  return {
    schedule: (work) => {
      scheduled += 1;
      return runImmediately(work);
    },
    count: () => scheduled,
  };
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
