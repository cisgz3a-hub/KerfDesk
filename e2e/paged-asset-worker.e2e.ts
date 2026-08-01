import { expect, test } from '@playwright/test';

test('real paged-asset worker persists pages and cleans cancellation before FIFO advances', async ({
  page,
}) => {
  const workerUrls: string[] = [];
  page.on('worker', (worker) => workerUrls.push(worker.url()));
  await page.goto('/');

  const result = await page.evaluate(async () => {
    interface Manifest {
      readonly assetId: string;
      readonly byteLength: number;
      readonly pageCount: number;
      readonly state: 'staging' | 'ready';
    }
    interface Progress {
      readonly phase: 'queued' | 'persisting';
      readonly queuePosition: number;
    }
    interface ClientApi {
      stageAssetOffThread: (
        blob: Blob,
        options: {
          readonly assetId: string;
          readonly sourceName: string;
          readonly createdAtEpochMs: number;
          readonly signal?: AbortSignal;
          readonly onProgress?: (progress: Progress) => void;
        },
      ) => Promise<Manifest> | null;
      resetPagedAssetWorkerForTests: () => void;
    }
    interface Repository {
      readManifest(assetId: string): Promise<Manifest | null>;
      readPage(assetId: string, index: number): Promise<Blob | null>;
    }
    interface RepositoryApi {
      IndexedDbPagedAssetRepository: new () => Repository;
    }

    const clientPath = '/src/ui/import/paged-asset-worker-client.ts';
    const repositoryPath = '/src/ui/import/paged-asset-indexeddb.ts';
    const client = (await import(/* @vite-ignore */ clientPath)) as Partial<ClientApi>;
    const repositories = (await import(
      /* @vite-ignore */ repositoryPath
    )) as Partial<RepositoryApi>;
    if (
      typeof client.stageAssetOffThread !== 'function' ||
      typeof client.resetPagedAssetWorkerForTests !== 'function' ||
      repositories.IndexedDbPagedAssetRepository === undefined
    ) {
      throw new Error('paged asset production modules are unavailable');
    }

    const repository = new repositories.IndexedDbPagedAssetRepository();
    const prefix = crypto.randomUUID();
    const readyId = `${prefix}-ready`;
    const cancelledId = `${prefix}-cancelled`;
    const queuedId = `${prefix}-queued`;
    const mib = 1024 * 1024;
    const controller = new AbortController();
    const queuedProgress: Progress[] = [];
    let cancellationRequested = false;
    let eventLoopTicks = 0;
    const heartbeat = window.setInterval(() => {
      eventLoopTicks += 1;
    }, 10);
    try {
      const ready = client.stageAssetOffThread(
        new Blob([new Uint8Array(4 * mib + 13)], { type: 'image/png' }),
        {
          assetId: readyId,
          sourceName: 'ready.png',
          createdAtEpochMs: Date.now(),
        },
      );
      if (ready === null) throw new Error('ready worker request was unavailable');
      const readyManifest = await ready;

      const cancelled = client.stageAssetOffThread(new Blob([new Uint8Array(32 * mib)]), {
        assetId: cancelledId,
        sourceName: 'cancelled.bin',
        createdAtEpochMs: Date.now(),
        signal: controller.signal,
        onProgress: (progress) => {
          if (progress.phase === 'persisting' && !cancellationRequested) {
            cancellationRequested = true;
            controller.abort();
          }
        },
      });
      const queued = client.stageAssetOffThread(new Blob([new Uint8Array(17)]), {
        assetId: queuedId,
        sourceName: 'queued.bin',
        createdAtEpochMs: Date.now(),
        onProgress: (progress) => queuedProgress.push(progress),
      });
      if (cancelled === null || queued === null) {
        throw new Error('cancel/queue worker request was unavailable');
      }
      let cancellationName = '';
      try {
        await cancelled;
      } catch (error) {
        cancellationName = error instanceof Error ? error.name : String(error);
      }
      const queuedManifest = await queued;
      return {
        readyManifest,
        firstPageBytes: (await repository.readPage(readyId, 0))?.size ?? -1,
        lastPageBytes: (await repository.readPage(readyId, 4))?.size ?? -1,
        cancellationName,
        cancelledManifest: await repository.readManifest(cancelledId),
        queuedManifest,
        queuedProgress,
        eventLoopTicks,
      };
    } finally {
      window.clearInterval(heartbeat);
      client.resetPagedAssetWorkerForTests();
    }
  });

  expect(result.readyManifest).toMatchObject({
    byteLength: 4 * 1024 * 1024 + 13,
    pageCount: 5,
    state: 'ready',
  });
  expect(result.firstPageBytes).toBe(1024 * 1024);
  expect(result.lastPageBytes).toBe(13);
  expect(result.cancellationName).toBe('AbortError');
  expect(result.cancelledManifest).toBeNull();
  expect(result.queuedManifest).toMatchObject({ byteLength: 17, state: 'ready' });
  expect(result.queuedProgress[0]).toEqual({ phase: 'queued', queuePosition: 1 });
  expect(result.eventLoopTicks).toBeGreaterThan(2);
  expect(workerUrls.some((url) => url.includes('paged-asset-worker'))).toBe(true);
});
