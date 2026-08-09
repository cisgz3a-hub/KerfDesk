import { expect, test } from '@playwright/test';
import { makePng } from '../src/ui/import/png-incremental-decoder.test-support';

const PNG_BASE64 = Buffer.from(
  makePng({
    width: 4,
    height: 2,
    colorType: 0,
    rows: [
      [0, 1, 127, 128],
      [129, 254, 255, 64],
    ],
    filters: [1, 4],
  }),
).toString('base64');

const TRANSPARENT_PNG_BASE64 = Buffer.from(
  makePng({
    width: 4,
    height: 1,
    colorType: 0,
    rows: [[12, 127, 200, 127]],
    transparency: Uint8Array.of(0, 127),
  }),
).toString('base64');

const PNG_FIXTURES = {
  ordinaryPngBase64: PNG_BASE64,
  transparentPngBase64: TRANSPARENT_PNG_BASE64,
};

test('real import worker clones exact canonical fields, tRNS mask, and replaces cancelled work', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const workerUrls: string[] = [];
  page.on('worker', (worker) => workerUrls.push(worker.url()));
  await page.goto('/');

  const result = await page.evaluate(async (fixtures) => {
    interface Progress {
      readonly phase: 'queued' | 'reading' | 'parsing' | 'preparing';
      readonly queuePosition: number;
    }
    type HeightfieldResult =
      | {
          readonly kind: 'ok';
          readonly heightfield: {
            readonly kind: 'heightfield-v1';
            readonly schemaVersion: 1;
            readonly width: number;
            readonly height: number;
            readonly physicalWidthMm: number;
            readonly physicalHeightMm: number;
            readonly encoding: 'u16le-base64-v1';
            readonly samplesBase64: string;
            readonly inclusionMask?: {
              readonly encoding: 'u8-base64-v1';
              readonly samplesBase64: string;
            };
            readonly mapping: object;
            readonly provenance: object;
            readonly algorithmRevision: string;
            readonly revision: number;
            readonly digest: string;
          };
        }
      | { readonly kind: 'error'; readonly reason: string };
    interface ClientApi {
      readonly prepareReliefHeightfieldPngOffThread: (
        blob: Blob,
        sourceName: string,
        physicalWidthMm: number,
        maxDepthMm: number,
        options?: {
          readonly signal?: AbortSignal;
          readonly onProgress?: (progress: Progress) => void;
        },
      ) => Promise<HeightfieldResult> | null;
      readonly resetImportWorkerForTests: () => void;
    }

    const modulePath = '/src/ui/import/import-worker-client.ts';
    const loaded: unknown = await import(/* @vite-ignore */ modulePath);
    const client = loaded as Partial<ClientApi>;
    if (
      typeof client.prepareReliefHeightfieldPngOffThread !== 'function' ||
      typeof client.resetImportWorkerForTests !== 'function'
    ) {
      throw new Error('production import worker client is unavailable');
    }

    const pngBytes = Uint8Array.from(atob(fixtures.ordinaryPngBase64), (character) =>
      character.charCodeAt(0),
    );
    const cancelledProgress: Progress[] = [];
    const currentProgress: Progress[] = [];
    const controller = new AbortController();
    let cancellationSent = false;
    try {
      const cancelled = client.prepareReliefHeightfieldPngOffThread(
        new Blob([pngBytes], { type: 'image/png' }),
        'cancelled.png',
        100,
        5,
        {
          signal: controller.signal,
          onProgress: (progress) => {
            cancelledProgress.push(progress);
            if (progress.phase === 'reading' && !cancellationSent) {
              cancellationSent = true;
              controller.abort();
            }
          },
        },
      );
      if (cancelled === null) throw new Error('production import worker could not be constructed');
      const cancellation = cancelled.then(
        () => 'resolved',
        (error: unknown) => (error instanceof Error ? error.name : String(error)),
      );
      const current = client.prepareReliefHeightfieldPngOffThread(
        new Blob([pngBytes], { type: 'image/png' }),
        'current.png',
        100,
        5,
        { onProgress: (progress) => currentProgress.push(progress) },
      );
      if (current === null) throw new Error('replacement import worker could not be constructed');

      const [cancellationName, prepared] = await Promise.all([cancellation, current]);
      if (prepared.kind !== 'ok') throw new Error(prepared.reason);
      const transparentBytes = Uint8Array.from(atob(fixtures.transparentPngBase64), (character) =>
        character.charCodeAt(0),
      );
      const transparent = client.prepareReliefHeightfieldPngOffThread(
        new Blob([transparentBytes], { type: 'image/png' }),
        'transparent.png',
        100,
        5,
      );
      if (transparent === null) throw new Error('replacement import worker became unavailable');
      const transparentPrepared = await transparent;
      if (transparentPrepared.kind !== 'ok') throw new Error(transparentPrepared.reason);
      return {
        cancellationName,
        cancelledProgress,
        currentProgress,
        heightfield: prepared.heightfield,
        isPlainClone: Object.getPrototypeOf(prepared.heightfield) === Object.prototype,
        transparentHeightfield: transparentPrepared.heightfield,
        transparentIsPlainClone:
          Object.getPrototypeOf(transparentPrepared.heightfield) === Object.prototype,
      };
    } finally {
      client.resetImportWorkerForTests();
    }
  }, PNG_FIXTURES);

  expect(result.cancellationName).toBe('AbortError');
  expect(result.cancelledProgress.some((progress) => progress.phase === 'reading')).toBe(true);
  expect(result.currentProgress[0]).toEqual({ phase: 'queued', queuePosition: 1 });
  expect(result.currentProgress.map((progress) => progress.phase)).toEqual(
    expect.arrayContaining(['reading', 'parsing', 'preparing']),
  );
  expect(result.isPlainClone).toBe(true);
  expect(result.heightfield).toEqual({
    kind: 'heightfield-v1',
    schemaVersion: 1,
    width: 4,
    height: 2,
    physicalWidthMm: 100,
    physicalHeightMm: 50,
    encoding: 'u16le-base64-v1',
    samplesBase64: 'AAABAX9/gICBgf7+//9AQA==',
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
      sourceName: 'current.png',
      sourceBitDepth: 8,
      sourcePolarity: 'light-is-high',
    },
    algorithmRevision: 'heightfield-map-v1',
    revision: 0,
    digest: 'sha256:92a4129e9c88663246c5ea4227fbfa7fdabcfa763935df2dda7854d2c5eab387',
  });
  expect(result.transparentIsPlainClone).toBe(true);
  expect(result.transparentHeightfield).toEqual({
    kind: 'heightfield-v1',
    schemaVersion: 1,
    width: 4,
    height: 1,
    physicalWidthMm: 100,
    physicalHeightMm: 25,
    encoding: 'u16le-base64-v1',
    samplesBase64: 'DAx/f8jIf38=',
    inclusionMask: {
      encoding: 'u8-base64-v1',
      samplesBase64: '/wD/AA==',
    },
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
      sourceName: 'transparent.png',
      sourceBitDepth: 8,
      sourcePolarity: 'light-is-high',
    },
    algorithmRevision: 'heightfield-map-v1',
    revision: 0,
    digest: 'sha256:f83b448b534af8c213a4a379f05d8d2620c3927b4d144520e5d0646cc909062a',
  });
  expect(
    workerUrls.filter(
      (url) => url.includes('/import-worker') && !url.includes('document-import-worker'),
    ),
  ).toHaveLength(2);
});
