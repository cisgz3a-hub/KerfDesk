import { IDBFactory as FakeIDBFactory, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb';
import { Blob as NodeBlob } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { IndexedDbPagedAssetRepository } from './paged-asset-indexeddb';
import { IndexedDbPagedAssetLeaseRepository } from './paged-asset-indexeddb-leases';
import { PAGED_ASSET_DATABASE_NAME, PAGED_ASSET_LEASE_STORE } from './paged-asset-indexeddb-schema';
import { IndexedDbPagedAssetReconciliationRepository } from './paged-asset-startup-reconciliation-repository';
import { stageAssetPages } from './paged-asset-stager';

describe('IndexedDbPagedAssetReconciliationRepository', () => {
  it('bounds expired lease rows and removes no manifest or page data', async () => {
    const factory = new FakeIDBFactory();
    const assets = new IndexedDbPagedAssetRepository(factory, FakeIDBKeyRange);
    const leases = new IndexedDbPagedAssetLeaseRepository(
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
    const reconciliation = new IndexedDbPagedAssetReconciliationRepository(
      factory,
      FakeIDBKeyRange,
    );
    await persist(assets, 'asset-a');
    await persist(assets, 'asset-b');
    await leases.acquireReadLease(['asset-a'], 'lease-a');
    await leases.acquireReadLease(['asset-b'], 'lease-b');

    const firstBatch = await reconciliation.listExpiredLeases(2_000, 1);
    expect(firstBatch).toHaveLength(1);
    await expect(reconciliation.removeExpiredLease(firstBatch[0]!, 2_000)).resolves.toBe(true);

    await expect(assets.readManifest(firstBatch[0]!.assetId)).resolves.toMatchObject({
      state: 'ready',
    });
    await expect(assets.readPage(firstBatch[0]!.assetId, 0)).resolves.toMatchObject({ size: 5 });
    await expect(reconciliation.listExpiredLeases(2_000, 1)).resolves.toHaveLength(1);
  });

  it('retains legacy lease rows that have no trustworthy expiry', async () => {
    const factory = new FakeIDBFactory();
    await createLegacyLease(factory);
    const reconciliation = new IndexedDbPagedAssetReconciliationRepository(
      factory,
      FakeIDBKeyRange,
    );

    await expect(reconciliation.listExpiredLeases(2_000, 64)).resolves.toEqual([]);
  });

  it('does not remove an unprotected lease that reused an expired candidate key', async () => {
    const factory = new FakeIDBFactory();
    const assets = new IndexedDbPagedAssetRepository(factory, FakeIDBKeyRange);
    const protectedLeases = new IndexedDbPagedAssetLeaseRepository(
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
    const unprotectedLeases = new IndexedDbPagedAssetLeaseRepository(
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
    const reconciliation = new IndexedDbPagedAssetReconciliationRepository(
      factory,
      FakeIDBKeyRange,
    );
    await persist(assets, 'asset-reused');
    await protectedLeases.acquireReadLease(['asset-reused'], 'lease-reused');
    const candidate = (await reconciliation.listExpiredLeases(2_000, 1))[0]!;
    await protectedLeases.releaseReadLease(['asset-reused'], 'lease-reused');
    await unprotectedLeases.acquireReadLease(['asset-reused'], 'lease-reused');

    await expect(reconciliation.removeExpiredLease(candidate, 2_000)).resolves.toBe(false);
    await unprotectedLeases.releaseReadLease(['asset-reused'], 'lease-reused');
  });
});

async function persist(repository: IndexedDbPagedAssetRepository, assetId: string): Promise<void> {
  await stageAssetPages(
    new NodeBlob(['ready']) as Blob,
    {
      assetId,
      sourceName: `${assetId}.bin`,
      createdAtEpochMs: 1,
      pageBytes: 5,
    },
    repository,
  );
}

function createLegacyLease(factory: IDBFactory): Promise<void> {
  return new Promise((resolve, reject) => {
    const pending = factory.open(PAGED_ASSET_DATABASE_NAME, 2);
    pending.onupgradeneeded = () => {
      pending.result.createObjectStore(PAGED_ASSET_LEASE_STORE, {
        keyPath: ['assetId', 'leaseId'],
      });
    };
    pending.onerror = () => reject(pending.error ?? new Error('Legacy database setup failed.'));
    pending.onsuccess = () => {
      const database = pending.result;
      const tx = database.transaction(PAGED_ASSET_LEASE_STORE, 'readwrite');
      tx.objectStore(PAGED_ASSET_LEASE_STORE).add({
        assetId: 'legacy-asset',
        leaseId: 'legacy-lease',
      });
      tx.onerror = () => reject(tx.error ?? new Error('Legacy lease setup failed.'));
      tx.oncomplete = () => {
        database.close();
        resolve();
      };
    };
  });
}
