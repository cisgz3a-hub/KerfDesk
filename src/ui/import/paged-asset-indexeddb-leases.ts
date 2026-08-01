import type { PagedAssetManifest } from './paged-asset-stager';
import {
  DEFAULT_PAGED_ASSET_LEASE_TTL_MS,
  type PagedAssetLeaseRecord,
} from './paged-asset-lease-record';
import {
  PagedAssetLeaseLocks,
  type PagedAssetLeaseGuard,
  type PagedAssetLeaseHolder,
} from './paged-asset-lease-lock';
import {
  PAGED_ASSET_DATABASE_NAME,
  PAGED_ASSET_DATABASE_VERSION,
  PAGED_ASSET_DELETION_STORE,
  PAGED_ASSET_LEASE_STORE,
  PAGED_ASSET_MANIFEST_STORE,
  PAGED_ASSET_PAGE_STORE,
  upgradePagedAssetDatabase,
} from './paged-asset-indexeddb-schema';

type DeletionRecord = { readonly assetId: string };

export class IndexedDbPagedAssetLeaseRepository {
  private databasePromise: Promise<IDBDatabase> | null = null;
  private readonly heldLeaseGuards = new Map<string, PagedAssetLeaseGuard>();

  constructor(
    private readonly factory: IDBFactory | undefined = globalThis.indexedDB,
    private readonly keyRanges:
      | Pick<typeof IDBKeyRange, 'bound'>
      | undefined = globalThis.IDBKeyRange,
    private readonly locks: PagedAssetLeaseHolder = new PagedAssetLeaseLocks(),
    private readonly now: () => number = Date.now,
    private readonly leaseTtlMs = DEFAULT_PAGED_ASSET_LEASE_TTL_MS,
  ) {}

  async acquireReadLease(assetIds: readonly string[], leaseId: string): Promise<void> {
    if (this.heldLeaseGuards.has(leaseId))
      throw new Error(`Page-asset lease ${leaseId} is active.`);
    const database = await this.database();
    const guard = await this.locks.hold(leaseId).catch(() => null);
    let tx: IDBTransaction | null = null;
    try {
      tx = database.transaction([PAGED_ASSET_MANIFEST_STORE, PAGED_ASSET_LEASE_STORE], 'readwrite');
      for (const assetId of new Set(assetIds)) {
        const manifest = await request<PagedAssetManifest | undefined>(
          tx.objectStore(PAGED_ASSET_MANIFEST_STORE).get(assetId),
        );
        if (manifest?.state !== 'ready') {
          throw new Error(`Cannot lease unavailable page asset ${assetId}.`);
        }
        await request(
          tx
            .objectStore(PAGED_ASSET_LEASE_STORE)
            .add(this.leaseRecord(assetId, leaseId, guard !== null)),
        );
      }
      await transactionFinished(tx);
      if (guard !== null) this.heldLeaseGuards.set(leaseId, guard);
    } catch (error) {
      if (tx !== null) abortIfActive(tx);
      await guard?.release();
      throw error;
    }
  }

  async releaseReadLease(assetIds: readonly string[], leaseId: string): Promise<void> {
    const guard = this.heldLeaseGuards.get(leaseId);
    try {
      const database = await this.database();
      const tx = database.transaction(allStores(), 'readwrite');
      try {
        for (const assetId of new Set(assetIds)) {
          await request(tx.objectStore(PAGED_ASSET_LEASE_STORE).delete([assetId, leaseId]));
          if (await this.shouldCompleteDeferredDelete(tx, assetId)) {
            await deleteAssetRecords(
              tx,
              assetId,
              this.pageRange(assetId),
              this.leaseRange(assetId),
            );
          }
        }
        await transactionFinished(tx);
      } catch (error) {
        abortIfActive(tx);
        throw error;
      }
    } finally {
      this.heldLeaseGuards.delete(leaseId);
      await guard?.release();
    }
  }

  async cancelDelete(assetId: string): Promise<void> {
    const database = await this.database();
    const tx = database.transaction(PAGED_ASSET_DELETION_STORE, 'readwrite');
    await request(tx.objectStore(PAGED_ASSET_DELETION_STORE).delete(assetId));
    await transactionFinished(tx);
  }

  async requestDelete(assetId: string): Promise<'deleted' | 'deferred'> {
    const database = await this.database();
    const tx = database.transaction(allStores(), 'readwrite');
    try {
      const leaseCount = await request<number>(
        tx.objectStore(PAGED_ASSET_LEASE_STORE).count(this.leaseRange(assetId)),
      );
      if (leaseCount > 0) {
        await request(
          tx.objectStore(PAGED_ASSET_DELETION_STORE).put({ assetId } satisfies DeletionRecord),
        );
        await transactionFinished(tx);
        return 'deferred';
      }
      await deleteAssetRecords(tx, assetId, this.pageRange(assetId), this.leaseRange(assetId));
      await transactionFinished(tx);
      return 'deleted';
    } catch (error) {
      abortIfActive(tx);
      throw error;
    }
  }

  private async shouldCompleteDeferredDelete(
    tx: IDBTransaction,
    assetId: string,
  ): Promise<boolean> {
    const remaining = await request<number>(
      tx.objectStore(PAGED_ASSET_LEASE_STORE).count(this.leaseRange(assetId)),
    );
    if (remaining > 0) return false;
    const requested = await request<DeletionRecord | undefined>(
      tx.objectStore(PAGED_ASSET_DELETION_STORE).get(assetId),
    );
    return requested !== undefined;
  }

  private database(): Promise<IDBDatabase> {
    if (this.factory === undefined) return Promise.reject(new Error('IndexedDB is unavailable.'));
    this.databasePromise ??= openDatabase(this.factory);
    return this.databasePromise;
  }

  private leaseRecord(
    assetId: string,
    leaseId: string,
    hasLockProtection: boolean,
  ): PagedAssetLeaseRecord {
    return {
      assetId,
      leaseId,
      expiresAtEpochMs: this.now() + this.leaseTtlMs,
      lockProtection: hasLockProtection ? 'web-lock' : 'none',
    };
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

function allStores(): string[] {
  return [
    PAGED_ASSET_MANIFEST_STORE,
    PAGED_ASSET_PAGE_STORE,
    PAGED_ASSET_LEASE_STORE,
    PAGED_ASSET_DELETION_STORE,
  ];
}

async function deleteAssetRecords(
  tx: IDBTransaction,
  assetId: string,
  pageRange: IDBKeyRange,
  leaseRange: IDBKeyRange,
): Promise<void> {
  await request(tx.objectStore(PAGED_ASSET_MANIFEST_STORE).delete(assetId));
  await request(tx.objectStore(PAGED_ASSET_PAGE_STORE).delete(pageRange));
  await request(tx.objectStore(PAGED_ASSET_LEASE_STORE).delete(leaseRange));
  await request(tx.objectStore(PAGED_ASSET_DELETION_STORE).delete(assetId));
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

function abortIfActive(tx: IDBTransaction): void {
  try {
    tx.abort();
  } catch {
    // Transaction already completed or aborted.
  }
}
