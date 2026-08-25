import { expect, test } from '@playwright/test';
import { makePng } from '../src/ui/import/png-incremental-decoder.test-support';

const ALPHA_PNG_BASE64 = Buffer.from(
  makePng({
    width: 4,
    height: 2,
    colorType: 4,
    rows: [
      [0, 0, 1, 1, 127, 127, 255, 128],
      [12, 254, 64, 255, 128, 200, 200, 42],
    ],
    filters: [1, 4],
  }),
).toString('base64');

test('real import worker and main fallback preserve the same grayscale-alpha field', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const workerUrls: string[] = [];
  page.on('worker', (worker) => workerUrls.push(worker.url()));
  await page.goto('/');

  const result = await page.evaluate(async (pngBase64) => {
    interface Progress {
      readonly phase: string;
      readonly queuePosition: number;
    }
    type Prepared =
      | { readonly kind: 'ok'; readonly heightfield: Record<string, unknown> }
      | { readonly kind: 'error'; readonly reason: string };
    interface Client {
      readonly prepareReliefHeightfieldPngOffThread: (
        blob: Blob,
        sourceName: string,
        physicalWidthMm: number,
        maxDepthMm: number,
        options?: { readonly onProgress?: (progress: Progress) => void },
      ) => Promise<Prepared> | null;
      readonly resetImportWorkerForTests: () => void;
    }
    interface Preparation {
      readonly prepareReliefHeightfieldPng: (
        blob: Blob,
        options: {
          readonly sourceName: string;
          readonly physicalWidthMm: number;
          readonly maxDepthMm: number;
        },
      ) => Promise<Prepared>;
    }

    const bytes = Uint8Array.from(atob(pngBase64), (character) => character.charCodeAt(0));
    const blob = new Blob([bytes], { type: 'image/png' });
    const clientPath = '/src/ui/import/import-worker-client.ts';
    const preparationPath = '/src/ui/import/depth-map-import-preparation.ts';
    const client = (await import(/* @vite-ignore */ clientPath)) as Partial<Client>;
    const preparation = (await import(/* @vite-ignore */ preparationPath)) as Partial<Preparation>;
    if (
      typeof client.prepareReliefHeightfieldPngOffThread !== 'function' ||
      typeof client.resetImportWorkerForTests !== 'function' ||
      typeof preparation.prepareReliefHeightfieldPng !== 'function'
    ) {
      throw new Error('production grayscale-alpha import modules are unavailable');
    }

    const progress: Progress[] = [];
    try {
      const pending = client.prepareReliefHeightfieldPngOffThread(blob, 'exact-alpha.png', 100, 5, {
        onProgress: (update) => progress.push(update),
      });
      if (pending === null) throw new Error('production import worker could not be constructed');
      const [workerPrepared, mainPrepared] = await Promise.all([
        pending,
        preparation.prepareReliefHeightfieldPng(blob, {
          sourceName: 'exact-alpha.png',
          physicalWidthMm: 100,
          maxDepthMm: 5,
        }),
      ]);
      if (workerPrepared.kind !== 'ok') throw new Error(workerPrepared.reason);
      if (mainPrepared.kind !== 'ok') throw new Error(mainPrepared.reason);
      return {
        progress,
        workerHeightfield: workerPrepared.heightfield,
        mainHeightfield: mainPrepared.heightfield,
        workerIsPlainClone: Object.getPrototypeOf(workerPrepared.heightfield) === Object.prototype,
      };
    } finally {
      client.resetImportWorkerForTests();
    }
  }, ALPHA_PNG_BASE64);

  expect(result.progress.map((progress) => progress.phase)).toEqual(
    expect.arrayContaining(['reading', 'parsing', 'preparing']),
  );
  expect(result.workerIsPlainClone).toBe(true);
  expect(result.workerHeightfield).toEqual(result.mainHeightfield);
  expect(result.workerHeightfield).toEqual({
    kind: 'heightfield-v1',
    schemaVersion: 1,
    width: 4,
    height: 2,
    physicalWidthMm: 100,
    physicalHeightMm: 50,
    encoding: 'u16le-base64-v1',
    samplesBase64: 'AAABAX9///8MDEBAgIDIyA==',
    inclusionMask: { encoding: 'u8-base64-v1', samplesBase64: 'AAF/gP7/yCo=' },
    mapping: {
      polarity: 'light-is-high',
      inputLowCode: 0,
      inputHighCode: 0xffff,
      curve: { kind: 'gamma-v1', gamma: 1 },
      maxDepthMm: 5,
      crop: { kind: 'normalized-v1', x: 0, y: 0, width: 1, height: 1 },
      aspect: 'preserve',
      inclusionThreshold: 255,
      outsideMask: 'excluded',
    },
    provenance: {
      sourceKind: 'depth-map',
      sourceName: 'exact-alpha.png',
      sourceBitDepth: 8,
      sourcePolarity: 'light-is-high',
    },
    algorithmRevision: 'heightfield-map-v1',
    revision: 0,
    digest: 'sha256:e4372aace9580e039467c5c6ef5303bcff2febe9d896891a83b43ba73f334b9f',
  });
  expect(
    workerUrls.filter(
      (url) => url.includes('/import-worker') && !url.includes('document-import-worker'),
    ),
  ).toHaveLength(1);
});
