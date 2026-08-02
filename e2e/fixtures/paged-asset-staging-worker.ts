import { IndexedDbPagedAssetRepository } from '../../src/ui/import/paged-asset-indexeddb';
import { PagedAssetStagingLocks } from '../../src/ui/import/paged-asset-staging-lock';
import type { PagedAssetManifest } from '../../src/ui/import/paged-asset-stager';

interface StagingWorkerRequest {
  readonly assetId: string;
}

const workerScope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<StagingWorkerRequest>) => void) | null;
  postMessage(message: string): void;
};

workerScope.onmessage = (event): void => {
  const repository = new IndexedDbPagedAssetRepository(
    indexedDB,
    IDBKeyRange,
    new PagedAssetStagingLocks(),
    () => 1,
    1,
  );
  const manifest: PagedAssetManifest = {
    schemaVersion: 1,
    assetId: event.data.assetId,
    sourceName: 'interrupted.bin',
    mimeType: 'application/octet-stream',
    byteLength: 4,
    writtenByteLength: 0,
    pageBytes: 4,
    pageCount: 1,
    createdAtEpochMs: 1,
    state: 'staging',
  };
  void repository
    .begin(manifest)
    .then(() => repository.writePage(manifest.assetId, 0, new Blob(['part'])))
    .then(() => workerScope.postMessage('staged'));
};
