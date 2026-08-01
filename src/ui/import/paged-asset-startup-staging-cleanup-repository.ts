import type { PagedAssetManifest } from './paged-asset-stager';
import {
  PAGED_ASSET_DATABASE_NAME,
  PAGED_ASSET_DATABASE_VERSION,
  PAGED_ASSET_DELETION_STORE,
  PAGED_ASSET_LEASE_STORE,
  PAGED_ASSET_MANIFEST_STORE,
  PAGED_ASSET_PAGE_STORE,
  PAGED_ASSET_STAGING_EXPIRY_INDEX,
  upgradePagedAssetDatabase,
} from './paged-asset-indexeddb-schema';

export type StalePagedAssetStaging = PagedAssetManifest & {
  readonly state: 'staging';
  readonly stagingLockProtection: 'web-lock';
  readonly stagingExpiresAtEpochMs: number;
};

export class IndexedDbPagedAssetStagingReconciliationRepository {
  private databasePromise: Promise<IDBDatabase> | null = null;

  constructor(
    private readonly factory: IDBFactory | undefined = globalThis.indexedDB,
    private readonly keyRanges:
      | Pick<typeof IDBKeyRange, 'bound'>
      | undefined = globalThis.IDBKeyRange,
  ) {}

  async listStaleProtectedStaging(
    nowEpochMs: number,
    maxAssets: number,
  ): Promise<StalePagedAssetStaging[]> {
    const database = await this.database();
    const tx = database.transaction(PAGED_ASSET_MANIFEST_STORE, 'readonly');
    const candidates = await request<StalePagedAssetStaging[]>(
      tx
        .objectStore(PAGED_ASSET_MANIFEST_STORE)
        .index(PAGED_ASSET_STAGING_EXPIRY_INDEX)
        .getAll(this.expiredProtectedRange(nowEpochMs), maxAssets),
    );
    await transactionFinished(tx);
    return candidates;
  }

  async removeStaleProtectedStaging(
    candidate: StalePagedAssetStaging,
    nowEpochMs: number,
  ): Promise<boolean> {
    const database = await this.database();
    const tx = database.transaction(
      [
        PAGED_ASSET_MANIFEST_STORE,
        PAGED_ASSET_PAGE_STORE,
        PAGED_ASSET_LEASE_STORE,
        PAGED_ASSET_DELETION_STORE,
      ],
      'readwrite',
    );
    const manifests = tx.objectStore(PAGED_ASSET_MANIFEST_STORE);
    const current = await request<PagedAssetManifest | undefined>(manifests.get(candidate.assetId));
    if (
      current?.state !== 'staging' ||
      current.stagingLockProtection !== 'web-lock' ||
      current.stagingExpiresAtEpochMs !== candidate.stagingExpiresAtEpochMs ||
      current.stagingExpiresAtEpochMs > nowEpochMs
    ) {
      await transactionFinished(tx);
      return false;
    }
    await request(manifests.delete(candidate.assetId));
    await request(tx.objectStore(PAGED_ASSET_PAGE_STORE).delete(this.pageRange(candidate.assetId)));
    await request(
      tx.objectStore(PAGED_ASSET_LEASE_STORE).delete(this.leaseRange(candidate.assetId)),
    );
    await request(tx.objectStore(PAGED_ASSET_DELETION_STORE).delete(candidate.assetId));
    await transactionFinished(tx);
    return true;
  }

  private database(): Promise<IDBDatabase> {
    if (this.factory === undefined) return Promise.reject(new Error('IndexedDB is unavailable.'));
    this.databasePromise ??= openDatabase(this.factory);
    return this.databasePromise;
  }

  private expiredProtectedRange(nowEpochMs: number): IDBKeyRange {
    if (this.keyRanges === undefined) throw new Error('IndexedDB key ranges are unavailable.');
    return this.keyRanges.bound(['staging', 'web-lock', 0], ['staging', 'web-lock', nowEpochMs]);
  }

  private pageRange(assetId: string): IDBKeyRange {
    if (this.keyRanges === undefined) throw new Error('IndexedDB key ranges are unavailable.');
    return this.keyRanges.bound([assetId, 0], [assetId, Number.MAX_SAFE_INTEGER]);
  }

  private leaseRange(assetId: string): IDBKeyRange {
    if (this.keyRanges === undefined) throw new Error('IndexedDB key ranges are unavailable.');
    return this.keyRanges.bound([assetId, ''], [assetId, '\uffff']);
  }
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const pending = factory.open(PAGED_ASSET_DATABASE_NAME, PAGED_ASSET_DATABASE_VERSION);
    pending.onupgradeneeded = () => upgradePagedAssetDatabase(pending.result, pending.transaction);
    pending.onsuccess = () => {
      const database = pending.result;
      database.onversionchange = () => database.close();
      resolve(database);
    };
    pending.onerror = () => reject(pending.error ?? new Error('Could not open asset storage.'));
    pending.onblocked = () => reject(new Error('Asset storage upgrade is blocked.'));
  });
}

function request<T = IDBValidKey>(pending: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    pending.onsuccess = () => resolve(pending.result);
    pending.onerror = () => reject(pending.error ?? new Error('Asset storage request failed.'));
  });
}

function transactionFinished(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Asset storage transaction failed.'));
    tx.onabort = () => reject(tx.error ?? new Error('Asset storage transaction aborted.'));
  });
}
