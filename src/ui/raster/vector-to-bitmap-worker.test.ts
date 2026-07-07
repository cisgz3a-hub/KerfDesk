import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RasterImage } from '../../core/scene';
import {
  IDENTITY_TRANSFORM,
  type Bounds,
  type ColoredPath,
  type ImportedSvg,
} from '../../core/scene';
import { resetConvertBitmapWorkerForTests } from './convert-bitmap-worker-client';
import { buildBitmapFromVectors } from './vector-to-bitmap';

const SVG_PATH: ColoredPath = {
  color: '#000000',
  polylines: [
    {
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
    },
  ],
};

function svgWithBounds(bounds: Bounds): ImportedSvg {
  return {
    kind: 'imported-svg',
    id: 'svg-worker-source',
    source: 'worker-source.svg',
    bounds,
    transform: IDENTITY_TRANSFORM,
    paths: [SVG_PATH],
  };
}

function fakeRaster(id: string): RasterImage {
  return {
    kind: 'raster-image',
    id,
    source: 'worker-source.svg (bitmap)',
    dataUrl: 'data:image/png;base64,worker',
    pixelWidth: 10,
    pixelHeight: 10,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'floyd-steinberg',
    linesPerMm: 10,
    lumaBase64: 'worker-luma',
  };
}

afterEach(() => {
  resetConvertBitmapWorkerForTests();
  vi.unstubAllGlobals();
});

describe('buildBitmapFromVectors worker selection', () => {
  it('uses the Convert to Bitmap worker when the browser supports workers', async () => {
    const workerRequests: unknown[] = [];
    class FakeWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;

      postMessage(request: { readonly id: number; readonly rasterId: string }): void {
        workerRequests.push(request);
        this.onmessage?.({
          data: { id: request.id, kind: 'ok', raster: fakeRaster(request.rasterId) },
        } as MessageEvent);
      }

      terminate(): void {
        // test double
      }
    }
    vi.stubGlobal('Worker', FakeWorker);

    const result = await buildBitmapFromVectors([
      svgWithBounds({ minX: 0, minY: 0, maxX: 10, maxY: 10 }),
    ]);

    expect(workerRequests).toHaveLength(1);
    expect(result.dataUrl).toBe('data:image/png;base64,worker');
    expect(result.id).toBe((workerRequests[0] as { readonly rasterId: string }).rasterId);
  });

  it('refuses medium-large conversions when no worker is available', async () => {
    vi.stubGlobal('Worker', undefined);

    await expect(
      buildBitmapFromVectors([svgWithBounds({ minX: 0, minY: 0, maxX: 80, maxY: 80 })]),
    ).rejects.toThrow('Convert to Bitmap worker is unavailable for this large conversion');
  });

  it('retires the worker when posting a conversion request fails', async () => {
    let workerConstructs = 0;
    class FailingPostWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;

      constructor() {
        workerConstructs += 1;
      }

      postMessage(): void {
        throw new Error('post failed');
      }

      terminate(): void {
        // test double
      }
    }
    vi.stubGlobal('Worker', FailingPostWorker);

    const source = svgWithBounds({ minX: 0, minY: 0, maxX: 80, maxY: 80 });

    await expect(buildBitmapFromVectors([source])).rejects.toThrow('post failed');
    await expect(buildBitmapFromVectors([source])).rejects.toThrow('post failed');
    expect(workerConstructs).toBe(2);
  });
});
