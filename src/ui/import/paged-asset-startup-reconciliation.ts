import { PagedAssetLeaseLocks, type PagedAssetLeaseProbe } from './paged-asset-lease-lock';
import {
  IndexedDbPagedAssetReconciliationRepository,
  type ExpiredPagedAssetLease,
} from './paged-asset-startup-reconciliation-repository';

export type { ExpiredPagedAssetLease } from './paged-asset-startup-reconciliation-repository';

export const MAX_PAGED_ASSET_RECONCILIATION_LEASES = 64;

export type PagedAssetReconciliationOptions = {
  readonly nowEpochMs: number;
  readonly maxLeases: number;
};

export type PagedAssetReconciliationResult = {
  readonly examined: number;
  readonly removed: number;
  readonly retainedLive: number;
  readonly retainedUnsupported: number;
};

type ReconciliationRepository = {
  listExpiredLeases(nowEpochMs: number, maxLeases: number): Promise<ExpiredPagedAssetLease[]>;
  removeExpiredLease(candidate: ExpiredPagedAssetLease, nowEpochMs: number): Promise<boolean>;
};

export async function reconcileExpiredPagedAssetLeases(
  options: PagedAssetReconciliationOptions,
  repository: ReconciliationRepository = new IndexedDbPagedAssetReconciliationRepository(),
  probe: PagedAssetLeaseProbe = new PagedAssetLeaseLocks(),
): Promise<PagedAssetReconciliationResult> {
  assertOptions(options);
  const candidates = await repository.listExpiredLeases(options.nowEpochMs, options.maxLeases);
  let removed = 0;
  let retainedLive = 0;
  let retainedUnsupported = 0;
  for (const candidate of candidates) {
    const outcome = await probe.runIfAbandoned(candidate.leaseId, async () => {
      if (await repository.removeExpiredLease(candidate, options.nowEpochMs)) removed += 1;
    });
    if (outcome === 'live') retainedLive += 1;
    if (outcome === 'unsupported') retainedUnsupported += 1;
  }
  return {
    examined: candidates.length,
    removed,
    retainedLive,
    retainedUnsupported,
  };
}

function assertOptions(options: PagedAssetReconciliationOptions): void {
  if (!Number.isSafeInteger(options.nowEpochMs) || options.nowEpochMs < 0) {
    throw new Error('Page-asset reconciliation time must be a non-negative safe integer.');
  }
  if (!Number.isSafeInteger(options.maxLeases) || options.maxLeases <= 0) {
    throw new Error('Page-asset reconciliation limit must be a positive safe integer.');
  }
  if (options.maxLeases > MAX_PAGED_ASSET_RECONCILIATION_LEASES) {
    throw new Error(
      `Page-asset reconciliation limit cannot exceed ${MAX_PAGED_ASSET_RECONCILIATION_LEASES}.`,
    );
  }
}
