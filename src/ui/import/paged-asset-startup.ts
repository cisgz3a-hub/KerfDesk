import {
  MAX_PAGED_ASSET_RECONCILIATION_LEASES,
  reconcileExpiredPagedAssetLeases,
} from './paged-asset-startup-reconciliation';
import {
  MAX_PAGED_ASSET_STAGING_RECONCILIATIONS,
  reconcileStalePagedAssetStaging,
} from './paged-asset-startup-staging-cleanup';

export function startPagedAssetReconciliation(): void {
  void reconcileExpiredPagedAssetLeases({
    nowEpochMs: Date.now(),
    maxLeases: MAX_PAGED_ASSET_RECONCILIATION_LEASES,
  }).catch((error: unknown) => {
    console.error('Page-asset lease reconciliation failed; retained stored assets.', error);
  });
  void reconcileStalePagedAssetStaging({
    nowEpochMs: Date.now(),
    maxAssets: MAX_PAGED_ASSET_STAGING_RECONCILIATIONS,
  }).catch((error: unknown) => {
    console.error('Page-asset staging reconciliation failed; retained stored assets.', error);
  });
}
