import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PNG_BASE64 = readFileSync(
  join(
    process.cwd(),
    'src',
    '__fixtures__',
    'perceptual',
    'assets',
    'arch-house-langebaan-source.png',
  ),
).toString('base64');

test('real PNG worker cleans cancellation, advances FIFO, and persists sampled luma', async ({
  page,
}) => {
  const workerUrls: string[] = [];
  page.on('worker', (worker) => workerUrls.push(worker.url()));
  await page.goto('/');

  const result = await page.evaluate(async (pngBase64) => {
    interface Progress {
      readonly phase: string;
      readonly queuePosition: number;
    }
    interface ImportResult {
      readonly kind: 'ok' | 'legacy-fallback';
      readonly sampledWidth?: number;
      readonly sampledHeight?: number;
      readonly sourceManifest?: { readonly assetId: string; readonly byteLength: number };
      readonly lumaManifest?: {
        readonly assetId: string;
        readonly byteLength: number;
        readonly pageCount: number;
      };
    }
    interface ClientApi {
      importPngOffThread: (
        blob: Blob,
        options: {
          readonly assetId: string;
          readonly lumaAssetId: string;
          readonly sourceName: string;
          readonly createdAtEpochMs: number;
          readonly maxEdge: number;
          readonly maxPixels: number;
          readonly signal?: AbortSignal;
          readonly onProgress?: (progress: Progress) => void;
        },
      ) => Promise<ImportResult> | null;
      resetPngImportWorkerForTests: () => Promise<void>;
    }
    interface Repository {
      readManifest(assetId: string): Promise<{ readonly state: string } | null>;
      readPage(assetId: string, index: number): Promise<Blob | null>;
    }
    interface RepositoryApi {
      IndexedDbPagedAssetRepository: new () => Repository;
    }

    const clientPath = '/src/ui/import/png-import-worker-client.ts';
    const repositoryPath = '/src/ui/import/paged-asset-indexeddb.ts';
    const client = (await import(/* @vite-ignore */ clientPath)) as Partial<ClientApi>;
    const repositories = (await import(
      /* @vite-ignore */ repositoryPath
    )) as Partial<RepositoryApi>;
    if (
      typeof client.importPngOffThread !== 'function' ||
      typeof client.resetPngImportWorkerForTests !== 'function' ||
      repositories.IndexedDbPagedAssetRepository === undefined
    ) {
      throw new Error('PNG production worker modules are unavailable');
    }

    const prefix = crypto.randomUUID();
    const cancelledSourceId = `${prefix}-cancelled-source`;
    const cancelledLumaId = `${prefix}-cancelled-luma`;
    const sourceId = `${prefix}-source`;
    const lumaId = `${prefix}-luma`;
    const controller = new AbortController();
    const queuedProgress: Progress[] = [];
    const pngBytes = Uint8Array.from(atob(pngBase64), (character) => character.charCodeAt(0));
    let eventLoopTicks = 0;
    const heartbeat = window.setInterval(() => {
      eventLoopTicks += 1;
    }, 10);
    try {
      const cancelled = client.importPngOffThread(new Blob([new Uint8Array(32 * 1024 * 1024)]), {
        assetId: cancelledSourceId,
        lumaAssetId: cancelledLumaId,
        sourceName: 'cancelled.png',
        createdAtEpochMs: Date.now(),
        maxEdge: 8192,
        maxPixels: 32_000_000,
        signal: controller.signal,
        onProgress: (progress) => {
          if (progress.phase === 'persisting-source') controller.abort();
        },
      });
      const queued = client.importPngOffThread(new Blob([pngBytes], { type: 'image/png' }), {
        assetId: sourceId,
        lumaAssetId: lumaId,
        sourceName: 'arch-house.png',
        createdAtEpochMs: Date.now(),
        maxEdge: 8192,
        maxPixels: 32_000_000,
        onProgress: (progress) => queuedProgress.push(progress),
      });
      if (cancelled === null || queued === null) throw new Error('PNG worker request unavailable');
      let cancellationName = '';
      try {
        await cancelled;
      } catch (error) {
        cancellationName = error instanceof Error ? error.name : String(error);
      }
      const imported = await queued;
      if (imported.kind !== 'ok' || imported.lumaManifest === undefined) {
        throw new Error('qualified PNG unexpectedly used the legacy fallback');
      }
      const repository = new repositories.IndexedDbPagedAssetRepository();
      return {
        cancellationName,
        cancelledSource: await repository.readManifest(cancelledSourceId),
        cancelledLuma: await repository.readManifest(cancelledLumaId),
        imported,
        lumaPageBytes: (await repository.readPage(imported.lumaManifest.assetId, 0))?.size ?? -1,
        queuedProgress,
        eventLoopTicks,
      };
    } finally {
      window.clearInterval(heartbeat);
      await client.resetPngImportWorkerForTests();
    }
  }, PNG_BASE64);

  expect(result.cancellationName).toBe('AbortError');
  expect(result.cancelledSource).toBeNull();
  expect(result.cancelledLuma).toBeNull();
  expect(result.imported).toMatchObject({
    kind: 'ok',
    sampledWidth: 1024,
    sampledHeight: 1024,
    sourceManifest: { byteLength: 313860 },
    lumaManifest: { byteLength: 1024 * 1024, pageCount: 1 },
  });
  expect(result.lumaPageBytes).toBe(1024 * 1024);
  expect(result.queuedProgress[0]).toEqual({ phase: 'queued', queuePosition: 1 });
  expect(result.eventLoopTicks).toBeGreaterThan(2);
  expect(workerUrls.some((url) => url.includes('png-import-worker'))).toBe(true);
});
