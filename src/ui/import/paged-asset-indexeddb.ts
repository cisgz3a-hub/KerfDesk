import type { PagedAssetManifest, PagedAssetSink } from './paged-asset-stager';
import { IndexedDbPagedAssetLeaseRepository } from './paged-asset-indexeddb-leases';
import {
  PAGED_ASSET_DATABASE_NAME,
  PAGED_ASSET_DATABASE_VERSION,
  PAGED_ASSET_DELETION_STORE,
  PAGED_ASSET_LEASE_STORE,
  PAGED_ASSET_MANIFEST_STORE,
  PAGED_ASSET_PAGE_STORE,
  upgradePagedAssetDatabase,
} from './paged-asset-indexeddb-schema';
import {
  PagedAssetStagingLocks,
  type PagedAssetStagingGuard,
  type PagedAssetStagingHolder,
} from './paged-asset-staging-lock';

export const DEFAULT_PAGED_ASSET_STAGING_TTL_MS = 24 * 60 * 60 * 1_000;

type StoredPage = {
  readonly assetId: string;
  readonly index: number;
  readonly blob: Blob;
  readonly size: number;
};

export class IndexedDbPagedAssetRepository implements PagedAssetSink {
  private databasePromise: Promise<IDBDatabase> | null = null;
  private readonly leases: IndexedDbPagedAssetLeaseRepository;
  private readonly heldStagingGuards = new Map<string, PagedAssetStagingGuard>();

  constructor(
    private readonly factory: IDBFactory | undefined = globalThis.indexedDB,
    private readonly keyRanges:
      | Pick<typeof IDBKeyRange, 'bound'>
      | undefined = globalThis.IDBKeyRange,
    private readonly stagingLocks: PagedAssetStagingHolder = new PagedAssetStagingLocks(),
    private readonly now: () => number = Date.now,
    private readonly stagingTtlMs = DEFAULT_PAGED_ASSET_STAGING_TTL_MS,
  ) {
    this.leases = new IndexedDbPagedAssetLeaseRepository(factory, keyRanges);
  }

  async begin(manifest: PagedAssetManifest): Promise<void> {
    if (manifest.state !== 'staging') throw new Error('Asset begin requires a staging manifest.');
    if (manifest.writtenByteLength !== 0) {
      throw new Error('Asset staging must begin with zero written bytes.');
    }
    const guard = await this.stagingLocks.hold(manifest.assetId).catch(() => null);
    const protectedManifest = this.protectedStagingManifest(manifest, guard);
    try {
      const database = await this.database();
      const tx = database.transaction(PAGED_ASSET_MANIFEST_STORE, 'readwrite');
      await request(tx.objectStore(PAGED_ASSET_MANIFEST_STORE).add(protectedManifest));
      await transactionFinished(tx);
      if (guard !== null && protectedManifest.stagingLockProtection === 'web-lock') {
        this.heldStagingGuards.set(manifest.assetId, guard);
      } else {
        await guard?.release().catch(() => undefined);
      }
    } catch (error) {
      await guard?.release().catch(() => undefined);
      throw error;
    }
  }

  async writePage(assetId: string, index: number, page: Blob): Promise<void> {
    const database = await this.database();
    const tx = database.transaction(
      [PAGED_ASSET_MANIFEST_STORE, PAGED_ASSET_PAGE_STORE],
      'readwrite',
    );
    try {
      const manifests = tx.objectStore(PAGED_ASSET_MANIFEST_STORE);
      const existing = await request<PagedAssetManifest | undefined>(manifests.get(assetId));
      if (existing?.state !== 'staging') throw new Error('Asset staging manifest is missing.');
      const expectedIndex = Math.floor(existing.writtenByteLength / existing.pageBytes);
      if (index !== expectedIndex) {
        throw new Error(`Asset page index is ${index}; expected ${expectedIndex}.`);
      }
      const expectedBytes = Math.min(
        existing.pageBytes,
        existing.byteLength - existing.writtenByteLength,
      );
      if (page.size !== expectedBytes) {
        throw new Error(`Asset page has ${page.size} bytes; expected ${expectedBytes}.`);
      }
      await request(
        tx.objectStore(PAGED_ASSET_PAGE_STORE).add({
          assetId,
          index,
          blob: page,
          size: page.size,
        } satisfies StoredPage),
      );
      await request(
        manifests.put({
          ...existing,
          writtenByteLength: existing.writtenByteLength + page.size,
        }),
      );
      await transactionFinished(tx);
    } catch (error) {
      abortIfActive(tx);
      throw error;
    }
  }

  async commit(manifest: PagedAssetManifest): Promise<void> {
    if (manifest.state !== 'ready') throw new Error('Asset commit requires a ready manifest.');
    const database = await this.database();
    const tx = database.transaction(
      [PAGED_ASSET_MANIFEST_STORE, PAGED_ASSET_PAGE_STORE],
      'readwrite',
    );
    try {
      const existing = await request<PagedAssetManifest | undefined>(
        tx.objectStore(PAGED_ASSET_MANIFEST_STORE).get(manifest.assetId),
      );
      if (existing?.state !== 'staging') throw new Error('Asset staging manifest is missing.');
      if (
        existing.byteLength !== manifest.byteLength ||
        existing.writtenByteLength !== manifest.byteLength ||
        manifest.writtenByteLength !== manifest.byteLength ||
        existing.pageBytes !== manifest.pageBytes ||
        existing.pageCount !== manifest.pageCount
      ) {
        throw new Error('Asset ready manifest does not match durable staging bytes.');
      }
      const storedPages = await request<number>(
        tx.objectStore(PAGED_ASSET_PAGE_STORE).count(this.pageRange(manifest.assetId)),
      );
      if (storedPages !== manifest.pageCount) {
        throw new Error(`Asset has ${storedPages} pages; expected ${manifest.pageCount}.`);
      }
      const {
        stagingLockProtection: _stagingLockProtection,
        stagingExpiresAtEpochMs: _stagingExpiresAtEpochMs,
        ...readyManifest
      } = manifest;
      await request(tx.objectStore(PAGED_ASSET_MANIFEST_STORE).put(readyManifest));
      await transactionFinished(tx);
      await this.releaseStagingGuard(manifest.assetId);
    } catch (error) {
      abortIfActive(tx);
      throw error;
    }
  }

