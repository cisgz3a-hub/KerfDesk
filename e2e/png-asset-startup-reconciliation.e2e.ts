import { expect, test } from '@playwright/test';

test('startup reconciliation retains a live worker lease and removes it after worker termination', async ({
  page,
}) => {
  const workerUrls: string[] = [];
  page.on('worker', (worker) => workerUrls.push(worker.url()));
  await page.goto('/');

  const initial = await page.evaluate(async () => {
    interface Manifest {
      readonly schemaVersion: 1;
      readonly assetId: string;
      readonly sourceName: string;
      readonly mimeType: string;
      readonly byteLength: number;
      readonly writtenByteLength: number;
      readonly pageBytes: number;
      readonly pageCount: number;
      readonly createdAtEpochMs: number;
      readonly state: 'staging' | 'ready';
    }
    interface Repository {
      begin(manifest: Manifest): Promise<void>;
      writePage(assetId: string, index: number, page: Blob): Promise<void>;
      commit(manifest: Manifest): Promise<void>;
      readManifest(assetId: string): Promise<Manifest | null>;
      readPage(assetId: string, index: number): Promise<Blob | null>;
    }
    interface RepositoryApi {
      IndexedDbPagedAssetRepository: new () => Repository;
    }
    interface ReconciliationApi {
      reconcileExpiredPagedAssetLeases(options: {
        readonly nowEpochMs: number;
        readonly maxLeases: number;
      }): Promise<{
        readonly removed: number;
        readonly retainedLive: number;
      }>;
    }

    const repositoryPath = '/src/ui/import/paged-asset-indexeddb.ts';
    const reconciliationPath = '/src/ui/import/paged-asset-startup-reconciliation.ts';
    const repositories = (await import(
      /* @vite-ignore */ repositoryPath
    )) as Partial<RepositoryApi>;
    const reconciliation = (await import(
      /* @vite-ignore */ reconciliationPath
    )) as Partial<ReconciliationApi>;
    if (
      repositories.IndexedDbPagedAssetRepository === undefined ||
      reconciliation.reconcileExpiredPagedAssetLeases === undefined
    ) {
      throw new Error('Page-asset reconciliation production modules are unavailable');
    }

    const repository = new repositories.IndexedDbPagedAssetRepository();
    const assetId = `${crypto.randomUUID()}-lease-crash`;
    const leaseId = `${crypto.randomUUID()}-worker`;
    const pageBlob = new Blob(['live'], { type: 'application/octet-stream' });
    const staging: Manifest = {
      schemaVersion: 1,
      assetId,
      sourceName: 'lease-crash.bin',
      mimeType: pageBlob.type,
      byteLength: pageBlob.size,
      writtenByteLength: 0,
      pageBytes: pageBlob.size,
      pageCount: 1,
      createdAtEpochMs: Date.now(),
      state: 'staging',
    };
    await repository.begin(staging);
    await repository.writePage(assetId, 0, pageBlob);
    await repository.commit({ ...staging, writtenByteLength: pageBlob.size, state: 'ready' });

    const worker = new Worker('/e2e/fixtures/paged-asset-lease-worker.ts', { type: 'module' });
    await new Promise<void>((resolve, reject) => {
      worker.onmessage = (event) => {
        if (event.data === 'acquired') resolve();
      };
      worker.onerror = () => reject(new Error('Lease worker failed'));
      worker.postMessage({ assetId, leaseId });
    });

    const whileLive = await reconciliation.reconcileExpiredPagedAssetLeases({
      nowEpochMs: Date.now(),
      maxLeases: 1,
    });
    worker.terminate();
    await new Promise((resolve) => window.setTimeout(resolve, 50));
    return { whileLive, assetId };
  });

  expect(initial.whileLive).toMatchObject({ examined: 1, removed: 0, retainedLive: 1 });
  await page.reload();
  const afterStartup = await page.evaluate(async (assetId) => {
    interface Repository {
      readManifest(assetId: string): Promise<{ readonly state: string } | null>;
      readPage(assetId: string, index: number): Promise<Blob | null>;
    }
    interface RepositoryApi {
      IndexedDbPagedAssetRepository: new () => Repository;
    }
    interface ReconciliationRepository {
      listExpiredLeases(nowEpochMs: number, maxLeases: number): Promise<unknown[]>;
    }
    interface ReconciliationRepositoryApi {
      IndexedDbPagedAssetReconciliationRepository: new () => ReconciliationRepository;
    }
    const repositoryPath = '/src/ui/import/paged-asset-indexeddb.ts';
    const reconciliationRepositoryPath =
      '/src/ui/import/paged-asset-startup-reconciliation-repository.ts';
    const repositories = (await import(
      /* @vite-ignore */ repositoryPath
    )) as Partial<RepositoryApi>;
    const reconciliationRepositories = (await import(
      /* @vite-ignore */ reconciliationRepositoryPath
    )) as Partial<ReconciliationRepositoryApi>;
    if (
      repositories.IndexedDbPagedAssetRepository === undefined ||
      reconciliationRepositories.IndexedDbPagedAssetReconciliationRepository === undefined
    ) {
      throw new Error('Page-asset startup modules are unavailable after reload');
    }
    const repository = new repositories.IndexedDbPagedAssetRepository();
    const reconciliation =
      new reconciliationRepositories.IndexedDbPagedAssetReconciliationRepository();
    let expired: unknown[] = [];
    for (let attempt = 0; attempt < 100; attempt += 1) {
      expired = await reconciliation.listExpiredLeases(Date.now(), 64);
      if (expired.length === 0) break;
      await new Promise((resolve) => window.setTimeout(resolve, 10));
    }
    return {
      expiredLeaseCount: expired.length,
      manifestState: (await repository.readManifest(assetId))?.state ?? null,
      pageText: await (await repository.readPage(assetId, 0))?.text(),
    };
  }, initial.assetId);

  expect(afterStartup).toEqual({
    expiredLeaseCount: 0,
    manifestState: 'ready',
    pageText: 'live',
  });
  expect(workerUrls.some((url) => url.includes('paged-asset-lease-worker'))).toBe(true);
});

