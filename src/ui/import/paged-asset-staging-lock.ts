import {
  PagedAssetCrossRealmLocks,
  type PagedAssetCrossRealmGuard,
  type PagedAssetCrossRealmHolder,
  type PagedAssetCrossRealmProbe,
} from './paged-asset-cross-realm-lock';

const PAGED_ASSET_STAGING_LOCK_NAMESPACE = 'curvedesk-page-asset-staging';

export type PagedAssetStagingGuard = PagedAssetCrossRealmGuard;
export type PagedAssetStagingHolder = PagedAssetCrossRealmHolder;
export type PagedAssetStagingProbe = PagedAssetCrossRealmProbe;

export class PagedAssetStagingLocks extends PagedAssetCrossRealmLocks {
  constructor(manager: LockManager | undefined = globalThis.navigator?.locks) {
    super(PAGED_ASSET_STAGING_LOCK_NAMESPACE, manager);
  }
}
