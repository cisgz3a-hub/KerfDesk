// Perf audit S1, S4-P3-1: the canvas Preview compiles a raster's burned image
// in a worker. The window only posts the request and draws the bitmap back.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLayer, createProject, IDENTITY_TRANSFORM, type RasterImage } from '../../core/scene';
import type { RasterPreviewBitmap } from './raster-preview-bitmap';
import { buildRasterPreviewBitmap } from './raster-preview-worker-client';

const compiled = vi.hoisted(() => ({ count: 0 }));

vi.mock('./raster-preview-bitmap', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./raster-preview-bitmap')>();
  return {
    ...actual,
    rasterPreviewBitmap: (...args: Parameters<typeof actual.rasterPreviewBitmap>) => {
      compiled.count += 1;
      return actual.rasterPreviewBitmap(...args);
    },
  };
});

class FakeWorker {
  static last: FakeWorker | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  posted: unknown[] = [];
  terminated = false;
  constructor() {
    FakeWorker.last = this;
  }
  postMessage(message: unknown): void {
    this.posted.push(message);
  }
  terminate(): void {
    this.terminated = true;
  }
}

function photo(): RasterImage {
  return {
    kind: 'raster-image',
    id: 'photo',
    source: 'photo.png',
    dataUrl: 'data:image/png;base64,AAAA',
    lumaBase64: btoa(String.fromCharCode(0, 64, 128, 255)),
    pixelWidth: 2,
    pixelHeight: 2,
    bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
    transform: IDENTITY_TRANSFORM,
    imageMaskId: 'mask',
  } as RasterImage;
}

const device = createProject().device;
const layer = createLayer({ id: 'L', color: '#000000', mode: 'image', name: 'Image' });
const other = { ...photo(), id: 'other' };
const mask = { ...photo(), id: 'mask' };

afterEach(() => {
  vi.unstubAllGlobals();
  compiled.count = 0;
  FakeWorker.last = null;
});

describe('canvas Preview raster bitmaps (perf audit S4-P3-1)', () => {
  it('compiles in a worker, sending only the luma and the raster’s mask', () => {
    vi.stubGlobal('Worker', FakeWorker);
    const done = vi.fn();
    buildRasterPreviewBitmap(photo(), layer, device, [other, mask], done);
    const worker = FakeWorker.last;
    expect(compiled.count).toBe(0);
    expect(done).not.toHaveBeenCalled();
    const request = worker?.posted[0] as { image: RasterImage; sceneObjects: unknown[] };
    expect(request.image.dataUrl).toBeUndefined();
    expect(request.sceneObjects).toEqual([mask]);
    const bitmap: RasterPreviewBitmap = { rgba: new Uint8ClampedArray(16), width: 2, height: 2 };
    worker?.onmessage?.({ data: bitmap } as MessageEvent);
    expect(done).toHaveBeenCalledWith(bitmap);
    expect(worker?.terminated).toBe(true);
  });

  it('stops the worker when the build is cancelled', () => {
    vi.stubGlobal('Worker', FakeWorker);
    const done = vi.fn();
    const cancel = buildRasterPreviewBitmap(photo(), layer, device, [], done);
    cancel();
    expect(FakeWorker.last?.terminated).toBe(true);
    FakeWorker.last?.onmessage?.({ data: null } as MessageEvent);
    expect(done).not.toHaveBeenCalled();
  });

  it('compiles in the window, before returning, where no worker can run', () => {
    vi.stubGlobal('Worker', undefined);
    const done = vi.fn();
    buildRasterPreviewBitmap(photo(), layer, device, [], done);
    expect(compiled.count).toBe(1);
    expect(done).toHaveBeenCalledTimes(1);
  });
});