test('startup cleanup removes only abandoned protected staging after a worker crash', async ({
  page,
}) => {
  const workerUrls: string[] = [];
  page.on('worker', (worker) => workerUrls.push(worker.url()));
  await page.goto('/');

  const initial = await page.evaluate(async () => {
    interface Manifest {
      readonly schemaVersion: 1;
      readonly assetId: string;
      readonly sourceName: string;
      readonly mimeType: string;
      readonly byteLength: number;
      readonly writtenByteLength: number;
      readonly pageBytes: number;
      readonly pageCount: number;
      readonly createdAtEpochMs: number;
      readonly state: 'staging' | 'ready';
    }
    interface Repository {
      begin(manifest: Manifest): Promise<void>;
      writePage(assetId: string, index: number, page: Blob): Promise<void>;
      commit(manifest: Manifest): Promise<void>;
      readManifest(assetId: string): Promise<Manifest | null>;
    }
    interface RepositoryApi {
      IndexedDbPagedAssetRepository: new (
        factory?: IDBFactory,
        keyRanges?: typeof IDBKeyRange,
        stagingLocks?: { hold(assetId: string): Promise<null> },
        now?: () => number,
        stagingTtlMs?: number,
      ) => Repository;
    }
    interface ReconciliationApi {
      reconcileStalePagedAssetStaging(options: {
        readonly nowEpochMs: number;
        readonly maxAssets: number;
      }): Promise<{
        readonly examined: number;
        readonly removed: number;
        readonly retainedLive: number;
      }>;
    }

    const repositoryPath = '/src/ui/import/paged-asset-indexeddb.ts';
    const reconciliationPath = '/src/ui/import/paged-asset-startup-staging-cleanup.ts';
    const repositories = (await import(
      /* @vite-ignore */ repositoryPath
    )) as Partial<RepositoryApi>;
    const reconciliation = (await import(
      /* @vite-ignore */ reconciliationPath
    )) as Partial<ReconciliationApi>;
    if (
      repositories.IndexedDbPagedAssetRepository === undefined ||
      reconciliation.reconcileStalePagedAssetStaging === undefined
    ) {
      throw new Error('Page-asset staging cleanup production modules are unavailable');
    }

    const abandonedAssetId = `${crypto.randomUUID()}-abandoned-staging`;
    const readyAssetId = `${crypto.randomUUID()}-ready`;
    const unprotectedAssetId = `${crypto.randomUUID()}-unprotected`;
    const legacyAssetId = `${crypto.randomUUID()}-legacy`;
    const worker = new Worker('/e2e/fixtures/paged-asset-staging-worker.ts', {
      type: 'module',
    });
    await new Promise<void>((resolve, reject) => {
      worker.onmessage = (event) => {
        if (event.data === 'staged') resolve();
      };
      worker.onerror = () => reject(new Error('Staging worker failed'));
      worker.postMessage({ assetId: abandonedAssetId });
    });

    const whileLive = await reconciliation.reconcileStalePagedAssetStaging({
      nowEpochMs: Date.now(),
      maxAssets: 64,
    });
    const repository = new repositories.IndexedDbPagedAssetRepository();
    await persistReady(repository, readyAssetId);
    const unprotected = new repositories.IndexedDbPagedAssetRepository(
      indexedDB,
      IDBKeyRange,
      { hold: async () => null },
      () => 1,
      1,
    );
    await beginOnePage(unprotected, unprotectedAssetId);
    await putLegacyStaging(legacyAssetId);
    worker.terminate();
    await new Promise((resolve) => window.setTimeout(resolve, 50));
    return {
      whileLive,
      abandonedAssetId,
      readyAssetId,
      unprotectedAssetId,
      legacyAssetId,
    };

    async function beginOnePage(target: Repository, assetId: string): Promise<Manifest> {
      const staging: Manifest = {
        schemaVersion: 1,
        assetId,
        sourceName: `${assetId}.bin`,
        mimeType: 'application/octet-stream',
        byteLength: 4,
        writtenByteLength: 0,
        pageBytes: 4,
        pageCount: 1,
        createdAtEpochMs: 1,
        state: 'staging',
      };
      await target.begin(staging);
      await target.writePage(assetId, 0, new Blob(['data']));
      return { ...staging, writtenByteLength: 4 };
    }

    async function persistReady(target: Repository, assetId: string): Promise<void> {
      const staging = await beginOnePage(target, assetId);
      await target.commit({ ...staging, state: 'ready' });
    }

    async function putLegacyStaging(assetId: string): Promise<void> {
      const pending = indexedDB.open('curvedesk-import-assets-v1', 5);
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        pending.onsuccess = () => resolve(pending.result);
        pending.onerror = () => reject(pending.error ?? new Error('Could not open asset storage'));
      });
      const tx = database.transaction('manifests', 'readwrite');
      tx.objectStore('manifests').add({
        schemaVersion: 1,
        assetId,
        sourceName: `${assetId}.bin`,
        mimeType: 'application/octet-stream',
        byteLength: 4,
        writtenByteLength: 0,
        pageBytes: 4,
        pageCount: 1,
        createdAtEpochMs: 1,
        state: 'staging',
      } satisfies Manifest);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('Could not store legacy staging'));
      });
      database.close();
    }
  });

  expect(initial.whileLive).toMatchObject({ removed: 0, retainedLive: 1 });
  await page.reload();
  const afterStartup = await page.evaluate(async (assetIds) => {
    interface Repository {
      readManifest(assetId: string): Promise<{ readonly state: string } | null>;
    }
    interface RepositoryApi {
      IndexedDbPagedAssetRepository: new () => Repository;
    }
    const repositoryPath = '/src/ui/import/paged-asset-indexeddb.ts';
    const repositories = (await import(
      /* @vite-ignore */ repositoryPath
    )) as Partial<RepositoryApi>;
    if (repositories.IndexedDbPagedAssetRepository === undefined) {
      throw new Error('Page-asset repository is unavailable after reload');
    }
    const repository = new repositories.IndexedDbPagedAssetRepository();
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if ((await repository.readManifest(assetIds.abandonedAssetId)) === null) break;
      await new Promise((resolve) => window.setTimeout(resolve, 10));
    }
    return {
      abandoned: (await repository.readManifest(assetIds.abandonedAssetId))?.state ?? null,
      ready: (await repository.readManifest(assetIds.readyAssetId))?.state ?? null,
      unprotected: (await repository.readManifest(assetIds.unprotectedAssetId))?.state ?? null,
      legacy: (await repository.readManifest(assetIds.legacyAssetId))?.state ?? null,
    };
  }, initial);

  expect(afterStartup).toEqual({
    abandoned: null,
    ready: 'ready',
    unprotected: 'staging',
    legacy: 'staging',
  });
  expect(workerUrls.some((url) => url.includes('paged-asset-staging-worker'))).toBe(true);
});
