import { PagedAssetStagingLocks, type PagedAssetStagingProbe } from './paged-asset-staging-lock';
import {
  IndexedDbPagedAssetStagingReconciliationRepository,
  type StalePagedAssetStaging,
} from './paged-asset-startup-staging-cleanup-repository';

export type { StalePagedAssetStaging } from './paged-asset-startup-staging-cleanup-repository';

export const MAX_PAGED_ASSET_STAGING_RECONCILIATIONS = 64;

export type PagedAssetStagingReconciliationOptions = {
  readonly nowEpochMs: number;
  readonly maxAssets: number;
};

export type PagedAssetStagingReconciliationResult = {
  readonly examined: number;
  readonly removed: number;
  readonly retainedLive: number;
  readonly retainedUnsupported: number;
};

type StagingReconciliationRepository = {
  listStaleProtectedStaging(
    nowEpochMs: number,
    maxAssets: number,
  ): Promise<StalePagedAssetStaging[]>;
  removeStaleProtectedStaging(
    candidate: StalePagedAssetStaging,
    nowEpochMs: number,
  ): Promise<boolean>;
};

export async function reconcileStalePagedAssetStaging(
  options: PagedAssetStagingReconciliationOptions,
  repository: StagingReconciliationRepository = new IndexedDbPagedAssetStagingReconciliationRepository(),
  probe: PagedAssetStagingProbe = new PagedAssetStagingLocks(),
): Promise<PagedAssetStagingReconciliationResult> {
  assertOptions(options);
  const candidates = await repository.listStaleProtectedStaging(
    options.nowEpochMs,
    options.maxAssets,
  );
  let removed = 0;
  let retainedLive = 0;
  let retainedUnsupported = 0;
  for (const candidate of candidates) {
    const outcome = await probe.runIfAbandoned(candidate.assetId, async () => {
      if (await repository.removeStaleProtectedStaging(candidate, options.nowEpochMs)) removed += 1;
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

function assertOptions(options: PagedAssetStagingReconciliationOptions): void {
  if (!Number.isSafeInteger(options.nowEpochMs) || options.nowEpochMs < 0) {
    throw new Error('Page-asset staging reconciliation time must be a non-negative safe integer.');
  }
  if (!Number.isSafeInteger(options.maxAssets) || options.maxAssets <= 0) {
    throw new Error('Page-asset staging reconciliation limit must be a positive safe integer.');
  }
  if (options.maxAssets > MAX_PAGED_ASSET_STAGING_RECONCILIATIONS) {
    throw new Error(
      `Page-asset staging reconciliation limit cannot exceed ${MAX_PAGED_ASSET_STAGING_RECONCILIATIONS}.`,
    );
  }
}
