import { IDBFactory as FakeIDBFactory, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb';
import { Blob as NodeBlob } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { IndexedDbPagedAssetRepository } from './paged-asset-indexeddb';
import {
  PAGED_ASSET_DATABASE_NAME,
  PAGED_ASSET_DATABASE_VERSION,
  PAGED_ASSET_MANIFEST_STORE,
  upgradePagedAssetDatabase,
} from './paged-asset-indexeddb-schema';
import { IndexedDbPagedAssetStagingReconciliationRepository } from './paged-asset-startup-staging-cleanup-repository';
import type { PagedAssetManifest } from './paged-asset-stager';

describe('IndexedDbPagedAssetStagingReconciliationRepository', () => {
  it('bounds candidates and deletes only exact expired protected staging records', async () => {
    const factory = new FakeIDBFactory();
    const assets = protectedRepository(factory);
    await beginOnePage(assets, 'stale-a');
    await beginOnePage(assets, 'stale-b');
    const reconciliation = new IndexedDbPagedAssetStagingReconciliationRepository(
      factory,
      FakeIDBKeyRange,
    );

    const firstBatch = await reconciliation.listStaleProtectedStaging(2_000, 1);
    expect(firstBatch).toHaveLength(1);
    await expect(reconciliation.removeStaleProtectedStaging(firstBatch[0]!, 2_000)).resolves.toBe(
      true,
    );

    await expect(assets.readManifest(firstBatch[0]!.assetId)).resolves.toBeNull();
    await expect(assets.readPage(firstBatch[0]!.assetId, 0)).resolves.toBeNull();
    await expect(reconciliation.listStaleProtectedStaging(2_000, 1)).resolves.toHaveLength(1);
  });

  it('never offers ready, legacy, or unprotected staging as cleanup candidates', async () => {
    const factory = new FakeIDBFactory();
    const protectedAssets = protectedRepository(factory);
    await beginOnePage(protectedAssets, 'ready');
    const ready = (await protectedAssets.readManifest('ready'))!;
    await protectedAssets.commit({ ...ready, state: 'ready' });

    const unprotectedAssets = new IndexedDbPagedAssetRepository(
      factory,
      FakeIDBKeyRange,
      {
        hold: async () => {
          throw new DOMException('lock unavailable', 'SecurityError');
        },
      },
      () => 1_000,
      100,
    );
    await beginOnePage(unprotectedAssets, 'unprotected');
    await putLegacyStaging(factory, 'legacy');

    const reconciliation = new IndexedDbPagedAssetStagingReconciliationRepository(
      factory,
      FakeIDBKeyRange,
    );
    await expect(reconciliation.listStaleProtectedStaging(2_000, 64)).resolves.toEqual([]);
    await expect(protectedAssets.readManifest('ready')).resolves.toMatchObject({ state: 'ready' });
    const unprotected = await unprotectedAssets.readManifest('unprotected');
    expect(unprotected).toMatchObject({ state: 'staging' });
    expect(unprotected).not.toHaveProperty('stagingLockProtection');
    const legacy = await unprotectedAssets.readManifest('legacy');
    expect(legacy).toMatchObject({ state: 'staging' });
    expect(legacy).not.toHaveProperty('stagingLockProtection');
  });

  it('does not delete a replacement unprotected staging record that reused a candidate id', async () => {
    const factory = new FakeIDBFactory();
    const protectedAssets = protectedRepository(factory);
    await beginOnePage(protectedAssets, 'reused');
    const reconciliation = new IndexedDbPagedAssetStagingReconciliationRepository(
      factory,
      FakeIDBKeyRange,
    );
    const candidate = (await reconciliation.listStaleProtectedStaging(2_000, 1))[0]!;
    await protectedAssets.abort('reused');

    const unprotectedAssets = new IndexedDbPagedAssetRepository(
      factory,
      FakeIDBKeyRange,
      { hold: async () => null },
      () => 1_000,
      100,
    );
    await beginOnePage(unprotectedAssets, 'reused');

    await expect(reconciliation.removeStaleProtectedStaging(candidate, 2_000)).resolves.toBe(false);
    const replacement = await unprotectedAssets.readManifest('reused');
    expect(replacement).toMatchObject({ state: 'staging' });
    expect(replacement).not.toHaveProperty('stagingLockProtection');
    await expect(unprotectedAssets.readPage('reused', 0)).resolves.toMatchObject({ size: 4 });
  });
});

function protectedRepository(factory: IDBFactory): IndexedDbPagedAssetRepository {
  return new IndexedDbPagedAssetRepository(
    factory,
    FakeIDBKeyRange,
    {
      hold: async () => ({
        release: async () => undefined,
      }),
    },
    () => 1_000,
    100,
  );
}

async function beginOnePage(
  repository: IndexedDbPagedAssetRepository,
  assetId: string,
): Promise<void> {
  await repository.begin(stagingManifest(assetId));
  await repository.writePage(assetId, 0, new NodeBlob(['data']) as Blob);
}

function stagingManifest(assetId: string): PagedAssetManifest {
  return {
    schemaVersion: 1,
    assetId,
    sourceName: `${assetId}.bin`,
    mimeType: 'application/octet-stream',
    byteLength: 4,
    writtenByteLength: 0,
    pageBytes: 4,
    pageCount: 1,
    createdAtEpochMs: 1_000,
    state: 'staging',
  };
}

async function putLegacyStaging(factory: IDBFactory, assetId: string): Promise<void> {
  const database = await openDatabase(factory);
  const tx = database.transaction(PAGED_ASSET_MANIFEST_STORE, 'readwrite');
  tx.objectStore(PAGED_ASSET_MANIFEST_STORE).add(stagingManifest(assetId));
  await transactionFinished(tx);
  database.close();
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const pending = factory.open(PAGED_ASSET_DATABASE_NAME, PAGED_ASSET_DATABASE_VERSION);
    pending.onupgradeneeded = () => upgradePagedAssetDatabase(pending.result, pending.transaction);
    pending.onsuccess = () => resolve(pending.result);
    pending.onerror = () => reject(pending.error ?? new Error('Could not open asset storage.'));
  });
}

function transactionFinished(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Asset storage transaction failed.'));
    tx.onabort = () => reject(tx.error ?? new Error('Asset storage transaction aborted.'));
  });
}
