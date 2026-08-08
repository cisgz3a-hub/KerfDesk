import { expect, test } from './fixtures/kerfdesk-test';
import {
  assertResponsivePhase,
  startResponsivenessProbe,
  stopResponsivenessProbe,
} from './fixtures/browser-responsiveness';

test('production relief materialization worker cancels stale work and keeps the UI responsive', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const workerUrls: string[] = [];
  page.on('worker', (worker) => workerUrls.push(worker.url()));
  await page.goto('/');
  await page.evaluate(() => {
    const width = 2048;
    const samples = new Uint8Array(width * width);
    for (let index = 0; index < samples.length; index += 1) samples[index] = index & 0xff;
    let binary = '';
    const chunkSize = 32_768;
    for (let offset = 0; offset < samples.length; offset += chunkSize) {
      binary += String.fromCharCode(...samples.subarray(offset, offset + chunkSize));
    }
    (
      window as typeof window & {
        __RELIEF_WORKER_SOURCE__?: {
          readonly schemaVersion: 1;
          readonly width: number;
          readonly height: number;
          readonly bitDepth: 8;
          readonly samplesBase64: string;
          readonly polarity: 'light-is-high';
        };
      }
    ).__RELIEF_WORKER_SOURCE__ = {
      schemaVersion: 1,
      width,
      height: width,
      bitDepth: 8,
      samplesBase64: btoa(binary),
      polarity: 'light-is-high',
    };
  });
  await startResponsivenessProbe(page);

  const result = await page.evaluate(async () => {
    interface Result {
      readonly taskId: string;
      readonly result:
        | {
            readonly kind: 'ok';
            readonly heightmap: {
              readonly widthCells: number;
              readonly heightCells: number;
              readonly mmPerCell: number;
              readonly depth: Float32Array;
            };
          }
        | { readonly kind: 'error'; readonly reason: string };
    }
    interface ClientApi {
      readonly prepareReliefHeightmapsOffThread: (
        items: readonly {
          readonly taskId: string;
          readonly source: object;
          readonly options: {
            readonly targetWidthMm: number;
            readonly reliefDepthMm: number;
            readonly mmPerCell: number;
          };
        }[],
        signal?: AbortSignal,
      ) => Promise<readonly Result[]> | null;
      readonly resetCncRemovalGridWorkerForTests: () => void;
      readonly prepareCncCut3DSurfaceOffThread: (grid: {
        readonly widthCells: number;
        readonly heightCells: number;
        readonly mmPerCell: number;
        readonly originX: number;
        readonly originY: number;
        readonly depth: Float32Array;
      }) => Promise<{
        readonly positions: Float32Array;
        readonly indices: Uint32Array;
        readonly normals: Float32Array;
      }> | null;
    }
    const target = window as typeof window & { __RELIEF_WORKER_SOURCE__?: object };
    const source = target.__RELIEF_WORKER_SOURCE__;
    if (source === undefined) throw new Error('relief source fixture missing');
    const modulePath = '/src/ui/workspace/cnc-removal-grid-worker-client.ts';
    const client = (await import(/* @vite-ignore */ modulePath)) as unknown as ClientApi;
    const options = { targetWidthMm: 256, reliefDepthMm: 6, mmPerCell: 1 };
    const controller = new AbortController();
    try {
      const stale = client.prepareReliefHeightmapsOffThread(
        [{ taskId: 'stale', source, options }],
        controller.signal,
      );
      const current = client.prepareReliefHeightmapsOffThread([
        { taskId: 'current', source, options },
      ]);
      if (stale === null || current === null)
        throw new Error('production relief worker unavailable');
      window.setTimeout(() => controller.abort(), 0);
      let staleErrorName = '';
      try {
        await stale;
      } catch (error) {
        staleErrorName = error instanceof Error ? error.name : String(error);
      }
      const items = await current;
      const currentResult = items[0];
      if (items.length !== 1 || currentResult?.result.kind !== 'ok') {
        throw new Error('production relief worker returned no heightmap');
      }
      const map = currentResult.result.heightmap;
      const surfaceWork = client.prepareCncCut3DSurfaceOffThread({
        ...map,
        originX: 0,
        originY: 0,
      });
      if (surfaceWork === null) throw new Error('production relief surface worker unavailable');
      const surface = await surfaceWork;
      await new Promise((resolve) => window.setTimeout(resolve, 150));
      return {
        staleErrorName,
        widthCells: currentResult.result.heightmap.widthCells,
        heightCells: currentResult.result.heightmap.heightCells,
        retainedCells: currentResult.result.heightmap.depth.length,
        surfaceVertices: surface.positions.length / 3,
        surfaceNormals: surface.normals.length / 3,
      };
    } finally {
      delete target.__RELIEF_WORKER_SOURCE__;
      client.resetCncRemovalGridWorkerForTests();
    }
  });

  const responsiveness = await stopResponsivenessProbe(page);
  assertResponsivePhase(testInfo, 'depth-map relief worker', responsiveness);
  expect(result).toEqual({
    staleErrorName: 'AbortError',
    widthCells: 256,
    heightCells: 256,
    retainedCells: 256 * 256,
    surfaceVertices: 256 * 256,
    surfaceNormals: 256 * 256,
  });
  expect(workerUrls.some((url) => url.includes('cnc-removal-grid-worker'))).toBe(true);
  expect(workerUrls.some((url) => url.includes('canvas-compilation-worker'))).toBe(true);
});
