import type { PagedAssetLeaseRecord } from './paged-asset-lease-record';
import {
  PAGED_ASSET_DATABASE_NAME,
  PAGED_ASSET_DATABASE_VERSION,
  PAGED_ASSET_LEASE_EXPIRY_INDEX,
  PAGED_ASSET_LEASE_STORE,
  upgradePagedAssetDatabase,
} from './paged-asset-indexeddb-schema';

export type ExpiredPagedAssetLease = PagedAssetLeaseRecord;

export class IndexedDbPagedAssetReconciliationRepository {
  private databasePromise: Promise<IDBDatabase> | null = null;

  constructor(
    private readonly factory: IDBFactory | undefined = globalThis.indexedDB,
    private readonly keyRanges:
      | Pick<typeof IDBKeyRange, 'bound'>
      | undefined = globalThis.IDBKeyRange,
  ) {}

  async listExpiredLeases(
    nowEpochMs: number,
    maxLeases: number,
  ): Promise<ExpiredPagedAssetLease[]> {
    const database = await this.database();
    const tx = database.transaction(PAGED_ASSET_LEASE_STORE, 'readonly');
    const range = this.expiredProtectedRange(nowEpochMs);
    const leases = await request<ExpiredPagedAssetLease[]>(
      tx
        .objectStore(PAGED_ASSET_LEASE_STORE)
        .index(PAGED_ASSET_LEASE_EXPIRY_INDEX)
        .getAll(range, maxLeases),
    );
    await transactionFinished(tx);
    return leases;
  }

  async removeExpiredLease(
    candidate: ExpiredPagedAssetLease,
    nowEpochMs: number,
  ): Promise<boolean> {
    const database = await this.database();
    const tx = database.transaction(PAGED_ASSET_LEASE_STORE, 'readwrite');
    const leases = tx.objectStore(PAGED_ASSET_LEASE_STORE);
    const current = await request<PagedAssetLeaseRecord | undefined>(
      leases.get([candidate.assetId, candidate.leaseId]),
    );
    if (
      current === undefined ||
      current.lockProtection !== 'web-lock' ||
      current.expiresAtEpochMs !== candidate.expiresAtEpochMs ||
      current.expiresAtEpochMs > nowEpochMs
    ) {
      await transactionFinished(tx);
      return false;
    }
    await request(leases.delete([candidate.assetId, candidate.leaseId]));
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
    return this.keyRanges.bound(['web-lock', 0], ['web-lock', nowEpochMs]);
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

function request<T>(pending: IDBRequest<T>): Promise<T> {
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
