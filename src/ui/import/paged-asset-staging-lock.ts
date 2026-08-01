import {
  PagedAssetCrossRealmLocks,
  pagedAssetCrossRealmLockName,
  type PagedAssetCrossRealmGuard,
  type PagedAssetCrossRealmHolder,
  type PagedAssetCrossRealmProbe,
  type PagedAssetCrossRealmProbeResult,
} from './paged-asset-cross-realm-lock';

const PAGED_ASSET_STAGING_LOCK_NAMESPACE = 'curvedesk-page-asset-staging';

export type PagedAssetStagingGuard = PagedAssetCrossRealmGuard;
export type PagedAssetStagingHolder = PagedAssetCrossRealmHolder;
export type PagedAssetStagingProbeResult = PagedAssetCrossRealmProbeResult;
export type PagedAssetStagingProbe = PagedAssetCrossRealmProbe;

export class PagedAssetStagingLocks extends PagedAssetCrossRealmLocks {
  constructor(manager: LockManager | undefined = globalThis.navigator?.locks) {
    super(PAGED_ASSET_STAGING_LOCK_NAMESPACE, manager);
  }
}

export function pagedAssetStagingLockName(assetId: string): string {
  return pagedAssetCrossRealmLockName(PAGED_ASSET_STAGING_LOCK_NAMESPACE, assetId);
}
