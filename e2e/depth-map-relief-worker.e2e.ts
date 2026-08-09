import { expect, test } from './fixtures/kerfdesk-test';
import {
  assertResponsivePhase,
  startResponsivenessProbe,
  stopResponsivenessProbe,
} from './fixtures/browser-responsiveness';
import { testReliefHeightfield } from '../src/__fixtures__/relief-heightfield';
import type { RemovalGrid } from '../src/core/sim';

const SOURCE_WIDTH_CELLS = 2048;
const SOURCE_PHYSICAL_SIZE_MM = 256;
const RELIEF_DEPTH_MM = 6;
const PREVIEW_MM_PER_CELL = 1;
const U8_SAMPLE_MASK = 0xff;
const U8_TO_U16_SCALE = 0x0101;
const WORKER_SETTLE_MS = 150;
const POSITION_COMPONENTS = 3;
const WORKER_FIXTURE = {
  source: testReliefHeightfield({
    width: SOURCE_WIDTH_CELLS,
    height: SOURCE_WIDTH_CELLS,
    physicalWidthMm: SOURCE_PHYSICAL_SIZE_MM,
    physicalHeightMm: SOURCE_PHYSICAL_SIZE_MM,
    maxDepthMm: RELIEF_DEPTH_MM,
    samplesU16: Array.from(
      { length: SOURCE_WIDTH_CELLS * SOURCE_WIDTH_CELLS },
      (_, index) => (index & U8_SAMPLE_MASK) * U8_TO_U16_SCALE,
    ),
    provenance: { sourceName: 'worker-heightfield.png' },
  }),
  options: {
    targetWidthMm: SOURCE_PHYSICAL_SIZE_MM,
    reliefDepthMm: RELIEF_DEPTH_MM,
    mmPerCell: PREVIEW_MM_PER_CELL,
  },
  workerSettleMs: WORKER_SETTLE_MS,
  positionComponents: POSITION_COMPONENTS,
};

test('production canonical heightfield worker cancels stale work and keeps the UI responsive', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const workerUrls: string[] = [];
  page.on('worker', (worker) => workerUrls.push(worker.url()));
  await page.goto('/');
  await startResponsivenessProbe(page);

  const result = await page.evaluate(async (fixture) => {
    type ClientApi = typeof import('../src/ui/workspace/cnc-removal-grid-worker-client');
    const modulePath = '/src/ui/workspace/cnc-removal-grid-worker-client.ts';
    const loaded: unknown = await import(/* @vite-ignore */ modulePath);
    // The Vite runtime import is string-addressed; runtime checks below provide
    // the narrowing that a static browser import cannot safely provide here.
    const client = loaded as Partial<ClientApi>;
    if (
      typeof client.prepareReliefHeightmapsOffThread !== 'function' ||
      typeof client.prepareCncCut3DSurfaceOffThread !== 'function' ||
      typeof client.resetCncRemovalGridWorkerForTests !== 'function'
    ) {
      throw new Error('production relief worker client is unavailable');
    }
    const { source, options, workerSettleMs, positionComponents } = fixture;
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
      controller.abort();
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
      const grid: RemovalGrid = {
        ...map,
        originX: 0,
        originY: 0,
        resolution: {
          requestedMmPerCell: options.mmPerCell,
          effectiveMmPerCell: map.mmPerCell,
          reason: null,
        },
      };
      const surfaceWork = client.prepareCncCut3DSurfaceOffThread(grid);
      if (surfaceWork === null) throw new Error('production relief surface worker unavailable');
      const surface = await surfaceWork;
      await new Promise((resolve) => window.setTimeout(resolve, workerSettleMs));
      return {
        staleErrorName,
        sourceKind: source.kind,
        sourceEncoding: source.encoding,
        widthCells: map.widthCells,
        heightCells: map.heightCells,
        retainedCells: map.depth.length,
        resolution: grid.resolution,
        surfaceVertices: surface.positions.length / positionComponents,
        surfaceNormals: surface.normals.length / positionComponents,
      };
    } finally {
      client.resetCncRemovalGridWorkerForTests();
    }
  }, WORKER_FIXTURE);

  const responsiveness = await stopResponsivenessProbe(page);
  assertResponsivePhase(testInfo, 'heightfield relief worker', responsiveness);
  expect(result).toEqual({
    staleErrorName: 'AbortError',
    sourceKind: 'heightfield-v1',
    sourceEncoding: 'u16le-base64-v1',
    widthCells: SOURCE_PHYSICAL_SIZE_MM,
    heightCells: SOURCE_PHYSICAL_SIZE_MM,
    retainedCells: SOURCE_PHYSICAL_SIZE_MM * SOURCE_PHYSICAL_SIZE_MM,
    resolution: {
      requestedMmPerCell: PREVIEW_MM_PER_CELL,
      effectiveMmPerCell: PREVIEW_MM_PER_CELL,
      reason: null,
    },
    surfaceVertices: SOURCE_PHYSICAL_SIZE_MM * SOURCE_PHYSICAL_SIZE_MM,
    surfaceNormals: SOURCE_PHYSICAL_SIZE_MM * SOURCE_PHYSICAL_SIZE_MM,
  });
  expect(workerUrls.some((url) => url.includes('cnc-removal-grid-worker'))).toBe(true);
  expect(workerUrls.some((url) => url.includes('canvas-compilation-worker'))).toBe(true);
});
