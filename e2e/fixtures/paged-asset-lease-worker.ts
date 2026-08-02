import { IndexedDbPagedAssetLeaseRepository } from '../../src/ui/import/paged-asset-indexeddb-leases';
import { PagedAssetLeaseLocks } from '../../src/ui/import/paged-asset-lease-lock';

interface LeaseWorkerRequest {
  readonly assetId: string;
  readonly leaseId: string;
}

const workerScope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<LeaseWorkerRequest>) => void) | null;
  postMessage(message: string): void;
};

workerScope.onmessage = (event): void => {
  const repository = new IndexedDbPagedAssetLeaseRepository(
    indexedDB,
    IDBKeyRange,
    new PagedAssetLeaseLocks(),
    () => 1,
    1,
  );
  void repository.acquireReadLease([event.data.assetId], event.data.leaseId).then(() => {
    workerScope.postMessage('acquired');
  });
};