  async abort(assetId: string): Promise<void> {
    try {
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
      await request(tx.objectStore(PAGED_ASSET_MANIFEST_STORE).delete(assetId));
      await request(tx.objectStore(PAGED_ASSET_PAGE_STORE).delete(this.pageRange(assetId)));
      await request(tx.objectStore(PAGED_ASSET_LEASE_STORE).delete(this.leaseRange(assetId)));
      await request(tx.objectStore(PAGED_ASSET_DELETION_STORE).delete(assetId));
      await transactionFinished(tx);
    } finally {
      await this.releaseStagingGuard(assetId);
    }
  }

  acquireReadLease(assetIds: readonly string[], leaseId: string): Promise<void> {
    return this.leaseRepository().acquireReadLease(assetIds, leaseId);
  }

  releaseReadLease(assetIds: readonly string[], leaseId: string): Promise<void> {
    return this.leaseRepository().releaseReadLease(assetIds, leaseId);
  }

  async readManifest(assetId: string): Promise<PagedAssetManifest | null> {
    const database = await this.database();
    const tx = database.transaction(PAGED_ASSET_MANIFEST_STORE, 'readonly');
    const manifest = await request<PagedAssetManifest | undefined>(
      tx.objectStore(PAGED_ASSET_MANIFEST_STORE).get(assetId),
    );
    await transactionFinished(tx);
    return manifest ?? null;
  }

  async readPage(assetId: string, index: number): Promise<Blob | null> {
    const database = await this.database();
    const tx = database.transaction(PAGED_ASSET_PAGE_STORE, 'readonly');
    const page = await request<StoredPage | undefined>(
      tx.objectStore(PAGED_ASSET_PAGE_STORE).get([assetId, index]),
    );
    await transactionFinished(tx);
    return page?.blob ?? null;
  }

  async *readAssetChunks(
    assetId: string,
    signal?: AbortSignal,
  ): AsyncGenerator<Uint8Array<ArrayBuffer>> {
    const manifest = await this.readManifest(assetId);
    if (manifest?.state !== 'ready') throw new Error('Ready asset manifest is missing.');
    for (let index = 0; index < manifest.pageCount; index += 1) {
      throwIfCancelled(signal);
      const page = await this.readPage(assetId, index);
      const expectedBytes = Math.min(
        manifest.pageBytes,
        manifest.byteLength - index * manifest.pageBytes,
      );
      if (page === null || page.size !== expectedBytes) {
        throw new Error(`Asset page ${index} is missing or has an invalid byte length.`);
      }
      const bytes = new Uint8Array(await page.arrayBuffer());
      if (bytes.byteLength !== expectedBytes) {
        throw new Error(`Asset page ${index} read returned an invalid byte length.`);
      }
      throwIfCancelled(signal);
      yield bytes;
    }
  }

  private database(): Promise<IDBDatabase> {
    if (this.factory === undefined) return Promise.reject(new Error('IndexedDB is unavailable.'));
    this.databasePromise ??= openDatabase(this.factory);
    return this.databasePromise;
  }

  private pageRange(assetId: string): IDBKeyRange {
    if (this.keyRanges === undefined) throw new Error('IndexedDB key ranges are unavailable.');
    return this.keyRanges.bound([assetId, 0], [assetId, Number.MAX_SAFE_INTEGER]);
  }

  private leaseRange(assetId: string): IDBKeyRange {
    if (this.keyRanges === undefined) throw new Error('IndexedDB key ranges are unavailable.');
    return this.keyRanges.bound([assetId, ''], [assetId, '\uffff']);
  }

  private leaseRepository(): IndexedDbPagedAssetLeaseRepository {
    return this.leases;
  }

  private protectedStagingManifest(
    manifest: PagedAssetManifest,
    guard: PagedAssetStagingGuard | null,
  ): PagedAssetManifest {
    if (guard === null) return manifest;
    const expiresAtEpochMs = this.now() + this.stagingTtlMs;
    if (!Number.isSafeInteger(expiresAtEpochMs) || expiresAtEpochMs < 0) return manifest;
    return {
      ...manifest,
      stagingLockProtection: 'web-lock',
      stagingExpiresAtEpochMs: expiresAtEpochMs,
    };
  }

  private async releaseStagingGuard(assetId: string): Promise<void> {
    const guard = this.heldStagingGuards.get(assetId);
    if (guard === undefined) return;
    this.heldStagingGuards.delete(assetId);
    await guard.release().catch(() => undefined);
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

function abortIfActive(tx: IDBTransaction): void {
  try {
    tx.abort();
  } catch {
    // Transaction already completed or aborted.
  }
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted !== true) return;
  const error = new Error('asset read cancelled');
  error.name = 'AbortError';
  throw error;
}
